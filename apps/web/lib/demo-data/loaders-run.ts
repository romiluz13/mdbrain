// The pinned run's own record: which source files arrived and in what order,
// and what its agents did. The server reads it from the run's control record
// and the proxy serves it at one fixed path (see ./proxy-run.ts). Everything
// the record names is then checked against the API where the API can answer.

import { MdbrainClientError } from "@mdbrain/client"
import { errorState, type DemoDataUpstream } from "./loaders.js"
import { readsFor } from "./reads.js"
import { AGENT_RUN_STATES, RUN_STATES, type RunRecord } from "./run-record.js"
import { mapWithStatus, type DataState } from "./states.js"

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

// The proxy projects the record into this shape, but the page reads it again
// before it trusts it: a stand-in or a changed server must show an error, not
// a blank page.
function isRunRecord(value: unknown): value is RunRecord {
	return (
		isObject(value) &&
		typeof value.state === "string" &&
		RUN_STATES.includes(value.state) &&
		typeof value.createdAt === "string" &&
		typeof value.eventsPlanned === "number" &&
		typeof value.pagesPlanned === "number" &&
		Array.isArray(value.arrivals) &&
		Array.isArray(value.pagesWritten) &&
		(value.agentRun === undefined ||
			(isObject(value.agentRun) &&
				typeof value.agentRun.state === "string" &&
				AGENT_RUN_STATES.includes(value.agentRun.state)))
	)
}

/** The run record as a state. A server with no run configured is a state of
 * its own, so the other chapters keep working; a run that is still being
 * seeded, or stopped while seeding, shows what arrived next to a notice. */
export async function loadRunRecord(
	upstream: DemoDataUpstream,
): Promise<DataState<RunRecord>> {
	try {
		const record = await readsFor(upstream).run()
		if (!isRunRecord(record)) {
			return {
				kind: "error",
				code: "RUN_RECORD_MALFORMED",
				message: "The run's record was not in a shape this page reads.",
			}
		}
		if (record.state === "seeding") {
			return {
				kind: "incomplete",
				reason: "RUN_NOT_READY",
				state: record.state,
				data: record,
			}
		}
		if (record.state === "failed") {
			return {
				kind: "incomplete",
				reason: "RUN_FAILED",
				state: record.state,
				data: record,
			}
		}
		return mapWithStatus({ data: record }, upstream.readKey)
	} catch (error) {
		if (
			error instanceof MdbrainClientError &&
			error.envelope?.code === "RUN_NOT_CONFIGURED"
		) {
			return { kind: "incomplete", reason: "RUN_NOT_CONFIGURED", state: null }
		}
		return errorState(error, upstream.readKey)
	}
}
