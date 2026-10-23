import type { AgentRole } from "../agents/config.js"

export type RunManifestState = "seeding" | "ready" | "used" | "failed"

export type ManifestEventRef = { sourceId: string; eventId: string }

/** Control-store index of a run: identity, boundaries, and per-write
 * progress. Deliberately carries no knowledge (no rendered bodies, no
 * evidence notes) and no secrets — it is a resume and equality-check
 * ledger, not a copy of the corpus. */
export type RunManifestDoc = {
	_id: string
	runId: string
	slotIndex: number
	scopeRef: string
	agentId: string
	state: RunManifestState
	corpus: {
		sha256: string
		records: number
		eventsPlanned: number
		pagesPlanned: number
		replaySourceIds: string[]
	}
	limitSources: number | null
	eventsWritten: ManifestEventRef[]
	pagesWritten: string[]
	failureReason?: string
	createdAt: string
	updatedAt: string
	readyAt?: string
	usedAt?: string
	failedAt?: string
	/** Flat guard for the agent-run state machine: "" from insert until an
	 * agent run starts, so "not yet running" is a plain equality filter
	 * (a missing field would never match). */
	agentRunState?: "" | "running" | "complete" | "incomplete"
	/** Who started the agent run, flat for the same reason: a worker ends or
	 * completes only a run it started, so a second worker's lost start cannot
	 * end the first one's live run. Absent for a run started with no owner. */
	agentRunOwner?: string
	agentRun?: AgentRunDoc
}

export type AgentRunUsage = {
	uncachedInput: number
	cacheRead: number
	cacheWrite: number
	output: number
}

/** Agent-run state machine (ticket 10). Started only from a ready run,
 * then complete (with the outcome summary) or incomplete (with a
 * reason); both terminal states are one-way. The doc's own state stays
 * "ready" throughout; a complete agent run is followed by markUsed. */
/** One confirmed agent step event, indexed (331): the recorder's step
 * number (the one in its idempotency key), the role and short labels,
 * and the id the API returned for the write. The body stays in
 * Memongo; the manifest is an index, not a copy. */
export type AgentRunStepRef = {
	n: number
	role: AgentRole
	name: string
	detail?: string
	eventId: string
}

export type AgentRunDoc = {
	state: "running" | "complete" | "incomplete"
	startedAt: string
	endedAt?: string
	usage?: AgentRunUsage
	stepsRecorded?: number
	steps?: AgentRunStepRef[]
	failureReason?: string
	reusedPage?: { slug: string; writtenBy: string; readBy: string }
	pendingProposal?: { title: string; slug: string }
}

export type AgentRunSummaryInput = {
	usage: AgentRunUsage
	stepsRecorded: number
	steps: AgentRunStepRef[]
	reusedPage?: { slug: string; writtenBy: string; readBy: string }
	pendingProposal?: { title: string; slug: string }
}

/** get() view: the stored doc plus the derived logical event id map the
 * equality check uses to swap unstable eventIds for corpus source ids. */
export type RunManifestView = RunManifestDoc & {
	eventIdBySourceId: Record<string, string>
}

export interface ManifestStore {
	findOne(filter: Record<string, unknown>): Promise<RunManifestDoc | null>
	findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: {
			upsert?: boolean
			returnDocument?: "before" | "after"
		},
	): Promise<RunManifestDoc | null>
}

export type CreateRunManifestInput = {
	runId: string
	slotIndex: number
	scopeRef: string
	agentId: string
	corpus: RunManifestDoc["corpus"]
	limitSources?: number
}

