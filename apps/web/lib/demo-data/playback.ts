// Recorded playback (ticket 14, plan decision 4). Public mode shows a stored,
// completed run as a history a visitor can scrub: at any cursor the pages, the
// claims, the revisions and the graph are derived from the run's stored
// revisions (the API's change feed), never from a script and never from the
// final state alone.
//
// One timeline is built once from reads the page already makes: the change feed
// from the start and the final page map. It is accepted only if it reproduces
// the API's final state exactly (pages, revisions per page, claims per page).
// Otherwise there is no playback and the page shows the final state with a
// chronological feed and says so. A frame afterwards is an in-memory fold: no
// read per frame.

import type { Layout } from "./graph-layout.js"
import type { ChangesView, WikiMapView } from "./loaders.js"
import type { RunRecord } from "./run-record.js"
import type { Graph, GraphGroup } from "./views.js"

export type TimelinePoint = {
	/** 1-based: cursor n has applied points 1..n. */
	index: number
	at: string
	pageSlug: string
	title?: string
	revision: number
	/** The revision that created the page. */
	created: boolean
	claimsAdded: number
	claimsRemoved: number
	claimsChanged: number
}

export type Timeline = {
	points: TimelinePoint[]
	/** Page slug to the cursor at which the page exists. */
	createdAt: Map<string, number>
}

export type TimelineResult =
	| { ok: true; timeline: Timeline }
	| { ok: false; reason: string }

const refuse = (reason: string): TimelineResult => ({ ok: false, reason })

export function buildTimeline(
	map: WikiMapView,
	changes: ChangesView,
): TimelineResult {
	if (!changes.complete || changes.hasMore) {
		return refuse("The change feed was cut short, so the history is partial.")
	}
	if (changes.changes.length === 0) {
		return refuse("The run stored no revisions to play back.")
	}
	const sorted = [...changes.changes].sort(
		(a, b) =>
			Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
			(a.pageSlug < b.pageSlug ? -1 : a.pageSlug > b.pageSlug ? 1 : 0) ||
			a.revision - b.revision,
	)
	const points: TimelinePoint[] = []
	const createdAt = new Map<string, number>()
	const lastRevision = new Map<string, number>()
	const claims = new Map<string, number>()
	for (const change of sorted) {
		if (Number.isNaN(Date.parse(change.createdAt))) {
			return refuse("A stored revision carries no time.")
		}
		if (change.claims === null || change.baseline === "unavailable") {
			return refuse(
				"A stored revision cannot be compared with its predecessor.",
			)
		}
		const first = !createdAt.has(change.pageSlug)
		if (first && change.baseline !== "none") {
			return refuse("The feed starts a page after its first revision.")
		}
		const added = change.claims.counts.added
		const removed = change.claims.counts.removed
		const point: TimelinePoint = {
			index: points.length + 1,
			at: change.createdAt,
			pageSlug: change.pageSlug,
			...(change.title !== undefined ? { title: change.title } : {}),
			revision: change.revision,
			created: first,
			claimsAdded: added,
			claimsRemoved: removed,
			claimsChanged: change.claims.counts.changed,
		}
		points.push(point)
		if (first) createdAt.set(change.pageSlug, point.index)
		lastRevision.set(change.pageSlug, change.revision)
		claims.set(
			change.pageSlug,
			(claims.get(change.pageSlug) ?? 0) + added - removed,
		)
	}
	const slugs = new Set(map.pages.map((page) => page.slug))
	for (const slug of createdAt.keys()) {
		if (!slugs.has(slug)) {
			return refuse("The feed names a page the final state no longer has.")
		}
	}
	for (const page of map.pages) {
		if (!createdAt.has(page.slug)) {
			return refuse("A stored page has no revisions in the feed.")
		}
		if (lastRevision.get(page.slug) !== page.revision) {
			return refuse("The feed ends a page at a different revision than stored.")
		}
		if ((claims.get(page.slug) ?? 0) !== page.claimCount) {
			return refuse("The claims the feed adds differ from the stored claims.")
		}
	}
	return {
		ok: true,
		timeline: {
			points,
			createdAt,
		},
	}
}

export type PlaybackState = {
	cursor: number
	total: number
	/** When the revision at the cursor was stored. */
	at?: string
	pageCount: number
	claimCount: number
	revisionCount: number
	visible: Set<string>
	claimsByPage: Map<string, number>
	revisionByPage: Map<string, number>
	/** The latest revisions up to the cursor, newest first. */
	recent: TimelinePoint[]
}

const RECENT = 6

export function stateAt(timeline: Timeline, cursor: number): PlaybackState {
	const total = timeline.points.length
	const at = Math.max(0, Math.min(total, Math.trunc(cursor)))
	const applied = timeline.points.slice(0, at)
	const claimsByPage = new Map<string, number>()
	const revisionByPage = new Map<string, number>()
	let claimCount = 0
	for (const point of applied) {
		revisionByPage.set(point.pageSlug, point.revision)
		const delta = point.claimsAdded - point.claimsRemoved
		claimsByPage.set(
			point.pageSlug,
			(claimsByPage.get(point.pageSlug) ?? 0) + delta,
		)
		claimCount += delta
	}
	const visible = new Set(claimsByPage.keys())
	return {
		cursor: at,
		total,
		...(at > 0 ? { at: (applied[at - 1] as TimelinePoint).at } : {}),
		pageCount: visible.size,
		claimCount,
		revisionCount: at,
		visible,
		claimsByPage,
		revisionByPage,
		recent: applied.slice(-RECENT).reverse(),
	}
}

