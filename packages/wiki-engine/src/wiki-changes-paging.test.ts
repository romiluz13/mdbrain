// Paging stability: a page boundary never skips or repeats a revision, including
// revisions that share a timestamp and revisions written while the reader pages.
// The cursor names the last revision RETURNED, so the next page is everything
// strictly after it in (createdAt, pageSlug, revision) order.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import {
	type WikiChangesPage,
	WikiChangesRequestError,
	getWikiChanges,
} from "./wiki-changes.js"
import { at, feedOf, iso, rev, slugsOf } from "./testing/changes-fixtures.js"

async function readAll(
	run: (more: { cursor?: string; limit?: number }) => Promise<WikiChangesPage>,
	limit: number,
	between?: (pageNumber: number) => void,
): Promise<{ seen: string[]; pages: number }> {
	const seen: string[] = []
	let cursor: string | undefined
	let pages = 0
	do {
		const page = await run({ cursor, limit })
		seen.push(...slugsOf(page))
		cursor = page.nextCursor
		pages++
		between?.(pages)
	} while (cursor && pages < 50)
	return { seen, pages }
}

describe("walking the whole window", () => {
	it("returns every revision exactly once, in order, whatever the page size", async () => {
		const revisions = [
			rev("a", 1, "02:00:00.000"),
			rev("a", 2, "03:00:00.000"),
			rev("b", 1, "03:00:00.001"),
			rev("c", 1, "04:00:00.000"),
			rev("c", 2, "05:00:00.000"),
			rev("d", 1, "05:00:00.000"),
			rev("e", 1, "06:00:00.000"),
		]
		const { run } = feedOf(revisions)
		const whole = slugsOf(await run({ limit: 100 }))

		for (const size of [1, 2, 3, 4, 6, 7]) {
			const { seen } = await readAll(run, size)
			expect(seen, `page size ${size}`).toEqual(whole)
		}
		expect(new Set(whole).size).toBe(7)
	})

	it("does not skip or repeat when a page boundary falls inside revisions sharing one timestamp", async () => {
		const sameInstant = "02:00:00.000"
		const revisions = [
			rev("m", 1, sameInstant),
			rev("a", 2, sameInstant),
			rev("a", 3, sameInstant),
			rev("z", 1, sameInstant),
			rev("b", 1, sameInstant),
			rev("a", 1, "01:59:59.999"),
			rev("q", 1, "02:00:00.001"),
		]
		const { run } = feedOf(revisions)

		const expected = ["a@1", "a@2", "a@3", "b@1", "m@1", "z@1", "q@1"]
		for (const size of [1, 2, 3, 4, 5]) {
			const { seen } = await readAll(run, size)
			expect(seen, `page size ${size}`).toEqual(expected)
		}
	})

	it("ends with no cursor and hasMore false", async () => {
		const { run } = feedOf([
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "02:00:00.001"),
		])

		const first = await run({ limit: 1 })
		const last = await run({ limit: 1, cursor: first.nextCursor })

		expect(first.hasMore).toBe(true)
		expect(last.hasMore).toBe(false)
		expect(last.nextCursor).toBeUndefined()
	})
})

describe("the frozen window", () => {
	it("carries since and until in the cursor, so later pages need neither", async () => {
		const { run } = feedOf([
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "03:00:00.000"),
		])
		const first = await run({ limit: 1, since: at("01:00:00.000") })

		const second = await run({
			cursor: first.nextCursor,
			since: undefined,
			until: undefined,
		})

		expect(second.window).toEqual(first.window)
		expect(slugsOf(second)).toEqual(["b@1"])
	})

	it("keeps the first page's until even though the clock has moved on", async () => {
		const revisions = [rev("a", 1, "02:00:00.000"), rev("b", 1, "03:00:00.000")]
		const { fake } = feedOf(revisions)
		const params = {
			scope: "workspace",
			scopeRef: "ws-1",
			governance: {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard" as const,
			},
			settleMs: 0,
		}
		const first = await getWikiChanges(fake, {
			...params,
			since: at("01:00:00.000"),
			limit: 1,
			now: () => at("04:00:00.000"),
		})
		revisions.push(rev("late", 1, "05:00:00.000"))

		const second = await getWikiChanges(fake, {
			...params,
			cursor: first.nextCursor,
			now: () => at("09:00:00.000"),
		})

		expect(first.window.until).toBe(iso("04:00:00.000"))
		expect(second.window.until).toBe(iso("04:00:00.000"))
		expect(slugsOf(second)).toEqual(["b@1"])
		expect(second.hasMore).toBe(false)
	})

	it("accepts since and until alongside a cursor only when they match the frozen window", async () => {
		const { run } = feedOf([
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "03:00:00.000"),
		])
		const first = await run({ limit: 1 })

		await expect(
			run({
				cursor: first.nextCursor,
				since: at("00:00:00.000"),
				until: at("11:00:00.000"),
			}),
		).resolves.toBeDefined()
		await expect(
			run({ cursor: first.nextCursor, since: at("00:00:01.000") }),
		).rejects.toBeInstanceOf(WikiChangesRequestError)
		await expect(
			run({ cursor: first.nextCursor, until: at("10:00:00.000") }),
		).rejects.toBeInstanceOf(WikiChangesRequestError)
	})

	it("tiles: a revision at until is left out of this window and is the first of the next", async () => {
		const revisions = [
			rev("a", 1, "02:00:00.000"),
			rev("edge", 1, "04:00:00.000"),
		]
		const { run } = feedOf(revisions)

		const first = await run({
			since: at("00:00:00.000"),
			until: at("04:00:00.000"),
		})
		const next = await run({
			since: at("04:00:00.000"),
			until: at("08:00:00.000"),
		})

		expect(slugsOf(first)).toEqual(["a@1"])
		expect(slugsOf(next)).toEqual(["edge@1"])
	})
})

