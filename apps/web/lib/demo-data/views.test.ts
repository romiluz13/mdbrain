import { describe, expect, it } from "vitest"
import type { MdbrainWikiChange, MdbrainWikiClaim } from "@mdbrain/client"
import type { ChangesView, WikiMapPage, WikiMapView } from "./loaders.js"
import {
	buildGraph,
	buildSourceIndex,
	earliestIngestion,
	formatUtc,
	governanceMix,
	flagPages,
	groupOf,
	rankClaims,
	summarizeChanges,
} from "./views.js"

function page(slug: string, overrides: Partial<WikiMapPage> = {}): WikiMapPage {
	return {
		slug,
		title: slug,
		kind: "entity",
		type: "customer-account",
		trustTier: "standard",
		state: "active",
		revision: 1,
		claimCount: 1,
		linkCount: 0,
		createdAt: "2026-10-20T09:00:00.000Z",
		updatedAt: "2026-10-20T09:00:00.000Z",
		links: [],
		sourceIds: [],
		contradictedClaims: 0,
		claims: [],
		...overrides,
	}
}

function view(pages: WikiMapPage[]): WikiMapView {
	return {
		pages,
		pageTotal: pages.length,
		claimTotal: 0,
		sourceTotal: 0,
		unresolvedContradictionCount: 0,
	}
}

describe("groupOf", () => {
	it("groups the corpus page types into the colored sectors of the direction", () => {
		expect(groupOf("customer-account")).toMatchObject({
			id: "account",
			label: "Accounts",
			color: "#F0B84B",
		})
		expect(groupOf("person")).toMatchObject({ id: "person", label: "People" })
		expect(groupOf("company").id).toBe("concept")
		expect(groupOf("model-release").id).toBe("concept")
		expect(groupOf("processes").id).toBe("process")
	})

	it("gives a type it does not know a neutral sector instead of dropping the page", () => {
		expect(groupOf("something-new")).toMatchObject({
			id: "other",
			label: "Other pages",
		})
	})
})

describe("buildGraph", () => {
	it("links pages by their stored relationships, once per pair, and skips dangling targets", () => {
		const graph = buildGraph(
			view([
				page("a", {
					links: [
						{ slug: "b", kind: "uses" },
						{ slug: "ghost", kind: "uses" },
					],
				}),
				page("b", { links: [{ slug: "a", kind: "used-by" }] }),
				page("c", {
					links: [
						{ slug: "a", kind: "owned-by" },
						{ slug: "c", kind: "self" },
					],
				}),
			]),
		)
		expect(graph.nodes.map((n) => [n.slug, n.degree])).toEqual([
			["a", 2],
			["b", 1],
			["c", 1],
		])
		expect(graph.edges).toHaveLength(2)
		expect(graph.index.get("c")).toBe(2)
	})

	it("picks the most connected page as the hub, ties by claims then slug", () => {
		const graph = buildGraph(
			view([
				page("a", { links: [{ slug: "b", kind: "x" }] }),
				page("b", { claimCount: 5 }),
				page("c"),
			]),
		)
		expect(graph.nodes[graph.hub]?.slug).toBe("b")
	})

	it("marks a page contradicted when it holds a contradicted claim", () => {
		const graph = buildGraph(
			view([page("a", { contradictedClaims: 1 }), page("b")]),
		)
		expect(graph.nodes.map((n) => n.contradicted)).toEqual([true, false])
	})

	it("summarizes the groups in the order of the direction, empty ones left out", () => {
		const graph = buildGraph(
			view([page("p1", { type: "person" }), page("a1"), page("a2")]),
		)
		expect(graph.groups.map((g) => [g.id, g.count])).toEqual([
			["account", 2],
			["person", 1],
		])
	})
})

describe("governanceMix", () => {
	it("counts pages by trust tier and by lifecycle state, largest first", () => {
		const mix = governanceMix(
			view([
				page("a", { trustTier: "standard" }),
				page("b", { trustTier: "verified", state: "superseded" }),
				page("c", { trustTier: "standard" }),
			]),
		)
		expect(mix.tiers).toEqual([
			["standard", 2],
			["verified", 1],
		])
		expect(mix.states).toEqual([
			["active", 2],
			["superseded", 1],
		])
	})
})

describe("earliestIngestion", () => {
	it("is the earliest page creation time, and null when there are no pages", () => {
		expect(
			earliestIngestion(
				view([
					page("a", { createdAt: "2026-10-20T09:05:00.000Z" }),
					page("b", { createdAt: "2026-10-20T08:59:00.000Z" }),
				]),
			),
		).toBe("2026-10-20T08:59:00.000Z")
		expect(earliestIngestion(view([]))).toBeNull()
	})
})

