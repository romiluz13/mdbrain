// The sources chapter in the order the run wrote them. The run's record names
// every arrival and the page confirms each by id; the stored claims only say
// which arrivals some claim cites, so the row can open that claim's sources.

import { countOf } from "./plural.js"
import type { AgentStep, RunRecord } from "./run-record.js"
import type { SourceIndexEntry } from "./views.js"

/** How many arrivals show at first, and each time the visitor asks for more:
 * every shown one is a cite. */
export const ARRIVALS_PAGE = 10

export type ArrivalRow = {
	/** The arrival's place in the run's order, from one. */
	position: number
	/** The corpus's own id for the source. */
	sourceId: string
	/** The id the API returned when the run wrote the event. */
	eventId: string
	/** A stored claim that cites the event, which "Open source" goes through.
	 * Absent when no stored claim cites it. */
	citedBy?: SourceIndexEntry
}

export type ArrivalSummary = {
	arrived: number
	planned: number
	/** Arrivals some stored claim cites. */
	cited: number
	/** Source events the stored claims cite that the record does not list. */
	citedOutsideRecord: number
	/** Of those, the ones the run's own record shows an agent wrote while it ran. */
	writtenByAgent: number
}

/** The runner names its steps `step N` and lists the tools each one called. */
const writesEvents = (step: AgentStep): boolean =>
	step.detail
		?.split(",")
		.some((tool) => tool.trim() === "mdbrain_write_event") === true

function indexById(
	index: readonly SourceIndexEntry[],
): Map<string, SourceIndexEntry> {
	return new Map(index.map((entry) => [entry.eventId, entry]))
}

export function arrivalRows(
	record: RunRecord,
	index: readonly SourceIndexEntry[],
): ArrivalRow[] {
	const citing = indexById(index)
	return record.arrivals.map((arrival, at) => {
		const citedBy = citing.get(arrival.eventId)
		return {
			position: at + 1,
			sourceId: arrival.sourceId,
			eventId: arrival.eventId,
			...(citedBy !== undefined ? { citedBy } : {}),
		}
	})
}

export function summarizeArrivals(
	record: RunRecord,
	index: readonly SourceIndexEntry[],
): ArrivalSummary {
	const citing = indexById(index)
	const arrived = new Set(record.arrivals.map((arrival) => arrival.eventId))
	const outside = index.filter((entry) => !arrived.has(entry.eventId))
	// An event is credited to an agent only when the record shows it: the claim
	// citing it sits on the page an agent wrote, and that agent's steps include
	// a write of memory events.
	const run = record.agentRun
	const wrote = run?.reusedPage
	const agentWroteEvents =
		wrote !== undefined &&
		(run?.steps ?? []).some(
			(step) => step.role === wrote.writtenBy && writesEvents(step),
		)
	return {
		arrived: record.arrivals.length,
		planned: record.eventsPlanned,
		cited: record.arrivals.filter((arrival) => citing.has(arrival.eventId))
			.length,
		citedOutsideRecord: outside.length,
		writtenByAgent:
			agentWroteEvents && wrote
				? outside.filter((entry) => entry.pageSlug === wrote.slug).length
				: 0,
	}
}

/** The sentence under the arrivals: how many cited events the record does not
 * list, and where they came from when the record says so. */
export function outsideRecordNote(summary: ArrivalSummary): string {
	const { citedOutsideRecord: outside, writtenByAgent: byAgent } = summary
	if (outside === 0) {
		return ""
	}
	const lead = `${countOf(outside, "stored source event")} cited by claims ${outside === 1 ? "is" : "are"} not in this record.`
	if (byAgent === 0) {
		return lead
	}
	if (byAgent === outside) {
		return `${lead} ${outside === 1 ? "It was" : "They were"} written by an agent during the run.`
	}
	return `${lead} ${byAgent} of them ${byAgent === 1 ? "was" : "were"} written by an agent during the run.`
}
