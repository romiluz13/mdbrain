// Entity overview assembly: the page and its backlinks. A page, backlink source or
// revision the caller may not read leaves no trace in the response, not even in a
// flag or a count.
//
// The collections are an in-memory fake that EVALUATES the real governance
// filters and $in lookups (src/testing/fake-wiki-db.ts). It is not MongoDB: the
// live check on the demo stack covers real operator semantics.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import {
	HIDDEN,
	admin,
	claim,
	exec,
	linked,
	outsider,
	overviewOf,
	page,
	slugsIn,
} from "./testing/overview-fixtures.js"

describe("the page", () => {
	it("is missing for a slug that does not exist", async () => {
		const { result } = overviewOf([page("a")], "nope", outsider)

		expect(await result).toBeUndefined()
	})

	it("is missing, exactly like an unknown slug, when the caller may not read it", async () => {
		const pages = [page("secret", { permissions: HIDDEN })]

		expect(await overviewOf(pages, "secret", outsider).result).toBeUndefined()
		expect(await overviewOf(pages, "secret", exec).result).toBeDefined()
		expect(await overviewOf(pages, "secret", admin).result).toBeDefined()
	})

	it("is missing from another scopeRef and when superseded", async () => {
		const pages = [
			page("elsewhere", { scopeRef: "ws-2" }),
			page("retired", { state: "superseded" }),
		]

		expect(
			await overviewOf(pages, "elsewhere", outsider).result,
		).toBeUndefined()
		expect(await overviewOf(pages, "retired", outsider).result).toBeUndefined()
	})

	it("is returned with its claims, in a view that omits the stored backlink list", async () => {
		const pages = [
			page("hub", {
				claims: [claim("c1", "The hub is large.")],
				backlinks: [{ sourcePageSlug: "ghost", sourceTitle: "Ghost" }],
			}),
		]

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.page.slug).toBe("hub")
		expect(overview?.page.claims).toEqual([claim("c1", "The hub is large.")])
		expect(overview?.page).not.toHaveProperty("backlinks")
		expect(overview?.page).not.toHaveProperty("embedding")
		expect(overview?.page.createdAt).toBe("2026-09-01T00:00:00.000Z")
	})

	it("lists only the relationships and transclusions whose target the caller may read", async () => {
		const rel = (slug: string) => ({
			targetPageSlug: slug,
			targetTitle: `Title of ${slug}`,
			kind: "related_to",
		})
		const pages = [
			page("hub", {
				relationships: [rel("open"), rel("secret"), rel("dangling")],
				transcludes: ["open", "secret"],
			}),
			page("open"),
			page("secret", { permissions: HIDDEN }),
		]

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(
			overview?.page.relationships.map((r) => (r as Document).targetPageSlug),
		).toEqual(["open"])
		expect(overview?.page.transcludes).toEqual(["open"])
		expect(JSON.stringify(overview)).not.toContain("secret")
		expect(JSON.stringify(overview)).not.toContain("dangling")
	})

	it("keeps every relationship for a caller who may read every target", async () => {
		const rel = (slug: string) => ({
			targetPageSlug: slug,
			targetTitle: slug,
			kind: "related_to",
		})
		const pages = [
			page("hub", { relationships: [rel("open"), rel("secret")] }),
			page("open"),
			page("secret", { permissions: HIDDEN }),
		]

		const overview = await overviewOf(pages, "hub", exec).result

		expect(
			overview?.page.relationships.map((r) => (r as Document).targetPageSlug),
		).toEqual(["open", "secret"])
	})
})

describe("a page stored without the optional array fields", () => {
	it("still has an overview, with empty sections", async () => {
		// The page schema requires none of these fields, so an older or imported
		// page may lack them.
		const bare = page("bare") as Record<string, unknown>
		for (const field of [
			"claims",
			"contradictions",
			"relationships",
			"backlinks",
			"transcludes",
		]) {
			delete bare[field]
		}

		const overview = await overviewOf([bare as Document], "bare", outsider)
			.result

		expect(overview?.page.slug).toBe("bare")
		expect(overview?.page.relationships).toEqual([])
		expect(overview?.page.transcludes).toEqual([])
		expect(overview?.contradictions).toEqual({ items: [], hasMore: false })
		expect(overview?.backlinks).toEqual({ items: [], hasMore: false })
		expect(overview?.neighbors).toEqual({ items: [], hasMore: false })
	})

	it("lists a neighbor and a backlink source that lack claims and relationships", async () => {
		const pages = [
			page("hub", {
				relationships: [
					{ targetPageSlug: "n", targetTitle: "N", kind: "related_to" },
				],
				backlinks: [{ sourcePageSlug: "src", sourceTitle: "Src" }],
			}),
			page("n"),
			page("src", {
				relationships: [
					{ targetPageSlug: "hub", targetTitle: "Hub", kind: "mentions" },
				],
			}),
		]
		delete (pages[1] as Record<string, unknown>).claims
		delete (pages[2] as Record<string, unknown>).claims

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.neighbors.items[0]).toMatchObject({
			slug: "n",
			claims: [],
			claimCount: 0,
		})
		expect(overview?.backlinks.items.map((i) => i.slug)).toEqual(["src"])
	})
})

