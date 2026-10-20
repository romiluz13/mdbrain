// Claim-level diffs: what the feed calls added, changed and removed. Claims are
// matched by id between a revision and the one before it. A claim is "changed"
// when text, status, confidence, evidence, derivedFrom, supersedesClaimId or
// validTo differ; updatedAt, validFrom, writerAgent and sourceMemId are not
// compared, because the write path restamps the first two on every patched claim
// (wiki-bridge.ts: validFrom ?? now, updatedAt: now), so an unchanged claim a
// writer re-sends must not read as a change.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import { claim as c, feedOf, rev, slugsOf } from "./testing/changes-fixtures.js"

const update = (before: Document[], after: Document[], extra: Document = {}) =>
	feedOf(
		[
			rev("acme", 1, "02:00:00.000", { snapshot: { claims: before } }),
			rev("acme", 2, "03:00:00.000", { snapshot: { claims: after, ...extra } }),
		],
		{ since: new Date("2026-10-01T02:30:00.000Z") },
	).run()

describe("an update against the revision before it", () => {
	it("reports a claim whose id is new as added", async () => {
		const page = await update(
			[c("k1", "One.")],
			[c("k1", "One."), c("k2", "Two.")],
		)

		const [change] = page.changes
		expect(change).toMatchObject({ baseline: "previous", baselineRevision: 1 })
		expect(change?.claims?.added).toEqual([c("k2", "Two.")])
		expect(change?.claims?.changed).toEqual([])
		expect(change?.claims?.removed).toEqual([])
		expect(change?.claims?.counts).toEqual({ added: 1, changed: 0, removed: 0 })
	})

	it("reports a claim whose id is gone as removed", async () => {
		const page = await update(
			[c("k1", "One."), c("k2", "Two.")],
			[c("k1", "One.")],
		)

		expect(page.changes[0]?.claims?.removed).toEqual([c("k2", "Two.")])
		expect(page.changes[0]?.claims?.counts).toEqual({
			added: 0,
			changed: 0,
			removed: 1,
		})
	})

	it("reports a claim whose text changed, with the fields that differ and both versions", async () => {
		const page = await update(
			[c("k1", "Renewal at risk.")],
			[c("k1", "Renewal secured.")],
		)

		const [moved] = page.changes[0]?.claims?.changed ?? []
		expect(moved).toEqual({
			id: "k1",
			fields: ["text"],
			before: c("k1", "Renewal at risk."),
			after: c("k1", "Renewal secured."),
		})
	})

	it.each([
		["text", { text: "B" }],
		["status", { status: "contested" }],
		["confidence", { confidence: 0.9 }],
		["evidence", { evidence: [{ kind: "event", sourceId: "e1" }] }],
		["derivedFrom", { derivedFrom: ["k0"] }],
		["supersedesClaimId", { supersedesClaimId: "k0" }],
		["validTo", { validTo: new Date("2026-12-01T00:00:00.000Z") }],
	])("counts a difference in %s as a change", async (field, patch) => {
		const page = await update([c("k1", "A")], [c("k1", "A", patch)])

		expect(page.changes[0]?.claims?.changed.map((x) => x.fields)).toEqual([
			[field],
		])
	})

	it("lists every field that differs, in a fixed order", async () => {
		const page = await update(
			[c("k1", "A", { confidence: 0.2 })],
			[c("k1", "B", { confidence: 0.8, status: "superseded" })],
		)

		expect(page.changes[0]?.claims?.changed[0]?.fields).toEqual([
			"text",
			"status",
			"confidence",
		])
	})

	it("does not count the timestamps the write path restamps, the writer, or the migration id", async () => {
		const page = await update(
			[
				c("k1", "A", {
					updatedAt: new Date("2026-10-01T02:00:00.000Z"),
					validFrom: new Date("2026-10-01T02:00:00.000Z"),
					writerAgent: { id: "a1", name: "One" },
					sourceMemId: "m1",
				}),
			],
			[
				c("k1", "A", {
					updatedAt: new Date("2026-10-01T03:00:00.000Z"),
					validFrom: new Date("2026-10-01T03:00:00.000Z"),
					writerAgent: { id: "a2", name: "Two" },
					sourceMemId: "m2",
				}),
			],
		)

		expect(page.changes[0]?.claims?.changed).toEqual([])
		expect(page.changes[0]?.claims?.counts).toEqual({
			added: 0,
			changed: 0,
			removed: 0,
		})
	})

	it("compares evidence by content, not key order, and ignores a stored marker", async () => {
		const page = await update(
			[
				c("k1", "A", {
					evidence: [{ kind: "event", sourceId: "e1", note: "n" }],
				}),
			],
			[
				c("k1", "A", {
					evidence: [
						{
							note: "n",
							sourceId: "e1",
							kind: "event",
							marker: "[[event:e1]]",
						},
					],
				}),
			],
		)

		expect(page.changes[0]?.claims?.changed).toEqual([])
	})

	it("reads a claim that is now superseded as a change of status, not a removal", async () => {
		const page = await update(
			[c("k1", "A")],
			[c("k1", "A", { status: "superseded" })],
		)

		expect(page.changes[0]?.claims?.removed).toEqual([])
		expect(page.changes[0]?.claims?.changed[0]?.fields).toEqual(["status"])
	})

	it("lists a revision that moved no claim with empty buckets", async () => {
		const page = await update([c("k1", "A")], [c("k1", "A")], {
			body: "edited",
		})

		expect(page.changes[0]?.claims).toEqual({
			added: [],
			changed: [],
			removed: [],
			counts: { added: 0, changed: 0, removed: 0 },
			truncated: false,
		})
	})

	it("treats a snapshot without claims as having none, and matches the first of a repeated id", async () => {
		const noClaims = feedOf(
			[
				rev("a", 1, "02:00:00.000"),
				rev("a", 2, "03:00:00.000", { snapshot: { claims: [c("k1", "A")] } }),
			],
			{ since: new Date("2026-10-01T02:30:00.000Z") },
		)
		const missing = rev("m", 1, "02:00:00.000")
		delete (missing.snapshot as Document).claims
		const twice = feedOf(
			[
				missing,
				rev("m", 2, "03:00:00.000", {
					snapshot: { claims: [c("k1", "first"), c("k1", "second")] },
				}),
			],
			{ since: new Date("2026-10-01T02:30:00.000Z") },
		)

		expect((await noClaims.run()).changes[0]?.claims?.added).toEqual([
			c("k1", "A"),
		])
		expect((await twice.run()).changes[0]?.claims?.added).toEqual([
			c("k1", "first"),
		])
	})

	it("keeps claims in the order of the snapshot they were read from", async () => {
		const page = await update(
			[c("r1", "x"), c("keep", "k"), c("r2", "y")],
			[c("n2", "p"), c("keep", "k"), c("n1", "q")],
		)

		expect(page.changes[0]?.claims?.added.map((x) => x.id)).toEqual([
			"n2",
			"n1",
		])
		expect(page.changes[0]?.claims?.removed.map((x) => x.id)).toEqual([
			"r1",
			"r2",
		])
	})
})

