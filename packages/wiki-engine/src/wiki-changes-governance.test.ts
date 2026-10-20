// Governance: a revision is authorized against its OWN snapshot, as the revision
// routes do. A revision the caller may not read leaves no trace: not in the
// entries, not in a count or hasMore, not as a cursor position. A diff is shown
// only against a previous snapshot the caller may also read; otherwise the entry
// says the baseline is unavailable, in one shape for "forbidden" and "missing", so
// the forbidden snapshot's content, and the fact that it exists, stay hidden.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import {
	WikiChangesScanError,
	decodeWikiChangesCursor,
} from "./wiki-changes.js"
import {
	HIDDEN,
	admin,
	claim as c,
	exec,
	feedOf,
	outsider,
	rev,
	slugsOf,
} from "./testing/changes-fixtures.js"

const hidden = (
	slug: string,
	revision: number,
	time: string,
	claims: Document[] = [c("s1", "SECRET-CLAIM text")],
	extra: Document = {},
) =>
	rev(slug, revision, time, {
		snapshot: {
			title: `SECRET-TITLE ${slug}`,
			permissions: HIDDEN,
			claims,
			...extra,
		},
	})

describe("a revision the caller may not read", () => {
	const revisions = () => [
		rev("open-a", 1, "02:00:00.000"),
		hidden("vault", 1, "02:00:00.001"),
		rev("open-b", 1, "02:00:00.002"),
	]

	it("is absent, and the response carries nothing of it", async () => {
		const page = await feedOf(revisions()).run()

		expect(slugsOf(page)).toEqual(["open-a@1", "open-b@1"])
		const text = JSON.stringify(page)
		for (const trace of ["vault", "SECRET-TITLE", "SECRET-CLAIM"]) {
			expect(text, trace).not.toContain(trace)
		}
	})

	it("is shown to a caller who may read it", async () => {
		const asExec = await feedOf(revisions(), { governance: exec }).run()
		const asAdmin = await feedOf(revisions(), { governance: admin }).run()

		expect(slugsOf(asExec)).toEqual(["open-a@1", "vault@1", "open-b@1"])
		expect(slugsOf(asAdmin)).toEqual(["open-a@1", "vault@1", "open-b@1"])
	})

	it("is indistinguishable from a database that never held it: same pages, same hasMore, same cursors", async () => {
		const withVault = feedOf(revisions())
		const without = feedOf(revisions().filter((r) => r.pageSlug !== "vault"))

		for (const size of [1, 2, 3]) {
			let a: string | undefined
			let b: string | undefined
			for (let i = 0; i < 4; i++) {
				const pa = await withVault.run({ limit: size, cursor: a })
				const pb = await without.run({ limit: size, cursor: b })
				expect(pa, `size ${size} page ${i}`).toEqual(pb)
				a = pa.nextCursor
				b = pb.nextCursor
				if (!a) break
			}
		}
	})

	it("never decides where a page ends or whether another page exists", async () => {
		const feed = feedOf([
			rev("a", 1, "02:00:00.000"),
			hidden("vault", 1, "02:00:00.001"),
			hidden("vault", 2, "02:00:00.002"),
			rev("b", 1, "02:00:00.003"),
			hidden("vault2", 1, "02:00:00.004"),
		])

		const first = await feed.run({ limit: 1 })
		const second = await feed.run({ limit: 1, cursor: first.nextCursor })

		expect(slugsOf(first)).toEqual(["a@1"])
		expect(first.hasMore).toBe(true)
		expect(slugsOf(second)).toEqual(["b@1"])
		expect(second.hasMore).toBe(false)
		expect(second.nextCursor).toBeUndefined()
		expect(decodeWikiChangesCursor(first.nextCursor ?? "").after.pageSlug).toBe(
			"a",
		)
	})

	it("is left out of the database read for a caller without access (the permissions filter runs on the snapshot)", async () => {
		const feed = feedOf(revisions())

		await feed.run()
		const forOutsider = JSON.stringify(feed.fake.queries[0]?.filter)
		const adminFeed = feedOf(revisions(), { governance: admin })
		await adminFeed.run()

		expect(forOutsider).toContain("snapshot.permissions")
		expect(JSON.stringify(adminFeed.fake.queries[0]?.filter)).not.toContain(
			"permissions",
		)
	})

	it("is dropped by the authority check even when the database filter would let it through", async () => {
		// Permissions holding only unknown keys: the query form reads the page as
		// open, the in-memory form (what the revision routes use) as closed.
		const odd = rev("odd", 1, "02:00:00.001", {
			snapshot: { title: "ODD-TITLE", permissions: { custom: true } },
		})
		const feed = feedOf([
			rev("a", 1, "02:00:00.000"),
			odd,
			rev("b", 1, "02:00:00.002"),
		])

		const page = await feed.run()

		expect(slugsOf(page)).toEqual(["a@1", "b@1"])
		expect(JSON.stringify(page)).not.toContain("ODD")
	})

	it("is skipped over, across batches, to fill a page", async () => {
		const odd = (i: number) =>
			rev(`odd${i}`, 1, `02:00:0${i % 10}.${100 + i}`, {
				snapshot: { permissions: { custom: true } },
			})
		const revisions = [
			...Array.from({ length: 12 }, (_, i) => odd(i)),
			rev("z1", 1, "03:00:00.000"),
			rev("z2", 1, "03:00:00.001"),
			rev("z3", 1, "03:00:00.002"),
		]
		const feed = feedOf(revisions)

		const page = await feed.run({ limit: 2 })

		expect(slugsOf(page)).toEqual(["z1@1", "z2@1"])
		expect(page.hasMore).toBe(true)
	})

	it("fails loudly, rather than stall or name a hidden position, when the scan cap is reached with nothing to show", async () => {
		const odd = Array.from({ length: 10 }, (_, i) =>
			rev(`odd${i}`, 1, `02:00:00.${100 + i}`, {
				snapshot: { permissions: { custom: true } },
			}),
		)
		const feed = feedOf([...odd, rev("z", 1, "03:00:00.000")])

		await expect(feed.run({ limit: 1, scanCap: 5 })).rejects.toBeInstanceOf(
			WikiChangesScanError,
		)
	})

	it("returns what it found with hasMore true when the scan cap is reached after something to show", async () => {
		const odd = (i: number) =>
			rev(`odd${i}`, 1, `02:00:00.${100 + i}`, {
				snapshot: { permissions: { custom: true } },
			})
		const feed = feedOf([
			rev("first", 1, "01:00:00.000"),
			...Array.from({ length: 10 }, (_, i) => odd(i)),
			rev("last", 1, "03:00:00.000"),
		])

		const page = await feed.run({ limit: 2, scanCap: 4 })

		expect(slugsOf(page)).toEqual(["first@1"])
		expect(page.hasMore).toBe(true)
	})

	it("is checked against the revision's own snapshot, not the page's later state", async () => {
		const feed = feedOf([
			rev("page", 1, "02:00:00.000"),
			hidden("page", 2, "03:00:00.000"),
			rev("page", 3, "04:00:00.000"),
		])

		const page = await feed.run()

		expect(slugsOf(page)).toEqual(["page@1", "page@3"])
	})

	it("is never read from another scopeRef", async () => {
		const feed = feedOf([
			rev("mine", 1, "02:00:00.000"),
			rev("theirs", 1, "02:00:00.001", {
				extra: { scopeRef: "ws-2" },
				snapshot: { scopeRef: "ws-2" },
			}),
		])

		expect(slugsOf(await feed.run())).toEqual(["mine@1"])
	})
})

