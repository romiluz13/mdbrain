// @mdbrain/wiki-engine — entity overview.
//
// One governed read that answers "what do we know about this page": the page,
// its open contradictions, who links to it, what it links to (with those pages'
// top claims) and its recent revisions. Every other page and revision it names
// is read under the caller's governance in the query itself, before its
// content, its existence or a count is exposed, so a page the caller may not
// read leaves no trace anywhere in the response.

import type { Document } from "mongodb"
import {
	getWikiPage,
	type WikiDbHandle,
	type WikiPageView,
} from "./wiki-bridge.js"
import {
	filterPagesByGovernance,
	buildGovernanceFilter,
	type GovernanceContext,
} from "./wiki-governance.js"
import {
	toRevisionSummary,
	type WikiPageRevisionRecord,
} from "./wiki-revisions.js"
import { wikiPagesCollection, wikiRevisionsCollection } from "./wiki-schema.js"

export const WIKI_OVERVIEW_LIMITS = {
	backlinks: { default: 20, max: 100 },
	neighbors: { default: 10, max: 50 },
	neighborClaims: { default: 3, max: 10 },
	revisions: { default: 5, max: 20 },
	contradictions: { default: 20, max: 100 },
} as const

export type WikiOverviewLimitName = keyof typeof WIKI_OVERVIEW_LIMITS
export type WikiOverviewLimits = Record<WikiOverviewLimitName, number>

export type WikiOverviewClaim = Record<string, unknown>

export interface WikiOverviewSection<T> {
	items: T[]
	hasMore: boolean
}

export interface WikiOverviewBacklink {
	slug: string
	title: string
	revision: number
	kinds: string[]
	context?: { claim?: WikiOverviewClaim; text?: string }
}

export interface WikiOverviewNeighbor {
	slug: string
	title: string
	summary: string
	revision: number
	linkKinds: string[]
	claimCount: number
	claimsTruncated: boolean
	claims: WikiOverviewClaim[]
}

export interface WikiOverviewContradiction {
	id: string
	detectedAt: string
	resolution: string
	note?: string
	claims: Array<{
		pageSlug: string
		pageTitle: string
		revision: number
		claim: WikiOverviewClaim
	}>
}

export type WikiOverviewRevision = Omit<WikiPageRevisionRecord, "snapshot">

export interface WikiEntityOverview {
	page: Omit<WikiPageView, "backlinks" | "contradictions">
	revisions: WikiOverviewSection<WikiOverviewRevision>
	contradictions: WikiOverviewSection<WikiOverviewContradiction>
	backlinks: WikiOverviewSection<WikiOverviewBacklink>
	neighbors: WikiOverviewSection<WikiOverviewNeighbor>
	limits: WikiOverviewLimits
}

export interface WikiEntityOverviewParams {
	slug: string
	scope: string
	scopeRef: string
	governance: GovernanceContext
	limits?: Partial<WikiOverviewLimits>
}

function effectiveLimits(
	requested: Partial<WikiOverviewLimits> = {},
): WikiOverviewLimits {
	const out = {} as WikiOverviewLimits
	for (const name of Object.keys(
		WIKI_OVERVIEW_LIMITS,
	) as WikiOverviewLimitName[]) {
		const bound = WIKI_OVERVIEW_LIMITS[name]
		const wanted = requested[name]
		out[name] =
			wanted === undefined
				? bound.default
				: Math.min(Math.max(Math.trunc(wanted), 1), bound.max)
	}
	return out
}

function arrayOf(value: unknown): Document[] {
	return Array.isArray(value) ? (value as Document[]) : []
}

function slugsOf(items: unknown, key: string): string[] {
	const slugs = arrayOf(items)
		.map((item) => item[key])
		.filter((slug): slug is string => typeof slug === "string")
	return [...new Set(slugs)]
}

function kindsTo(relationships: unknown, slug: string): string[] {
	const kinds = arrayOf(relationships)
		.filter((rel) => rel.targetPageSlug === slug)
		.map((rel) => rel.kind as string)
	return [...new Set(kinds)]
}

const CONTEXT_TEXT_CAP = 280

const PAGE_PROJECTION = {
	slug: 1,
	title: 1,
	summary: 1,
	revision: 1,
	body: 1,
	claims: 1,
	relationships: 1,
	updatedAt: 1,
}

async function readablePages(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
	filter: Document,
	limit: number,
): Promise<{ pages: Document[]; hasMore: boolean }> {
	const found = await wikiPagesCollection(handle.db, handle.prefix)
		.find(
			{
				...filter,
				state: { $ne: "superseded" },
				...buildGovernanceFilter(params.governance),
			},
			{ projection: PAGE_PROJECTION },
		)
		.sort({ updatedAt: -1, slug: 1 })
		.limit(limit + 1)
		.toArray()
	return { pages: found.slice(0, limit), hasMore: found.length > limit }
}

