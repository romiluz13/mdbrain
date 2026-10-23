/** Ticket-10 role-agent runner. Three Haiku agents run in sequence
 * against one ready run slot: the Support Lead replays its held-back
 * sources and publishes the risk page, the Account Manager reads that
 * page (staging) and answers with a cross-role note, and the Product Lead
 * reads the page and leaves the Silent ETA drift proposal pending. Each
 * step is recorded as a memory event without blocking the model; the
 * recorder is confirmed before the manifest flips complete, so the
 * per-agentId write queue (D10: all roles share the run's agentId)
 * drains while later tasks run instead of stalling every step. */
import { generateText, stepCountIs } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import { MdbrainClientError, type MdbrainClient } from "@mdbrain/client"
import {
	BudgetExhaustedError,
	type BudgetUsage,
	type ModelBudget,
} from "@mdbrain/lib/budget"
import type { RenderedRecord, World } from "../corpus/types.js"
import type { RunWrites } from "../evidence.js"
import type { createRunManifests } from "../seeding/manifest.js"
import { ROLE_LABELS, type AgentCeilings, type AgentRole } from "./config.js"
import { createStepEventRecorder } from "./events.js"
import { agentTools } from "./tools.js"
import { buildRolePlans, type RolePlan } from "./story.js"

/** Haiku input ceiling per task. The eight MCP tool schemas alone measure
 * ~10.4KB — above the corpus seeder's 12k cap — so agent tasks carry
 * their own, higher bound. */
export const AGENT_MAX_INPUT_TOKENS = 20_000
export const AGENT_MAX_OUTPUT_TOKENS = 2_000
const AGENT_RESERVE_TOKENS = AGENT_MAX_INPUT_TOKENS + AGENT_MAX_OUTPUT_TOKENS

export const DEFAULT_STAGING_DEADLINE_MS = 5_000
export const DEFAULT_POLL_INTERVAL_MS = 100
const CONFIRM_DEADLINE_MS = 60_000

const PHASE_BY_ROLE: Record<AgentRole, string> = {
	support: "replay-support",
	account: "staging-account",
	product: "proposal-product",
}

export type AgentSlot = {
	index: number
	scopeRef: string
	agentId: string
}

export type RunPhase = { name: string; durationMs: number }

export type ReusedPage = {
	slug: string
	writtenBy: AgentRole
	readBy: AgentRole
}

export type PendingProposal = { title: string; slug: string }

export type AgentRunOutcome = {
	state: "complete" | "incomplete"
	failureReason?: string
	phases: RunPhase[]
	usage: BudgetUsage
	stepsRecorded: number
	stepCounts: Record<AgentRole, number>
	reusedPage?: ReusedPage
	pendingProposal?: PendingProposal
}

/** The run cannot begin: it is not ready, or another worker already started
 * it. Thrown before any state changes, so the caller must leave the run alone;
 * it belongs to whoever started it. */
export class RunNotStartableError extends Error {
	name = "RunNotStartableError"
}

export type RunRoleAgentsInput = {
	/** Who is starting the run: only this owner may end or complete it. */
	owner?: string
	manifests: ReturnType<typeof createRunManifests>
	pool: { markUsed(index: number): Promise<unknown> }
	runId: string
	slot: AgentSlot
	clients: Record<AgentRole, MdbrainClient>
	modelFor: (role: AgentRole) => LanguageModelV2
	budget: ModelBudget
	ceilings: AgentCeilings
	world: World
	records: Map<string, RenderedRecord>
	stagingDeadlineMs?: number
	pollIntervalMs?: number
}

type TaskResult = { ok: true; steps: number } | { ok: false; reason: string }

const ZERO_USAGE: BudgetUsage = {
	uncachedInput: 0,
	cacheRead: 0,
	cacheWrite: 0,
	output: 0,
}