export function createRunManifests(
	store: ManifestStore,
	options: { now?: () => Date } = {},
) {
	const now = () => (options.now?.() ?? new Date()).toISOString()

	async function createRun(
		input: CreateRunManifestInput,
	): Promise<RunManifestDoc | null> {
		// With upsert + $setOnInsert an existing doc matches but is left
		// untouched; returnDocument "before" tells us it pre-existed.
		const existing = await store.findOneAndUpdate(
			{ _id: input.runId },
			{
				$setOnInsert: {
					runId: input.runId,
					slotIndex: input.slotIndex,
					scopeRef: input.scopeRef,
					agentId: input.agentId,
					state: "seeding" as RunManifestState,
					corpus: input.corpus,
					limitSources: input.limitSources ?? null,
					eventsWritten: [] as ManifestEventRef[],
					pagesWritten: [] as string[],
					agentRunState: "" as const,
					createdAt: now(),
					updatedAt: now(),
				},
			},
			{ upsert: true, returnDocument: "before" },
		)
		if (existing) return null
		return store.findOne({ _id: input.runId })
	}

	/** Idempotent: re-reporting the same write is a no-op. Only valid
	 * while the run is still seeding. */
	async function recordEvent(
		runId: string,
		sourceId: string,
		eventId: string,
	): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "seeding" },
			{
				$addToSet: { eventsWritten: { sourceId, eventId } },
				$set: { updatedAt: now() },
			},
			{ returnDocument: "after" },
		)
	}

	async function recordPage(
		runId: string,
		slug: string,
	): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "seeding" },
			{
				$addToSet: { pagesWritten: slug },
				$set: { updatedAt: now() },
			},
			{ returnDocument: "after" },
		)
	}

	async function markReady(runId: string): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "seeding" },
			{
				$set: {
					state: "ready" as RunManifestState,
					readyAt: now(),
					updatedAt: now(),
				},
			},
			{ returnDocument: "after" },
		)
	}

	async function orderEvents(
		runId: string,
		refs: ManifestEventRef[],
	): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "seeding" },
			{ $set: { eventsWritten: refs, updatedAt: now() } },
			{ returnDocument: "after" },
		)
	}

	async function markUsed(runId: string): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "ready" },
			{
				$set: {
					state: "used" as RunManifestState,
					usedAt: now(),
					updatedAt: now(),
				},
			},
			{ returnDocument: "after" },
		)
	}

	/** Starts the agent-run state machine. Valid only on a ready run
	 * that has not started one yet; one-way: a second start is refused. */
	async function markAgentRunStarted(
		runId: string,
		owner?: string,
	): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "ready", agentRun: { $exists: false } },
			{
				$set: {
					agentRunState: "running",
					...(owner !== undefined ? { agentRunOwner: owner } : {}),
					agentRun: { state: "running", startedAt: now() },
					updatedAt: now(),
				},
			},
			{ returnDocument: "after" },
		)
	}

	/** The filter for ending a running agent run: the run, running, and (when
	 * the caller names one) started by that owner. */
	const running = (runId: string, owner: string | undefined) => ({
		_id: runId,
		agentRunState: "running",
		...(owner !== undefined ? { agentRunOwner: owner } : {}),
	})

	async function markAgentRunComplete(
		runId: string,
		summary: AgentRunSummaryInput,
		owner?: string,
	): Promise<RunManifestDoc | null> {
		const doc = await store.findOne(running(runId, owner))
		if (doc?.agentRun?.state !== "running") return null
		return store.findOneAndUpdate(
			running(runId, owner),
			{
				$set: {
					agentRunState: "complete",
					agentRun: {
						state: "complete",
						startedAt: doc.agentRun.startedAt,
						endedAt: now(),
						usage: summary.usage,
						stepsRecorded: summary.stepsRecorded,
						steps: summary.steps,
						reusedPage: summary.reusedPage,
						pendingProposal: summary.pendingProposal,
					},
					updatedAt: now(),
				},
			},
			{ returnDocument: "after" },
		)
	}

	async function markAgentRunIncomplete(
		runId: string,
		reason: string,
		owner?: string,
	): Promise<RunManifestDoc | null> {
		const doc = await store.findOne(running(runId, owner))
		if (doc?.agentRun?.state !== "running") return null
		return store.findOneAndUpdate(
			running(runId, owner),
			{
				$set: {
					agentRunState: "incomplete",
					agentRun: {
						state: "incomplete",
						startedAt: doc.agentRun.startedAt,
						endedAt: now(),
						failureReason: reason,
					},
					updatedAt: now(),
				},
			},
			{ returnDocument: "after" },
		)
	}

	async function markFailed(
		runId: string,
		reason: string,
	): Promise<RunManifestDoc | null> {
		return store.findOneAndUpdate(
			{ _id: runId, state: "seeding" },
			{
				$set: {
					state: "failed" as RunManifestState,
					failedAt: now(),
					failureReason: reason,
					updatedAt: now(),
				},
			},
			{ returnDocument: "after" },
		)
	}

	async function get(runId: string): Promise<RunManifestView | null> {
		const doc = await store.findOne({ _id: runId })
		if (!doc) return null
		// Derived view: the logical event id map used by the equality check.
		const eventIdBySourceId: Record<string, string> = {}
		for (const ref of doc.eventsWritten) {
			eventIdBySourceId[ref.sourceId] = ref.eventId
		}
		return { ...doc, eventIdBySourceId }
	}

	return {
		createRun,
		recordEvent,
		recordPage,
		orderEvents,
		markReady,
		markUsed,
		markAgentRunStarted,
		markAgentRunComplete,
		markAgentRunIncomplete,
		markFailed,
		get,
	}
}
