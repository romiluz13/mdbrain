// The delivery-ledger tests drive the real conditional updates against the
// fake, so the fake has to apply a filter before it writes, the way a server
// does: a predicate that no longer holds matches nothing and changes nothing.

import type { Document } from "mongodb"
import { describe, expect, it } from "vitest"
import { createFakeWikiDb } from "./fake-wiki-db.js"

function open(docs: Document[]) {
	const fake = createFakeWikiDb({ things: docs })
	return fake.db.collection("t_things") as unknown as {
		findOne(filter: Document): Promise<Document | null>
		insertOne(doc: Document): Promise<unknown>
		updateOne(
			filter: Document,
			update: Document,
		): Promise<{ matchedCount: number }>
		findOneAndUpdate(
			filter: Document,
			update: Document,
			options?: Document,
		): Promise<Document | null>
	}
}

describe("fake collection writes", () => {
	it("updates only when the filter still holds, and returns the new document", async () => {
		const things = open([{ id: "a", state: "pending", n: 1 }])

		const won = await things.findOneAndUpdate(
			{ id: "a", state: "pending" },
			{ $set: { state: "done" }, $inc: { n: 2 } },
			{ returnDocument: "after" },
		)
		const lost = await things.findOneAndUpdate(
			{ id: "a", state: "pending" },
			{ $set: { state: "other" } },
			{ returnDocument: "after" },
		)

		expect(won).toMatchObject({ id: "a", state: "done", n: 3 })
		expect(lost).toBeNull()
		expect(await things.findOne({ id: "a" })).toMatchObject({
			state: "done",
			n: 3,
		})
	})

	it("applies $unset and $addToSet", async () => {
		const things = open([{ id: "a", gone: 1, tags: ["x"] }])

		await things.findOneAndUpdate(
			{ id: "a" },
			{ $unset: { gone: "" }, $addToSet: { tags: { $each: ["x", "y"] } } },
		)

		const doc = await things.findOne({ id: "a" })
		expect(doc).not.toHaveProperty("gone")
		expect(doc?.tags).toEqual(["x", "y"])
	})

	it("hands out copies, so a later write cannot change a document already read", async () => {
		const things = open([{ id: "a", state: "pending" }])
		const before = await things.findOne({ id: "a" })

		await things.findOneAndUpdate({ id: "a" }, { $set: { state: "done" } })

		expect(before?.state).toBe("pending")
	})

	it("inserts and counts matches on updateOne", async () => {
		const things = open([])
		await things.insertOne({ id: "a", state: "pending" })

		expect(
			await things.updateOne({ id: "a" }, { $set: { state: "done" } }),
		).toEqual({
			matchedCount: 1,
		})
		expect(
			await things.updateOne({ id: "zzz" }, { $set: { state: "done" } }),
		).toEqual({
			matchedCount: 0,
		})
	})

	it("refuses an update operator it does not implement", async () => {
		const things = open([{ id: "a" }])

		await expect(
			things.findOneAndUpdate({ id: "a" }, { $rename: { id: "x" } }),
		).rejects.toThrow(/unsupported update operator/)
	})
})

describe("fake collection paging reads", () => {
	it("skips, limits and counts over the same filter", async () => {
		const fake = createFakeWikiDb({
			things: [
				{ id: "a", n: 1 },
				{ id: "b", n: 2 },
				{ id: "c", n: 3 },
				{ id: "d", n: 4 },
			],
		})
		const things = fake.db.collection("t_things") as unknown as {
			find(filter: Document): {
				sort(spec: Document): {
					skip(n: number): {
						limit(n: number): { toArray(): Promise<Document[]> }
					}
				}
			}
			countDocuments(filter: Document): Promise<number>
		}

		const page = await things.find({}).sort({ n: 1 }).skip(1).limit(2).toArray()

		expect(page.map((d) => d.id)).toEqual(["b", "c"])
		expect(await things.countDocuments({ n: { $gt: 1 } })).toBe(3)
	})
})
