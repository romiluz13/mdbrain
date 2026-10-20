// Operator CLI for ticket 09: run-slot pool preparation, API-only seeding,
// and the two-slot equality check. Never prints key values.
//
// Usage (from apps/demo-agents):
//   bun run seed:run -- prepare --slots 4 --secrets <file>
//   bun run seed:run -- seed --secrets <file> --run-id <id> \
//     [--limit-sources N] [--concurrency 6] [--rate 90]
//   bun run seed:run -- compare --secrets <file> --run-a <id> --run-b <id>
//   bun run seed:run -- mark-used --secrets <file> --run-id <id>
//
// Secrets file keys used: DEMO_ATLAS_URI (control store) and
// MDBRAIN_DEMO_SLOT_KEYS (JSON array of slot tokens, in slot order — the
// same variable scripts/demo-stack-config.ts turns into scoped keys).
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { MdbrainClient } from "@mdbrain/client"
import { MongoClient, type Db } from "mongodb"
import { readRecords, readWorld } from "../corpus/corpus-files.js"
import { CONTROL_DATABASE } from "../corpus/render-config.js"
import { corpusDigest } from "./digest.js"
import { compareRunSlots, type RunEqualityReport } from "./equality.js"
import { createRunManifests, type RunManifestDoc } from "./manifest.js"
import { createPacer } from "./pacing.js"
import { buildLoadPlan } from "./plan.js"
import { createRunSlotPool, type SlotDoc } from "./pool.js"
import { seedSlot, type SeedSlotSummary } from "./seed.js"
import { createControlStores } from "./stores.js"

// Matches DEMO_API_PORT in scripts/demo-stack-config.ts.
export const DEMO_API_BASE_URL = "http://127.0.0.1:3857"
export const REQUEST_DEADLINE_MS = 180_000

export type ControlContext = {
	db: Db
	pool: ReturnType<typeof createRunSlotPool>
	manifests: ReturnType<typeof createRunManifests>
	close: () => Promise<void>
}

export function readSecrets(path: string): Map<string, string> {
	const out = new Map<string, string>()
	for (const raw of readFileSync(path, "utf8").split("\n")) {
		const line = raw.trim()
		if (!line || line.startsWith("#")) continue
		const eq = line.indexOf("=")
		if (eq <= 0) continue
		out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
	}
	return out
}

/** Slot tokens from MDBRAIN_DEMO_SLOT_KEYS, in slot order. */
export function readSlotTokens(secrets: Map<string, string>): string[] {
	const raw = secrets.get("MDBRAIN_DEMO_SLOT_KEYS")
	if (!raw) {
		throw new Error("secrets file has no MDBRAIN_DEMO_SLOT_KEYS array")
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		throw new Error("MDBRAIN_DEMO_SLOT_KEYS must be a JSON array")
	}
	if (
		!Array.isArray(parsed) ||
		!parsed.every((token) => typeof token === "string" && token)
	) {
		throw new Error("MDBRAIN_DEMO_SLOT_KEYS must be an array of tokens")
	}
	return parsed as string[]
}

export async function openControl(
	secrets: Map<string, string>,
): Promise<ControlContext> {
	const uri = secrets.get("DEMO_ATLAS_URI")
	if (!uri) throw new Error("secrets file has no DEMO_ATLAS_URI")
	const mongo = await MongoClient.connect(uri)
	const db = mongo.db(CONTROL_DATABASE)
	const stores = createControlStores(db)
	return {
		db,
		pool: createRunSlotPool(stores.slotStore),
		manifests: createRunManifests(stores.manifestStore),
		close: () => mongo.close(),
	}
}

/** A client for one slot's exact grant. The token never reaches stdout. */
export function slotClient(token: string): MdbrainClient {
	return new MdbrainClient({
		baseUrl: DEMO_API_BASE_URL,
		apiKey: token,
		// Retries are paced by the seeder's own pacer; the client's internal
		// retry loop stays off so every request start is accounted for.
		maxRetries: 0,
		defaultDeadlineMs: REQUEST_DEADLINE_MS,
	})
}