export async function runRoleAgents(
	input: RunRoleAgentsInput,
): Promise<AgentRunOutcome> {
	const plans = buildRolePlans({
		world: input.world,
		records: input.records,
		runId: input.runId,
		scopeRef: input.slot.scopeRef,
	})
	const recorder = createStepEventRecorder({
		clients: input.clients,
		runId: input.runId,
		agentId: input.slot.agentId,
		scopeRef: input.slot.scopeRef,
	})
	// Shared write ledger (330): event ids captured from this run's
	// mdbrain_write_event receipts, and the refusals that fail it closed.
	const writes: RunWrites = {
		eventIdBySource: new Map(),
		refusals: [],
		writeRefusals: new Map(),
	}
	const phases: RunPhase[] = []
	const usage: BudgetUsage = { ...ZERO_USAGE }
	const stepCounts: Record<AgentRole, number> = {
		support: 0,
		account: 0,
		product: 0,
	}
	let stepsRecorded = 0
	let budgetId: string | undefined

	const fail = async (reason: string): Promise<AgentRunOutcome> => {
		// A failed run still owns the memory it already wrote: let the
		// fired step events land before the manifest flips.
		await recorder.confirm(CONFIRM_DEADLINE_MS)
		await input.manifests.markAgentRunIncomplete(
			input.runId,
			reason,
			input.owner,
		)
		return {
			state: "incomplete",
			failureReason: reason,
			phases,
			usage,
			stepsRecorded,
			stepCounts,
		}
	}

	const releaseBudget = async () => {
		if (!budgetId) return
		const id = budgetId
		budgetId = undefined
		try {
			await input.budget.markUncertain(id)
		} catch {
			// The run is already failing; bookkeeping must not mask it.
		}
	}

	const runTask = async (role: AgentRole): Promise<TaskResult> => {
		const plan: RolePlan = plans[role]
		const taskUsage: BudgetUsage = { ...ZERO_USAGE }
		const controller = new AbortController()
		const timer = setTimeout(
			() => controller.abort(),
			input.ceilings.taskDeadlineMs,
		)
		let steps = 0
		try {
			budgetId = await input.budget.reserve({
				key: `agents:${input.runId}`,
				ceiling: input.ceilings.tokens,
				amount: AGENT_RESERVE_TOKENS,
			})
			const result = await generateText({
				model: input.modelFor(role),
				system: plan.system,
				prompt: plan.prompt,
				tools: agentTools({
					client: input.clients[role],
					role,
					agentId: input.slot.agentId,
					scopeRef: input.slot.scopeRef,
					events: plan.events,
					page: plan.page,
					writes,
				}),
				stopWhen: stepCountIs(input.ceilings.steps),
				maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
				providerOptions: { anthropic: { effort: "low" } },
				abortSignal: controller.signal,
				onStepFinish: (step) => {
					steps += 1
					stepCounts[role] = steps
					stepsRecorded += 1
					taskUsage.uncachedInput += step.usage.inputTokens ?? 0
					taskUsage.cacheRead += step.usage.cachedInputTokens ?? 0
					taskUsage.output += step.usage.outputTokens ?? 0
					const meta = (
						step.providerMetadata as
							| { anthropic?: { cacheCreationInputTokens?: number } }
							| undefined
					)?.anthropic
					taskUsage.cacheWrite += meta?.cacheCreationInputTokens ?? 0
					const detail = step.toolCalls.map((call) => call.toolName).join(", ")
					recorder.record({
						role,
						name: `step ${steps}`,
						detail: detail.length > 0 ? detail : undefined,
					})
				},
			})
			const last = result.steps.at(-1)
			if (last && last.toolCalls.length > 0) {
				return {
					ok: false,
					reason: `${ROLE_LABELS[role]} task stopped at the ${input.ceilings.steps} steps ceiling with pinned replay work still in flight`,
				}
			}
			const writeRefusal = Array.from(writes.writeRefusals.values())[0]
			if (writeRefusal !== undefined) {
				// Fail closed (330): the API refused a pinned replay write, so
				// this run's evidence can never land; end it with the API's reason
				// — the root cause, ahead of any apply-time refusal it caused.
				return { ok: false, reason: writeRefusal }
			}
			if (writes.refusals.length > 0) {
				// Fail closed (330): a cited source never landed as an event, so
				// the page apply was refused rather than sent unsourced.
				return { ok: false, reason: writes.refusals[0] ?? "unknown refusal" }
			}
			if (budgetId) {
				await input.budget.settle(budgetId, taskUsage)
				budgetId = undefined
			}
			usage.uncachedInput += taskUsage.uncachedInput
			usage.cacheRead += taskUsage.cacheRead
			usage.cacheWrite += taskUsage.cacheWrite
			usage.output += taskUsage.output
			return { ok: true, steps }
		} catch (error) {
			if (error instanceof BudgetExhaustedError) {
				return { ok: false, reason: `budget: ${error.message}` }
			}
			if (controller.signal.aborted) {
				return {
					ok: false,
					reason: `task deadline: ${ROLE_LABELS[role]} exceeded ${input.ceilings.taskDeadlineMs}ms`,
				}
			}
			return {
				ok: false,
				reason: error instanceof Error ? error.message : String(error),
			}
		} finally {
			clearTimeout(timer)
			await releaseBudget()
		}
	}

	const phase = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
		const startedAt = Date.now()
		try {
			return await run()
		} finally {
			phases.push({ name, durationMs: Math.max(0, Date.now() - startedAt) })
		}
	}

	const started = await input.manifests.markAgentRunStarted(
		input.runId,
		input.owner,
	)
	if (!started) {
		throw new RunNotStartableError(
			`agent run ${input.runId} is not ready to start`,
		)
	}

	const support = await phase(PHASE_BY_ROLE.support, () => runTask("support"))
	if (!support.ok) return fail(support.reason)

	// Staging (ticket 10): the account role must be able to read the page
	// the support role just published before either of them continues.
	const stagingDeadlineMs =
		input.stagingDeadlineMs ?? DEFAULT_STAGING_DEADLINE_MS
	const pollIntervalMs = Math.max(
		1,
		input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
	)
	const riskSlug = plans.support.page?.slug ?? ""
	let reusedPage: ReusedPage | undefined
	const account = await phase(
		PHASE_BY_ROLE.account,
		async (): Promise<TaskResult> => {
			if (!riskSlug) {
				return {
					ok: false,
					reason:
						"staging: the support plan carries no page for the account role to read",
				}
			}
			const deadline = Date.now() + stagingDeadlineMs
			let refusal: string | undefined
			for (;;) {
				try {
					await input.clients.account.wikiGet({
						slug: riskSlug,
						scope: "workspace",
						scopeRef: input.slot.scopeRef,
						agentId: input.slot.agentId,
					})
					reusedPage = {
						slug: riskSlug,
						writtenBy: "support",
						readBy: "account",
					}
					break
				} catch (error) {
					// Only "not there yet" is worth waiting out; any other answer is final.
					if (!(error instanceof MdbrainClientError) || error.status !== 404) {
						refusal = describeReadError(error)
						break
					}
					if (Date.now() >= deadline) break
					await delay(pollIntervalMs)
				}
			}
			if (refusal) {
				return {
					ok: false,
					reason: `staging: account could not read ${riskSlug}: ${refusal}`,
				}
			}
			if (!reusedPage) {
				return {
					ok: false,
					reason: `staging: account could not read ${riskSlug} within ${stagingDeadlineMs}ms`,
				}
			}
			return runTask("account")
		},
	)
	if (!account.ok) return fail(account.reason)

	const product = await phase(PHASE_BY_ROLE.product, () => runTask("product"))
	if (!product.ok) return fail(product.reason)

	const proposal = plans.product.proposal
	const pendingProposal: PendingProposal | undefined = proposal
		? {
				title: proposal.wikiPromotion.page.title,
				slug: proposal.wikiPromotion.page.slug,
			}
		: undefined

	const confirmed = await phase("confirm-step-events", () =>
		recorder.confirm(CONFIRM_DEADLINE_MS),
	)
	if (confirmed.failed.length > 0) {
		const first = confirmed.failed[0]!
		return fail(`step events: ${first.name} failed (${first.error})`)
	}

	await input.manifests.markAgentRunComplete(
		input.runId,
		{
			usage,
			stepsRecorded,
			steps: confirmed.steps,
			reusedPage,
			pendingProposal,
		},
		input.owner,
	)
	await input.manifests.markUsed(input.runId)
	await input.pool.markUsed(input.slot.index)
	return {
		state: "complete",
		phases,
		usage,
		stepsRecorded,
		stepCounts,
		reusedPage,
		pendingProposal,
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeReadError(error: unknown): string {
	if (error instanceof MdbrainClientError) {
		return `${error.status} ${error.envelope?.message ?? error.message}`
	}
	return error instanceof Error ? error.message : String(error)
}
