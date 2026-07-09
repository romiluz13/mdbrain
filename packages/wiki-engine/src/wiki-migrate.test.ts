// wiki-migrate.ts tests (T9).
//
// Seeds structured_mem + procedures records, runs migration, asserts:
// - structured_mem → claims on wiki pages (no data loss)
// - procedures → wiki pages kind="procedure"
// - idempotent (re-running doesn't duplicate)
// - coverage check passes

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	createWikiPage,
	getWikiPage,
	type WikiDbHandle,
} from "./wiki-bridge.js"
import {
	migrateStructuredMem,
	migrateProcedures,
	migrateLegacyToWiki,
	checkMigrationCoverage,
} from "./wiki-migrate.js"

function makeStore() {
	const wikiDocs = new Map<string, Document>()
	const memDocs: Document[] = []
	const procDocs: Document[] = []
	const key = (slug: string, scope: string, scopeRef: string) =>
		`${slug}|${scope}|${scopeRef}`
	return { wikiDocs, memDocs, procDocs, key }
}

function mockDb(store: ReturnType<typeof makeStore>): {
	db: Db
	coll: Collection
} {
	const wikiColl = {
		collectionName: "test_wiki_pages",
		insertOne: vi.fn(async (doc: Document) => {
			const k = store.key(doc.slug, doc.scope, doc.scopeRef)
			if (store.wikiDocs.has(k)) throw new Error("E11000 duplicate key error")
			const id = { toString: () => `wiki-${k}` }
			store.wikiDocs.set(k, { ...doc, _id: id })
			return { acknowledged: true, insertedId: id }
		}),
		findOne: vi.fn(async (filter: Document) => {
			// Support query by claims.sourceMemId or frontmatter.migratedFrom
			if (filter["claims.sourceMemId"]) {
				for (const doc of Array.from(store.wikiDocs.values())) {
					if (
						(!filter.scope || doc.scope === filter.scope) &&
						(!filter.scopeRef || doc.scopeRef === filter.scopeRef) &&
						Array.isArray(doc.claims) &&
						doc.claims.some(
							(c: Document) => c.sourceMemId === filter["claims.sourceMemId"],
						)
					) {
						return doc
					}
				}
				return null
			}
			if (filter["frontmatter.migratedFrom"]) {
				for (const doc of Array.from(store.wikiDocs.values())) {
					if (
						(!filter.scope || doc.scope === filter.scope) &&
						(!filter.scopeRef || doc.scopeRef === filter.scopeRef) &&
						doc.frontmatter?.migratedFrom === filter["frontmatter.migratedFrom"]
					) {
						return doc
					}
				}
				return null
			}
			for (const doc of Array.from(store.wikiDocs.values())) {
				if (
					(!filter.slug || doc.slug === filter.slug) &&
					(!filter.scope || doc.scope === filter.scope) &&
					(!filter.scopeRef || doc.scopeRef === filter.scopeRef)
				) {
					return doc
				}
			}
			return null
		}),
		find: vi.fn((filter: Document) => {
			const matched = Array.from(store.wikiDocs.values()).filter((doc) => {
				for (const [k, v] of Object.entries(filter)) {
					if (doc[k] !== v) return false
				}
				return true
			})
			return {
				sort: vi.fn(() => ({
					skip: vi.fn(() => ({
						limit: vi.fn(() => ({ toArray: async () => matched })),
					})),
				})),
			}
		}),
		countDocuments: vi.fn(async () => 0),
		findOneAndUpdate: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.wikiDocs.get(k)
			if (!existing) return { value: null }
			const updated = {
				...existing,
				...update.$set,
				revision: (existing.revision ?? 1) + (update.$inc?.revision ?? 0),
			}
			store.wikiDocs.set(k, updated)
			return { value: updated }
		}),
		updateOne: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.wikiDocs.get(k)
			if (!existing) return { matchedCount: 0, modifiedCount: 0 }
			store.wikiDocs.set(k, { ...existing, ...update.$set })
			return { matchedCount: 1, modifiedCount: 1 }
		}),
		deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection

	const memColl = {
		find: vi.fn((filter: Document) => {
			const matched = store.memDocs.filter((doc) => {
				for (const [k, v] of Object.entries(filter)) {
					if (doc[k] !== v) return false
				}
				return true
			})
			return { toArray: async () => matched }
		}),
	} as unknown as Collection

	const procColl = {
		find: vi.fn((filter: Document) => {
			const matched = store.procDocs.filter((doc) => {
				for (const [k, v] of Object.entries(filter)) {
					if (doc[k] !== v) return false
				}
				return true
			})
			return { toArray: async () => matched }
		}),
	} as unknown as Collection

	const db = {
		collection: vi.fn((name: string) => {
			if (name === "test_wiki_pages") return wikiColl
			if (name === "test_structured_mem") return memColl
			if (name === "test_procedures") return procColl
			return wikiColl
		}),
	} as unknown as Db
	return { db, coll: wikiColl }
}

function handle(store: ReturnType<typeof makeStore>): WikiDbHandle {
	const { db } = mockDb(store)
	return { db, prefix: "test_" }
}

const SCOPE = "workspace" as const
const SCOPE_REF = "ws-1"

function seedMem(store: ReturnType<typeof makeStore>, n: number): void {
	for (let i = 0; i < n; i++) {
		store.memDocs.push({
			_id: { toString: () => `mem-${i}` },
			type: "fact",
			key: `fact-${i}`,
			value: `This is fact number ${i}.`,
			context: `context-${i}`,
			confidence: 0.8,
			tags: ["test"],
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			validFrom: new Date(),
		})
	}
}