describe("backlinks", () => {
	it("lists the readable pages that link to the page, newest first, with the link kinds", async () => {
		const pages = linked("hub", [
			{ slug: "old", kind: "owns" },
			{ slug: "new", kind: "mentions" },
		])
		const old = pages.find((p) => p.slug === "old") as Document
		old.updatedAt = new Date("2026-09-02T00:00:00.000Z")
		const fresh = pages.find((p) => p.slug === "new") as Document
		fresh.updatedAt = new Date("2026-09-03T00:00:00.000Z")
		fresh.revision = 4

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.backlinks).toEqual({
			items: [
				{
					slug: "new",
					title: "Title of new",
					revision: 4,
					kinds: ["mentions"],
				},
				{ slug: "old", title: "Title of old", revision: 1, kinds: ["owns"] },
			],
			hasMore: false,
		})
	})

	it("adds the claim that cites the target and the body line that links it", async () => {
		const cited = claim("k1", "Halvorsen renewed.", {
			evidence: [{ kind: "file", sourceId: "hub" }],
		})
		const linksInText = claim("k2", "See [[hub]] for the account owner.")
		const pages = linked("hub", [
			{
				slug: "renewal",
				extra: {
					claims: [claim("k0", "Unrelated."), cited],
					body: "Intro.\nThe renewal is tracked on [[hub|the hub]] weekly.\nOutro.",
				},
			},
			{ slug: "owner", extra: { claims: [linksInText] } },
			{ slug: "bare" },
		])

		const overview = await overviewOf(pages, "hub", outsider).result
		const byslug = Object.fromEntries(
			(overview?.backlinks.items ?? []).map((i) => [i.slug, i.context]),
		)

		expect(byslug.renewal).toEqual({
			claim: cited,
			text: "The renewal is tracked on [[hub|the hub]] weekly.",
		})
		expect(byslug.owner).toEqual({ claim: linksInText })
		expect(byslug.bare).toBeUndefined()
	})

	it("never offers a superseded claim as the context", async () => {
		const stale = claim("k1", "Old [[hub]] fact.", { status: "superseded" })
		const pages = linked("hub", [{ slug: "src", extra: { claims: [stale] } }])

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(overview?.backlinks.items[0]?.context).toBeUndefined()
	})

	it("leaves out a forbidden source and does not count it toward hasMore", async () => {
		const pages = linked("hub", [
			{ slug: "visible-a" },
			{ slug: "secret-x", extra: { permissions: HIDDEN } },
			{ slug: "visible-b" },
		])

		const one = await overviewOf(pages, "hub", outsider, {
			limits: { backlinks: 2 },
		}).result
		const two = await overviewOf(pages, "hub", outsider, {
			limits: { backlinks: 1 },
		}).result

		expect(slugsIn(one?.backlinks)?.sort()).toEqual(["visible-a", "visible-b"])
		expect(one?.backlinks.hasMore).toBe(false)
		expect(slugsIn(two?.backlinks)).toHaveLength(1)
		expect(two?.backlinks.hasMore).toBe(true)
		expect(JSON.stringify(one)).not.toContain("secret-x")
		expect(JSON.stringify(two)).not.toContain("secret-x")
	})

	it("shows the forbidden source to a caller who may read it", async () => {
		const pages = linked("hub", [
			{ slug: "visible" },
			{ slug: "secret-x", extra: { permissions: HIDDEN } },
		])

		const overview = await overviewOf(pages, "hub", exec).result

		expect(slugsIn(overview?.backlinks)?.sort()).toEqual([
			"secret-x",
			"visible",
		])
	})

	it("skips stored entries that no readable page backs: missing, superseded, or no longer linking", async () => {
		const pages = [
			...linked("hub", [
				{ slug: "real" },
				{ slug: "gone", extra: { state: "superseded" } },
			]),
			page("drifted"),
		]
		const hub = pages.find((p) => p.slug === "hub") as Document
		hub.backlinks.push(
			{ sourcePageSlug: "never-existed", sourceTitle: "Never existed" },
			{ sourcePageSlug: "drifted", sourceTitle: "Drifted" },
		)

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(slugsIn(overview?.backlinks)).toEqual(["real"])
		expect(JSON.stringify(overview)).not.toContain("never-existed")
	})

	it("reads the sources in one governed query, scoped to the request", async () => {
		const pages = linked("hub", [{ slug: "a" }, { slug: "b" }])
		const { fake, result } = overviewOf(pages, "hub", outsider)
		await result

		const sourceQueries = fake.queries.filter(
			(q) =>
				JSON.stringify(q.filter).includes('"$in":["a","b"]') ||
				JSON.stringify(q.filter).includes('"$in":["b","a"]'),
		)
		expect(sourceQueries.length).toBeGreaterThan(0)
		for (const q of sourceQueries) {
			expect(JSON.stringify(q.filter)).toContain('"scope":"workspace"')
			expect(JSON.stringify(q.filter)).toContain('"scopeRef":"ws-1"')
			expect(JSON.stringify(q.filter)).toContain("permissions")
		}
	})
})
