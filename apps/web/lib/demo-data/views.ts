// Pure view models for the /demo chapters: derived values only, no reads and
// no rendering. Everything here is computed from loader results.

import type { MdbrainWikiChange, MdbrainWikiClaim } from "@mdbrain/client"
import type { ChangesView, WikiMapPage, WikiMapView } from "./loaders.js"

export type GroupId =
	| "account"
	| "person"
	| "team"
	| "product"
	| "process"
	| "policy"
	| "incident"
	| "concept"
	| "other"

type GroupSpec = {
	id: GroupId
	label: string
	/** The page-type hue on the scope surface, from the 304 direction. */
	color: string
	types: readonly string[]
}

// Sector order is the reading order around the map. The hues are the 304
// page-type hues; teams share the document hue and unknown types get a
// neutral one, because the direction names eight hues for ten stored types.
const GROUPS: readonly GroupSpec[] = [
	{ id: "account", label: "Accounts", color: "#F0B84B", types: ["customer-account", "account", "customer"] },
	{ id: "person", label: "People", color: "#8DBDF2", types: ["person"] },
	{ id: "team", label: "Teams", color: "#C8D4D6", types: ["team"] },
	{ id: "product", label: "Products", color: "#6FD3A8", types: ["product", "project"] },
	{ id: "process", label: "Processes", color: "#4DC3D6", types: ["processes", "process", "runbook"] },
	{ id: "policy", label: "Policies", color: "#B8A2F0", types: ["policy"] },
	{ id: "incident", label: "Incidents", color: "#F46F5B", types: ["incidents", "incident"] },
	{ id: "concept", label: "Concepts", color: "#F2B8D2", types: ["concepts", "concept", "company", "model-release"] },
	{ id: "other", label: "Other pages", color: "#8FA3A0", types: [] },
]

const OTHER = GROUPS[GROUPS.length - 1] as GroupSpec

/** The sector a page type belongs to. A type the table does not know lands in
 *  a neutral sector instead of being dropped from the map. */
export function groupOf(type: string): GroupSpec {
	return GROUPS.find((group) => group.types.includes(type)) ?? OTHER
}

export type GraphNode = {
	slug: string
	title: string
	type: string
	group: GroupId
	color: string
	degree: number
	claimCount: number
	/** The page holds a contradicted claim or is named by the open case. */
	contradicted: boolean
}

export type GraphEdge = { a: number; b: number; kind: string }

export type GraphGroup = { id: GroupId; label: string; color: string; count: number }

export type Graph = {
	nodes: GraphNode[]
	edges: GraphEdge[]
	groups: GraphGroup[]
	/** Slug to node index. */
	index: Map<string, number>
	/** Index of the most connected page: the map's first focus. */
	hub: number
}

/** The brain as a graph: one node per stored page, one edge per linked pair
 *  of stored pages (a relationship to a page outside the run is not drawn). */
export function buildGraph(
	view: WikiMapView,
	flagged: ReadonlySet<string> = new Set(),
): Graph {
	const index = new Map<string, number>()
	view.pages.forEach((page, position) => index.set(page.slug, position))
	const edges: GraphEdge[] = []
	const seen = new Set<string>()
	const degree = new Array<number>(view.pages.length).fill(0)
	view.pages.forEach((page, from) => {
		for (const link of page.links) {
			const to = index.get(link.slug)
			if (to === undefined || to === from) {
				continue
			}
			const key = from < to ? `${from}:${to}` : `${to}:${from}`
			if (seen.has(key)) {
				continue
			}
			seen.add(key)
			edges.push({ a: from, b: to, kind: link.kind })
			degree[from] = (degree[from] ?? 0) + 1
			degree[to] = (degree[to] ?? 0) + 1
		}
	})
	const nodes = view.pages.map((page, position): GraphNode => {
		const group = groupOf(page.type)
		return {
			slug: page.slug,
			title: page.title,
			type: page.type,
			group: group.id,
			color: group.color,
			degree: degree[position] ?? 0,
			claimCount: page.claimCount,
			contradicted: page.contradictedClaims > 0 || flagged.has(page.slug),
		}
	})
	let hub = 0
	nodes.forEach((node, position) => {
		const best = nodes[hub] as GraphNode
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
	const groups = GROUPS.map((spec) => ({
		id: spec.id,
		label: spec.label,
		color: spec.color,
		count: nodes.filter((node) => node.group === spec.id).length,
	})).filter((group) => group.count > 0)
	return { nodes, edges, groups, index, hub }
}

function tally(values: readonly string[]): Array<[string, number]> {
	const counts = new Map<string, number>()
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1)
	}
	return [...counts.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	)
}

