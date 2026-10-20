// Which page owns the claims a contradiction names. Claim ids are unique only
// within a page, so an id the hub shares with another page must never be
// resolved by guessing, and nothing about a page the caller may not read (its
// conflict, id, time or count) may show.
//
// The collections are an in-memory fake that evaluates the real governance
// filters (src/testing/fake-wiki-db.ts), not MongoDB.

import { describe, expect, it } from "vitest"
import {
	HIDDEN,
	admin,
	claim,
	contradiction,
	exec,
	linked,
	outsider,
	overviewOf,
	page,
	refs,
} from "./testing/overview-fixtures.js"

const ids = (overview: Awaited<ReturnType<typeof overviewOf>["result"]>) =>
	overview?.contradictions.items.map((c) => c.id)

describe("legacy records (bare claim ids)", () => {
	it("does not list a hidden page's conflict that reuses a hub claim id", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: {
						permissions: HIDDEN,
						claims: [claim("status", "Layoffs are planned for Q4.")],
					},
				},
			],
			{
				claims: [claim("status", "Headcount is stable.")],
				contradictions: [
					contradiction("contra-status-status", ["status", "status"]),
				],
			},
		)

		for (const caller of [outsider, exec, admin]) {
			const overview = await overviewOf(pages, "hub", caller).result
			expect(ids(overview)).toEqual([])
		}
		const text = JSON.stringify(await overviewOf(pages, "hub", outsider).result)
		expect(text).not.toContain("contra-status-status")
		expect(text).not.toContain("Layoffs")
	})

	it("does not give the hub an id that a hidden page holds too, even when another id of the record is clear", async () => {
		const pages = linked(
			"hub",
			[
				{ slug: "open-src", extra: { claims: [claim("x", "Readable x.")] } },
				{
					slug: "secret-src",
					extra: { permissions: HIDDEN, claims: [claim("m1", "Hidden m1.")] },
				},
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [contradiction("contra-x-m1", ["x", "m1"])],
			},
		)

		for (const caller of [outsider, exec, admin]) {
			expect(ids(await overviewOf(pages, "hub", caller).result)).toEqual([])
		}
	})

	it.each([
		["one id", ["m1"]],
		["no ids", []],
		["an id that is not a string", [5, "m1"]],
	])("drops a record that names %s", async (_, claimIds) => {
		const pages = [
			page("hub", {
				claims: [claim("m1", "Mine."), { id: 5, text: "Numeric id." }],
				contradictions: [contradiction("contra-odd", claimIds)],
			}),
		]

		expect(ids(await overviewOf(pages, "hub", admin).result)).toEqual([])
	})

	it("does not read the hub again to find its own claims", async () => {
		const pages = linked(
			"hub",
			[{ slug: "billing", extra: { claims: [claim("c-their", "Monthly.")] } }],
			{
				claims: [claim("c-mine", "Annual.")],
				contradictions: [contradiction("contra-1", ["c-their", "c-mine"])],
			},
		)

		const { fake, result } = overviewOf(pages, "hub", outsider)
		await result

		const slugReads = fake.queries
			.filter((q) => q.collection === "t_wiki_pages")
			.flatMap((q) => (q.filter.slug?.$in as string[] | undefined) ?? [])
		expect(slugReads).not.toContain("hub")
	})

	it("drops a record whose two claims resolve to the same page and claim", async () => {
		const pages = [
			page("hub", {
				claims: [claim("status", "Only the hub holds this.")],
				contradictions: [
					contradiction("contra-status-status", ["status", "status"]),
				],
			}),
		]

		const overview = await overviewOf(pages, "hub", admin).result

		expect(ids(overview)).toEqual([])
	})

	it("does not give an id to a readable backlink when a hidden page holds it too", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: { permissions: HIDDEN, claims: [claim("x", "Hidden x.")] },
				},
				{ slug: "open-src", extra: { claims: [claim("x", "Readable x.")] } },
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [contradiction("contra-x", ["x", "m1"])],
			},
		)

		for (const caller of [outsider, exec, admin]) {
			const overview = await overviewOf(pages, "hub", caller).result
			expect(ids(overview)).toEqual([])
		}
	})

	it("counts a holder that does not link to the hub, so a readable backlink is not taken for the owner", async () => {
		const pages = [
			...linked(
				"hub",
				[{ slug: "open-src", extra: { claims: [claim("x", "Readable x.")] } }],
				{
					claims: [claim("m1", "Mine.")],
					contradictions: [contradiction("contra-x", ["x", "m1"])],
				},
			),
			page("unlinked-secret", {
				permissions: HIDDEN,
				claims: [claim("x", "Hidden x.")],
			}),
		]

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(ids(overview)).toEqual([])
	})

	it("counts a superseded holder too, because its claim may be the one the record meant", async () => {
		const pages = linked(
			"hub",
			[
				{ slug: "open-src", extra: { claims: [claim("x", "Readable x.")] } },
				{
					slug: "old-src",
					extra: { state: "superseded", claims: [claim("x", "Old x.")] },
				},
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [contradiction("contra-x", ["x", "m1"])],
			},
		)

		const overview = await overviewOf(pages, "hub", admin).result

		expect(ids(overview)).toEqual([])
	})

	it("still lists a record when exactly one page holds each id and the caller may read both", async () => {
		const theirs = claim("c-their", "Renewal is monthly.")
		const mine = claim("c-mine", "Renewal is annual.")
		const pages = linked(
			"hub",
			[{ slug: "billing", extra: { claims: [theirs] } }],
			{
				claims: [mine],
				contradictions: [contradiction("contra-1", ["c-their", "c-mine"])],
			},
		)

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(
			overview?.contradictions.items[0]?.claims.map((c) => c.pageSlug),
		).toEqual(["billing", "hub"])
	})

	it("lists a record whose sole holder no longer links to the hub", async () => {
		const pages = [
			page("hub", {
				claims: [claim("m1", "Mine.")],
				contradictions: [contradiction("contra-x", ["x", "m1"])],
			}),
			page("moved-on", { claims: [claim("x", "Only here.")] }),
		]

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(
			overview?.contradictions.items[0]?.claims.map((c) => c.pageSlug),
		).toEqual(["moved-on", "hub"])
	})

	it("drops a record whose sole holder is a page the caller may not read", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: { permissions: HIDDEN, claims: [claim("s1", "Hidden.")] },
				},
			],
			{
				claims: [claim("m1", "Mine.")],
				contradictions: [contradiction("contra-s1", ["s1", "m1"])],
			},
		)

		expect(ids(await overviewOf(pages, "hub", outsider).result)).toEqual([])
		expect(ids(await overviewOf(pages, "hub", exec).result)).toEqual([
			"contra-s1",
		])
	})
})

