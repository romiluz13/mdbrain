import { describe, expect, it } from "vitest"
import type { MdbrainWikiChange } from "@mdbrain/client"
import type { Layout } from "./graph-layout.js"
import type { ChangesView, WikiMapPage, WikiMapView } from "./loaders.js"
import {
	boundaries,
	buildTimeline,
	changesAt,
	graphAt,
	mapAt,
	stateAt,
	type Timeline,
} from "./playback.js"
import type { RunRecord } from "./run-record.js"
import { buildGraph } from "./views.js"

const T = (minute: number, second = 0) =>
	new Date(Date.UTC(2026, 9, 20, 9, minute, second)).toISOString()

function change(
	pageSlug: string,
	revision: number,
	at: string,
	added: number,
	removed = 0,
	over: Partial<MdbrainWikiChange> = {},
): MdbrainWikiChange {
	return {
		pageSlug,
		title: pageSlug,
		revision,
		editKind: "update",
		createdAt: at,
		baseline: revision === 1 ? "none" : "previous",
		baselineRevision: revision === 1 ? null : revision - 1,
		claims: {
			added: [],
			changed: [],
			removed: [],
			counts: { added, changed: 0, removed },
			truncated: false,
		},
		...over,
	} as MdbrainWikiChange
}

function page(
	slug: string,
	revision: number,
	claimCount: number,
	links: string[] = [],
	type = "customer-account",
): WikiMapPage {
	return {
		slug,
		title: slug,
		kind: "entity",
		type,
		trustTier: "standard",
		state: "active",
		revision,
		claimCount,
		linkCount: links.length,
		createdAt: T(1),
		updatedAt: T(1),
		links: links.map((target) => ({ slug: target, kind: "related" })),
		sourceIds: [],
		contradictedClaims: 0,
		claims: [],
	}
}

// Three pages built over time. a: rev 1 (3 claims), rev 2 (+1 -1); b: rev 1 (2);
// c: rev 1 (1) after the agents started. Final claims: a 3, b 2, c 1.
const MAP: WikiMapView = {
	pages: [
		page("accounts/a", 2, 3, ["people/b"]),
		page("people/b", 1, 2, ["accounts/a"], "person"),
		page("syntheses/c", 1, 1, ["accounts/a"], "synthesis"),
	],
	pageTotal: 3,
	claimTotal: 6,
	sourceTotal: 0,
	unresolvedContradictionCount: 0,
}
const CHANGES: ChangesView = {
	changes: [
		change("accounts/a", 1, T(1), 3),
		change("people/b", 1, T(2), 2),
		change("accounts/a", 2, T(4), 1, 1),
		change("syntheses/c", 1, T(9), 1),
	],
	window: { since: T(0), until: T(30), settled: true },
	hasMore: false,
	complete: true,
}

function built(map = MAP, changes = CHANGES): Timeline {
	const result = buildTimeline(map, changes)
	if (!result.ok) throw new Error(result.reason)
	return result.timeline
}

describe("buildTimeline", () => {
	it("orders the stored revisions by time and counts the pages and claims they add", () => {
		const timeline = built()
		expect(
			timeline.points.map((p) => [p.index, p.pageSlug, p.revision, p.created]),
		).toEqual([
			[1, "accounts/a", 1, true],
			[2, "people/b", 1, true],
			[3, "accounts/a", 2, false],
			[4, "syntheses/c", 1, true],
		])
		expect(timeline.points.map((p) => p.claimsAdded - p.claimsRemoved)).toEqual(
			[3, 2, 0, 1],
		)
	})

	it("orders the revisions by time whatever order they arrive in", () => {
		const swapped: ChangesView = {
			...CHANGES,
			changes: [
				CHANGES.changes[3]!,
				CHANGES.changes[2]!,
				CHANGES.changes[1]!,
				CHANGES.changes[0]!,
			],
		}
		expect(built(MAP, swapped).points.map((p) => p.pageSlug)).toEqual([
			"accounts/a",
			"people/b",
			"accounts/a",
			"syntheses/c",
		])
	})

	it("holds the history to the API's final state: the last cursor equals the stored pages, claims and revisions", () => {
		const timeline = built()
		const last = stateAt(timeline, timeline.points.length)
		expect(last.pageCount).toBe(MAP.pageTotal)
		expect(last.claimCount).toBe(MAP.claimTotal)
		expect(last.revisionCount).toBe(4)
		expect([...last.visible].sort()).toEqual(
			MAP.pages.map((p) => p.slug).sort(),
		)
		for (const p of MAP.pages) {
			expect(last.claimsByPage.get(p.slug)).toBe(p.claimCount)
		}
	})

	it.each([
		["the feed was cut short", { ...CHANGES, complete: false, hasMore: true }],
		[
			"a page the feed never mentions",
			{
				...CHANGES,
				changes: CHANGES.changes.filter((c) => c.pageSlug !== "people/b"),
			},
		],
		[
			"a deleted page the map no longer has",
			{
				...CHANGES,
				changes: [...CHANGES.changes, change("accounts/gone", 1, T(3), 1)],
			},
		],
		[
			"a final revision that differs from the map's",
			{ ...CHANGES, changes: CHANGES.changes.filter((c) => c.revision !== 2) },
		],
		[
			"claim counts that do not add up to the map's",
			{
				...CHANGES,
				changes: [
					change("accounts/a", 1, T(1), 9),
					...CHANGES.changes.slice(1),
				],
			},
		],
		[
			"a revision whose claims cannot be compared",
			{
				...CHANGES,
				changes: CHANGES.changes.map((c, i) =>
					i === 2
						? { ...c, baseline: "unavailable" as const, claims: null }
						: c,
				),
			},
		],
		[
			"a first revision that was not a creation",
			{
				...CHANGES,
				changes: CHANGES.changes.map((c, i) =>
					i === 0 ? { ...c, baseline: "previous" as const } : c,
				),
			},
		],
		[
			"a revision with no time",
			{
				...CHANGES,
				changes: CHANGES.changes.map((c, i) =>
					i === 1 ? { ...c, createdAt: "" } : c,
				),
			},
		],
	])("refuses to play back %s, so the page shows the final state instead", (_, changes) => {
		const result = buildTimeline(MAP, changes as ChangesView)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason.length).toBeGreaterThan(10)
	})

	it("has nothing to play back with no revisions", () => {
		expect(buildTimeline(MAP, { ...CHANGES, changes: [] }).ok).toBe(false)
	})
})