function seedProc(store: ReturnType<typeof makeStore>, n: number): void {
	for (let i = 0; i < n; i++) {
		store.procDocs.push({
			_id: { toString: () => `proc-${i}` },
			procedureId: `proc-id-${i}`,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			name: `Procedure ${i}`,
			intentTags: ["test"],
			triggerQueries: [`How to do ${i}?`],
			steps: [`Step 1 for ${i}`, `Step 2 for ${i}`],
		})
	}
}

describe("migration: structured_mem → wiki claims", () => {
	it("migrates structured_mem records into claims on entity pages", async () => {
		const store = makeStore()
		const h = handle(store)
		seedMem(store, 3)
		const result = await migrateStructuredMem(h)
		expect(result.structuredMemTotal).toBe(3)
		expect(result.structuredMemMigrated).toBe(3)
		expect(result.structuredMemSkipped).toBe(0)
		expect(result.pagesCreated).toBe(3)
		expect(result.claimsAdded).toBe(3)
		// Verify each page has a claim with sourceMemId.
		for (let i = 0; i < 3; i++) {
			const page = await getWikiPage(
				h,
				`entities/fact/fact-${i}`,
				SCOPE,
				SCOPE_REF,
			)
			expect(page).toBeDefined()
			expect(page?.claims).toHaveLength(1)
			expect(page?.claims[0]).toMatchObject({ sourceMemId: `mem-${i}` })
		}
	})

	it("adds claims to existing pages without duplicating", async () => {
		const store = makeStore()
		const h = handle(store)
		// Create an entity page first.
		await createWikiPage(h, {
			kind: "entity",
			title: "fact/my-fact",
			slug: "entities/fact/my-fact",
			summary: "Existing page.",
			body: "",
			frontmatter: { type: "entity" },
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			trustTier: "standard",
		})
		// Seed a mem record for the same type+key.
		store.memDocs.push({
			_id: { toString: () => "mem-existing" },
			type: "fact",
			key: "my-fact",
			value: "This is a migrated fact.",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		const result = await migrateStructuredMem(h)
		expect(result.structuredMemMigrated).toBe(1)
		expect(result.pagesCreated).toBe(0) // page already existed
		expect(result.claimsAdded).toBe(1)
		const page = await getWikiPage(h, "entities/fact/my-fact", SCOPE, SCOPE_REF)
		expect(page?.claims).toHaveLength(1)
		expect(page?.claims[0]).toMatchObject({ sourceMemId: "mem-existing" })
	})

	it("is idempotent — re-running skips already-migrated records", async () => {
		const store = makeStore()
		const h = handle(store)
		seedMem(store, 2)
		await migrateStructuredMem(h)
		const result2 = await migrateStructuredMem(h)
		expect(result2.structuredMemMigrated).toBe(0)
		expect(result2.structuredMemSkipped).toBe(2)
		expect(result2.claimsAdded).toBe(0)
		expect(result2.pagesCreated).toBe(0)
	})
})

describe("migration: procedures → wiki pages", () => {
	it("migrates procedures into wiki pages with kind=procedure", async () => {
		const store = makeStore()
		const h = handle(store)
		seedProc(store, 2)
		const result = await migrateProcedures(h)
		expect(result.proceduresTotal).toBe(2)
		expect(result.proceduresMigrated).toBe(2)
		expect(result.proceduresSkipped).toBe(0)
		for (let i = 0; i < 2; i++) {
			const page = await getWikiPage(
				h,
				`procedures/procedure-${i}`,
				SCOPE,
				SCOPE_REF,
			)
			expect(page?.kind).toBe("procedure")
			expect(page?.title).toBe(`Procedure ${i}`)
			expect(page?.body).toContain("Step 1")
			expect(page?.body).toContain("Step 2")
			expect(page?.questions).toHaveLength(1)
		}
	})

	it("is idempotent — re-running skips already-migrated procedures", async () => {
		const store = makeStore()
		const h = handle(store)
		seedProc(store, 1)
		await migrateProcedures(h)
		const result2 = await migrateProcedures(h)
		expect(result2.proceduresMigrated).toBe(0)
		expect(result2.proceduresSkipped).toBe(1)
	})
})

describe("migration: full + coverage", () => {
	it("migrateLegacyToWiki runs both legs and checkMigrationCoverage passes", async () => {
		const store = makeStore()
		const h = handle(store)
		seedMem(store, 3)
		seedProc(store, 2)
		const result = await migrateLegacyToWiki(h)
		expect(result.structuredMemMigrated).toBe(3)
		expect(result.proceduresMigrated).toBe(2)
		// Coverage check — no data loss.
		const coverage = await checkMigrationCoverage(h)
		expect(coverage.structuredMemCovered).toBe(3)
		expect(coverage.structuredMemTotal).toBe(3)
		expect(coverage.proceduresCovered).toBe(2)
		expect(coverage.proceduresTotal).toBe(2)
	})

	it("dryRun doesn't write but counts what would be migrated", async () => {
		const store = makeStore()
		const h = handle(store)
		seedMem(store, 2)
		seedProc(store, 1)
		const result = await migrateLegacyToWiki(h, { dryRun: true })
		expect(result.structuredMemMigrated).toBe(2)
		expect(result.proceduresMigrated).toBe(1)
		// Nothing was actually written.
		expect(store.wikiDocs.size).toBe(0)
	})
})
