// Citation markers on the API side: resolving one to what it names, and
// attaching markers to claims in responses. The marker grammar itself lives in
// @mdbrain/client so agents and the UI use the same parser.

import { type CitationMarker, formatCitationMarker } from "@mdbrain/client"
import type { MemoryScope } from "@mdbrain/lib"
import {
	type GovernanceContext,
	type WikiDbHandle,
	getWikiPageRevision,
} from "@mdbrain/wiki-engine"

type WikiMarker = Extract<CitationMarker, { kind: "wiki" }>

export type ResolvedClaim = {
	status: "resolved"
	kind: "claim"
	marker: string
	page: {
		slug: string
		title: string | undefined
		revision: number
		revisionCreatedAt: string
	}
	claim: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function tryFormat(marker: CitationMarker): string | undefined {
	try {
		return formatCitationMarker(marker)
	} catch {
		return undefined
	}
}

// A stored id the grammar cannot carry (empty, control characters) simply has
// no marker; it must not fail the whole response. Markers are derived here and
// never taken from storage, because a client can echo a stale one back in a
// read-modify-write patch.
function withClaimMarker(
	claim: unknown,
	slug: string,
	revision: number,
): unknown {
	if (!isRecord(claim) || typeof claim.id !== "string") return claim
	const { marker: _storedMarker, ...rest } = claim
	const marker = tryFormat({
		kind: "wiki",
		slug,
		claimId: claim.id,
		revision,
	})
	const evidence = Array.isArray(rest.evidence)
		? rest.evidence.map((entry: unknown) => {
				if (!isRecord(entry)) return entry
				const { marker: _storedEvidenceMarker, ...bare } = entry
				if (entry.kind !== "event" || typeof entry.sourceId !== "string") {
					return bare
				}
				const eventMarker = tryFormat({
					kind: "event",
					eventId: entry.sourceId,
				})
				return eventMarker ? { ...bare, marker: eventMarker } : bare
			})
		: rest.evidence
	return {
		...rest,
		...(marker ? { marker } : {}),
		...(evidence !== undefined ? { evidence } : {}),
	}
}

function markClaims(claims: unknown, slug: string, revision: number): unknown {
	return Array.isArray(claims)
		? claims.map((claim) => withClaimMarker(claim, slug, revision))
		: claims
}

// A wiki page view (anything with a slug, a revision and claims) with markers on
// its claims. Other shapes pass through untouched.
export function withPageMarkers<T>(page: T): T {
	if (
		!isRecord(page) ||
		typeof page.slug !== "string" ||
		!Number.isSafeInteger(page.revision) ||
		!Array.isArray(page.claims)
	) {
		return page
	}
	return {
		...page,
		claims: markClaims(page.claims, page.slug, page.revision as number),
	} as T
}

// A stored revision: its claims are marked with the revision they were stored at.
export function withRevisionMarkers<T>(record: T): T {
	if (
		!isRecord(record) ||
		!isRecord(record.snapshot) ||
		typeof record.pageSlug !== "string" ||
		!Number.isSafeInteger(record.revision) ||
		!Array.isArray(record.snapshot.claims)
	) {
		return record
	}
	return {
		...record,
		snapshot: {
			...record.snapshot,
			claims: markClaims(
				record.snapshot.claims,
				record.pageSlug,
				record.revision as number,
			),
		},
	} as T
}

// Governance and scope come only from the request. The lookup is by the exact
// revision named; a revision that is missing, lacks the claim, or is hidden by
// that revision's own permissions is the same answer: undefined.
export async function resolveClaimMarker(
	handle: WikiDbHandle,
	marker: WikiMarker,
	request: { scope: string; scopeRef: string; governance: GovernanceContext },
): Promise<ResolvedClaim | undefined> {
	const record = await getWikiPageRevision(handle, {
		pageSlug: marker.slug,
		scope: request.scope,
		scopeRef: request.scopeRef,
		revision: marker.revision,
		governance: request.governance,
	})
	if (!record) return undefined
	const claims = record.snapshot.claims
	const stored = Array.isArray(claims)
		? claims.find(
				(candidate) => isRecord(candidate) && candidate.id === marker.claimId,
			)
		: undefined
	if (!isRecord(stored)) return undefined
	return {
		status: "resolved",
		kind: "claim",
		marker: formatCitationMarker(marker),
		page: {
			slug: record.pageSlug,
			title:
				typeof record.snapshot.title === "string"
					? record.snapshot.title
					: undefined,
			revision: record.revision,
			revisionCreatedAt: record.createdAt,
		},
		claim: withClaimMarker(stored, record.pageSlug, record.revision) as Record<
			string,
			unknown
		>,
	}
}

type EventMarker = Extract<CitationMarker, { kind: "event" }>

export type ResolvedEvent = {
	status: "resolved"
	kind: "event"
	marker: string
	citedBy: string
	event: {
		eventId: string
		canonicalId: string
		text: string | undefined
		timestamp: string | undefined
		scope: string
		scopeRef: string
	}
}

export type EventCitationOutcome =
	| { outcome: "resolved"; body: ResolvedEvent }
	| { outcome: "claim-not-found" }
	| { outcome: "unresolved" }
	| { outcome: "degraded"; retryAfterMs: number | undefined }

export type RecallEvents = (params: {
	query: string
	agentId: string | undefined
	maxResults: number
	scope: MemoryScope
	scopeRef: string
}) => Promise<unknown>

export class CitationRecallError extends Error {
	constructor(readonly original: unknown) {
		super("governed recall failed")
		this.name = "CitationRecallError"
	}
}

// How much of the citing evidence's excerpt is sent as the recall query.
const RECALL_QUERY_CHARS = 1000
const RECALL_MAX_RESULTS = 10

// Memongo has no get-event-by-id route (decision D9), so an event marker is
// confirmed only in the context of a claim that cites it: that claim's
// evidence for the event carries a verbatim excerpt in `note`, governed recall
// under the request's agent and scope is queried with it, and only a hit whose
// canonicalId is exactly `event:EVENT_ID` counts. No hit means unresolved.
export async function resolveEventMarker(
	handle: WikiDbHandle,
	marker: EventMarker,
	citedBy: WikiMarker,
	request: {
		agentId: string | undefined
		scope: MemoryScope
		scopeRef: string
		governance: GovernanceContext
	},
	recall: RecallEvents,
): Promise<EventCitationOutcome> {
	const citing = await resolveClaimMarker(handle, citedBy, request)
	if (!citing) return { outcome: "claim-not-found" }
	const evidence = Array.isArray(citing.claim.evidence)
		? citing.claim.evidence
		: []
	const note = evidence
		.map((entry: unknown) =>
			isRecord(entry) &&
			entry.kind === "event" &&
			entry.sourceId === marker.eventId &&
			typeof entry.note === "string"
				? entry.note.trim()
				: "",
		)
		.find((excerpt) => excerpt !== "")
	if (!note) return { outcome: "unresolved" }

	let response: unknown
	try {
		response = await recall({
			query: note.slice(0, RECALL_QUERY_CHARS),
			agentId: request.agentId,
			maxResults: RECALL_MAX_RESULTS,
			scope: request.scope,
			scopeRef: request.scopeRef,
		})
	} catch (error) {
		throw new CitationRecallError(error)
	}
	const results =
		isRecord(response) && Array.isArray(response.results)
			? response.results
			: []
	const canonicalId = `event:${marker.eventId}`
	const hit = results.find(
		(result): result is Record<string, unknown> =>
			isRecord(result) &&
			result.canonicalId === canonicalId &&
			(result.scope === undefined || result.scope === request.scope) &&
			(result.scopeRef === undefined || result.scopeRef === request.scopeRef),
	)
	if (!hit) {
		const degradation = isRecord(response) ? response.degradation : undefined
		return isRecord(degradation) && degradation.kind === "throttled"
			? {
					outcome: "degraded",
					retryAfterMs:
						typeof degradation.retryAfterMs === "number"
							? degradation.retryAfterMs
							: undefined,
				}
			: { outcome: "unresolved" }
	}
	const text =
		typeof hit.text === "string"
			? hit.text
			: typeof hit.snippet === "string"
				? hit.snippet
				: undefined
	return {
		outcome: "resolved",
		body: {
			status: "resolved",
			kind: "event",
			marker: formatCitationMarker(marker),
			citedBy: formatCitationMarker(citedBy),
			event: {
				eventId: marker.eventId,
				canonicalId,
				text,
				timestamp:
					typeof hit.timestamp === "string" ? hit.timestamp : undefined,
				scope: request.scope,
				scopeRef: request.scopeRef,
			},
		},
	}
}
