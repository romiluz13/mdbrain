// What-changed-since feed: the window, the order, the page size and the explicit
// created and deleted entries. The revisions collection is the in-memory fake
// from src/testing, which evaluates the feed's real filters, sort and limit. It is
// not MongoDB: the live check on the demo stack covers the real server.

import { describe, expect, it } from "vitest"
import { WikiChangesRequestError } from "./wiki-changes.js"
import {
	NOW,
	at,
	claim as c,
	feedOf,
	iso,
	rev,
	slugsOf,
} from "./testing/changes-fixtures.js"

describe("the window", () => {
	it("lists the revisions in [since, until), oldest first, ordered by time, page, then revision", async () => {
		const { run } = feedOf([
			rev("late", 1, "10:00:00.000"),
			rev("b", 2, "09:00:00.000"),
			rev("a", 3, "09:00:00.000"),
			rev("a", 2, "09:00:00.000"),
			rev("early", 1, "01:00:00.000"),
		])

		const page = await run()

		expect(slugsOf(page)).toEqual(["early@1", "a@2", "a@3", "b@2", "late@1"])
	})

	it("includes a revision at since and excludes one at until", async () => {
		const { run } = feedOf([
			rev("before", 1, "03:59:59.999"),
			rev("at-since", 1, "04:00:00.000"),
			rev("inside", 1, "05:00:00.000"),
			rev("at-until", 1, "06:00:00.000"),
		])

		const page = await run({
			since: at("04:00:00.000"),
			until: at("06:00:00.000"),
		})

		expect(slugsOf(page)).toEqual(["at-since@1", "inside@1"])
		expect(page.window).toEqual({
			since: iso("04:00:00.000"),
			until: iso("06:00:00.000"),
			settled: true,
		})
	})

	it("stays inside the request's scope and scopeRef", async () => {
		const { run } = feedOf([
			rev("mine", 1, "02:00:00.000"),
			rev("elsewhere", 1, "02:00:00.000", { extra: { scopeRef: "ws-2" } }),
			rev("other-scope", 1, "02:00:00.000", { extra: { scope: "agent" } }),
		])

		expect(slugsOf(await run())).toEqual(["mine@1"])
	})

	it("describes each revision with its page, title, kind, editor and time", async () => {
		const { run } = feedOf([
			rev("accounts/acme", 4, "02:30:00.000", {
				snapshot: { title: "Acme" },
				extra: { editor: { id: "u1", name: "Ada", runId: "run-9" } },
			}),
		])

		const [change] = (await run()).changes

		expect(change).toMatchObject({
			pageSlug: "accounts/acme",
			title: "Acme",
			revision: 4,
			editKind: "update",
			createdAt: iso("02:30:00.000"),
			editor: { id: "u1", name: "Ada", runId: "run-9" },
		})
	})

	it("is empty, not an error, when since is not before until", async () => {
		const { run } = feedOf([rev("a", 1, "02:00:00.000")])

		const page = await run({
			since: at("05:00:00.000"),
			until: at("05:00:00.000"),
		})

		expect(page.changes).toEqual([])
		expect(page.hasMore).toBe(false)
		expect(page.nextCursor).toBeUndefined()
	})

	it("rejects an explicit until earlier than since", async () => {
		const { run } = feedOf([])

		await expect(
			run({ since: at("05:00:00.000"), until: at("04:00:00.000") }),
		).rejects.toBeInstanceOf(WikiChangesRequestError)
	})

	it("requires since when there is no cursor", async () => {
		const { run } = feedOf([])

		await expect(run({ since: undefined })).rejects.toBeInstanceOf(
			WikiChangesRequestError,
		)
	})
})