describe("stateAt", () => {
	it("derives the pages, claims and revisions at a cursor from the stored revisions alone", () => {
		const timeline = built()
		const at2 = stateAt(timeline, 2)
		expect([...at2.visible].sort()).toEqual(["accounts/a", "people/b"])
		expect(at2.claimCount).toBe(5)
		expect(at2.revisionCount).toBe(2)
		expect(at2.at).toBe(T(2))
		const at3 = stateAt(timeline, 3)
		expect(at3.claimsByPage.get("accounts/a")).toBe(3)
		expect(at3.pageCount).toBe(2)
		expect(at3.recent.map((p) => p.index)).toEqual([3, 2, 1])
	})

	it("matches a brute-force fold of the stored revisions at every cursor", () => {
		const timeline = built()
		for (let cursor = 1; cursor <= timeline.points.length; cursor++) {
			const applied = timeline.points.slice(0, cursor)
			const claims = applied.reduce(
				(n, p) => n + p.claimsAdded - p.claimsRemoved,
				0,
			)
			const state = stateAt(timeline, cursor)
			expect(state.claimCount, `cursor ${cursor}`).toBe(claims)
			expect(state.pageCount, `cursor ${cursor}`).toBe(
				new Set(applied.map((p) => p.pageSlug)).size,
			)
		}
	})

	it("clamps a cursor outside the history", () => {
		const timeline = built()
		expect(stateAt(timeline, 99).cursor).toBe(4)
		expect(stateAt(timeline, -3).cursor).toBe(0)
		expect(stateAt(timeline, 0).pageCount).toBe(0)
	})
})

function run(
	over: Partial<NonNullable<RunRecord["agentRun"]>> = {},
): RunRecord {
	return {
		state: "used",
		createdAt: T(0),
		eventsPlanned: 4,
		pagesPlanned: 3,
		arrivals: [],
		pagesWritten: [],
		agentRun: {
			state: "complete",
			startedAt: T(3),
			endedAt: T(10),
			pendingProposal: { title: "C", slug: "syntheses/c" },
			...over,
		},
	}
}

describe("boundaries", () => {
	it("places the sources, the agents and the recorded approval on the timeline by the run's own times", () => {
		const timeline = built()
		expect(boundaries(timeline, run({ endedAt: T(8) }))).toEqual({
			sourcesEnd: 2,
			agentsEnd: 3,
			approval: 4,
			contradiction: null,
		})
	})

	it("places the contradiction where the detector had recorded it, and nowhere without a record", () => {
		const timeline = built()
		expect(boundaries(timeline, run(), T(5))?.contradiction).toBe(3)
		expect(boundaries(timeline, run(), T(0))?.contradiction).toBe(1)
		expect(boundaries(timeline, run(), "not a time")?.contradiction).toBeNull()
		expect(boundaries(timeline, run())?.contradiction).toBeNull()
	})

	it("reports no approval while the proposal's page has not been stored", () => {
		const timeline = built(
			{ ...MAP, pages: MAP.pages.slice(0, 2), pageTotal: 2, claimTotal: 5 },
			{ ...CHANGES, changes: CHANGES.changes.slice(0, 3) },
		)
		expect(boundaries(timeline, run())?.approval).toBeNull()
	})

	it("has no boundaries without an agent run", () => {
		expect(boundaries(built(), { ...run(), agentRun: undefined })).toBeNull()
		expect(boundaries(built(), undefined)).toBeNull()
	})
})