/** The governed-growth mix of the stored brain: pages by trust tier and by
 *  lifecycle state, largest first. */
export function governanceMix(view: WikiMapView): {
	tiers: Array<[string, number]>
	states: Array<[string, number]>
} {
	return {
		tiers: tally(view.pages.map((page) => page.trustTier)),
		states: tally(view.pages.map((page) => page.state)),
	}
}

/** The earliest stored page creation time: ingestion time, the only honest
 *  `since` the page can offer without a run-window route. */
export function earliestIngestion(view: WikiMapView): string | null {
	let best: string | null = null
	let bestTime = Number.POSITIVE_INFINITY
	for (const page of view.pages) {
		const time = Date.parse(page.createdAt)
		if (!Number.isNaN(time) && time < bestTime) {
			bestTime = time
			best = page.createdAt
		}
	}
	return best
}

export type ChangesSummary = {
	revisions: number
	pages: number
	added: number
	changed: number
	removed: number
}

function claimMoves(change: MdbrainWikiChange): ChangesSummary["added"][] {
	const counts = change.claims?.counts
	return [counts?.added ?? 0, counts?.changed ?? 0, counts?.removed ?? 0]
}

/** What changed, in numbers. A revision whose baseline cannot be read counts
 *  as a revision with no claim movement, never as a guess. */
export function summarizeChanges(view: ChangesView): ChangesSummary {
	const summary: ChangesSummary = {
		revisions: view.changes.length,
		pages: new Set(view.changes.map((change) => change.pageSlug)).size,
		added: 0,
		changed: 0,
		removed: 0,
	}
	for (const change of view.changes) {
		const [added, changed, removed] = claimMoves(change)
		summary.added += added ?? 0
		summary.changed += changed ?? 0
		summary.removed += removed ?? 0
	}
	return summary
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (value: number): string => String(value).padStart(2, "0")

/** An instant in UTC with the zone named, so ingestion and business time are
 *  never read as the viewer's local clock. */
export function formatUtc(iso: string | undefined): string {
	if (iso === undefined) {
		return "unknown"
	}
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) {
		return "unknown"
	}
	return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"are",
	"was",
	"were",
	"this",
	"that",
	"with",
	"from",
	"has",
	"have",
	"does",
	"not",
	"its",
	"our",
	"you",
	"can",
])

function words(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9$%.,-]+/g) ?? [])
		.map((word) => word.replace(/^[.,-]+|[.,-]+$/g, ""))
		.filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

/** The claims of a page, most relevant to the question first: by the number of
 *  distinct question words each claim shares, then confidence, then page order.
 *  A claim that shares no word keeps its place behind the ones that do. */
export function rankClaims(
	query: string,
	claims: readonly MdbrainWikiClaim[],
): MdbrainWikiClaim[] {
	const wanted = new Set(words(query))
	const scored = claims.map((claim, index) => {
		const have = new Set(words(claim.text))
		let overlap = 0
		for (const word of wanted) {
			if (have.has(word)) {
				overlap += 1
			}
		}
		return { claim, index, overlap }
	})
	scored.sort(
		(a, b) =>
			b.overlap - a.overlap ||
			b.claim.confidence - a.claim.confidence ||
			a.index - b.index,
	)
	return scored.map((entry) => entry.claim)
}
