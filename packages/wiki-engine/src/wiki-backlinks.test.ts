// wiki-backlinks.ts tests (T11).
//
// Verifies: create A→B relationship, assert B has a backlink to A; update
// (remove relationship) removes the backlink; delete A removes A's backlink
// from B. Uses an in-memory mock store that emulates the MongoDB aggregation
// ($match on relationships.targetPageSlug + backlinks.sourcePageSlug).

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	createWikiPage,
	updateWikiPage,
	deleteWikiPage,
	getWikiPage,
	type WikiDbHandle,
} from "./wiki-bridge.js"
import {
	recomputeBacklinksFor,
	recomputeAllBacklinks,
} from "./wiki-backlinks.js"

function makeStore() {
	const docs = new Map<string, Document>()
	const key = (slug: string, scope: string, scopeRef: string) =>
		`${slug}|${scope}|${scopeRef}`
	return { docs, key }
}

function mockDb(store: ReturnType<typeof makeStore>): {
	db: Db
	coll: Collection
} {
	const coll = {
		collectionName: "test_wiki_pages",
		insertOne: vi.fn(async (doc: Document) => {
			const k = store.key(doc.slug, doc.scope, doc.scopeRef)
			if (store.docs.has(k)) throw new Error("E11000 duplicate key error")
			const id = { toString: () => `id-${k}` }
			store.docs.set(k, { ...doc, _id: id })
			return { acknowledged: true, insertedId: id }
		}),
		findOne: vi.fn(async (filter: Document) => {
			for (const doc of Array.from(store.docs.values())) {
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
			const matched = Array.from(store.docs.values()).filter((doc) => {
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
			const existing = store.docs.get(k)
			if (!existing) return { value: null }
			const updated = {
				...existing,
				...update.$set,
				revision: (existing.revision ?? 1) + (update.$inc?.revision ?? 0),
			}
			store.docs.set(k, updated)
			return { value: updated }
		}),
		updateOne: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.docs.get(k)
			if (!existing) return { matchedCount: 0, modifiedCount: 0 }
			store.docs.set(k, { ...existing, ...update.$set })
			return { matchedCount: 1, modifiedCount: 1 }
		}),
		deleteOne: vi.fn(async (filter: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			if (!store.docs.has(k)) return { deletedCount: 0 }
			store.docs.delete(k)
			return { deletedCount: 1 }
		}),
		aggregate: vi.fn((pipeline: Document[]) => {
			// Emulate the $match + $project pipeline used by backlinks.
			const stage = pipeline[0]
			if (stage && stage.$match) {
				const m = stage.$match
				const scope = m.scope
				const scopeRef = m.scopeRef
				let results: Document[] = []
				if (m["relationships.targetPageSlug"]) {
					const target = m["relationships.targetPageSlug"]
					results = Array.from(store.docs.values()).filter(
						(doc) =>
							doc.scope === scope &&
							doc.scopeRef === scopeRef &&
							doc.state !== "superseded" &&
							Array.isArray(doc.relationships) &&
							doc.relationships.some(
								(r: Document) => r.targetPageSlug === target,
							),
					)
				} else if (m["backlinks.sourcePageSlug"]) {
					const source = m["backlinks.sourcePageSlug"]
					results = Array.from(store.docs.values()).filter(
						(doc) =>
							doc.scope === scope &&
							doc.scopeRef === scopeRef &&
							Array.isArray(doc.backlinks) &&
							doc.backlinks.some((b: Document) => b.sourcePageSlug === source),
					)
				} else if (m.scope && m.scopeRef) {
					results = Array.from(store.docs.values()).filter(
						(doc) => doc.scope === scope && doc.scopeRef === scopeRef,
					)
				}
				// Apply $project if present (just pass through the needed fields).
				return { toArray: async () => results }
			}
			return { toArray: async () => [] }
		}),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, coll }
}

function handle(store: ReturnType<typeof makeStore>): WikiDbHandle {
	const { db } = mockDb(store)
	return { db, prefix: "test_" }
}

const SCOPE = "workspace" as const
const SCOPE_REF = "ws-1"

const PAGE_A = {
	kind: "concept" as const,
	title: "Page A",
	slug: "a",
	summary: "Page A summary.",
	body: "Body A",
	frontmatter: { type: "concept" },
	scope: SCOPE,
	scopeRef: SCOPE_REF,
	trustTier: "standard" as const,
	relationships: [
		{ targetPageSlug: "b", targetTitle: "Page B", kind: "relates_to" },
	],
}

const PAGE_B = {
	kind: "concept" as const,
	title: "Page B",
	slug: "b",
	summary: "Page B summary.",
	body: "Body B",
	frontmatter: { type: "concept" },
	scope: SCOPE,
	scopeRef: SCOPE_REF,
	trustTier: "standard" as const,
}

describe("backlinks auto-generation", () => {
	it("create A→B relationship → B has a backlink to A", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, PAGE_B)
		await createWikiPage(h, PAGE_A)
		const b = await getWikiPage(h, "b", SCOPE, SCOPE_REF)
		expect(b?.backlinks).toHaveLength(1)
		expect(b?.backlinks[0]).toMatchObject({
			sourcePageSlug: "a",
			sourceTitle: "Page A",
		})
	})

	it("update A to remove the B relationship → B loses the backlink", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, PAGE_B)
		await createWikiPage(h, PAGE_A)
		// Verify backlink exists.
		let b = await getWikiPage(h, "b", SCOPE, SCOPE_REF)
		expect(b?.backlinks).toHaveLength(1)
		// Update A to remove all relationships.
		await updateWikiPage(h, "a", SCOPE, SCOPE_REF, { relationships: [] })
		b = await getWikiPage(h, "b", SCOPE, SCOPE_REF)
		expect(b?.backlinks).toHaveLength(0)
	})

	it("delete A (hard) → B loses the backlink from A", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, PAGE_B)
		await createWikiPage(h, PAGE_A)
		expect(
			(await getWikiPage(h, "b", SCOPE, SCOPE_REF))?.backlinks,
		).toHaveLength(1)
		await deleteWikiPage(h, "a", SCOPE, SCOPE_REF, { hard: true })
		const b = await getWikiPage(h, "b", SCOPE, SCOPE_REF)
		expect(b?.backlinks).toHaveLength(0)
	})

	it("recomputeBacklinksFor directly updates the target page", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, PAGE_B)
		await createWikiPage(h, PAGE_A)
		// Manually clear B's backlinks, then recompute.
		const bKey = store.key("b", SCOPE, SCOPE_REF)
		const bDoc = store.docs.get(bKey)!
		bDoc.backlinks = []
		const result = await recomputeBacklinksFor(h, "b", SCOPE, SCOPE_REF)
		expect(result).toHaveLength(1)
		expect(result![0]).toMatchObject({
			sourcePageSlug: "a",
			sourceTitle: "Page A",
		})
	})

	it("recomputeAllBacklinks updates all pages in a scope", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, PAGE_B)
		await createWikiPage(h, PAGE_A)
		// Clear all backlinks, then full recompute.
		for (const doc of Array.from(store.docs.values())) {
			doc.backlinks = []
		}
		const count = await recomputeAllBacklinks(h, SCOPE, SCOPE_REF)
		expect(count).toBe(2)
		const b = await getWikiPage(h, "b", SCOPE, SCOPE_REF)
		expect(b?.backlinks).toHaveLength(1)
	})

	it("no self-backlinks (A→A relationship does not backlink to A)", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, {
			...PAGE_A,
			slug: "self",
			relationships: [
				{ targetPageSlug: "self", targetTitle: "Self", kind: "relates_to" },
			],
		})
		const self = await getWikiPage(h, "self", SCOPE, SCOPE_REF)
		expect(self?.backlinks).toHaveLength(0)
	})

	it("soft-delete A → B loses the backlink from A (superseded pages excluded)", async () => {
		const store = makeStore()
		const h = handle(store)
		await createWikiPage(h, PAGE_B)
		await createWikiPage(h, PAGE_A)
		expect(
			(await getWikiPage(h, "b", SCOPE, SCOPE_REF))?.backlinks,
		).toHaveLength(1)
		// Soft delete (default — marks state=superseded, not hard delete)
		await deleteWikiPage(h, "a", SCOPE, SCOPE_REF)
		const b = await getWikiPage(h, "b", SCOPE, SCOPE_REF)
		expect(b?.backlinks).toHaveLength(0)
	})
})