export type Boundaries = {
	/** The cursor after the last revision stored before the agents started. */
	sourcesEnd: number
	/** The cursor after the last revision stored by the time the agents ended. */
	agentsEnd: number
	/** The cursor at which the proposed page was approved into the wiki, or
	 * null while the record shows it pending. */
	approval: number | null
	/** The cursor at which the detector had recorded the run's contradiction,
	 * or null when none is recorded. */
	contradiction: number | null
}

/** The cursor that has applied every revision stored up to an instant, never
 * less than the first; null for an instant that is missing or not a time. */
export function cursorAt(
	timeline: Timeline,
	instant: string | undefined,
): number | null {
	const at = instant === undefined ? Number.NaN : Date.parse(instant)
	if (Number.isNaN(at)) return null
	return Math.max(
		1,
		timeline.points.filter((point) => Date.parse(point.at) <= at).length,
	)
}

/** Where the run's own times fall on the timeline, or null when the run has no
 * agent run to place. */
export function boundaries(
	timeline: Timeline,
	run: RunRecord | undefined,
	detectedAt?: string,
): Boundaries | null {
	const agentRun = run?.agentRun
	if (!agentRun) return null
	const started = Date.parse(agentRun.startedAt)
	if (Number.isNaN(started)) return null
	const ended = agentRun.endedAt ? Date.parse(agentRun.endedAt) : Number.NaN
	const total = timeline.points.length
	const sourcesEnd = timeline.points.filter(
		(point) => Date.parse(point.at) < started,
	).length
	const agentsEnd = Number.isNaN(ended)
		? total
		: timeline.points.filter((point) => Date.parse(point.at) <= ended).length
	const slug = agentRun.pendingProposal?.slug
	const approvalPoint =
		slug === undefined
			? undefined
			: timeline.points.find(
					(point) =>
						point.created && point.pageSlug === slug && point.index > agentsEnd,
				)
	const contradiction = cursorAt(timeline, detectedAt)
	return {
		sourcesEnd,
		agentsEnd,
		approval: approvalPoint?.index ?? null,
		contradiction,
	}
}

/** The graph as it stood at the cursor: the pages that exist, the links among
 * them, and each page's own position, so nothing moves when another arrives.
 * Null while nothing exists yet. */
export function graphAt(
	graph: Graph,
	layout: Layout,
	visible: ReadonlySet<string>,
): { graph: Graph; layout: Layout } | null {
	const keep: number[] = []
	graph.nodes.forEach((node, position) => {
		if (visible.has(node.slug)) keep.push(position)
	})
	if (keep.length === 0) return null
	const renumbered = new Map<number, number>()
	keep.forEach((position, next) => {
		renumbered.set(position, next)
	})
	const edges = graph.edges.flatMap((edge) => {
		const a = renumbered.get(edge.a)
		const b = renumbered.get(edge.b)
		return a === undefined || b === undefined ? [] : [{ ...edge, a, b }]
	})
	const degree = new Array<number>(keep.length).fill(0)
	for (const edge of edges) {
		degree[edge.a] = (degree[edge.a] ?? 0) + 1
		degree[edge.b] = (degree[edge.b] ?? 0) + 1
	}
	const nodes = keep.map((position, next) => ({
		...(graph.nodes[position] as Graph["nodes"][number]),
		degree: degree[next] ?? 0,
	}))
	let hub = 0
	nodes.forEach((node, position) => {
		const best = nodes[hub] as Graph["nodes"][number]
		if (
			node.degree > best.degree ||
			(node.degree === best.degree && node.claimCount > best.claimCount) ||
			(node.degree === best.degree &&
				node.claimCount === best.claimCount &&
				node.slug < best.slug)
		) {
			hub = position
		}
	})
	const groups: GraphGroup[] = graph.groups
		.map((group) => ({
			...group,
			count: nodes.filter((node) => node.group === group.id).length,
		}))
		.filter((group) => group.count > 0)
	return {
		graph: {
			nodes,
			edges,
			groups,
			index: new Map(nodes.map((node, position) => [node.slug, position])),
			hub,
		},
		layout: {
			x: Float32Array.from(keep, (position) => layout.x[position] ?? 0),
			y: Float32Array.from(keep, (position) => layout.y[position] ?? 0),
		},
	}
}

/** The change feed as it stood at the cursor: the revisions already stored. */
export function changesAt(
	changes: ChangesView,
	timeline: Timeline,
	cursor: number,
): ChangesView {
	const stored = new Set(
		timeline.points
			.slice(0, Math.max(0, cursor))
			.map((point) => `${point.pageSlug}\u0000${point.revision}`),
	)
	return {
		...changes,
		changes: changes.changes.filter((change) =>
			stored.has(`${change.pageSlug}\u0000${change.revision}`),
		),
	}
}

/** The page list as it stood at the cursor. A page's trust tier, lifecycle
 * state and claim texts are the stored final values; its revision and claim
 * count are the cursor's. Contradicted claims are counted only once the
 * detector has recorded the contradiction. */
export function mapAt(
	map: WikiMapView,
	state: PlaybackState,
	contradictionRecorded: boolean,
): WikiMapView {
	const pages = map.pages
		.filter((page) => state.visible.has(page.slug))
		.map((page) => {
			const links = page.links.filter((link) => state.visible.has(link.slug))
			return {
				...page,
				revision: state.revisionByPage.get(page.slug) ?? page.revision,
				claimCount: state.claimsByPage.get(page.slug) ?? page.claimCount,
				contradictedClaims: contradictionRecorded ? page.contradictedClaims : 0,
				links,
				linkCount: links.length,
			}
		})
	return {
		pages,
		pageTotal: pages.length,
		claimTotal: state.claimCount,
		sourceTotal: new Set(pages.flatMap((page) => page.sourceIds)).size,
		unresolvedContradictionCount: contradictionRecorded
			? map.unresolvedContradictionCount
			: 0,
	}
}
