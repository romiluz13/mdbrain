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
		markFailed,
		get,
	}
}
