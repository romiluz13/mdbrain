// Entity overview assembly: neighbors with their bounded top claims, and the
// bounds themselves.
//
// The collections are an in-memory fake that EVALUATES the real governance
// filters and $in lookups (src/testing/fake-wiki-db.ts). It is not MongoDB: the
// live check on the demo stack covers real operator semantics.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import {
	HIDDEN,
	claim,
	exec,
	hubLinking,
	outsider,
	overviewOf,
	page,
} from "./testing/overview-fixtures.js"
import { WIKI_OVERVIEW_LIMITS } from "./wiki-overview.js"

describe("neighbors", () => {
	it("lists the pages the page links to, newest first, with their top claims", async () => {
		const pages = hubLinking([
			{ slug: "older", kind: "owns" },
			{
				slug: "newer",
				kind: "depends_on",
				extra: {
					revision: 3,
					claims: [
						claim("n1", "Low confidence.", { confidence: 0.2 }),
						claim("n2", "High confidence.", { confidence: 0.9 }),
						claim("n3", "Replaced.", { confidence: 1, status: "superseded" }),
						claim("n4", "Middle confidence.", { confidence: 0.5 }),
					],
				},
			},
		])
		const older = pages.find((p) => p.slug === "older") as Document
		older.updatedAt = new Date("2026-09-02T00:00:00.000Z")
		const newer = pages.find((p) => p.slug === "newer") as Document
		newer.updatedAt = new Date("2026-09-03T00:00:00.000Z")

		const overview = await overviewOf(pages, "hub", outsider, {
			limits: { neighborClaims: 2 },
		}).result

		expect(overview?.neighbors.hasMore).toBe(false)
		expect(overview?.neighbors.items.map((n) => n.slug)).toEqual([
			"newer",
			"older",
		])
		const first = overview?.neighbors.items[0]
		expect(first).toMatchObject({
			title: "Title of newer",
			summary: "Summary of newer",
			revision: 3,
			linkKinds: ["depends_on"],
			claimCount: 3,
			claimsTruncated: true,
		})
		expect(first?.claims.map((c) => c.id)).toEqual(["n2", "n4"])
		expect(overview?.neighbors.items[1]).toMatchObject({
			linkKinds: ["owns"],
			claims: [],
			claimCount: 0,
			claimsTruncated: false,
		})
	})

	it("reports claimsTruncated false when every active claim fits", async () => {
		const pages = hubLinking([
			{ slug: "n", extra: { claims: [claim("a", "A"), claim("b", "B")] } },
		])

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.neighbors.items[0]).toMatchObject({
			claimCount: 2,
			claimsTruncated: false,
		})
	})

	it("leaves a forbidden neighbor out of items, hasMore and the response entirely", async () => {
		const pages = hubLinking([
			{ slug: "visible-a" },
			{
				slug: "secret-n",
				extra: {
					permissions: HIDDEN,
					title: "Secret Merger Target",
					claims: [claim("s1", "The merger closes in March.")],
				},
			},
			{ slug: "visible-b" },
		])

		const all = await overviewOf(pages, "hub", outsider, {
			limits: { neighbors: 2 },
		}).result
		const capped = await overviewOf(pages, "hub", outsider, {
			limits: { neighbors: 1 },
		}).result

		expect(all?.neighbors.items.map((n) => n.slug).sort()).toEqual([
			"visible-a",
			"visible-b",
		])
		expect(all?.neighbors.hasMore).toBe(false)
		expect(capped?.neighbors.items).toHaveLength(1)
		expect(capped?.neighbors.hasMore).toBe(true)
		for (const response of [all, capped]) {
			const text = JSON.stringify(response)
			expect(text).not.toContain("secret-n")
			expect(text).not.toContain("Secret Merger Target")
			expect(text).not.toContain("merger closes")
		}
	})

	it("shows the same neighbor, claims included, to a caller who may read it", async () => {
		const pages = hubLinking([
			{
				slug: "secret-n",
				extra: { permissions: HIDDEN, claims: [claim("s1", "Cleared claim.")] },
			},
		])

		const overview = await overviewOf(pages, "hub", exec).result

		expect(overview?.neighbors.items[0]?.claims.map((c) => c.id)).toEqual([
			"s1",
		])
	})

	it("omits a link whose target page does not exist", async () => {
		const pages = hubLinking([{ slug: "real" }])
		;(pages[0] as Document).relationships.push({
			targetPageSlug: "dangling",
			targetTitle: "Dangling",
			kind: "related_to",
		})

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.neighbors.items.map((n) => n.slug)).toEqual(["real"])
		expect(JSON.stringify(overview?.neighbors)).not.toContain("dangling")
	})
})

describe("limits", () => {
	const defaults = {
		backlinks: 20,
		neighbors: 10,
		neighborClaims: 3,
		revisions: 5,
		contradictions: 20,
	}
	const maximums = {
		backlinks: 100,
		neighbors: 50,
		neighborClaims: 10,
		revisions: 20,
		contradictions: 100,
	}

	it("states a default and a maximum for every bound", () => {
		for (const [name, bound] of Object.entries(WIKI_OVERVIEW_LIMITS)) {
			expect(bound.default).toBe(defaults[name as keyof typeof defaults])
			expect(bound.max).toBe(maximums[name as keyof typeof maximums])
		}
	})

	it("applies the defaults when none are asked for and echoes them", async () => {
		const overview = await overviewOf([page("hub")], "hub", outsider).result

		expect(overview?.limits).toEqual(defaults)
	})

	it("clamps a bound above its maximum and discloses what applied", async () => {
		const overview = await overviewOf([page("hub")], "hub", outsider, {
			limits: {
				backlinks: 5000,
				neighbors: 51,
				neighborClaims: 11,
				revisions: 21,
				contradictions: 101,
			},
		}).result

		expect(overview?.limits).toEqual(maximums)
	})

	it("never goes below one", async () => {
		const overview = await overviewOf([page("hub")], "hub", outsider, {
			limits: { backlinks: 0, neighbors: -4 },
		}).result

		expect(overview?.limits.backlinks).toBe(1)
		expect(overview?.limits.neighbors).toBe(1)
	})

	it("bounds the neighbors and their claims at the stated maximum", async () => {
		const many = Array.from({ length: 60 }, (_, i) => ({
			slug: `n${String(i).padStart(2, "0")}`,
			extra: {
				claims: Array.from({ length: 15 }, (_, k) =>
					claim(`c${k}`, `Claim ${k}`),
				),
			},
		}))

		const overview = await overviewOf(hubLinking(many), "hub", outsider, {
			limits: { neighbors: 9999, neighborClaims: 9999 },
		}).result

		expect(overview?.neighbors.items).toHaveLength(50)
		expect(overview?.neighbors.hasMore).toBe(true)
		expect(overview?.neighbors.items[0]?.claims).toHaveLength(10)
		expect(overview?.neighbors.items[0]?.claimCount).toBe(15)
		expect(overview?.neighbors.items[0]?.claimsTruncated).toBe(true)
	})
})