export type SeedRunResult = {
	slot: SlotDoc
	summary: SeedSlotSummary
	manifest: RunManifestDoc
	elapsedMs: number
	/** True when the run reclaimed a slot that was already seeding. */
	resumed: boolean
}

/** Claims a slot for the run and seeds it through the API. Re-running with
 * the same --run-id resumes the same slot without duplicates. */
export async function seedRun(input: {
	secrets: Map<string, string>
	control: ControlContext
	runId: string
	limitSources?: number
	concurrency?: number
	rate?: number
}): Promise<SeedRunResult> {
	const { slot, resumed } = await input.control.pool.claim(input.runId)
	const tokens = readSlotTokens(input.secrets)
	const token = tokens[slot.index - 1]
	if (!token) {
		throw new Error(
			`slot ${slot.index} has no token: MDBRAIN_DEMO_SLOT_KEYS has ${tokens.length}`,
		)
	}
	const world = readWorld()
	const records = readRecords()
	const plan = buildLoadPlan(world, records, {
		scopeRef: slot.scopeRef,
		limitSources: input.limitSources,
	})
	const client = slotClient(token)
	const startedAt = Date.now()
	const summary = await seedSlot(plan, {
		client,
		ledger: input.control.manifests,
		runId: input.runId,
		agentId: slot.agentId,
		scopeRef: slot.scopeRef,
		manifestInit: {
			slotIndex: slot.index,
			corpus: {
				sha256: corpusDigest({
					sources: world.sources,
					records,
					pages: world.pages,
					contradiction: world.contradiction,
				}),
				records: records.size,
				eventsPlanned: plan.counts.eventsPlanned,
				pagesPlanned: plan.counts.pagesPlanned,
				replaySourceIds: plan.heldBackSourceIds,
			},
			limitSources: input.limitSources,
		},
		pacer: createPacer({ startsPerMinute: input.rate ?? 90 }),
		requestTimeoutMs: REQUEST_DEADLINE_MS,
		concurrency: input.concurrency ?? 6,
	})
	const elapsedMs = Date.now() - startedAt
	await input.control.manifests.markReady(input.runId)
	const ready = await input.control.pool.markReady(input.runId)
	const manifest = await input.control.manifests.get(input.runId)
	if (!manifest || !ready) {
		throw new Error(`run ${input.runId} did not reach ready`)
	}
	return { slot: ready, summary, manifest, elapsedMs, resumed }
}

