// Operator CLI for ticket 10: run the three Haiku role agents against one
// ready run slot. Never prints key values.
//
// Usage (from apps/demo-agents):
//   bun run agents:run -- run --secrets <file> --run-id <id>
//
// Secrets file keys used: DEMO_ATLAS_URI (control store and model budget),
// ANTHROPIC_API_KEY (pinned Haiku model), MDBRAIN_DEMO_AGENT_KEYS (per-slot
// [support, account] pairs) and MDBRAIN_DEMO_PROPOSER_KEYS (the product
// lead's key). Ceilings come from the environment: DEMO_AGENT_STEPS,
// DEMO_AGENT_TASK_DEADLINE_MS, DEMO_AGENT_TOKENS (apps/demo-agents/src/
// agents/config.ts).
import { parseArgs } from "node:util"
import { createAnthropic } from "@ai-sdk/anthropic"
import { MdbrainClient } from "@mdbrain/client"
import { createModelBudget } from "@mdbrain/lib/budget"
import { DEMO_MODEL } from "../corpus/render-config.js"
import { readRecords, readWorld } from "../corpus/corpus-files.js"
import {
	DEMO_API_BASE_URL,
	REQUEST_DEADLINE_MS,
	openControl,
	readSecrets,
	type ControlContext,
} from "../seeding/run.js"
import { agentCeilings } from "./config.js"
import { readAgentRoleKeys } from "./keys.js"
import { runRoleAgents, type AgentRunOutcome } from "./runner.js"

/** A client for one role key's exact grant. The key never reaches stdout. */
function agentClient(key: string): MdbrainClient {
	return new MdbrainClient({
		baseUrl: DEMO_API_BASE_URL,
		apiKey: key,
		// The runner paces itself (one task at a time, a deadline per task),
		// so the client's internal retry loop stays off.
		maxRetries: 0,
		defaultDeadlineMs: REQUEST_DEADLINE_MS,
	})
}

function anthropicApiKey(secrets: Map<string, string>): string {
	const fromFile = secrets.get("ANTHROPIC_API_KEY")?.trim()
	const key = fromFile || process.env.ANTHROPIC_API_KEY?.trim()
	if (!key) {
		throw new Error("no ANTHROPIC_API_KEY for the pinned Haiku model")
	}
	return key
}

export type AgentRunContext = {
	secrets: Map<string, string>
	control: Pick<ControlContext, "manifests" | "pool" | "db">
}

/** The run body the CLI and the worker (./serve.ts) share: checks the run is
 * ready and unstarted, then runs the three role agents inside the shared
 * budget. Throws before any model call when the run is not startable. */
export async function executeAgentRun(
	ctx: AgentRunContext,
	runId: string,
): Promise<AgentRunOutcome> {
	const { secrets, control } = ctx
	const manifest = await control.manifests.get(runId)
	if (!manifest) throw new Error(`no manifest for run ${runId}`)
	if (manifest.state !== "ready") {
		throw new Error(`run ${runId} is ${manifest.state}, not ready`)
	}
	if (manifest.agentRun?.state) {
		throw new Error(
			`run ${runId}'s agent run is already ${manifest.agentRun.state}`,
		)
	}
	const anthropicKey = anthropicApiKey(secrets)
	const keys = readAgentRoleKeys(
		Object.fromEntries(secrets),
		manifest.slotIndex,
	)
	const budget = createModelBudget(control.db)
	return runRoleAgents({
		manifests: control.manifests,
		pool: control.pool,
		runId,
		slot: {
			index: manifest.slotIndex,
			scopeRef: manifest.scopeRef,
			agentId: manifest.agentId,
		},
		clients: {
			support: agentClient(keys.support),
			account: agentClient(keys.account),
			product: agentClient(keys.product),
		},
		// D6: the provider and model id are pinned, never chosen per role.
		modelFor: () => createAnthropic({ apiKey: anthropicKey })(DEMO_MODEL),
		budget,
		ceilings: agentCeilings(process.env),
		world: readWorld(),
		records: readRecords(),
	})
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			secrets: { type: "string" },
			"run-id": { type: "string" },
		},
	})
	const secretsPath = values.secrets
	const runId = values["run-id"]
	if (!secretsPath || !runId) {
		console.error("usage: agents:run -- run --secrets <file> --run-id <id>")
		process.exit(2)
	}
	const secrets = readSecrets(secretsPath)
	const control = await openControl(secrets)
	try {
		const startedAt = Date.now()
		const outcome = await executeAgentRun({ secrets, control }, runId)
		const elapsedS = Math.round((Date.now() - startedAt) / 1000)
		console.log(`agent run ${runId}: ${outcome.state} in ${elapsedS}s`)
		if (outcome.failureReason) {
			console.log(`  reason: ${outcome.failureReason}`)
		}
		for (const phase of outcome.phases) {
			console.log(`  ${phase.name}: ${phase.durationMs}ms`)
		}
		console.log(
			`  steps: ${outcome.stepsRecorded}` +
				` (support ${outcome.stepCounts.support}` +
				`, account ${outcome.stepCounts.account}` +
				`, product ${outcome.stepCounts.product})`,
		)
		console.log(
			`  tokens: ${outcome.usage.uncachedInput} uncached in` +
				`, ${outcome.usage.cacheRead} cache read` +
				`, ${outcome.usage.cacheWrite} cache write` +
				`, ${outcome.usage.output} out`,
		)
		if (outcome.reusedPage) {
			console.log(`  staged page: ${outcome.reusedPage.slug}`)
		}
		if (outcome.pendingProposal) {
			console.log(`  pending proposal: ${outcome.pendingProposal.title}`)
		}
		if (outcome.state !== "complete") process.exit(1)
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