describe("bounds", () => {
	const many = (n: number, prefix: string, text = "t") =>
		Array.from({ length: n }, (_, i) => c(`${prefix}${i}`, text))

	it("lists at most maxClaims in each bucket, with the full counts and a truncated flag", async () => {
		const before = [...many(4, "r"), ...many(4, "m", "old")]
		const after = [...many(5, "a"), ...many(4, "m", "new")]
		const feed = feedOf(
			[
				rev("p", 1, "02:00:00.000", { snapshot: { claims: before } }),
				rev("p", 2, "03:00:00.000", { snapshot: { claims: after } }),
			],
			{ since: new Date("2026-10-01T02:30:00.000Z") },
		)

		const page = await feed.run({ maxClaims: 2 })

		const claims = page.changes[0]?.claims
		expect(claims?.added).toHaveLength(2)
		expect(claims?.changed).toHaveLength(2)
		expect(claims?.removed).toHaveLength(2)
		expect(claims?.counts).toEqual({ added: 5, changed: 4, removed: 4 })
		expect(claims?.truncated).toBe(true)
		expect(page.limits.maxClaims).toBe(2)
	})

	it("defaults to 10 per bucket and clamps to 50", async () => {
		const feed = feedOf([
			rev("p", 1, "02:00:00.000", { snapshot: { claims: many(60, "a") } }),
		])

		expect((await feed.run()).changes[0]?.claims?.added).toHaveLength(10)
		expect(
			(await feed.run({ maxClaims: 500 })).changes[0]?.claims?.added,
		).toHaveLength(50)
		expect((await feed.run({ maxClaims: 500 })).limits.maxClaims).toBe(50)
	})

	it("does not flag a bucket that fits", async () => {
		const feed = feedOf([
			rev("p", 1, "02:00:00.000", { snapshot: { claims: many(3, "a") } }),
		])

		expect(
			(await feed.run({ maxClaims: 3 })).changes[0]?.claims?.truncated,
		).toBe(false)
	})
})

describe("the previous revision", () => {
	it("reads every previous snapshot a page needs in one query", async () => {
		const feed = feedOf(
			[
				rev("a", 1, "01:00:00.000"),
				rev("b", 1, "01:00:00.000"),
				rev("a", 2, "03:00:00.000"),
				rev("b", 2, "03:00:00.001"),
				rev("a", 3, "03:00:00.002"),
			],
			{ since: new Date("2026-10-01T02:30:00.000Z") },
		)

		const page = await feed.run()
		const lookups = feed.fake.queries.filter((q) => Array.isArray(q.filter.$or))

		expect(slugsOf(page)).toEqual(["a@2", "b@2", "a@3"])
		expect(page.changes.map((x) => x.baselineRevision)).toEqual([1, 1, 2])
		expect(lookups).toHaveLength(1)
	})

	it("is unavailable, with no diff, when it was never recorded", async () => {
		const feed = feedOf([
			rev("orphan", 5, "03:00:00.000", {
				snapshot: { claims: [c("k1", "A")] },
			}),
		])

		const [change] = (await feed.run()).changes

		expect(change).toMatchObject({
			baseline: "unavailable",
			baselineRevision: null,
			claims: null,
		})
	})
})
