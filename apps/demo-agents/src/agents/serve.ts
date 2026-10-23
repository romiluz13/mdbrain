/** The runner worker (ticket 14): consumes the presenter's run requests from
 * the control store, one at a time. The loop knows nothing about models or
 * keys; `execute` is the shared run body (./run.ts), so a request runs exactly
 * what `agents:run` runs, inside the same shared budget.
 *
 * It also keeps the deadline honest: a request nobody picked up in time fails,
 * and a run that stayed claimed past the run deadline (a worker that died
 * mid-run) is marked incomplete instead of looking forever "running". */
import { RunNotStartableError, type AgentRunOutcome } from "./runner.js"
import type { RunRequestDoc, RunRequests } from "./run-requests.js"

export type ServeDeps = {
	requests: RunRequests
	manifests: {
		get(runId: string): Promise<{ agentRun?: { state?: string } } | null>
		markAgentRunIncomplete(
			runId: string,
			reason: string,
			owner?: string,
		): Promise<unknown>
	}
	/** Runs the request's run, starting it as `owner`. */
	execute: (
		request: RunRequestDoc,
		owner: string,
	) => Promise<Pick<AgentRunOutcome, "state" | "failureReason">>
	workerId: string
	pollMs: number
	sleep: (ms: number) => Promise<void>
	signal?: AbortSignal
	/** Stop when the queue is empty instead of polling. */
	once?: boolean
	log?: (line: string) => void
}

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

async function sweep(deps: ServeDeps, log: (line: string) => void) {
	for (const expired of await deps.requests.expireStale()) {
		log(`request ${expired._id}: expired before a runner picked it up`)
	}
	for (const overdue of await deps.requests.overdue()) {
		const reason = `run deadline: ${overdue._id} ran past its deadline`
		await deps.manifests.markAgentRunIncomplete(overdue._id, reason)
		await deps.requests.finish(overdue._id, { state: "failed", reason })
		log(`request ${overdue._id}: ${reason}`)
	}
}

async function liveElsewhere(deps: ServeDeps, runId: string): Promise<boolean> {
	const view = await deps.manifests.get(runId).catch(() => null)
	return view?.agentRun?.state === "running"
}

async function handle(
	deps: ServeDeps,
	request: RunRequestDoc,
	log: (line: string) => void,
) {
	log(`request ${request._id}: running on slot ${request.slotIndex}`)
	// One claim, one owner: a later claim of the same request is a different
	// attempt, so it cannot end a run an earlier attempt still holds.
	const owner = `${deps.workerId}@${request.claimedAt ?? ""}`
	try {
		const outcome = await deps.execute(request, owner)
		if (outcome.state === "complete") {
			await deps.requests.finish(request._id, { state: "done" })
		} else {
			await deps.requests.finish(request._id, {
				state: "failed",
				reason: outcome.failureReason ?? "the agent run did not complete",
			})
		}
		log(`request ${request._id}: ${outcome.state}`)
	} catch (error) {
		const reason = message(error)
		// A run this attempt started must not stay "running": end it, as its
		// owner. A run that could not start belongs to someone else, or to no
		// one, and is left alone.
		if (!(error instanceof RunNotStartableError)) {
			await deps.manifests
				.markAgentRunIncomplete(request._id, reason, owner)
				.catch(() => undefined)
		} else if (await liveElsewhere(deps, request._id)) {
			// The request is the other attempt's too: leave it claimed, so that
			// attempt's finish ends it, or the deadline sweep does if it died.
			log(`request ${request._id}: its run is live under another attempt`)
			return
		}
		await deps.requests.finish(request._id, { state: "failed", reason })
		log(`request ${request._id}: failed (${reason})`)
	}
}

export async function serveRunRequests(deps: ServeDeps): Promise<void> {
	const log = deps.log ?? (() => {})
	while (!deps.signal?.aborted) {
		try {
			await sweep(deps, log)
			const claimed = await deps.requests.claimNext(deps.workerId)
			if (claimed) {
				await handle(deps, claimed, log)
				continue
			}
			if (deps.once) return
		} catch (error) {
			if (deps.once) throw error
			log(`worker: ${message(error)}`)
		}
		await deps.sleep(deps.pollMs)
	}
}