describe("the frozen upper bound", () => {
	it("is fixed at now minus the settle lag when until is omitted", async () => {
		const { run } = feedOf([
			rev("old", 1, "11:59:44.999"),
			rev("recent", 1, "11:59:45.000"),
		])

		const page = await run({ until: undefined, settleMs: 15_000 })

		expect(page.window.until).toBe(
			new Date(NOW.getTime() - 15_000).toISOString(),
		)
		expect(slugsOf(page)).toEqual(["old@1"])
		expect(page.window.settled).toBe(true)
	})

	it("defaults the settle lag to 15 seconds", async () => {
		const { run } = feedOf([rev("old", 1, "11:59:44.000")])

		const page = await run({ until: undefined, settleMs: undefined })

		expect(page.window.until).toBe(iso("11:59:45.000"))
	})

	it("honors an explicit until and reports it unsettled while it is within the lag of now", async () => {
		const { run } = feedOf([rev("fresh", 1, "11:59:50.000")])

		const unsettled = await run({ until: at("11:59:55.000"), settleMs: 15_000 })
		const settled = await run({ until: at("11:59:45.000"), settleMs: 15_000 })

		expect(unsettled.window).toMatchObject({
			until: iso("11:59:55.000"),
			settled: false,
		})
		expect(slugsOf(unsettled)).toEqual(["fresh@1"])
		expect(settled.window.settled).toBe(true)
	})
})

describe("the page size", () => {
	const many = () =>
		Array.from({ length: 7 }, (_, i) => rev(`p${i}`, 1, `02:00:0${i}.000`))

	it("returns at most limit changes and says more exist", async () => {
		const { run } = feedOf(many())

		const page = await run({ limit: 3 })

		expect(slugsOf(page)).toEqual(["p0@1", "p1@1", "p2@1"])
		expect(page.hasMore).toBe(true)
		expect(page.limits.limit).toBe(3)
	})

	it("does not say more exist when the last page is exactly full", async () => {
		const { run } = feedOf(many())

		const page = await run({ limit: 7 })

		expect(page.changes).toHaveLength(7)
		expect(page.hasMore).toBe(false)
		expect(page.nextCursor).toBeUndefined()
	})

	it("defaults to 25 and clamps to the maximum of 100, reporting the value used", async () => {
		const { run } = feedOf(many())

		expect((await run()).limits.limit).toBe(25)
		expect((await run({ limit: 5000 })).limits.limit).toBe(100)
		expect((await run({ limit: 0 })).limits.limit).toBe(1)
	})
})

describe("created and deleted pages", () => {
	it("lists a creation as an explicit entry with every claim added", async () => {
		const claims = [
			c("k1", "Acme is a customer."),
			c("k2", "Acme is in Haifa."),
		]
		const { run } = feedOf([
			rev("acme", 1, "02:00:00.000", { snapshot: { claims } }),
		])

		const [change] = (await run()).changes

		expect(change).toMatchObject({
			editKind: "create",
			baseline: "none",
			baselineRevision: null,
		})
		expect(change?.claims?.added).toEqual(claims)
		expect(change?.claims?.counts).toEqual({ added: 2, changed: 0, removed: 0 })
	})

	it("lists a soft deletion as an explicit entry with every claim held at deletion removed", async () => {
		const claims = [c("k1", "Acme is a customer.")]
		const { run } = feedOf([
			rev("acme", 1, "02:00:00.000", { snapshot: { claims } }),
			rev("acme", 2, "03:00:00.000", {
				editKind: "delete",
				snapshot: { claims, state: "superseded" },
			}),
		])

		const page = await run()
		const deleted = page.changes.find((x) => x.editKind === "delete")

		expect(deleted).toMatchObject({ revision: 2, baseline: "none" })
		expect(deleted?.claims?.removed).toEqual(claims)
		expect(deleted?.claims?.added).toEqual([])
		expect(deleted?.claims?.counts).toEqual({
			added: 0,
			changed: 0,
			removed: 1,
		})
	})

	it("lists a hard deletion, which leaves only its delete revision, the same way", async () => {
		const claims = [c("k1", "Acme is a customer.")]
		const { run } = feedOf([
			rev("gone", 4, "03:00:00.000", {
				editKind: "delete",
				snapshot: { claims, revision: 3 },
			}),
		])

		const [deleted] = (await run()).changes

		expect(deleted).toMatchObject({ editKind: "delete", revision: 4 })
		expect(deleted?.claims?.removed).toEqual(claims)
	})
})
