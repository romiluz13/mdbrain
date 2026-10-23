/** The presenter's "Run the agents" queue (ticket 14). The web server cannot
 * start this runner itself (on Cloudflare a Worker cannot spawn a process, and
 * a child of the web process would die with it), so it writes one request per
 * leased run into the control store and this runner's worker consumes it. The
 * request is durable: a web restart loses nothing, and a worker restart picks
 * up what is still queued.
 *
 * The collection name and the document shape are a contract with the web
 * writer (apps/web/lib/demo-presenter/run-requests.ts); a test there holds
 * the name equal. Times are ISO strings, as in the run manifests. */

export const RUN_REQUESTS_COLLECTION = "demo_run_requests"

export type RunRequestState = "queued" | "claimed" | "done" | "failed"

export type RunRequestDoc = {
	/** The leased run's id: one request per run. */
	_id: string
	slotIndex: number
	state: RunRequestState
	requestedAt: string
	/** The presenter's session digest, never a cookie value. */
	requestedBy: string
	claimedAt?: string
	workerId?: string
	finishedAt?: string
	failureReason?: string
}

export interface RunRequestStore {
	find(filter: Record<string, unknown>): Promise<RunRequestDoc[]>
	findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: {
			sort?: Record<string, 1 | -1>
			returnDocument?: "before" | "after"
		},
	): Promise<RunRequestDoc | null>
}

/** A request older than this was not picked up: nobody is running a worker. */
export const DEFAULT_MAX_QUEUE_AGE_MS = 120_000

export const EXPIRED_REASON = "no runner picked the request up in time"

export type RunRequestOptions = {
	now?: () => Date
	maxQueueAgeMs?: number
	/** How long a claimed request may run before it counts as overdue. */
	runDeadlineMs: number
}

export function createRunRequests(
	store: RunRequestStore,
	options: RunRequestOptions,
) {
	const now = () => options.now?.() ?? new Date()
	const maxQueueAgeMs = options.maxQueueAgeMs ?? DEFAULT_MAX_QUEUE_AGE_MS
	const before = (ms: number) => new Date(now().getTime() - ms).toISOString()

	return {
		/** Takes the oldest queued request that is still fresh, or null. The
		 * guarded update matches only a `queued` document, so of two workers one
		 * wins. */
		claimNext(workerId: string): Promise<RunRequestDoc | null> {
			return store.findOneAndUpdate(
				{ state: "queued", requestedAt: { $gte: before(maxQueueAgeMs) } },
				{
					$set: {
						state: "claimed",
						workerId,
						claimedAt: now().toISOString(),
					},
				},
				{ sort: { requestedAt: 1 }, returnDocument: "after" },
			)
		},

		/** Fails every queued request that waited past the queue age. */
		async expireStale(): Promise<RunRequestDoc[]> {
			const expired: RunRequestDoc[] = []
			for (;;) {
				const doc = await store.findOneAndUpdate(
					{ state: "queued", requestedAt: { $lt: before(maxQueueAgeMs) } },
					{
						$set: {
							state: "failed",
							failureReason: EXPIRED_REASON,
							finishedAt: now().toISOString(),
						},
					},
					{ returnDocument: "after" },
				)
				if (!doc) return expired
				expired.push(doc)
			}
		},

		/** Ends a claimed request; false when it was not claimed. */
		async finish(
			runId: string,
			outcome: { state: "done" } | { state: "failed"; reason: string },
		): Promise<boolean> {
			const doc = await store.findOneAndUpdate(
				{ _id: runId, state: "claimed" },
				{
					$set: {
						state: outcome.state,
						finishedAt: now().toISOString(),
						...(outcome.state === "failed"
							? { failureReason: outcome.reason }
							: {}),
					},
				},
				{ returnDocument: "after" },
			)
			return doc !== null
		},

		/** Claimed requests that have run past the run deadline. */
		overdue(): Promise<RunRequestDoc[]> {
			return store.find({
				state: "claimed",
				claimedAt: { $lt: before(options.runDeadlineMs) },
			})
		},
	}
}

export type RunRequests = ReturnType<typeof createRunRequests>
