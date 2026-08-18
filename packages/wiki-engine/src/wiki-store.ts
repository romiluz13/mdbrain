import {
	MongoClient,
	type ClientSession,
	type Db,
	type MongoClientOptions,
} from "mongodb"
import type { WikiDbHandle } from "./wiki-bridge.js"
import { ensureWikiSchema } from "./wiki-schema.js"

export type WikiStoreConfig = {
	uri: string
	databaseName: string
	collectionPrefix: string
	clientOptions?: MongoClientOptions
}

export type WikiTransactionSession = ClientSession

type WikiStoreDependencies = {
	client?: MongoClient
	ensureSchema?: (db: Db, prefix: string) => Promise<void>
}

export function resolveWikiStoreConfig(
	env: NodeJS.ProcessEnv = process.env,
): WikiStoreConfig {
	const uri = env.MDBRAIN_WIKI_MONGODB_URI?.trim()
	if (!uri) {
		throw new Error("MDBRAIN_WIKI_MONGODB_URI is required")
	}
	return {
		uri,
		databaseName: env.MDBRAIN_WIKI_DATABASE?.trim() || "mdbrain_wiki",
		collectionPrefix: env.MDBRAIN_WIKI_COLLECTION_PREFIX?.trim() || "mdbrain_",
	}
}

export class WikiStore {
	readonly #client: MongoClient
	readonly #ensureSchema: (db: Db, prefix: string) => Promise<void>
	readonly #databaseName: string
	readonly #collectionPrefix: string
	#db?: Db
	#initializing?: Promise<void>

	constructor(
		config: WikiStoreConfig,
		dependencies: WikiStoreDependencies = {},
	) {
		this.#client =
			dependencies.client ??
			new MongoClient(config.uri, config.clientOptions ?? {})
		this.#ensureSchema = dependencies.ensureSchema ?? ensureWikiSchema
		this.#databaseName = config.databaseName
		this.#collectionPrefix = config.collectionPrefix
	}

	initialize(): Promise<void> {
		if (this.#db) return Promise.resolve()
		if (!this.#initializing) {
			this.#initializing = this.#initialize().finally(() => {
				this.#initializing = undefined
			})
		}
		return this.#initializing
	}

	async #initialize(): Promise<void> {
		await this.#client.connect()
		const db = this.#client.db(this.#databaseName)
		await this.#ensureSchema(db, this.#collectionPrefix)
		this.#db = db
	}

	handle(): WikiDbHandle {
		if (!this.#db) {
			throw new Error("WikiStore is not initialized")
		}
		return {
			db: this.#db,
			prefix: this.#collectionPrefix,
			client: this.#client,
		}
	}

	async transaction<T>(
		operation: (session: ClientSession) => Promise<T>,
	): Promise<T> {
		this.handle()
		const session = this.#client.startSession()
		try {
			let completed = false
			let result!: T
			await session.withTransaction(async () => {
				result = await operation(session)
				completed = true
			})
			if (!completed) {
				throw new Error("WikiStore transaction completed without a result")
			}
			return result
		} finally {
			await session.endSession()
		}
	}

	async ping(): Promise<{ ok: true }> {
		const { db } = this.handle()
		await db.command({ ping: 1 })
		return { ok: true }
	}

	async close(): Promise<void> {
		await this.#client.close()
		this.#db = undefined
	}
}
