// The pinned run's own record: which source files arrived and in what order,
// and what its agents did. The server reads it from the run's control record
// and the proxy serves it at one fixed path (see ./proxy-run.ts). Everything
// the record names is then checked against the API where the API can answer.

import { MdbrainClientError } from "@mdbrain/client"
import { errorState, type DemoDataUpstream } from "./loaders.js"
import { readsFor } from "./reads.js"
import type { RunRecord } from "./run-record.js"
import { mapWithStatus, type DataState } from "./states.js"

/** The run record as a state. A server with no run configured is a state of
 * its own, so the other chapters keep working; a run that is still being
 * seeded, or stopped while seeding, shows what arrived next to a notice. */
export async function loadRunRecord(
	upstream: DemoDataUpstream,
): Promise<DataState<RunRecord>> {
	try {
		const record = await readsFor(upstream).run()
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
