// Loaders for the chapters that go beyond a single read: the sources behind a
// claim, the recorded contradiction with both of its claims and sources, and
// the governed question read. Same rules as ./loaders.ts: every loader returns
// a DataState, none returns fixture data, and business time (an event's own
// timestamp) stays apart from ingestion time (what mdbrain stamped).

import {
	MdbrainClientError,
	formatCitationMarker,
	type MdbrainWikiClaim,
} from "@mdbrain/client"
import {
	errorState,
	loadContradictions,
	type DemoDataUpstream,
} from "./loaders.js"
import { readsFor } from "./reads.js"
import { mapWithStatus, type DataState } from "./states.js"
import { rankClaims } from "./views.js"

/** How many of a claim's source events the page reads and shows. */
export const SOURCE_LIMIT = 6
const SEARCH_RESULTS = 6
const SEARCH_CLAIMS_PER_HIT = 3

/** One source event a claim cites, resolved through the governed cite route.
 *  `businessTime` is the event's own timestamp; it is absent when the source
 *  carried none. */
export type SourceView = {
	eventId: string
	marker: string
	status: "resolved" | "unavailable"
	/** Set when recall answered and could not confirm the source, which is not
	 * the same as a read that failed and may work on the next try. */
	reason?: "unconfirmed"
	text?: string
	businessTime?: string
}

/** One event a claim cites: what to read, not yet read. */
export type SourceRef = { eventId: string; marker: string }
export type ClaimSourceRefs = {
	refs: SourceRef[]
	/** Every event the claim cites; `refs` stops at SOURCE_LIMIT. */
	eventCount: number
	otherEvidence: number
}

export type ClaimSourceRefsState =
	| { kind: "ready"; data: ClaimSourceRefs }
	| { kind: "empty" }
	| { kind: "error"; code: string; message: string }

type EventEvidence = MdbrainWikiClaim["evidence"][number]

const refOf = (evidence: EventEvidence): SourceRef => ({
	eventId: evidence.sourceId,
	marker:
		evidence.marker ??
		formatCitationMarker({ kind: "event", eventId: evidence.sourceId }),
})

/** One event a claim cites, named without reading it. */
export function eventRef(
	claim: MdbrainWikiClaim,
	eventId: string,
): SourceRef | undefined {
	const found = claim.evidence.find(
		(evidence) => evidence.kind === "event" && evidence.sourceId === eventId,
	)
	return found ? refOf(found) : undefined
}

/** The events a claim rests on, named without reading any of them, so a screen
 * can show each source as it is read. A claim with no marker cannot be cited
 * through, and says so rather than showing no sources. */
export function claimSourceRefs(claim: MdbrainWikiClaim): ClaimSourceRefsState {
	const events = claim.evidence.filter((evidence) => evidence.kind === "event")
	if (events.length === 0) {
		return { kind: "empty" }
	}
	if (claim.marker === undefined) {
		return {
			kind: "error",
			code: "NO_CLAIM_MARKER",
			message:
				"the claim carries no citation marker to cite its sources through",
		}
	}
	// A claim can cite one event more than once; it is one source.
	const named = events.filter(
		(evidence, at) =>
			events.findIndex((other) => other.sourceId === evidence.sourceId) === at,
	)
	return {
		kind: "ready",
		data: {
			refs: named.slice(0, SOURCE_LIMIT).map(refOf),
			eventCount: named.length,
			otherEvidence: claim.evidence.length - events.length,
		},
	}
}

const UNCONFIRMED_CODES: ReadonlySet<string> = new Set([
	"CITATION_UNRESOLVED",
	"CITATION_NOT_FOUND",
])

/** One source of a claim, read through the governed cite route. A source that
 * cannot be cited is marked unavailable; this never throws. */
export async function loadSource(
	upstream: DemoDataUpstream,
	claim: MdbrainWikiClaim,
	ref: SourceRef,
): Promise<SourceView> {
	const { eventId, marker } = ref
	if (claim.marker === undefined) {
		return { eventId, marker, status: "unavailable" }
	}
	try {
		const response = await readsFor(upstream).cite({
			marker,
			citedBy: claim.marker,
		})
		if (response.kind !== "event") {
			return { eventId, marker, status: "unavailable" }
		}
		const { event } = response
		return {
			eventId,
			marker,
			status: "resolved",
			...(event.text !== undefined ? { text: event.text } : {}),
			...(event.timestamp !== undefined
				? { businessTime: event.timestamp }
				: {}),
		}
	} catch (error) {
		const code =
			error instanceof MdbrainClientError ? error.envelope?.code : undefined
		return {
			eventId,
			marker,
			status: "unavailable",
			...(code !== undefined && UNCONFIRMED_CODES.has(code)
				? { reason: "unconfirmed" as const }
				: {}),
		}
	}
}

