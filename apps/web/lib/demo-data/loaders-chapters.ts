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

const SOURCE_LIMIT = 6
const SEARCH_RESULTS = 6
const SEARCH_CLAIMS_PER_HIT = 3

/** One source event a claim cites, resolved through the governed cite route.
 *  `businessTime` is the event's own timestamp; it is absent when the source
 *  carried none. */
export type SourceView = {
	eventId: string
	marker: string
	status: "resolved" | "unavailable"
	text?: string
	businessTime?: string
}
export type ClaimSourcesView = {
	sources: SourceView[]
	/** Evidence that is not an event source (a file, a URL, a manual note). */
	otherEvidence: number
}

/** The sources behind a claim: one cite per event it rests on, through the
 *  claim's own marker. A source that cannot be cited is marked unavailable and
 *  does not fail the claim. */
export async function loadClaimSources(
	upstream: DemoDataUpstream,
	claim: MdbrainWikiClaim,
): Promise<DataState<ClaimSourcesView>> {
	const events = claim.evidence.filter((evidence) => evidence.kind === "event")
	const otherEvidence = claim.evidence.length - events.length
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
	const citedBy = claim.marker
	const reads = readsFor(upstream)
	const sources = await Promise.all(
		events.slice(0, SOURCE_LIMIT).map(async (evidence): Promise<SourceView> => {
			const marker =
				evidence.marker ??
				formatCitationMarker({ kind: "event", eventId: evidence.sourceId })
			try {
				const response = await reads.cite({ marker, citedBy })
				if (response.kind !== "event") {
					return { eventId: evidence.sourceId, marker, status: "unavailable" }
				}
				const { event } = response
				return {
					eventId: evidence.sourceId,
					marker,
					status: "resolved",
					...(event.text !== undefined ? { text: event.text } : {}),
					...(event.timestamp !== undefined
						? { businessTime: event.timestamp }
						: {}),
				}
			} catch {
				return { eventId: evidence.sourceId, marker, status: "unavailable" }
			}
		}),
	)
	return mapWithStatus({ data: { sources, otherEvidence } }, upstream.readKey)
}

export type ContradictionCaseClaim = {
	pageSlug: string
	pageTitle: string
	revision: number
	claim: MdbrainWikiClaim
	sources: SourceView[]
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
 *  claims arrive with the page and revision they were read from, then each
 *  claim's sources. A record the caller cannot fully read is not shown. */
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
			return { kind: "empty" }
		}
		const claims = await Promise.all(
			record.claims.map(async (named): Promise<ContradictionCaseClaim> => {
				const sources = await loadClaimSources(upstream, named.claim)
				return {
					pageSlug: named.pageSlug,
					pageTitle: named.pageTitle,
					revision: named.revision,
					claim: named.claim,
					sources: sources.kind === "ready" ? sources.data.sources : [],
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
			return { kind: "empty" }
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