describe("records with provenance", () => {
	it("resolves each claim from the page it names, however many pages reuse the id", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "open-src",
					extra: { claims: [claim("status", "Open status.")] },
				},
				{ slug: "other-src", extra: { claims: [claim("status", "Other.")] } },
			],
			{
				claims: [claim("status", "Hub status.")],
				contradictions: [
					contradiction("contra-status-status", ["status", "status"], {
						claimRefs: refs(["open-src", "status"], ["hub", "status"]),
					}),
				],
			},
		)

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(
			overview?.contradictions.items[0]?.claims.map((c) => [
				c.pageSlug,
				c.claim.text,
			]),
		).toEqual([
			["open-src", "Open status."],
			["hub", "Hub status."],
		])
	})

	it("drops a record whose named page the caller may not read, and shows it to one who may", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "secret-src",
					extra: {
						permissions: HIDDEN,
						claims: [claim("status", "Layoffs are planned for Q4.")],
					},
				},
			],
			{
				claims: [claim("status", "Headcount is stable.")],
				contradictions: [
					contradiction("contra-status-status", ["status", "status"], {
						claimRefs: refs(["secret-src", "status"], ["hub", "status"]),
					}),
				],
			},
		)

		const outside = await overviewOf(pages, "hub", outsider).result
		const inside = await overviewOf(pages, "hub", exec).result

		expect(ids(outside)).toEqual([])
		const text = JSON.stringify(outside)
		expect(text).not.toContain("contra-status-status")
		expect(text).not.toContain("secret-src")
		expect(text).not.toContain("Layoffs")
		expect(
			inside?.contradictions.items[0]?.claims.map((c) => [
				c.pageSlug,
				c.claim.text,
			]),
		).toEqual([
			["secret-src", "Layoffs are planned for Q4."],
			["hub", "Headcount is stable."],
		])
	})

	it("drops a record whose named page became hidden after it was written", async () => {
		const record = contradiction("contra-s1", ["s1", "m1"], {
			claimRefs: refs(["src", "s1"], ["hub", "m1"]),
		})
		const visible = linked(
			"hub",
			[{ slug: "src", extra: { claims: [claim("s1", "S1.")] } }],
			{
				claims: [claim("m1", "M1.")],
				contradictions: [record],
			},
		)
		const hidden = linked(
			"hub",
			[
				{
					slug: "src",
					extra: { permissions: HIDDEN, claims: [claim("s1", "S1.")] },
				},
			],
			{ claims: [claim("m1", "M1.")], contradictions: [record] },
		)

		expect(ids(await overviewOf(visible, "hub", outsider).result)).toEqual([
			"contra-s1",
		])
		expect(ids(await overviewOf(hidden, "hub", outsider).result)).toEqual([])
	})

	it("trusts the named page over a legacy-style guess even when the hub holds the id", async () => {
		const pages = linked(
			"hub",
			[
				{
					slug: "open-src",
					extra: { claims: [claim("status", "Open status.")] },
				},
			],
			{
				claims: [claim("status", "Hub status.")],
				contradictions: [
					contradiction("contra-status-status", ["status", "status"], {
						claimRefs: refs(["hub", "status"], ["open-src", "status"]),
					}),
				],
			},
		)

		const overview = await overviewOf(pages, "hub", outsider).result

		expect(
			overview?.contradictions.items[0]?.claims.map((c) => c.pageSlug),
		).toEqual(["hub", "open-src"])
	})

	it.each([
		["a missing page", refs(["nowhere", "s1"], ["hub", "m1"])],
		["a claim the page does not hold", refs(["src", "gone"], ["hub", "m1"])],
		["a superseded page", refs(["old-src", "s1"], ["hub", "m1"])],
		["the same page and claim twice", refs(["hub", "m1"], ["hub", "m1"])],
		["refs that disagree with the ids", refs(["src", "other"], ["hub", "m1"])],
		["too few refs", refs(["src", "s1"])],
		["too many refs", refs(["src", "s1"], ["hub", "m1"], ["hub", "m1"])],
		["a null ref", [null, { pageSlug: "hub", claimId: "m1" }]],
		["refs that are not an array", { pageSlug: "src", claimId: "s1" }],
		[
			"a malformed ref",
			[{ pageSlug: "src" }, { pageSlug: "hub", claimId: "m1" }],
		],
	])("drops a record that names %s", async (_, claimRefs) => {
		const pages = linked(
			"hub",
			[
				{ slug: "src", extra: { claims: [claim("s1", "S1.")] } },
				{
					slug: "old-src",
					extra: { state: "superseded", claims: [claim("s1", "Old.")] },
				},
			],
			{
				claims: [claim("m1", "M1.")],
				contradictions: [
					contradiction("contra-bad", ["s1", "m1"], { claimRefs }),
				],
			},
		)

		expect(ids(await overviewOf(pages, "hub", admin).result)).toEqual([])
	})
})
