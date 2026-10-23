// What the presenter sees about "Run the agents": one stage and one plain
// label, derived from the run request and the run's own record. Once the agent
// run exists its state wins; before that, the request says whether a runner has
// the run. A failed request shows a fixed label, never the stored reason.

import type { AgentRunRecord } from "../demo-data/run-record.js"
import {
	RUN_REQUEST_QUEUE_MAX_AGE_MS,
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

const EXPIRED_REASON = "no runner picked the request up in time"

export function runProgress(input: {
	request: Pick<RunRequestDoc, "state" | "requestedAt" | "failureReason"> | null
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
		return {
			stage: "queued",
			label: "The runner has the run and is starting it.",
		}
	}
	return now.getTime() - Date.parse(request.requestedAt) >
		RUN_REQUEST_QUEUE_MAX_AGE_MS
		? noRunner
		: { stage: "queued", label: "Waiting for the runner to pick the run up." }
}
