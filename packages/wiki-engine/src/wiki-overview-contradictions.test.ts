// Entity overview assembly: open contradictions and the claims they name.
//
// The collections are an in-memory fake that EVALUATES the real governance
// filters and $in lookups (src/testing/fake-wiki-db.ts). It is not MongoDB: the
// live check on the demo stack covers real operator semantics.

import { describe, expect, it } from "vitest"
import {
	HIDDEN,
	claim,
	contradiction,
	exec,
	linked,
	outsider,
	overviewOf,
	page,
} from "./testing/overview-fixtures.js"

describe("contradictions", () => {
	it("lists open contradictions with both claims resolved to the page that holds them", async () => {
		const mine = claim("c-mine", "Renewal is annual.")
		const theirs = claim("c-their", "Renewal is monthly.", { confidence: 0.8 })
		const pages = linked(
			"hub",
			[{ slug: "billing", extra: { claims: [theirs], revision: 7 } }],
			{
				claims: [mine],
				contradictions: [
					contradiction("contra-1", ["c-their", "c-mine"], {
						note: "check contract",
					}),
				],
			},
		)

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.contradictions).toEqual({
			items: [
				{
					id: "contra-1",
					detectedAt: "2026-09-05T00:00:00.000Z",
					resolution: "unresolved",
					note: "check contract",
					claims: [
						{
							pageSlug: "billing",
							pageTitle: "Title of billing",
							revision: 7,
							claim: theirs,
						},
						{
							pageSlug: "hub",
							pageTitle: "Title of hub",
							revision: 1,
							claim: mine,
						},
					],
				},
			],
			hasMore: false,
		})
	})

	it("omits contradictions that are already resolved", async () => {
		const pages = [
			page("hub", {
				claims: [claim("a", "A"), claim("b", "B")],
				contradictions: [
					contradiction("done", ["a", "b"], { resolution: "newest_wins" }),
					contradiction("open", ["a", "b"]),
				],
			}),
		]

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.contradictions.items.map((c) => c.id)).toEqual(["open"])
	})

	it("drops a contradiction whose other claim lives on a page the caller may not read", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: {
						permissions: HIDDEN,
						claims: [claim("s1", "Layoffs are planned for Q4.")],
					},
				},
				{
					slug: "open-src",
					extra: { claims: [claim("o1", "Visible conflict.")] },
				},
			],
			{
				claims: [claim("m1", "Headcount is stable.")],
				contradictions: [
					contradiction("contra-secret", ["s1", "m1"], {}, 6),
					contradiction("contra-open", ["o1", "m1"], {}, 5),
				],
			},
		)

		const outside = await overviewOf(pages, "hub", outsider).result
		const inside = await overviewOf(pages, "hub", exec).result

		expect(outside?.contradictions.items.map((c) => c.id)).toEqual([
			"contra-open",
		])
		const text = JSON.stringify(outside)
		expect(text).not.toContain("contra-secret")
		expect(text).not.toContain("Layoffs")
		expect(text).not.toContain("secret-src")
		expect(inside?.contradictions.items.map((c) => c.id)).toEqual([
			"contra-secret",
			"contra-open",
		])
	})

	it("drops a contradiction whose claim id resolves nowhere", async () => {
		const pages = [
			page("hub", {
				claims: [claim("a", "A")],
				contradictions: [contradiction("orphan", ["a", "missing-claim"])],
			}),
		]

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.contradictions.items).toEqual([])
		expect(JSON.stringify(overview)).not.toContain("missing-claim")
	})

	it("counts only readable contradictions toward hasMore", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: { permissions: HIDDEN, claims: [claim("s1", "Hidden.")] },
				},
				{
					slug: "open-src",
					extra: { claims: [claim("o1", "One."), claim("o2", "Two.")] },
				},
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [
					contradiction("c-secret", ["s1", "m1"], {}, 9),
					contradiction("c-o1", ["o1", "m1"], {}, 8),
					contradiction("c-o2", ["o2", "m1"], {}, 7),
				],
			},
		)

		const fits = await overviewOf(pages, "hub", outsider, {
			limits: { contradictions: 2 },
		}).result
		const cut = await overviewOf(pages, "hub", outsider, {
			limits: { contradictions: 1 },
		}).result

		expect(fits?.contradictions.items.map((c) => c.id)).toEqual([
			"c-o1",
			"c-o2",
		])
		expect(fits?.contradictions.hasMore).toBe(false)
		expect(cut?.contradictions.items.map((c) => c.id)).toEqual(["c-o1"])
		expect(cut?.contradictions.hasMore).toBe(true)
	})
})
