// "Run the agents" from the presenter's side: one durable request per leased
// run, written into the control store. The web server starts nothing. The
// runner worker (apps/demo-agents/src/agents/serve.ts) claims the request and
// runs the agents with the slot's keys, which never reach this server.
//
// The collection name, the document shape and the queue age are a contract
// with that worker; a test holds them equal.

import { DuplicateKeyError, type ControlCollection } from "./collections.js"
import { isFullySeeded, type LeaseDoc, type LeaseManifest } from "./lease.js"

export type RunRequestState = "queued" | "claimed" | "done" | "failed"

export type RunRequestDoc = {
	_id: string
	slotIndex: number
	state: RunRequestState
	requestedAt: string
	requestedBy: string
	claimedAt?: string
	workerId?: string
	finishedAt?: string
	failureReason?: string
}

/** The failure reason the worker writes when it expires a request nobody
 * picked up. */
export const EXPIRED_REASON = "no runner picked the request up in time"

/** A queued request older than this was not picked up: no worker is running. */
export const RUN_REQUEST_QUEUE_MAX_AGE_MS = 120_000

/** A claimed request whose run record is still missing this long after the
 * claim lost its runner: claiming to starting the run takes seconds. */
export const RUN_REQUEST_CLAIM_MAX_AGE_MS = 120_000

export function requestIsStale(
	request: Pick<RunRequestDoc, "state" | "requestedAt" | "claimedAt">,
	now: Date,
): boolean {
	if (request.state === "queued") {
		return (
			now.getTime() - Date.parse(request.requestedAt) >
			RUN_REQUEST_QUEUE_MAX_AGE_MS
		)
	}
	if (request.state === "claimed") {
		return (
			now.getTime() - Date.parse(request.claimedAt ?? request.requestedAt) >
			RUN_REQUEST_CLAIM_MAX_AGE_MS
		)
	}
	return false
}

export class RunRequestError extends Error {
	name = "RunRequestError"
	constructor(
		readonly code: "RUN_NOT_READY",
		message: string,
	) {
		super(message)
	}
}

export type RunRequestDeps = {
	requests: ControlCollection<RunRequestDoc>
	now: () => Date
}

export function createRunRequestService(deps: RunRequestDeps) {
	return {
		get: (runId: string): Promise<RunRequestDoc | null> =>
			deps.requests.findOne({ _id: runId }),

		/** Queues the leased run, or returns the request already there. A failed
		 * request, a queued one nobody picked up, or a claimed one whose runner
		 * went quiet, is queued again while the run has not started. */
		async enqueue(
			lease: Pick<LeaseDoc, "runId" | "slotIndex">,
			manifest: LeaseManifest | null,
			presenterId: string,
		): Promise<RunRequestDoc> {
			const now = deps.now().toISOString()
			const existing = await deps.requests.findOne({ _id: lease.runId })
			const stale = existing !== null && requestIsStale(existing, deps.now())
			if (existing && existing.state !== "failed" && !stale) return existing
			if (!manifest || !isFullySeeded(manifest)) {
				if (existing) return existing
				throw new RunRequestError(
					"RUN_NOT_READY",
					"the leased run is not fully seeded or has already started",
				)
			}
			if (!existing) {
				const doc: RunRequestDoc = {
					_id: lease.runId,
					slotIndex: lease.slotIndex,
					state: "queued",
					requestedAt: now,
					requestedBy: presenterId,
				}
				try {
					await deps.requests.insertOne(doc)
					return doc
				} catch (error) {
					// A double click: the other call queued it first.
					if (!(error instanceof DuplicateKeyError)) throw error
					const winner = await deps.requests.findOne({ _id: lease.runId })
					if (winner) return winner
					throw error
				}
			}
			const requeued = await deps.requests.findOneAndUpdate(
				{ _id: lease.runId, state: existing.state },
				{
					$set: { state: "queued", requestedAt: now, requestedBy: presenterId },
					$unset: {
						failureReason: "",
						finishedAt: "",
						claimedAt: "",
						workerId: "",
					},
				},
				{ returnDocument: "after" },
			)
			return (
				requeued ??
				(await deps.requests.findOne({ _id: lease.runId })) ??
				existing
			)
		},
	}
}

export type RunRequestService = ReturnType<typeof createRunRequestService>
