// Typed loaders for the /demo data layer (ticket 12, part 1). Each loader
// reads through @mdbrain/client against a DemoDataUpstream and returns a
// DataState: loading, ready, empty, error or incomplete-run. No loader ever
// returns fixture data, and business time (event timestamps) is kept apart
// from ingestion time (server-stamped page times).
//
// Two reads have no API route today (D19): the run source-event list and the
// run manifest. The run loader is shaped manifest -> ordered event ids ->
// cite each; until a manifest route exists it reports
// RUN_MANIFEST_NOT_EXPOSED instead of inventing data.
//
// Production path: the /demo page runs these loaders in the browser against
// the same-origin /api/demo route, whose handler (handleDemoRead in
// ./proxy.ts) injects the principal and the read key. A proxy-shaped
// upstream therefore carries the /api/demo prefix, a placeholder key and no
// scope or scopeRef; the live check exercises the same handler in-process.
// The read seam itself lives in ./reads.ts: MdbrainClient always sends the
// principal its API demands, which the proxy refuses, so proxy-shaped
// upstreams read through a principal-free reader instead.

import {
	MdbrainClientError,
	formatCitationMarker,
	type MdbrainCitationEventResponse,
	type MdbrainCitationResponse,
	type MdbrainWikiChange,
	type MdbrainWikiClaim,
	type MdbrainWikiOverviewBacklink,
	type MdbrainWikiOverviewContradiction,
	type MdbrainWikiOverviewNeighbor,
	type MdbrainWikiOverviewResponse,
	type MdbrainWikiPageView,
	type MdbrainWikiRevisionSummary,
} from "@mdbrain/client"
import { readsFor, type DemoReads } from "./reads.js"
import { mapWithStatus, type DataState } from "./states.js"

/** Where the loaders read from. `getRunManifest` and `pinnedPage` are the
 * seams for the reads that have no API route yet (D19); the live check and
 * the future manifest wiring inject them. */
export interface DemoDataUpstream {
	/** The API base the client reads: the direct API in tests, or the
	 * same-origin /api/demo route in production and the live check. */
	apiBaseUrl: string
	readKey: string
	/** The principal, when the caller owns it (direct API reads). Reading
	 * through the demo proxy these stay unset: the proxy injects the scope
	 * and scopeRef itself and refuses caller-set ones. */
	scope?: string
	scopeRef?: string
	getRunManifest?: () => Promise<RunManifestView | null>
	pinnedPage?: PinnedPageRef
}

/** The run manifest as the demo driver writes it. There is no API route for
 * it today; this is the shape a future route would serve. */
export interface RunManifestView {
	runId: string
	slotIndex?: number
	scopeRef?: string
	agentId?: string
	state: string
	eventsWritten?: string[]
}

/** A wiki page pinned as the citing context for run events. */
export interface PinnedPageRef {
	slug: string
	revision: number
	claims: ReadonlyArray<{ id: string }>
}

function errorState(error: unknown, secret: string): DataState<never> {
	if (error instanceof MdbrainClientError) {
		return mapWithStatus(
			{
				status: error.status,
				code: error.envelope?.code ?? error.code ?? "UPSTREAM_ERROR",
				message: error.envelope?.message ?? error.message,
			},
			secret,
		)
	}
	return mapWithStatus(
		{
			status: 502,
			code: "UPSTREAM_ERROR",
			message:
				error instanceof Error
					? error.message
					: "the demo upstream read failed",
		},
		secret,
	)
}

const LIST_PAGE_SIZE = 100
const MAX_LIST_CALLS = 50
const MAX_CHANGE_CALLS = 10

// The wiki-lint envelope. The SDK types wikiLint as unknown, so the loader
// keeps its own narrow, guarded view of it.
interface LintContradiction {
	id: string
	detectedAt?: string
	resolution?: string
	note?: string
	claims?: unknown[]
}
type LintEnvelope = {
	pages?: number
	total?: number
	unresolvedContradictions?: LintContradiction[]
}

function isLintContradiction(value: unknown): value is LintContradiction {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { id?: unknown }).id === "string"
	)
}

export type WikiMapPage = {
	slug: string
	title: string
	kind: string
	trustTier: string
	state: string
	revision: number
	claimCount: number
	linkCount: number
	updatedAt: string
}
export type WikiMapView = {
	pages: WikiMapPage[]
	pageTotal: number
	unresolvedContradictionCount: number
}

/** The map chapter: every page in the run scope plus the unresolved
 * contradiction count from the lint read. */