function linksTo(text: string, slug: string): boolean {
	return text.includes(`[[${slug}]]`) || text.includes(`[[${slug}|`)
}

function backlinkContext(
	source: Document,
	target: string,
): WikiOverviewBacklink["context"] {
	const claim = arrayOf(source.claims).find(
		(c) =>
			c.status !== "superseded" &&
			((typeof c.text === "string" && linksTo(c.text, target)) ||
				arrayOf(c.evidence).some((e) => e.sourceId === target)),
	)
	const line =
		typeof source.body === "string"
			? source.body.split("\n").find((l: string) => linksTo(l, target))
			: undefined
	const text = line?.trim().slice(0, CONTEXT_TEXT_CAP)
	if (!claim && !text) return undefined
	return { ...(claim ? { claim } : {}), ...(text ? { text } : {}) }
}

async function readBacklinks(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
	view: WikiPageView,
	limit: number,
): Promise<WikiOverviewSection<WikiOverviewBacklink>> {
	const candidates = slugsOf(view.backlinks, "sourcePageSlug").filter(
		(slug) => slug !== view.slug,
	)
	if (candidates.length === 0) return { items: [], hasMore: false }
	const { pages, hasMore } = await readablePages(
		handle,
		params,
		{
			slug: { $in: candidates },
			"relationships.targetPageSlug": view.slug,
		},
		limit,
	)
	const items = pages.map((source) => {
		const context = backlinkContext(source, view.slug)
		return {
			slug: source.slug as string,
			title: source.title as string,
			revision: source.revision as number,
			kinds: kindsTo(source.relationships, view.slug),
			...(context ? { context } : {}),
		}
	})
	return { items, hasMore }
}

async function readNeighbors(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
	view: WikiPageView,
	limits: WikiOverviewLimits,
): Promise<WikiOverviewSection<WikiOverviewNeighbor>> {
	const targets = slugsOf(view.relationships, "targetPageSlug").filter(
		(slug) => slug !== view.slug,
	)
	if (targets.length === 0) return { items: [], hasMore: false }
	const { pages, hasMore } = await readablePages(
		handle,
		params,
		{ slug: { $in: targets } },
		limits.neighbors,
	)
	const items = pages.map((neighbor) => {
		const slug = neighbor.slug as string
		const active = arrayOf(neighbor.claims).filter(
			(c) => c.status !== "superseded",
		)
		const top = [...active]
			.sort(
				(a, b) =>
					((b.confidence as number) ?? 0) - ((a.confidence as number) ?? 0),
			)
			.slice(0, limits.neighborClaims)
		return {
			slug,
			title: neighbor.title as string,
			summary: neighbor.summary as string,
			revision: neighbor.revision as number,
			linkKinds: kindsTo(view.relationships, slug),
			claimCount: active.length,
			claimsTruncated: active.length > top.length,
			claims: top,
		}
	})
	return { items, hasMore }
}

const REVISION_BATCH = 25
const REVISION_SCAN_CAP = 200

const REVISION_PROJECTION = {
	pageSlug: 1,
	scope: 1,
	scopeRef: 1,
	revision: 1,
	editKind: 1,
	editor: 1,
	createdAt: 1,
	"snapshot.scope": 1,
	"snapshot.scopeRef": 1,
	"snapshot.permissions": 1,
}

// Each revision is authorized against its own snapshot, so the limit has to
// count readable revisions only: read newest-first in batches until limit + 1
// readable ones are found or the history ends. The scan stops at
// REVISION_SCAN_CAP revisions; past it, hasMore is true because older readable
// revisions may exist.
async function readRevisions(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
	limit: number,
): Promise<WikiOverviewSection<WikiOverviewRevision>> {
	const coll = wikiRevisionsCollection(handle.db, handle.prefix)
	const readable: WikiOverviewRevision[] = []
	let before: number | undefined
	let scanned = 0
	while (readable.length <= limit && scanned < REVISION_SCAN_CAP) {
		const batch = (await coll
			.find(
				{
					pageSlug: params.slug,
					scope: params.scope,
					scopeRef: params.scopeRef,
					...(before === undefined ? {} : { revision: { $lt: before } }),
				},
				{ projection: REVISION_PROJECTION },
			)
			.sort({ revision: -1 })
			.limit(REVISION_BATCH)
			.toArray()) as Document[]
		for (const doc of batch) {
			const snapshot = (doc.snapshot as Document | undefined) ?? {}
			if (filterPagesByGovernance([snapshot], params.governance).length > 0) {
				readable.push(toRevisionSummary(doc))
			}
		}
		scanned += batch.length
		if (batch.length < REVISION_BATCH) {
			return {
				items: readable.slice(0, limit),
				hasMore: readable.length > limit,
			}
		}
		before = batch[batch.length - 1]?.revision as number
	}
	return {
		items: readable.slice(0, limit),
		hasMore: readable.length > limit || scanned >= REVISION_SCAN_CAP,
	}
}

