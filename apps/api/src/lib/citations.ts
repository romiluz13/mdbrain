// Citation markers on the API side: resolving one to what it names, and
// attaching markers to claims in responses. The marker grammar itself lives in
// @mdbrain/client so agents and the UI use the same parser.

import { type CitationMarker, formatCitationMarker } from "@mdbrain/client"
import type { MemoryScope } from "@mdbrain/lib"
import type { MemoryEventRecord } from "@mdbrain/memory-bridge"
import {
	type GovernanceContext,
	type WikiChange,
	type WikiChangeClaim,
	type WikiChangesPage,
	type WikiDbHandle,
	type WikiEntityOverview,
	type WikiOverviewClaim,
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
// Checked on write so every stored claim stays citable: the marker must fit
// even at the largest revision the page could ever reach.
export function uncitableClaimError(
	slug: string,
	claims: unknown,
): string | undefined {
	if (!Array.isArray(claims)) return undefined
	for (const [index, claim] of claims.entries()) {
		if (!isRecord(claim) || typeof claim.id !== "string") continue
		const marker = tryFormat({
			kind: "wiki",
			slug,
			claimId: claim.id,
			revision: Number.MAX_SAFE_INTEGER,
		})
		if (!marker) {
			return `claims[${index}].id cannot be cited: with the slug it must form a citation marker of at most 2048 characters once percent-encoded, without control characters`
		}
	}
	return undefined
}

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

// The overview shows claims of several pages, each marked with the slug and
// revision of the page it was read from (a neighbor's or a backlink source's
// own current revision, not the requested page's).
export function withOverviewMarkers(
	overview: WikiEntityOverview,
): WikiEntityOverview {
	return {
		...overview,
		page: withPageMarkers(overview.page),
		backlinks: {
			...overview.backlinks,
			items: overview.backlinks.items.map((item) =>
				item.context?.claim
					? {
							...item,
							context: {
								...item.context,
								claim: withClaimMarker(
									item.context.claim,
									item.slug,
									item.revision,
								) as WikiOverviewClaim,
							},
						}
					: item,
			),
		},
		neighbors: {
			...overview.neighbors,
			items: overview.neighbors.items.map((item) => ({
				...item,
				claims: markClaims(
					item.claims,
					item.slug,
					item.revision,
				) as WikiOverviewClaim[],
			})),
		},
		contradictions: {
			...overview.contradictions,
			items: overview.contradictions.items.map((item) => ({
				...item,
				claims: item.claims.map((entry) => ({
					...entry,
					claim: withClaimMarker(
						entry.claim,
						entry.pageSlug,
						entry.revision,
					) as WikiOverviewClaim,
				})),
			})),
		},
	}
}

// The feed shows claims read from two revisions of a page. Added claims and the
// `after` of a change were read at the entry's revision; removed claims and the
// `before` of a change were read at the revision before it. A deletion lists
// the claims held at deletion, read from the delete revision itself.
function markChange(change: WikiChange): WikiChange {
	if (!change.claims) return change
	const at = change.revision
	const before =
		change.editKind === "delete" ? at : (change.baselineRevision ?? at)
	const mark = (claim: WikiChangeClaim, revision: number) =>
		withClaimMarker(claim, change.pageSlug, revision) as WikiChangeClaim
	return {
		...change,
		claims: {
			...change.claims,
			added: change.claims.added.map((claim) => mark(claim, at)),
			changed: change.claims.changed.map((moved) => ({
				...moved,
				before: mark(moved.before, before),
				after: mark(moved.after, at),
			})),
			removed: change.claims.removed.map((claim) => mark(claim, before)),
		},
	}
}

export function withChangesMarkers(page: WikiChangesPage): WikiChangesPage {
	return { ...page, changes: page.changes.map(markChange) }
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
	citedBy?: string
	event: {
		eventId: string
		canonicalId: string
		text: string
		timestamp: string
		scope: string
		scopeRef: string
	}
}

export type EventCitationOutcome =
	| { outcome: "resolved"; body: ResolvedEvent }
	| { outcome: "claim-not-found" }
	| { outcome: "unresolved" }

export type GetEvent = (params: {
	eventId: string
	agentId: string | undefined
	scope: MemoryScope
	scopeRef: string
}) => Promise<MemoryEventRecord | null>

export class CitationLookupError extends Error {
	constructor(readonly original: unknown) {
		super("governed event lookup failed")
		this.name = "CitationLookupError"
	}
}

// An event marker resolves through Memongo's governed by-id read under the
// request's agent, scope and scopeRef (decision D21). A citing claim is
// optional; when given it must be readable and must cite the event, or the
// marker is refused before any lookup.
export async function resolveEventMarker(
	handle: WikiDbHandle | undefined,
	marker: EventMarker,
	citedBy: WikiMarker | undefined,
	request: {
		agentId: string | undefined
		scope: MemoryScope
		scopeRef: string
		governance: GovernanceContext
	},
	getEvent: GetEvent,
): Promise<EventCitationOutcome> {
	if (citedBy) {
		const citing = handle
			? await resolveClaimMarker(handle, citedBy, request)
			: undefined
		if (!citing) return { outcome: "claim-not-found" }
		const evidence = Array.isArray(citing.claim.evidence)
			? citing.claim.evidence
			: []
		const cites = evidence.some(
			(entry: unknown) =>
				isRecord(entry) &&
				entry.kind === "event" &&
				entry.sourceId === marker.eventId,
		)
		if (!cites) return { outcome: "unresolved" }
	}

	let event: MemoryEventRecord | null
	try {
		event = await getEvent({
			eventId: marker.eventId,
			agentId: request.agentId,
			scope: request.scope,
			scopeRef: request.scopeRef,
		})
	} catch (error) {
		throw new CitationLookupError(error)
	}
	if (
		!event ||
		event.eventId !== marker.eventId ||
		event.scope !== request.scope ||
		event.scopeRef !== request.scopeRef
	) {
		return { outcome: "unresolved" }
	}
	return {
		outcome: "resolved",
		body: {
			status: "resolved",
			kind: "event",
			marker: formatCitationMarker(marker),
			...(citedBy ? { citedBy: formatCitationMarker(citedBy) } : {}),
			event: {
				eventId: event.eventId,
				canonicalId: `event:${event.eventId}`,
				text: event.body,
				timestamp: event.timestamp,
				scope: event.scope,
				scopeRef: event.scopeRef,
			},
		},
	}
}