export async function loadWikiMap(
	upstream: DemoDataUpstream,
): Promise<DataState<WikiMapView>> {
	const reads = readsFor(upstream)
	try {
		const pages: MdbrainWikiPageView[] = []
		let total = 0
		for (let call = 0; call < MAX_LIST_CALLS; call++) {
			const list = await reads.wikiList({
				limit: LIST_PAGE_SIZE,
				skip: pages.length,
			})
			pages.push(...list.pages)
			total = list.total
			if (list.pages.length === 0 || pages.length >= total) {
				break
			}
		}
		if (pages.length === 0) {
			return { kind: "empty" }
		}
		let unresolvedContradictionCount = 0
		try {
			const lint = (await reads.wikiLint({
				limit: LIST_PAGE_SIZE,
			})) as LintEnvelope | null
			if (
				lint !== null &&
				typeof lint === "object" &&
				Array.isArray(lint.unresolvedContradictions)
			) {
				unresolvedContradictionCount = lint.unresolvedContradictions.length
			}
		} catch {
			// The map stays usable without the contradiction count.
		}
		return mapWithStatus(
			{
				data: {
					pages: pages.map((page) => ({
						slug: page.slug,
						title: page.title,
						kind: page.kind,
						trustTier: page.trustTier,
						state: page.state,
						revision: page.revision,
						claimCount: page.claims.length,
						linkCount: page.relationships.length,
						updatedAt: page.updatedAt,
					})),
					pageTotal: total,
					unresolvedContradictionCount,
				},
			},
			upstream.readKey,
		)
	} catch (error) {
		return errorState(error, upstream.readKey)
	}
}

/** The client-side page shape for the entity chapter: only typed fields, no
 * raw unknown[] sections. */
export type EntityOverviewPage = {
	slug: string
	title: string
	summary: string
	kind: string
	trustTier: string
	state: string
	revision: number
	createdAt: string
	updatedAt: string
	lastMaintainedAt?: string
	validFrom: string | null
	claims: MdbrainWikiClaim[]
}
export type EntityOverviewView = {
	page: EntityOverviewPage
	contradictions: MdbrainWikiOverviewContradiction[]
	backlinks: MdbrainWikiOverviewBacklink[]
	neighbors: MdbrainWikiOverviewNeighbor[]
	revisions: MdbrainWikiRevisionSummary[]
	limits: MdbrainWikiOverviewResponse["limits"]
	hasMore: {
		contradictions: boolean
		backlinks: boolean
		neighbors: boolean
		revisions: boolean
	}
}