describe("a previous snapshot the caller may not read", () => {
	const restrictedThenOpen = () => [
		rev("deal", 1, "01:00:00.000", {
			snapshot: {
				permissions: HIDDEN,
				claims: [
					c("k1", "SECRET-CLAIM renewal at 40%"),
					c("k2", "SECRET-CLAIM kept"),
				],
			},
		}),
		rev("deal", 2, "03:00:00.000", {
			snapshot: { claims: [c("k1", "Renewal discussed."), c("k3", "New.")] },
		}),
	]
	const since = { since: new Date("2026-10-01T02:00:00.000Z") }

	it("gives the readable revision no diff content", async () => {
		const page = await feedOf(restrictedThenOpen(), since).run()

		const [change] = page.changes
		expect(change).toMatchObject({
			revision: 2,
			editKind: "update",
			baseline: "unavailable",
			baselineRevision: null,
			claims: null,
		})
		expect(JSON.stringify(page)).not.toContain("SECRET-CLAIM")
		expect(JSON.stringify(page)).not.toContain("renewal at 40%")
	})

	it("looks exactly like a previous snapshot that was never recorded", async () => {
		const forbidden = await feedOf(restrictedThenOpen(), since).run()
		const missing = await feedOf(
			restrictedThenOpen().filter((r) => r.revision !== 1),
			since,
		).run()

		expect(forbidden).toEqual(missing)
	})

	it("diffs normally for a caller who may read both revisions", async () => {
		const page = await feedOf(restrictedThenOpen(), {
			...since,
			governance: exec,
		}).run()

		expect(page.changes[0]?.baseline).toBe("previous")
		expect(page.changes[0]?.claims?.removed.map((x) => x.id)).toEqual(["k2"])
	})

	it("gives a revision that follows a restricted one no baseline, even though an earlier revision was open", async () => {
		const page = await feedOf(
			[
				rev("deal", 1, "01:00:00.000", {
					snapshot: { claims: [c("k1", "A")] },
				}),
				rev("deal", 2, "02:00:00.000", {
					snapshot: { claims: [c("k1", "B")], permissions: HIDDEN },
				}),
				rev("deal", 3, "03:00:00.000", {
					snapshot: { claims: [c("k1", "C")] },
				}),
			],
			since,
		).run()

		expect(slugsOf(page)).toEqual(["deal@3"])
		expect(page.changes[0]?.baseline).toBe("unavailable")
		expect(JSON.stringify(page)).not.toContain('"B"')
	})

	it("leaves out a restricted revision that follows a readable one", async () => {
		const page = await feedOf(
			[
				rev("deal", 1, "01:00:00.000", {
					snapshot: { claims: [c("k1", "A")] },
				}),
				hidden("deal", 2, "02:00:00.000", [c("k1", "SECRET-CLAIM B")]),
			],
			{ since: new Date("2026-10-01T00:00:00.000Z") },
		).run()

		expect(slugsOf(page)).toEqual(["deal@1"])
		expect(JSON.stringify(page)).not.toContain("SECRET-CLAIM")
	})
})

describe("deletions", () => {
	it("hides the deletion of a page the caller may not read, and shows the deletion of one they may", async () => {
		const feed = feedOf([
			rev("open", 2, "02:00:00.000", {
				editKind: "delete",
				snapshot: { claims: [c("o1", "Open claim.")] },
			}),
			rev("vault", 3, "02:00:00.001", {
				editKind: "delete",
				snapshot: {
					title: "SECRET-TITLE",
					permissions: HIDDEN,
					claims: [c("v1", "SECRET-CLAIM")],
				},
			}),
		])

		const page = await feed.run()

		expect(slugsOf(page)).toEqual(["open@2"])
		expect(JSON.stringify(page)).not.toContain("SECRET")
	})
})

describe("callers by tier", () => {
	it.each([
		["outsider", outsider, ["open@1"]],
		["exec", exec, ["open@1", "vault@1"]],
		["admin", admin, ["open@1", "vault@1"]],
	])("%s sees the revisions its governance allows", async (_name, governance, expected) => {
		const feed = feedOf(
			[rev("open", 1, "02:00:00.000"), hidden("vault", 1, "02:00:00.001")],
			{ governance },
		)

		expect(slugsOf(await feed.run())).toEqual(expected)
	})
})