function timeOf(value: unknown): number {
	return value instanceof Date
		? value.getTime()
		: new Date(String(value)).getTime()
}

// A contradiction names claim ids. Its other claim usually lives on a page
// that links here, so ids are resolved on this page first, then on the
// readable pages that link to it. One whose claims cannot all be shown to this
// caller is dropped whole: showing half of it, or an id, would leak the page
// that holds the rest.
async function readContradictions(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
	view: WikiPageView,
	limit: number,
): Promise<WikiOverviewSection<WikiOverviewContradiction>> {
	const open = arrayOf(view.contradictions).filter(
		(c) => c.resolution === "unresolved" && Array.isArray(c.claimIds),
	)
	if (open.length === 0) return { items: [], hasMore: false }

	const owned = new Map<string, Document>(
		arrayOf(view.claims).map((c) => [c.id as string, c]),
	)
	const foreignIds = [
		...new Set(
			open
				.flatMap((c) => c.claimIds as string[])
				.filter((id) => !owned.has(id)),
		),
	]
	const foreign = new Map<string, { page: Document; claim: Document }>()
	const sources = slugsOf(view.backlinks, "sourcePageSlug").filter(
		(slug) => slug !== view.slug,
	)
	if (foreignIds.length > 0 && sources.length > 0) {
		const { pages } = await readablePages(
			handle,
			params,
			{ slug: { $in: sources }, "claims.id": { $in: foreignIds } },
			sources.length,
		)
		for (const source of pages) {
			for (const claim of arrayOf(source.claims)) {
				const id = claim.id as string
				if (foreignIds.includes(id) && !foreign.has(id)) {
					foreign.set(id, { page: source, claim })
				}
			}
		}
	}

	const here = { slug: view.slug, title: view.title, revision: view.revision }
	const shown: WikiOverviewContradiction[] = []
	for (const c of [...open].sort(
		(a, b) => timeOf(b.detectedAt) - timeOf(a.detectedAt),
	)) {
		const claims: WikiOverviewContradiction["claims"] = []
		for (const id of c.claimIds as string[]) {
			const mine = owned.get(id)
			const theirs = foreign.get(id)
			if (mine) {
				claims.push({
					pageSlug: here.slug,
					pageTitle: here.title,
					revision: here.revision,
					claim: mine,
				})
			} else if (theirs) {
				claims.push({
					pageSlug: theirs.page.slug as string,
					pageTitle: theirs.page.title as string,
					revision: theirs.page.revision as number,
					claim: theirs.claim,
				})
			}
		}
		if (claims.length !== (c.claimIds as string[]).length) continue
		shown.push({
			id: c.id as string,
			detectedAt: new Date(timeOf(c.detectedAt)).toISOString(),
			resolution: c.resolution as string,
			...(typeof c.note === "string" ? { note: c.note } : {}),
			claims,
		})
	}
	return { items: shown.slice(0, limit), hasMore: shown.length > limit }
}

async function readableSlugs(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
	candidates: string[],
): Promise<Set<string>> {
	if (candidates.length === 0) return new Set()
	const found = await wikiPagesCollection(handle.db, handle.prefix)
		.find(
			{
				slug: { $in: candidates },
				state: { $ne: "superseded" },
				...buildGovernanceFilter(params.governance),
			},
			{ projection: { slug: 1 } },
		)
		.toArray()
	return new Set(found.map((doc) => (doc as Document).slug as string))
}

export async function getWikiEntityOverview(
	handle: WikiDbHandle,
	params: WikiEntityOverviewParams,
): Promise<WikiEntityOverview | undefined> {
	const view = await getWikiPage(
		handle,
		params.slug,
		params.scope,
		params.scopeRef,
		params.governance,
	)
	if (!view) return undefined

	const limits = effectiveLimits(params.limits)
	const outgoing = slugsOf(view.relationships, "targetPageSlug")
	const transcluded = arrayOf(view.transcludes) as unknown as string[]
	const [readable, backlinks, neighbors, contradictions, revisions] =
		await Promise.all([
			readableSlugs(handle, params, [
				...new Set([...outgoing, ...transcluded]),
			]),
			readBacklinks(handle, params, view, limits.backlinks),
			readNeighbors(handle, params, view, limits),
			readContradictions(handle, params, view, limits.contradictions),
			readRevisions(handle, params, limits.revisions),
		])

	// The stored backlinks and contradictions name pages and claim ids the
	// caller may not read; the sections above replace them.
	const { backlinks: _stored, contradictions: _open, ...rest } = view
	void _stored
	void _open
	const page = {
		...rest,
		relationships: arrayOf(view.relationships).filter((rel) =>
			readable.has(rel.targetPageSlug as string),
		),
		transcludes: transcluded.filter((slug) => readable.has(slug)),
	}

	return { page, contradictions, backlinks, neighbors, revisions, limits }
}