/** The entity chapter (ticket 04 view): one page's governed overview. */
export async function loadEntityOverview(
	slug: string,
	upstream: DemoDataUpstream,
): Promise<DataState<EntityOverviewView>> {
	const reads = readsFor(upstream)
	try {
		const response = await reads.overview(slug)
		const page = response.page
		return mapWithStatus(
			{
				data: {
					page: {
						slug: page.slug,
						title: page.title,
						summary: page.summary,
						kind: page.kind,
						trustTier: page.trustTier,
						state: page.state,
						revision: page.revision,
						createdAt: page.createdAt,
						updatedAt: page.updatedAt,
						...(page.lastMaintainedAt !== undefined
							? { lastMaintainedAt: page.lastMaintainedAt }
							: {}),
						validFrom: page.validFrom,
						claims: page.claims,
					},
					contradictions: response.contradictions.items,
					backlinks: response.backlinks.items,
					neighbors: response.neighbors.items,
					revisions: response.revisions.items,
					limits: response.limits,
					hasMore: {
						contradictions: response.contradictions.hasMore,
						backlinks: response.backlinks.hasMore,
						neighbors: response.neighbors.hasMore,
						revisions: response.revisions.hasMore,
					},
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

export type ContradictionsView = {
	unresolved: LintContradiction[]
	pageCount: number
	pageTotal: number
}

/** The contradiction chapter: the flat unresolved list from the lint read. */
export async function loadContradictions(
	upstream: DemoDataUpstream,
): Promise<DataState<ContradictionsView>> {
	const reads = readsFor(upstream)
	try {
		const lint = (await reads.wikiLint({
			limit: LIST_PAGE_SIZE,
		})) as LintEnvelope
		const envelope = lint !== null && typeof lint === "object" ? lint : {}
		const unresolved = (
			Array.isArray(envelope.unresolvedContradictions)
				? envelope.unresolvedContradictions
				: []
		).filter(isLintContradiction)
		const pageCount =
			typeof envelope.pages === "number" ? envelope.pages : unresolved.length
		const pageTotal =
			typeof envelope.total === "number" ? envelope.total : unresolved.length
		if (unresolved.length === 0) {
			return { kind: "empty" }
		}
		return mapWithStatus(
			{ data: { unresolved, pageCount, pageTotal } },
			upstream.readKey,
		)
	} catch (error) {
		return errorState(error, upstream.readKey)
	}
}

export type ChangesView = {
	changes: MdbrainWikiChange[]
	window: { since: string; until: string; settled: boolean }
	hasMore: boolean
	complete: boolean
}

/** The what-changed chapter (ticket 05 feed): fans in the changes windows
 * from `since` until the cursor chain ends or the call budget is spent. */
export async function loadWikiChanges(
	upstream: DemoDataUpstream,
	since: string | Date,
): Promise<DataState<ChangesView>> {
	const reads = readsFor(upstream)
	try {
		let changes: MdbrainWikiChange[] = []
		let window: { since: string; until: string; settled: boolean } | undefined
		let hasMore = false
		let cursor: string | undefined
		for (let call = 0; call < MAX_CHANGE_CALLS; call++) {
			const response = await reads.changes({
				since,
				...(cursor !== undefined ? { cursor } : {}),
			})
			changes = changes.concat(response.changes)
			window = response.window
			hasMore = response.hasMore
			if (!response.hasMore || response.nextCursor === undefined) {
				cursor = undefined
				break
			}
			cursor = response.nextCursor
		}
		if (window === undefined) {
			throw new Error("the changes response carried no window")
		}
		if (changes.length === 0 && !hasMore) {
			return { kind: "empty" }
		}
		return mapWithStatus(
			{
				data: {
					changes,
					window,
					hasMore,
					complete: !hasMore && cursor === undefined,
				},
			},
			upstream.readKey,
		)
	} catch (error) {
		return errorState(error, upstream.readKey)
	}
}

/** One source event of the run, cited through the governed recall route.
 * `timestamp` is the event's business time; it is absent when the source
 * carried none. `citedBy` is the wiki claim marker the cite resolved
 * through. */
export type RunEventView = {
	id: string
	text?: string
	timestamp?: string
	citedBy: string
}
export type RunSourcesView = {
	runId: string
	slotIndex?: number
	state: string
	events: RunEventView[]
	unresolvedEventIds: string[]
}

async function resolveCitedBy(
	reads: DemoReads,
	upstream: DemoDataUpstream,
): Promise<string> {
	if (upstream.pinnedPage) {
		const first = upstream.pinnedPage.claims[0]
		if (first) {
			return formatCitationMarker({
				kind: "wiki",
				slug: upstream.pinnedPage.slug,
				claimId: first.id,
				revision: upstream.pinnedPage.revision,
			})
		}
	}
	const list = await reads.wikiList({ limit: 1 })
	const listed = list.pages[0]
	if (!listed) {
		throw noCitingPageError()
	}
	const page = await reads.wikiGet(listed.slug)
	const claim = page.claims[0]
	if (!claim) {
		throw noCitingPageError()
	}
	return (
		claim.marker ??
		formatCitationMarker({
			kind: "wiki",
			slug: page.slug,
			claimId: claim.id,
			revision: page.revision,
		})
	)
}

function noCitingPageError(): MdbrainClientError {
	return new MdbrainClientError(
		404,
		JSON.stringify({
			error: {
				code: "NO_CITING_PAGE",
				message: "no wiki page with a claim exists to cite run events",
			},
		}),
	)
}

/** The sources chapter, shaped per D19: run manifest -> ordered event ids ->
 * one cite per event. The manifest read has no API route yet, so without an
 * injected manifest source this reports RUN_MANIFEST_NOT_EXPOSED. A full
 * run cites every planned event (564 in the full corpus plan), which is the
 * batching target named in the Return. */
export async function loadRunSources(
	upstream: DemoDataUpstream,
): Promise<DataState<RunSourcesView>> {
	const reads = readsFor(upstream)
	const manifest = upstream.getRunManifest
		? await upstream.getRunManifest()
		: null
	if (!manifest) {
		return {
			kind: "incomplete",
			reason: "RUN_MANIFEST_NOT_EXPOSED",
			state: null,
		}
	}
	if (manifest.state !== "ready") {
		return {
			kind: "incomplete",
			reason: "RUN_NOT_READY",
			state: manifest.state,
		}
	}
	const eventIds = manifest.eventsWritten ?? []
	if (eventIds.length === 0) {
		return { kind: "empty" }
	}
	try {
		const citedBy = await resolveCitedBy(reads, upstream)
		const events: RunEventView[] = []
		const unresolvedEventIds: string[] = []
		for (const eventId of eventIds) {
			try {
				const response: MdbrainCitationResponse = await reads.cite({
					marker: formatCitationMarker({ kind: "event", eventId }),
					citedBy,
					...(upstream.scopeRef !== undefined
						? { agentId: upstream.scopeRef }
						: {}),
				})
				if (response.kind !== "event") {
					unresolvedEventIds.push(eventId)
					continue
				}
				const event: MdbrainCitationEventResponse["event"] = response.event
				events.push({
					id: event.eventId,
					...(event.text !== undefined ? { text: event.text } : {}),
					...(event.timestamp !== undefined
						? { timestamp: event.timestamp }
						: {}),
					citedBy,
				})
			} catch {
				unresolvedEventIds.push(eventId)
			}
		}
		if (events.length === 0) {
			return mapWithStatus(
				{
					status: 502,
					code: "NO_SOURCES_RESOLVED",
					message: "none of the run's source events could be cited",
				},
				upstream.readKey,
			)
		}
		return mapWithStatus(
			{
				data: {
					runId: manifest.runId,
					...(manifest.slotIndex !== undefined
						? { slotIndex: manifest.slotIndex }
						: {}),
					state: manifest.state,
					events,
					unresolvedEventIds,
				},
			},
			upstream.readKey,
		)
	} catch (error) {
		return errorState(error, upstream.readKey)
	}
}
