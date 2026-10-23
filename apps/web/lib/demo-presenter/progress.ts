// What the presenter sees about "Run the agents": one stage and one plain
// label, derived from the run request and the run's own record. Once the agent
// run exists its state wins; before that, the request says whether a runner has
// the run. A failed request shows a fixed label, never the stored reason.

import type { AgentRunRecord } from "../demo-data/run-record.js"
import {
	EXPIRED_REASON,
	requestIsStale,
	type RunRequestDoc,
} from "./run-requests.js"

export type RunStage =
	| "idle"
	| "queued"
	| "no-runner"
	| "running"
	| "complete"
	| "incomplete"
	| "failed"

export type RunProgress = { stage: RunStage; label: string }

export function runProgress(input: {
	request: Pick<
		RunRequestDoc,
		"state" | "requestedAt" | "claimedAt" | "failureReason"
	> | null
	agentRun: Pick<AgentRunRecord, "state"> | undefined
	now: Date
}): RunProgress {
	const { request, agentRun, now } = input
	if (agentRun) {
		return {
			stage: agentRun.state,
			label:
				agentRun.state === "running"
					? "The agents are at work."
					: agentRun.state === "complete"
						? "The agents finished."
						: "The agent run stopped before it finished.",
		}
	}
	if (!request) {
		return {
			stage: "idle",
			label: "Ready. The agents have not run on this slot.",
		}
	}
	const noRunner: RunProgress = {
		stage: "no-runner",
		label:
			"No runner picked this up. Start the runner worker, then run the agents again.",
	}
	if (request.state === "failed") {
		return request.failureReason === EXPIRED_REASON
			? noRunner
			: { stage: "failed", label: "The runner could not run the agents." }
	}
	if (request.state === "done") {
		return { stage: "failed", label: "The runner ended without a run record." }
	}
	if (request.state === "claimed") {
		return requestIsStale(request, now)
			? {
					stage: "no-runner",
					label:
						"The runner took the run and went quiet. Restart the runner worker, then run the agents again.",
				}
			: {
					stage: "queued",
					label: "The runner has the run and is starting it.",
				}
	}
	return requestIsStale(request, now)
		? noRunner
		: { stage: "queued", label: "Waiting for the runner to pick the run up." }
}
