// The sources chapter in the order the run wrote them. The run's record names
// every arrival; the stored claims decide which of them this page can confirm,
// because the API confirms an event only through a claim that cites it.

import { eventRef } from "./loaders-chapters.js"
import type { EventSubject } from "./confirm-event.js"
import type { RunRecord } from "./run-record.js"
import type { SourceIndexEntry } from "./views.js"

/** How many arrivals show at first, and each time the visitor asks for more:
 * every shown one that can be confirmed is a governed recall. */
export const ARRIVALS_PAGE = 10

export type ArrivalRow = {
	/** The arrival's place in the run's order, from one. */
	position: number
	/** The corpus's own id for the source. */
	sourceId: string
	/** The id the API returned when the run wrote the event. */
	eventId: string
	/** The stored claim that cites the event, which a confirmation goes
	 * through. Absent when no stored claim cites it. */
	citedBy?: SourceIndexEntry
}

export type ArrivalSummary = {
	arrived: number
	planned: number
	/** Arrivals some stored claim cites: the ones this page can confirm. */
	confirmable: number
	/** Arrivals the record holds that no stored claim cites. */
	notConfirmable: number
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
	const confirmable = record.arrivals.filter((arrival) =>
		citing.has(arrival.eventId),
	).length
	return {
		arrived: record.arrivals.length,
		planned: record.eventsPlanned,
		confirmable,
		notConfirmable: record.arrivals.length - confirmable,
		citedOutsideRecord: index.filter((entry) => !arrived.has(entry.eventId))
			.length,
	}
}

/** What to confirm for one row. */
export function arrivalSubject(row: ArrivalRow): EventSubject {
	const ref = row.citedBy ? eventRef(row.citedBy.claim, row.eventId) : undefined
	return {
		kind: "arrival",
		eventId: row.eventId,
		...(row.citedBy !== undefined && ref !== undefined
			? { via: { claim: row.citedBy.claim, ref } }
			: {}),
	}
}
