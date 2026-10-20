// Renders the Northstar corpus with the demo model under the shared budget.
// Resumable: finished records are appended to records.jsonl and skipped on
// the next run. Usage:
//   DEMO_CORPUS_TOKENS=<ceiling> bun run corpus:render -- --secrets <file> [--limit N] [--only id,id] [--concurrency N]
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { createAnthropic } from "@ai-sdk/anthropic"
import { type ModelMessage, generateText, wrapLanguageModel } from "ai"
import { MongoClient } from "mongodb"
import {
	BudgetExhaustedError,
	budgetMiddleware,
	createModelBudget,
	operatorCeiling,
} from "../budget.js"
import {
	appendRecord,
	readRecords,
	sortRecords,
	writeWorld,
} from "./corpus-files.js"
import { realCompaniesIn } from "./names.js"
import {
	OUTPUT_TOKENS,
	inputTokenBound,
	recordPrompt,
	systemPrompt,
} from "./prompt.js"
import {
	CONTROL_DATABASE,
	CORPUS_BUDGET_KEY,
	CORPUS_CEILING_ENV,
	CORPUS_SEED,
	DEMO_MODEL,
	MAX_INPUT_TOKENS,
} from "./render-config.js"
import type { SourceSpec } from "./types.js"
import { buildWorld } from "./world.js"

const { values: args } = parseArgs({
	options: {
		secrets: { type: "string" },
		limit: { type: "string" },
		only: { type: "string" },
		concurrency: { type: "string", default: "4" },
	},
})
const secrets = readFileSync(args.secrets ?? "", "utf8")
const read = (key: string) =>
	new RegExp(`^${key}=(.+)$`, "m").exec(secrets)?.[1]?.trim()
if (read("DEMO_AGENT_MODEL") !== DEMO_MODEL)
	throw new Error(`corpus renders on ${DEMO_MODEL} only`)
const ceiling = operatorCeiling(process.env, CORPUS_CEILING_ENV)
if (ceiling === 0) {
	console.error(
		`refusing: set ${CORPUS_CEILING_ENV} to a positive token ceiling`,
	)
	process.exit(2)
}

const world = buildWorld(CORPUS_SEED)
writeWorld(world)
const done = readRecords()
const only = args.only ? new Set(args.only.split(",")) : undefined
const pending = world.sources
	.filter((s) => !done.has(s.id) && (!only || only.has(s.id)))
	.slice(0, args.limit ? Number(args.limit) : undefined)

const client = await MongoClient.connect(read("DEMO_ATLAS_URI") ?? "")
const budget = createModelBudget(client.db(CONTROL_DATABASE))
const model = wrapLanguageModel({
	model: createAnthropic({ apiKey: read("ANTHROPIC_API_KEY") })(DEMO_MODEL),
	middleware: budgetMiddleware({
		budget,
		key: CORPUS_BUDGET_KEY,
		ceiling,
		maxInputTokens: MAX_INPUT_TOKENS,
	}),
})
const system = systemPrompt(world)
const totals = { calls: 0, input: 0, cacheRead: 0, output: 0, repaired: 0 }
const failures: string[] = []
let stopped: string | undefined
const lastFinish = new Map<string, string>()

function problems(spec: SourceSpec, text: string): string[] {
	const lower = text.toLowerCase()
	return [
		...spec.facts
			.filter((f) => !lower.includes(f.toLowerCase()))
			.map((f) => `missing the exact string "${f}"`),
		...realCompaniesIn(text).map(
			(b) => `mentions a real company ("${b}"); describe it generically`,
		),
	]
}

async function call(
	spec: SourceSpec,
	messages: ModelMessage[],
): Promise<string> {
	const bound = inputTokenBound(
		system,
		...messages.map((m) => (typeof m.content === "string" ? m.content : "")),
	)
	if (bound > MAX_INPUT_TOKENS)
		throw new Error(
			`${spec.id}: prompt bound ${bound} exceeds ${MAX_INPUT_TOKENS}`,
		)
	const result = await generateText({
		model,
		maxOutputTokens: OUTPUT_TOKENS[spec.length],
		maxRetries: 1,
		// Haiku 5.5 thinks adaptively by default and its reasoning counts
		// against maxOutputTokens; run 1 got empty text on short records.
		providerOptions: { anthropic: { thinking: { type: "disabled" } } },
		messages: [
			{
				role: "system",
				content: system,
				providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
			},
			...messages,
		],
	})
	if (!result.response.modelId.startsWith(DEMO_MODEL))
		throw new Error(`unexpected model ${result.response.modelId}`)
	totals.calls++
	totals.input += result.usage.inputTokens ?? 0
	totals.cacheRead += result.usage.cachedInputTokens ?? 0
	totals.output += result.usage.outputTokens ?? 0
	lastFinish.set(
		spec.id,
		`${result.finishReason}, ${result.usage.reasoningTokens ?? 0} reasoning tokens`,
	)
	return result.text.trim()
}

async function render(spec: SourceSpec): Promise<void> {
	const user = recordPrompt(world, spec)
	let text = await call(spec, [{ role: "user", content: user }])
	// An empty reply cannot be sent back as an assistant turn; ask afresh.
	if (!text) text = await call(spec, [{ role: "user", content: user }])
	let issues = text ? problems(spec, text) : ["empty reply"]
	if (issues.length && text) {
		totals.repaired++
		text = await call(spec, [
			{ role: "user", content: user },
			{ role: "assistant", content: text },
			{
				role: "user",
				content: `Rewrite the whole record. Fix: ${issues.join("; ")}.`,
			},
		])
		issues = problems(spec, text)
	}
	if (issues.length) {
		failures.push(
			`${spec.id}: ${issues.join("; ")} (${lastFinish.get(spec.id)})`,
		)
		return
	}
	appendRecord({
		id: spec.id,
		body: text,
		model: DEMO_MODEL,
		renderedAt: new Date().toISOString(),
	})
}

async function worker(queue: SourceSpec[]): Promise<void> {
	for (let spec = queue.shift(); spec && !stopped; spec = queue.shift()) {
		try {
			await render(spec)
			process.stdout.write(".")
		} catch (error) {
			if (error instanceof BudgetExhaustedError)
				stopped = `budget ceiling reached (${ceiling} tokens)`
			else
				failures.push(
					`${spec.id}: ${error instanceof Error ? error.message : String(error)}`,
				)
		}
	}
}

const started = Date.now()
const queue = [...pending]
try {
	await Promise.all(
		Array.from({ length: Number(args.concurrency) }, () => worker(queue)),
	)
} finally {
	sortRecords(world)
	const ledger = await budget.read(CORPUS_BUDGET_KEY).catch(() => null)
	await client.close()
	console.log(
		`\n${JSON.stringify(
			{
				requested: pending.length,
				rendered: readRecords().size,
				ofTotal: world.sources.length,
				failures,
				stopped,
				totals,
				ledger: ledger && {
					reserved: ledger.reserved,
					spent: ledger.spent,
					usage: ledger.usage,
				},
				seconds: Math.round((Date.now() - started) / 1000),
			},
			null,
			2,
		)}`,
	)
}
process.exit(failures.length || stopped ? 1 : 0)
