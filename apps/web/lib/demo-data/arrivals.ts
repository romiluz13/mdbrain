// The sources chapter in the order the run wrote them. The run's record names
// every arrival and the page confirms each by id; the stored claims only say
// which arrivals some claim cites, so the row can open that claim's sources.

import type { RunRecord } from "./run-record.js"
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
}

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
	return {
		arrived: record.arrivals.length,
		planned: record.eventsPlanned,
		cited: record.arrivals.filter((arrival) => citing.has(arrival.eventId))
			.length,
		citedOutsideRecord: index.filter((entry) => !arrived.has(entry.eventId))
			.length,
	}
}