describe("summarizeChanges", () => {
	const claimsOf = (
		added: number,
		changed: number,
		removed: number,
	): MdbrainWikiChange["claims"] => ({
		added: [],
		changed: [],
		removed: [],
		counts: { added, changed, removed },
		truncated: false,
	})
	const change = (
		slug: string,
		revision: number,
		claims: MdbrainWikiChange["claims"],
	): MdbrainWikiChange => ({
		pageSlug: slug,
		revision,
		editKind: "update",
		createdAt: "2026-10-20T09:00:00.000Z",
		baseline: "previous",
		baselineRevision: revision - 1,
		claims,
	})
	it("totals revisions, distinct pages and claim movements, counting an unreadable baseline as none", () => {
		const changes: ChangesView = {
			changes: [
				change("a", 2, claimsOf(2, 1, 0)),
				change("a", 3, claimsOf(0, 1, 1)),
				change("b", 1, null),
			],
			window: { since: "s", until: "u", settled: true },
			hasMore: false,
			complete: true,
		}
		expect(summarizeChanges(changes)).toEqual({
			revisions: 3,
			pages: 2,
			added: 2,
			changed: 2,
			removed: 1,
		})
	})
})

describe("formatUtc", () => {
	it("prints an instant in UTC with the zone named, so the two clocks never read as local", () => {
		expect(formatUtc("2026-09-14T15:20:00.000Z")).toBe(
			"Sep 14, 2026, 15:20 UTC",
		)
	})
	it("says unknown for a missing or unreadable time instead of inventing one", () => {
		expect(formatUtc(undefined)).toBe("unknown")
		expect(formatUtc("not a date")).toBe("unknown")
	})
})

describe("rankClaims", () => {
	const claim = (
		id: string,
		text: string,
		confidence = 0.9,
	): MdbrainWikiClaim => ({
		id,
		text,
		status: "active",
		confidence,
		evidence: [],
		derivedFrom: [],
	})
	it("puts the claims that share the most question words first and keeps the rest in page order", () => {
		const ranked = rankClaims("Is the Halvorsen renewal safe?", [
			claim("fleet", "Halvorsen runs 4,200 trucks."),
			claim("arr", "Halvorsen brings $1.26M ARR."),
			claim("health", "The Halvorsen renewal is healthy and safe."),
		])
		expect(ranked.map((c) => c.id)).toEqual(["health", "fleet", "arr"])
	})
})

describe("flagPages", () => {
	it("marks the named pages contradicted without changing what the layout reads", () => {
		const base = buildGraph(
			view([page("a"), page("b", { contradictedClaims: 1 }), page("c")]),
		)
		const flagged = flagPages(base, new Set(["c", "missing"]))
		expect(flagged.nodes.map((n) => n.contradicted)).toEqual([
			false,
			true,
			true,
		])
		expect(flagged.edges).toBe(base.edges)
		expect(flagged.groups).toBe(base.groups)
		expect(flagged.hub).toBe(base.hub)
		expect(base.nodes.map((n) => n.contradicted)).toEqual([false, true, false])
	})

	it("returns the same graph when there is nothing to flag", () => {
		const base = buildGraph(view([page("a")]))
		expect(flagPages(base, new Set())).toBe(base)
	})
})

describe("buildSourceIndex", () => {
	const claim = (id: string, eventIds: string[]): MdbrainWikiClaim => ({
		id,
		text: id,
		status: "active",
		confidence: 0.9,
		evidence: eventIds.map((sourceId) => ({
			kind: "event" as const,
			sourceId,
		})),
		derivedFrom: [],
	})
	it("lists each source event once, with the first claim that cites it, in page order", () => {
		const index = buildSourceIndex(
			view([
				page("a", {
					claims: [claim("c1", ["e1", "e2"]), claim("c2", ["e2", "e3"])],
				}),
				page("b", { claims: [claim("c3", ["e3", "e4"])] }),
			]),
			10,
		)
		expect(
			index.map((entry) => [entry.eventId, entry.pageSlug, entry.claim.id]),
		).toEqual([
			["e1", "a", "c1"],
			["e2", "a", "c1"],
			["e3", "a", "c2"],
			["e4", "b", "c3"],
		])
	})

	it("stops at the limit", () => {
		const index = buildSourceIndex(
			view([page("a", { claims: [claim("c1", ["e1", "e2", "e3"])] })]),
			2,
		)
		expect(index.map((entry) => entry.eventId)).toEqual(["e1", "e2"])
	})

	it("skips evidence that is not a source event", () => {
		const other: MdbrainWikiClaim = {
			...claim("c1", []),
			evidence: [
				{
					kind: "wiki",
					sourceId: "x",
				} as unknown as MdbrainWikiClaim["evidence"][number],
			],
		}
		expect(buildSourceIndex(view([page("a", { claims: [other] })]), 5)).toEqual(
			[],
		)
	})
})