describe("writes while the reader pages", () => {
	it("serves a revision written after the cursor's position but before until exactly once", async () => {
		const revisions: Document[] = [
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "03:00:00.000"),
			rev("c", 1, "09:00:00.000"),
		]
		const { run } = feedOf(revisions)

		const { seen } = await readAll(run, 1, (page) => {
			if (page === 1) {
				revisions.push(rev("mid", 1, "05:00:00.000"))
				revisions.push(rev("b", 2, "03:00:00.000"))
			}
		})

		expect(seen).toEqual(["a@1", "b@1", "b@2", "mid@1", "c@1"])
		expect(new Set(seen).size).toBe(seen.length)
	})

	it("never serves a revision stamped at or after the frozen until, and serves it in the next window", async () => {
		const revisions: Document[] = [
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "03:00:00.000"),
		]
		const { run } = feedOf(revisions)
		const bounded = { since: at("00:00:00.000"), until: at("06:00:00.000") }

		const first = await run({ ...bounded, limit: 1 })
		revisions.push(
			rev("after", 1, "06:00:00.000"),
			rev("later", 1, "07:00:00.000"),
		)
		const second = await run({ ...bounded, cursor: first.nextCursor, limit: 1 })
		const next = await run({
			since: at("06:00:00.000"),
			until: at("11:00:00.000"),
		})

		expect(slugsOf(first)).toEqual(["a@1"])
		expect(first.hasMore).toBe(true)
		expect(slugsOf(second)).toEqual(["b@1"])
		expect(second.hasMore).toBe(false)
		expect(slugsOf(next)).toEqual(["after@1", "later@1"])
	})

	it("leaves the revisions stamped inside the settle lag out of an omitted-until window, so a transaction still in flight cannot be skipped", async () => {
		const revisions: Document[] = [
			rev("old", 1, "11:59:00.000"),
			rev("in-flight", 1, "11:59:50.000"),
		]
		const { run } = feedOf(revisions, { settleMs: 15_000, until: undefined })

		const first = await run({ since: at("11:00:00.000"), limit: 1 })

		expect(slugsOf(first)).toEqual(["old@1"])
		expect(first.hasMore).toBe(false)
		expect(first.window.settled).toBe(true)
		expect(first.window.until).toBe(iso("11:59:45.000"))
	})

	it("can still skip a revision stamped before until that commits after the reader passed it: the residual a settle lag only narrows", async () => {
		const revisions: Document[] = [
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "02:00:00.002"),
			rev("c", 1, "03:00:00.000"),
		]
		const { run } = feedOf(revisions)

		const first = await run({ limit: 1 })
		const second = await run({ limit: 1, cursor: first.nextCursor })
		// stamped 02:00:00.001, but its transaction commits only now
		revisions.push(rev("slow", 1, "02:00:00.001"))
		const third = await run({ limit: 1, cursor: second.nextCursor })

		const seen = [...slugsOf(first), ...slugsOf(second), ...slugsOf(third)]
		expect(seen).toEqual(["a@1", "b@1", "c@1"])
		expect(seen).not.toContain("slow@1")
	})
})

describe("the cursor", () => {
	it("names a revision that was returned, never one beyond the page", async () => {
		const { run } = feedOf([
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "03:00:00.000"),
			rev("c", 1, "04:00:00.000"),
		])

		const first = await run({ limit: 2 })
		const decoded = JSON.parse(
			Buffer.from(first.nextCursor ?? "", "base64url").toString("utf8"),
		)

		expect(decoded).toMatchObject({ p: "b", r: 1, t: iso("03:00:00.000") })
	})

	it.each([
		["not base64 json", "%%%"],
		["not json", Buffer.from("hello").toString("base64url")],
		[
			"another version",
			Buffer.from(
				JSON.stringify({
					v: 2,
					s: iso("00:00:00.000"),
					u: iso("11:00:00.000"),
					t: iso("02:00:00.000"),
					p: "a",
					r: 1,
				}),
			).toString("base64url"),
		],
		[
			"a missing field",
			Buffer.from(
				JSON.stringify({
					v: 1,
					s: iso("00:00:00.000"),
					u: iso("11:00:00.000"),
					p: "a",
					r: 1,
				}),
			).toString("base64url"),
		],
		[
			"a bad date",
			Buffer.from(
				JSON.stringify({
					v: 1,
					s: "yesterday",
					u: iso("11:00:00.000"),
					t: iso("02:00:00.000"),
					p: "a",
					r: 1,
				}),
			).toString("base64url"),
		],
		[
			"a bad revision",
			Buffer.from(
				JSON.stringify({
					v: 1,
					s: iso("00:00:00.000"),
					u: iso("11:00:00.000"),
					t: iso("02:00:00.000"),
					p: "a",
					r: 0,
				}),
			).toString("base64url"),
		],
	])("is refused when it is %s", async (_name, cursor) => {
		const { run } = feedOf([])

		await expect(run({ cursor })).rejects.toBeInstanceOf(
			WikiChangesRequestError,
		)
	})
})