const NOT_READABLE: DataState<never> = {
	kind: "incomplete",
	reason: "CONTRADICTION_NOT_READABLE",
	state: null,
}

export type ContradictionCaseClaim = {
	pageSlug: string
	pageTitle: string
	revision: number
	claim: MdbrainWikiClaim
}
export type ContradictionCase = {
	id: string
	/** Ingestion time: when the detector recorded the contradiction. */
	detectedAt: string
	resolution: string
	note?: string
	claims: ContradictionCaseClaim[]
	unresolvedCount: number
}

/** The recorded contradiction chapter: the first unresolved record from the
 *  lint read, read back through the overview of the page that holds it, so both
 *  claims arrive with the page and revision they were read from. Their sources
 *  are read apart (see ./source-reader.ts), so the case shows before they land.
 *  A record the lint read lists but this caller cannot read back is reported as
 *  not readable, never as "none recorded". */
export async function loadContradictionCase(
	upstream: DemoDataUpstream,
): Promise<DataState<ContradictionCase>> {
	const listed = await loadContradictions(upstream)
	if (listed.kind !== "ready") {
		return listed.kind === "error" || listed.kind === "empty"
			? listed
			: { kind: "empty" }
	}
	const entry = listed.data.unresolved[0]
	if (entry === undefined) {
		return { kind: "empty" }
	}
	const reads = readsFor(upstream)
	try {
		const overview = await reads.overview(entry.pageSlug)
		const record = overview.contradictions.items.find(
			(item) => item.id === entry.id,
		)
		if (record === undefined) {
			return NOT_READABLE
		}
		const claims = await Promise.all(
			record.claims.map((named): ContradictionCaseClaim => {
				return {
					pageSlug: named.pageSlug,
					pageTitle: named.pageTitle,
					revision: named.revision,
					claim: named.claim,
				}
			}),
		)
		return mapWithStatus(
			{
				data: {
					id: record.id,
					detectedAt: record.detectedAt,
					resolution: record.resolution,
					...(record.note !== undefined ? { note: record.note } : {}),
					claims,
					unresolvedCount: listed.data.unresolved.length,
				},
			},
			upstream.readKey,
		)
	} catch (error) {
		if (error instanceof MdbrainClientError && error.status === 404) {
			return NOT_READABLE
		}
		return errorState(error, upstream.readKey)
	}
}

export type SearchHitView = {
	slug: string
	title: string
	summary: string
	score: number
	lane: string
	claims: MdbrainWikiClaim[]
}
export type SearchView = {
	query: string
	hits: SearchHitView[]
	recipe: string
	mode: string
}

/** The ask chapter: a governed text-lane search over the stored pages. No model
 *  runs; each hit lists the claims on its page that share the most words with
 *  the question. A search outage is an error, never an empty answer. */
export async function loadWikiSearch(
	upstream: DemoDataUpstream,
	question: string,
): Promise<DataState<SearchView>> {
	const query = question.trim()
	if (query === "") {
		return { kind: "empty" }
	}
	const reads = readsFor(upstream)
	try {
		const response = await reads.search({ query, maxResults: SEARCH_RESULTS })
		if (response.results.length === 0) {
			return { kind: "empty" }
		}
		return mapWithStatus(
			{
				data: {
					query,
					recipe: response.recipe,
					mode: response.mode,
					hits: response.results.map((result) => ({
						slug: result.page.slug,
						title: result.page.title,
						summary: result.page.summary,
						score: result.score,
						lane: result.source,
						claims: rankClaims(query, result.page.claims).slice(
							0,
							SEARCH_CLAIMS_PER_HIT,
						),
					})),
				},
			},
			upstream.readKey,
		)
	} catch (error) {
		return errorState(error, upstream.readKey)
	}
}

/** The agents-at-work chapter. No stored read carries agent activity yet
 * (ticket 10 is not merged), so this reports "not yet in this run" instead
 * of presenting the seeder's writer ids as agents at work. */
export function loadAgentActivity(): DataState<never> {
	return {
		kind: "incomplete",
		reason: "AGENT_ACTIVITY_NOT_EXPOSED",
		state: null,
	}
}
