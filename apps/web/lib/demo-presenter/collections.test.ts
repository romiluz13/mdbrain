import { describe, expect, it } from "vitest"
import {
	DuplicateKeyError,
	driverCollection,
	type DriverCollectionShape,
} from "./collections.js"

/** The error the mongodb 7 driver throws for a unique-index violation, in the
 * shape it carries: a MongoServerError with code 11000 and the key it hit. */
class MongoServerError extends Error {
	code = 11000
	codeName = "DuplicateKey"
	keyPattern = { presenterId: 1 }
	keyValue = { presenterId: "p1" }
	constructor() {
		super("E11000 duplicate key error collection: x index: presenterId_1")
		this.name = "MongoServerError"
	}
}

function failing(error: unknown): DriverCollectionShape {
	const reject = async () => {
		throw error
	}
	return {
		findOne: reject,
		find: () => ({ toArray: reject }),
		insertOne: reject,
		findOneAndUpdate: reject,
		deleteOne: reject,
		deleteMany: reject,
	}
}

describe("driverCollection", () => {
	it("maps the driver's duplicate key error to the port's on insertOne", async () => {
		const collection = driverCollection<{ _id: string }>(
			failing(new MongoServerError()),
		)
		await expect(collection.insertOne({ _id: "a" })).rejects.toBeInstanceOf(
			DuplicateKeyError,
		)
	})

	it("maps it on findOneAndUpdate too, where a takeover can hit the unique presenter index", async () => {
		const collection = driverCollection<{ _id: string }>(
			failing(new MongoServerError()),
		)
		await expect(
			collection.findOneAndUpdate({ _id: "a" }, { $set: { x: 1 } }),
		).rejects.toBeInstanceOf(DuplicateKeyError)
	})

	it("lets every other driver error through unchanged", async () => {
		const other = Object.assign(new Error("network"), { code: 91 })
		const collection = driverCollection<{ _id: string }>(failing(other))
		await expect(collection.insertOne({ _id: "a" })).rejects.toBe(other)
		await expect(
			collection.findOneAndUpdate({ _id: "a" }, { $set: { x: 1 } }),
		).rejects.toBe(other)
		await expect(collection.findOne({})).rejects.toBe(other)
	})

	it("passes filters, updates and the update options to the driver and returns what it returns", async () => {
		const seen: unknown[] = []
		const collection = driverCollection<{ _id: string }>({
			findOne: async (filter) => {
				seen.push(["findOne", filter])
				return { _id: "a" }
			},
			find: (filter) => {
				seen.push(["find", filter])
				return { toArray: async () => [{ _id: "a" }, { _id: "b" }] }
			},
			insertOne: async (doc) => {
				seen.push(["insertOne", doc])
				return {}
			},
			findOneAndUpdate: async (filter, update, options) => {
				seen.push(["findOneAndUpdate", filter, update, options])
				return { _id: "a" }
			},
			deleteOne: async () => ({ deletedCount: 1 }),
			deleteMany: async () => ({ deletedCount: 3 }),
		})
		expect(await collection.findOne({ _id: "a" })).toEqual({ _id: "a" })
		expect(await collection.find({ s: 1 })).toHaveLength(2)
		await collection.insertOne({ _id: "c" })
		await collection.findOneAndUpdate(
			{ _id: "a" },
			{ $set: { x: 1 } },
			{ sort: { n: 1 } },
		)
		expect(await collection.deleteOne({})).toBe(1)
		expect(await collection.deleteMany({})).toBe(3)
		expect(seen).toContainEqual([
			"findOneAndUpdate",
			{ _id: "a" },
			{ $set: { x: 1 } },
			{ returnDocument: "after", sort: { n: 1 } },
		])
	})
})
