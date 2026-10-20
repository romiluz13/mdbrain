// The feed reads revisions by scope, then a createdAt range, ordered by
// (createdAt, pageSlug, revision). Its index must lead with scope, scopeRef and
// createdAt and continue with pageSlug and revision, or the read scans the
// collection or sorts in memory. These tests pin the index definition that
// ensureWikiStandardIndexes creates and the shape of the feed's query to it. They
// do not run the planner: explain() needs a real server.

import type { Db, Document } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import {
	WIKI_CHANGES_SETTLE_MS,
	WIKI_CHANGES_SCAN_CAP,
} from "./wiki-changes.js"
import { ensureWikiStandardIndexes } from "./wiki-schema.js"
import { feedOf, rev } from "./testing/changes-fixtures.js"
import type { RecordedQuery } from "./testing/fake-wiki-db.js"

type IndexSpec = {
	name: string
	key: Record<string, number>
	unique?: boolean
	expireAfterSeconds?: number
}

async function revisionIndexes(): Promise<IndexSpec[]> {
	const created = new Map<string, IndexSpec[]>()
	const db = {
		collection: (name: string) => ({
			collectionName: name,
			createIndexes: vi.fn(async (specs: IndexSpec[]) => {
				created.set(name, specs)
				return specs.map((s) => s.name)
			}),
			dropIndex: vi.fn(async () => ({ ok: 1 })),
		}),
	} as unknown as Db
	await ensureWikiStandardIndexes(db, "test_")
	return created.get("test_wiki_revisions") ?? []
}

// The first clause of the feed's $and is the scope and createdAt range.
const baseOf = (query: RecordedQuery | undefined) =>
	((query?.filter.$and ?? []) as Document[])[0] as Document

describe("the revision-time index", () => {
	it("is created on wiki_revisions alongside the per-page unique index", async () => {
		const indexes = await revisionIndexes()

		const feedIndex = indexes.find(
			(i) => i.name === "scope_createdAt_page_revision",
		)
		expect(feedIndex?.key).toEqual({
			scope: 1,
			scopeRef: 1,
			createdAt: 1,
			pageSlug: 1,
			revision: 1,
		})
		expect(Object.keys(feedIndex?.key ?? {})).toEqual([
			"scope",
			"scopeRef",
			"createdAt",
			"pageSlug",
			"revision",
		])
		expect(feedIndex?.unique).toBeUndefined()
		expect(feedIndex?.expireAfterSeconds).toBeUndefined()
		expect(
			indexes.find((i) => i.name === "page_revision_unique"),
		).toMatchObject({
			unique: true,
			key: { pageSlug: 1, scope: 1, scopeRef: 1, revision: -1 },
		})
	})

	it("has a stable name, so a restart does not build it twice", async () => {
		const first = await revisionIndexes()
		const second = await revisionIndexes()

		expect(first.map((i) => i.name)).toEqual(second.map((i) => i.name))
	})

	it("is the index the feed's first read is shaped for: equality on scope, a range on createdAt, then the rest of the key as the sort", async () => {
		const index = (await revisionIndexes()).find(
			(i) => i.name === "scope_createdAt_page_revision",
		)
		const keys = Object.keys(index?.key ?? {})
		const feed = feedOf([rev("a", 1, "02:00:00.000")])

		await feed.run()
		const read = feed.fake.queries[0]
		const base = baseOf(read)

		expect(Object.keys(base)).toEqual(keys.slice(0, 3))
		expect(base.createdAt).toHaveProperty("$gte")
		expect(base.createdAt).toHaveProperty("$lt")
		expect(Object.keys(read?.sort ?? {})).toEqual(keys.slice(2))
		expect(Object.values(read?.sort ?? {})).toEqual([1, 1, 1])
	})

	it("keeps the second page's read on the same prefix", async () => {
		const index = (await revisionIndexes()).find(
			(i) => i.name === "scope_createdAt_page_revision",
		)
		const keys = Object.keys(index?.key ?? {})
		const feed = feedOf([
			rev("a", 1, "02:00:00.000"),
			rev("b", 1, "02:00:00.001"),
		])
		const first = await feed.run({ limit: 1 })

		await feed.run({ limit: 1, cursor: first.nextCursor })
		const read = feed.fake.queries.at(-1)
		const base = baseOf(read)

		expect(Object.keys(base)).toEqual(keys.slice(0, 3))
		expect(Object.keys(read?.sort ?? {})).toEqual(keys.slice(2))
	})
})

describe("the feed's constants", () => {
	it("settle 15 seconds and examine at most 1000 revisions per call", () => {
		expect(WIKI_CHANGES_SETTLE_MS).toBe(15_000)
		expect(WIKI_CHANGES_SCAN_CAP).toBe(1000)
	})
})