/** Compares two runs' slots page by page through the API. */
export async function compareRuns(input: {
	secrets: Map<string, string>
	control: ControlContext
	runA: string
	runB: string
}): Promise<RunEqualityReport> {
	const manifestA = await input.control.manifests.get(input.runA)
	const manifestB = await input.control.manifests.get(input.runB)
	if (!manifestA) throw new Error(`no manifest for run ${input.runA}`)
	if (!manifestB) throw new Error(`no manifest for run ${input.runB}`)
	const tokens = readSlotTokens(input.secrets)
	const tokenA = tokens[manifestA.slotIndex - 1]
	const tokenB = tokens[manifestB.slotIndex - 1]
	if (!tokenA || !tokenB) {
		throw new Error("MDBRAIN_DEMO_SLOT_KEYS does not cover both run slots")
	}
	const clientA = slotClient(tokenA)
	const clientB = slotClient(tokenB)
	// One reader that dispatches by scopeRef: each slot's pages are read
	// with that slot's own exact-grant key.
	const reader = {
		wikiGet: (
			args: { slug: string; scope: string; scopeRef: string; format?: "json" },
			requestOptions?: { timeoutMs?: number },
		) =>
			(args.scopeRef === manifestA.scopeRef ? clientA : clientB).wikiGet(
				args,
				requestOptions,
			),
	}
	return compareRunSlots({
		reader,
		slots: [
			{ scopeRef: manifestA.scopeRef, manifest: manifestA },
			{ scopeRef: manifestB.scopeRef, manifest: manifestB },
		],
		requestTimeoutMs: REQUEST_DEADLINE_MS,
	})
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2)
	if (!command) {
		console.error(
			"usage: seed:run -- <prepare|seed|compare|mark-used> [options]",
		)
		process.exit(2)
	}
	const { values } = parseArgs({
		args: rest,
		options: {
			secrets: { type: "string" },
			slots: { type: "string" },
			"run-id": { type: "string" },
			"run-a": { type: "string" },
			"run-b": { type: "string" },
			"limit-sources": { type: "string" },
			concurrency: { type: "string" },
			rate: { type: "string" },
		},
	})
	const secretsPath = values.secrets
	if (!secretsPath) {
		console.error("--secrets <file> is required (never printed)")
		process.exit(2)
	}
	const secrets = readSecrets(secretsPath)
	const control = await openControl(secrets)
	try {
		if (command === "prepare") {
			const count = Number(values.slots ?? "0")
			const slots = await control.pool.prepare(count)
			console.log(
				`prepared ${slots.length} slots: ${slots
					.map((slot) => `#${slot.index} ${slot.scopeRef} (${slot.state})`)
					.join(", ")}`,
			)
			return
		}
		if (command === "seed") {
			const runId = values["run-id"]
			if (!runId) {
				console.error("--run-id is required")
				process.exit(2)
			}
			const result = await seedRun({
				secrets,
				control,
				runId,
				limitSources: values["limit-sources"]
					? Number(values["limit-sources"])
					: undefined,
				concurrency: values.concurrency
					? Number(values.concurrency)
					: undefined,
				rate: values.rate ? Number(values.rate) : undefined,
			})
			console.log(
				`run ${runId} ready on slot #${result.slot.index} (${result.slot.scopeRef})` +
					(result.resumed ? ", resumed" : "") +
					`: ${result.summary.eventsWritten} events written` +
					`, ${result.summary.eventsReplayed} replayed` +
					`, ${result.summary.pagesWritten} pages written` +
					`, ${result.summary.pagesReconciled} reconciled` +
					` in ${Math.round(result.elapsedMs / 1000)}s`,
			)
			return
		}
		if (command === "compare") {
			const runA = values["run-a"]
			const runB = values["run-b"]
			if (!runA || !runB) {
				console.error("--run-a and --run-b are required")
				process.exit(2)
			}
			const report = await compareRuns({ secrets, control, runA, runB })
			console.log(
				`equality: ${report.equal ? "EQUAL" : "DIFFERENT"}` +
					` (${report.pagesCompared} pages compared` +
					`, ${report.differences.length} differences)`,
			)
			for (const difference of report.differences.slice(0, 20)) {
				console.log(
					`  ${difference.path}: A=${JSON.stringify(difference.slotA)}` +
						` B=${JSON.stringify(difference.slotB)}`,
				)
			}
			if (!report.equal) process.exit(1)
			return
		}
		if (command === "mark-used") {
			const runId = values["run-id"]
			if (!runId) {
				console.error("--run-id is required")
				process.exit(2)
			}
			const manifest = await control.manifests.get(runId)
			if (!manifest) throw new Error(`no manifest for run ${runId}`)
			const slot = await control.pool.markUsed(manifest.slotIndex)
			if (!slot) throw new Error(`run ${runId}'s slot is not ready`)
			await control.manifests.markUsed(runId)
			console.log(`run ${runId} slot #${slot.index} marked used`)
			return
		}
		console.error(`unknown command ${command}`)
		process.exit(2)
	} finally {
		await control.close()
	}
}

if (
	process.argv[1] &&
	import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
	await main()
}
