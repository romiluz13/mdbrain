import type {
	ClientSession,
	Collection,
	Db,
	Document,
	MongoClient,
} from "mongodb"
import { describe, expect, it, vi } from "vitest"
import {
	WikiStore,
	resolveWikiStoreConfig,
	type WikiStoreConfig,
} from "./wiki-store.js"

const CONFIG: WikiStoreConfig = {
	uri: "mongodb://127.0.0.1:27017",
	databaseName: "mdbrain_wiki",
	collectionPrefix: "wiki_",
}

function fakeClient() {
	const db = {
		command: vi.fn(async () => ({ ok: 1 })),
		collection: vi.fn(
			() =>
				({
					findOne: vi.fn(async () => null),
				}) as unknown as Collection<Document>,
		),
	} as unknown as Db
	const session = {
		withTransaction: vi.fn(async (callback: () => Promise<unknown>) =>
			callback(),
		),
		endSession: vi.fn(async () => undefined),
	} as unknown as ClientSession
	const client = {
		connect: vi.fn(async () => undefined),
		db: vi.fn(() => db),
		startSession: vi.fn(() => session),
		close: vi.fn(async () => undefined),
	} as unknown as MongoClient
	return { client, db, session }
}

describe("resolveWikiStoreConfig", () => {
	it("uses only MDBrain-owned wiki database settings", () => {
		expect(
			resolveWikiStoreConfig({
				MDBRAIN_WIKI_MONGODB_URI: "mongodb://wiki.example.test:27017",
				MDBRAIN_WIKI_DATABASE: "company_brain",
				MDBRAIN_WIKI_COLLECTION_PREFIX: "company_",
				MEMONGO_API_URL: "https://memongo.example.test",
			}),
		).toEqual({
			uri: "mongodb://wiki.example.test:27017",
			databaseName: "company_brain",
			collectionPrefix: "company_",
		})
	})

	it("fails closed without an MDBrain wiki URI", () => {
		expect(() => resolveWikiStoreConfig({})).toThrow(
			"MDBRAIN_WIKI_MONGODB_URI is required",
		)
	})
})

describe("WikiStore", () => {
	it("owns initialization and exposes a wiki handle", async () => {
		const { client, db } = fakeClient()
		const ensureSchema = vi.fn(async () => undefined)
		const store = new WikiStore(CONFIG, { client, ensureSchema })

		await store.initialize()

		expect(client.connect).toHaveBeenCalledTimes(1)
		expect(client.db).toHaveBeenCalledWith("mdbrain_wiki")
		expect(ensureSchema).toHaveBeenCalledWith(db, "wiki_")
		expect(store.handle()).toEqual({
			db,
			prefix: "wiki_",
			client,
		})
	})

	it("executes work with one session and always ends it", async () => {
		const { client, session } = fakeClient()
		const store = new WikiStore(CONFIG, {
			client,
			ensureSchema: vi.fn(async () => undefined),
		})
		await store.initialize()
		const operation = vi.fn(async (_session: ClientSession) => "created")

		await expect(store.transaction(operation)).resolves.toBe("created")
		expect(operation).toHaveBeenCalledWith(session)
		expect(session.withTransaction).toHaveBeenCalledTimes(1)
		expect(session.endSession).toHaveBeenCalledTimes(1)
	})

	it("surfaces transaction failures and still ends the session", async () => {
		const { client, session } = fakeClient()
		const store = new WikiStore(CONFIG, {
			client,
			ensureSchema: vi.fn(async () => undefined),
		})
		await store.initialize()

		await expect(
			store.transaction(async () => {
				throw new Error("audit insert failed")
			}),
		).rejects.toThrow("audit insert failed")
		expect(session.endSession).toHaveBeenCalledTimes(1)
	})

	it("pings its own database and closes its own client", async () => {
		const { client, db } = fakeClient()
		const store = new WikiStore(CONFIG, {
			client,
			ensureSchema: vi.fn(async () => undefined),
		})
		await store.initialize()

		await expect(store.ping()).resolves.toEqual({ ok: true })
		expect(db.command).toHaveBeenCalledWith({ ping: 1 })
		await store.close()
		expect(client.close).toHaveBeenCalledTimes(1)
	})
})