describe("graphAt", () => {
	const graph = buildGraph(MAP)
	const layout: Layout = {
		x: new Float32Array([0, 0.5, -0.5]),
		y: new Float32Array([0, 0.5, -0.5]),
	}

	it("keeps only the pages that exist at the cursor, their links among themselves, and their own positions", () => {
		const cut = graphAt(graph, layout, new Set(["accounts/a", "people/b"]))!
		expect(cut.graph.nodes.map((n) => n.slug)).toEqual([
			"accounts/a",
			"people/b",
		])
		expect(cut.graph.edges).toHaveLength(1)
		expect(cut.graph.nodes.map((n) => n.degree)).toEqual([1, 1])
		expect(Array.from(cut.layout.x)).toEqual([0, 0.5])
		expect(Array.from(cut.layout.y)).toEqual([0, 0.5])
		expect(cut.graph.index.get("people/b")).toBe(1)
		expect(cut.graph.hub).toBeGreaterThanOrEqual(0)
		expect(cut.graph.groups.reduce((n, g) => n + g.count, 0)).toBe(2)
	})

	it("drops a link whose other end does not exist yet", () => {
		const cut = graphAt(graph, layout, new Set(["accounts/a", "syntheses/c"]))!
		expect(cut.graph.edges).toHaveLength(1)
		const lone = graphAt(graph, layout, new Set(["people/b"]))!
		expect(lone.graph.edges).toHaveLength(0)
	})

	it("is the whole graph when every page exists, and null when none does", () => {
		const all = graphAt(graph, layout, new Set(MAP.pages.map((p) => p.slug)))!
		expect(all.graph.nodes).toHaveLength(3)
		expect(all.graph.edges).toHaveLength(graph.edges.length)
		expect(graphAt(graph, layout, new Set())).toBeNull()
	})
})

describe("changesAt", () => {
	it("keeps the revisions stored by the cursor and no later one", () => {
		const timeline = built()
		const cut = changesAt(CHANGES, timeline, 3)
		expect(
			cut.changes.map((c) => `${c.pageSlug}@${c.revision}`).sort(),
		).toEqual(["accounts/a@1", "accounts/a@2", "people/b@1"])
		expect(changesAt(CHANGES, timeline, 4).changes).toHaveLength(4)
		expect(changesAt(CHANGES, timeline, 0).changes).toHaveLength(0)
		expect(cut.window).toEqual(CHANGES.window)
	})
})

describe("mapAt", () => {
	it("keeps the pages stored by the cursor, with the cursor's revisions, claims and links", () => {
		const timeline = built()
		const cut = mapAt(MAP, stateAt(timeline, 3), true)
		expect(
			cut.pages.map((p) => [p.slug, p.revision, p.claimCount, p.linkCount]),
		).toEqual([
			["accounts/a", 2, 3, 1],
			["people/b", 1, 2, 1],
		])
		expect(cut.pageTotal).toBe(2)
		expect(cut.claimTotal).toBe(5)
	})

	it("drops a link to a page that does not exist yet", () => {
		const cut = mapAt(MAP, stateAt(built(), 1), true)
		expect(cut.pages).toHaveLength(1)
		expect(cut.pages[0]?.links).toEqual([])
		expect(cut.pages[0]?.revision).toBe(1)
	})

	it("is the stored map at the last cursor", () => {
		const timeline = built()
		const last = mapAt(MAP, stateAt(timeline, timeline.points.length), true)
		expect(last.pages.map((p) => [p.slug, p.revision, p.claimCount])).toEqual(
			MAP.pages.map((p) => [p.slug, p.revision, p.claimCount]),
		)
		expect(last.pageTotal).toBe(MAP.pageTotal)
		expect(last.claimTotal).toBe(MAP.claimTotal)
	})

	it("counts open contradictions only once the detector has recorded one", () => {
		const withOne = { ...MAP, unresolvedContradictionCount: 1 }
		const state = stateAt(built(), 3)
		expect(mapAt(withOne, state, true).unresolvedContradictionCount).toBe(1)
		expect(mapAt(withOne, state, false).unresolvedContradictionCount).toBe(0)
	})

	it("flags a page's contradicted claims only once the detector has recorded them", () => {
		const flagged = {
			...MAP,
			pages: MAP.pages.map((p) => ({ ...p, contradictedClaims: 1 })),
		}
		const state = stateAt(built(), 3)
		expect(
			mapAt(flagged, state, true).pages.map((p) => p.contradictedClaims),
		).toEqual([1, 1])
		expect(
			mapAt(flagged, state, false).pages.map((p) => p.contradictedClaims),
		).toEqual([0, 0])
	})
})
