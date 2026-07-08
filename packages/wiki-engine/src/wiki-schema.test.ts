/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock method assertions */
import type { Db, Collection } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	wikiPagesCollection,
	ensureWikiCollections,
	ensureWikiSchemaValidation,
	ensureWikiStandardIndexes,
	ensureWikiSearchIndexes,
	ensureWikiSchema,
	WIKI_PAGES_SEARCH_INDEX_TARGETS,
	WIKI_PAGE_KIND_VALUES,
	WIKI_SCOPE_VALUES,
	WIKI_TRUST_TIER_VALUES,
} from "./wiki-schema.js"

// ---------------------------------------------------------------------------
// Mock helpers (mirror memory-engine mongodb-schema.test.ts pattern)
// ---------------------------------------------------------------------------

function mockCollection(name: string): Collection {
	return {
		collectionName: name,
		createIndex: vi.fn(async () => name),
		createIndexes: vi.fn(async () => [name]),
		createSearchIndex: vi.fn(async () => name),
		updateSearchIndex: vi.fn(async () => undefined),
		dropIndex: vi.fn(async () => ({ ok: 1 })),
		listSearchIndexes: vi.fn(() => ({ toArray: async () => [] })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
}

function mockDb(existingCollections: string[] = []): Db {
	const collections = new Map<string, Collection>()

	const db = {
		collection: vi.fn((name: string) => {
			if (!collections.has(name)) {
				collections.set(name, mockCollection(name))
			}
			return collections.get(name)!
		}),
		command: vi.fn(async () => ({ ok: 1 })),
		createCollection: vi.fn(async (name: string) => {
			collections.set(name, mockCollection(name))
			return collections.get(name)!
		}),
		listCollections: vi.fn(() => ({
			map: vi.fn(() => ({
				toArray: async () => existingCollections,
			})),
		})),
	} as unknown as Db

	return db
}

// ---------------------------------------------------------------------------
// Collection helper tests
// ---------------------------------------------------------------------------

describe("wikiPagesCollection", () => {
	it("returns prefixed collection", () => {
		const db = mockDb()
		wikiPagesCollection(db, "test_")
		expect(db.collection).toHaveBeenCalledWith("test_wiki_pages")
	})

	it("supports empty prefix", () => {
		const db = mockDb()
		wikiPagesCollection(db, "")
		expect(db.collection).toHaveBeenCalledWith("wiki_pages")
	})
})

// ---------------------------------------------------------------------------
// ensureWikiCollections
// ---------------------------------------------------------------------------

describe("ensureWikiCollections", () => {
	it("creates wiki_pages when missing", async () => {
		const db = mockDb([])
		await ensureWikiCollections(db, "test_")
		expect(db.createCollection).toHaveBeenCalledWith(
			"test_wiki_pages",
			expect.objectContaining({
				validator: expect.any(Object),
				validationLevel: "moderate",
				validationAction: "error",
			}),
		)
	})

	it("passes a $jsonSchema validator", async () => {
		const db = mockDb([])
		await ensureWikiCollections(db, "test_")
		const call = (db.createCollection as unknown as ReturnType<typeof vi.fn>)
			.mock.calls[0]
		const validator = call[1].validator
		expect(validator.$jsonSchema).toBeDefined()
		expect(validator.$jsonSchema.bsonType).toBe("object")
		// Spot-check required fields from the spec
		const required = validator.$jsonSchema.required as string[]
		for (const field of [
			"kind",
			"title",
			"slug",
			"summary",
			"body",
			"frontmatter",
			"scope",
			"scopeRef",
			"trustTier",
			"state",
			"revision",
			"validFrom",
			"freshness",
		]) {
			expect(required).toContain(field)
		}
	})

	it("is idempotent — does not recreate if already present", async () => {
		const db = mockDb(["test_wiki_pages"])
		await ensureWikiCollections(db, "test_")
		expect(db.createCollection).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// ensureWikiSchemaValidation
// ---------------------------------------------------------------------------

describe("ensureWikiSchemaValidation", () => {
	it("applies collMod with the wiki_pages validator", async () => {
		const db = mockDb()
		await ensureWikiSchemaValidation(db, "test_")
		expect(db.command).toHaveBeenCalledWith(
			expect.objectContaining({
				collMod: "test_wiki_pages",
				validator: expect.objectContaining({ $jsonSchema: expect.any(Object) }),
				validationLevel: "moderate",
				validationAction: "error",
			}),
		)
	})

	it("swallows NamespaceNotFound (collection not yet created)", async () => {
		const db = mockDb()
		;(db.command as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("NamespaceNotFound: ns not found"),
		)
		await expect(
			ensureWikiSchemaValidation(db, "test_"),
		).resolves.toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// ensureWikiStandardIndexes
// ---------------------------------------------------------------------------

describe("ensureWikiStandardIndexes", () => {
	it("creates the expected set of standard indexes", async () => {
		const db = mockDb()
		await ensureWikiStandardIndexes(db, "test_")
		const coll = wikiPagesCollection(db, "test_")
		const calls = (coll.createIndexes as unknown as ReturnType<typeof vi.fn>)
			.mock.calls
		expect(calls.length).toBe(1)
		const indexes = calls[0][0]
		const names = indexes.map((i: { name: string }) => i.name)
		// Every index from the ticket acceptance criteria
		for (const name of [
			"slug_scope_unique",
			"kind",
			"entityId",
			"okfConceptId",
			"okfBundleId",
			"scope_scopeRef",
			"trustTier",
			"state",
			"freshness",
			"tags",
			"aliases_text",
		]) {
			expect(names).toContain(name)
		}
	})

	it("slug_scope_unique is a unique compound index", async () => {
		const db = mockDb()
		await ensureWikiStandardIndexes(db, "test_")
		const coll = wikiPagesCollection(db, "test_")
		const indexes = (coll.createIndexes as unknown as ReturnType<typeof vi.fn>)
			.mock.calls[0][0]
		const slugIdx = indexes.find(
			(i: { name: string }) => i.name === "slug_scope_unique",
		)
		expect(slugIdx.unique).toBe(true)
		expect(Object.keys(slugIdx.key).sort()).toEqual([
			"scope",
			"scopeRef",
			"slug",
		])
	})
})

// ---------------------------------------------------------------------------
// ensureWikiSearchIndexes
// ---------------------------------------------------------------------------

describe("ensureWikiSearchIndexes", () => {
	it("creates vector + text search indexes when absent", async () => {
		const db = mockDb()
		await ensureWikiSearchIndexes(db, "test_")
		const coll = wikiPagesCollection(db, "test_")
		const createCalls = (
			coll.createSearchIndex as unknown as ReturnType<typeof vi.fn>
		).mock.calls
		expect(createCalls.length).toBe(2)
		const created = createCalls.map((c: unknown[]) => c[0] as { type: string })
		const types = created.map((d) => d.type).sort()
		expect(types).toEqual(["search", "vectorSearch"])
	})

	it("is idempotent — skips indexes that already exist", async () => {
		const db = mockDb()
		const coll = wikiPagesCollection(db, "test_")
		;(coll.listSearchIndexes as unknown as ReturnType<typeof vi.fn>)
			.mockReturnValueOnce({
				toArray: async () => [{ name: "wiki_pages_vector" }],
			})
			.mockReturnValueOnce({
				toArray: async () => [{ name: "wiki_pages_text" }],
			})
		await ensureWikiSearchIndexes(db, "test_")
		expect(coll.createSearchIndex).not.toHaveBeenCalled()
	})

	it("swallows search-index-management-unavailable (no mongot)", async () => {
		const db = mockDb()
		const coll = wikiPagesCollection(db, "test_")
		;(
			coll.createSearchIndex as unknown as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("no such command: searchIndexManagement"))
		await expect(ensureWikiSearchIndexes(db, "test_")).resolves.toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// ensureWikiSchema (convenience aggregator)
// ---------------------------------------------------------------------------

describe("ensureWikiSchema", () => {
	it("runs collections → validation → indexes → search indexes in order", async () => {
		const db = mockDb()
		await ensureWikiSchema(db, "test_")
		// collections created
		expect(db.createCollection).toHaveBeenCalledWith(
			"test_wiki_pages",
			expect.any(Object),
		)
		// validation applied
		expect(db.command).toHaveBeenCalledWith(
			expect.objectContaining({ collMod: "test_wiki_pages" }),
		)
		// standard indexes
		const coll = wikiPagesCollection(db, "test_")
		expect(coll.createIndexes).toHaveBeenCalled()
		// search indexes
		expect(coll.createSearchIndex).toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// Search index targets (shape contract)
// ---------------------------------------------------------------------------

describe("WIKI_PAGES_SEARCH_INDEX_TARGETS", () => {
	it("vector target has embedding field with numDimensions + similarity", () => {
		const fields = WIKI_PAGES_SEARCH_INDEX_TARGETS.vector.definition
			.fields as Array<{
			type: string
			path?: string
			numDimensions?: number
			similarity?: string
		}>
		const vectorField = fields.find((f) => f.type === "vector")
		expect(vectorField).toBeDefined()
		expect(vectorField!.path).toBe("embedding")
		expect(vectorField!.numDimensions).toBe(1024)
		expect(vectorField!.similarity).toBe("cosine")
	})

	it("vector target includes governance filter axes", () => {
		const fields = WIKI_PAGES_SEARCH_INDEX_TARGETS.vector.definition
			.fields as Array<{
			type: string
			path: string
		}>
		const filterPaths = fields
			.filter((f) => f.type === "filter")
			.map((f) => f.path)
		for (const path of [
			"kind",
			"scope",
			"scopeRef",
			"trustTier",
			"state",
			"permissions.privacyTier",
		]) {
			expect(filterPaths).toContain(path)
		}
	})

	it("text target maps title+summary+body+aliases+tags", () => {
		const fields = WIKI_PAGES_SEARCH_INDEX_TARGETS.text.definition.mappings
			.fields as Record<string, unknown>
		for (const path of ["title", "summary", "body", "aliases"]) {
			expect(fields[path]).toBeDefined()
		}
		expect(fields["frontmatter.tags"]).toBeDefined()
		expect(fields["permissions.privacyTier"]).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// Enum exports (value vocabulary contracts)
// ---------------------------------------------------------------------------

describe("enum exports", () => {
	it("WIKI_PAGE_KIND_VALUES lists all 6 kinds", () => {
		expect(WIKI_PAGE_KIND_VALUES).toEqual([
			"entity",
			"concept",
			"synthesis",
			"source",
			"report",
			"procedure",
		])
	})

	it("WIKI_SCOPE_VALUES matches memory-engine scope set", () => {
		expect(WIKI_SCOPE_VALUES).toEqual([
			"session",
			"user",
			"agent",
			"workspace",
			"tenant",
			"global",
		])
	})

	it("WIKI_TRUST_TIER_VALUES lists arXIV trust tiers", () => {
		expect(WIKI_TRUST_TIER_VALUES).toEqual(["restricted", "standard", "admin"])
	})
})
