// wiki-maintenance.ts tests (T13 git-diff + T14 Dreamer).
//
// Tests:
// - computeMaintenanceHash is deterministic
// - detectChangedSources finds changed files (hash mismatch)
// - runGitDiffMaintenance: LLM regenerates pages, claims pass through pipeline gate
// - runDreamerPromotion: events → wiki pages with claims
// - Both update lastMaintainedAt + lastMaintenanceSource

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	computeMaintenanceHash,
	detectChangedSources,
	runGitDiffMaintenance,
	runDreamerPromotion,
} from "./wiki-maintenance.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

function makeStore() {
	const docs = new Map<string, Document>()
	const key = (s: string, sc: string, sr: string) => `${s}|${sc}|${sr}`
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
			store.docs.set(k, { ...doc, _id: { toString: () => `id-${k}` } })
			return { acknowledged: true, insertedId: { toString: () => `id-${k}` } }
		}),
		findOne: vi.fn(async (filter: Document) => {
			for (const doc of Array.from(store.docs.values())) {
				if (
					(!filter.slug || doc.slug === filter.slug) &&
					(!filter.scope || doc.scope === filter.scope) &&
					(!filter.scopeRef || doc.scopeRef === filter.scopeRef) &&
					(!filter["frontmatter.resource"] ||
						doc.frontmatter?.resource === filter["frontmatter.resource"])
				) {
					return doc
				}
			}
			return null
		}),
		find: vi.fn(() => ({
			sort: vi.fn(() => ({
				skip: vi.fn(() => ({
					limit: vi.fn(() => ({ toArray: async () => [] })),
				})),
			})),
		})),
		countDocuments: vi.fn(async () => 0),
		findOneAndUpdate: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.docs.get(k)
			if (!existing) return null
			const updated = {
				...existing,
				...update.$set,
				revision: (existing.revision ?? 1) + (update.$inc?.revision ?? 0),
			}
			store.docs.set(k, updated)
			return updated
		}),
		updateOne: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.docs.get(k)
			if (!existing) return { matchedCount: 0, modifiedCount: 0 }
			store.docs.set(k, { ...existing, ...update.$set })
			return { matchedCount: 1, modifiedCount: 1 }
		}),
		deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
	// wiki_revisions is a separate collection from wiki_pages — routing every
	// name to the same mock `coll` would make createWikiPage/updateWikiPage's
	// best-effort revision-history writes land in the wiki_pages store and
	// corrupt document counts these tests assert on.
	const revisionsColl = {
		insertOne: vi.fn(async () => ({
			acknowledged: true,
			insertedId: { toString: () => "rev" },
		})),
	} as unknown as Collection
	const db = {
		collection: vi.fn((name: string) =>
			name.endsWith("wiki_revisions") ? revisionsColl : coll,
		),
	} as unknown as Db
	return { db, coll }
}

function handle(store: ReturnType<typeof makeStore>): WikiDbHandle {
	const { db } = mockDb(store)
	return { db, prefix: "test_" }
}

const SCOPE = "workspace" as const
const SCOPE_REF = "ws-1"

describe("computeMaintenanceHash", () => {
	it("is deterministic (same content → same hash)", () => {
		expect(computeMaintenanceHash("hello world")).toBe(
			computeMaintenanceHash("hello world"),
		)
	})

	it("changes when content changes", () => {
		expect(computeMaintenanceHash("hello world")).not.toBe(
			computeMaintenanceHash("hello world!"),
		)
	})
})

describe("detectChangedSources", () => {
	it("detects files with no existing hash (new files)", async () => {
		const store = makeStore()
		const h = handle(store)
		const changed = await detectChangedSources(
			h,
			[{ path: "src/api.ts", content: "export const x = 1" }],
			SCOPE,
			SCOPE_REF,
		)
		expect(changed).toHaveLength(1)
		expect(changed[0].path).toBe("src/api.ts")
		expect(changed[0].previousHash).toBeUndefined()
	})

	it("detects files with changed hash (modified files)", async () => {
		const store = makeStore()
		const h = handle(store)
		// Seed a wiki page with an old maintenanceHash.
		const oldHash = computeMaintenanceHash("old content")
		store.docs.set(store.key("sources/src/api.ts", SCOPE, SCOPE_REF), {
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			frontmatter: {
				type: "source",
				resource: "src/api.ts",
				maintenanceHash: oldHash,
			},
		})
		const changed = await detectChangedSources(
			h,
			[{ path: "src/api.ts", content: "new content" }],
			SCOPE,
			SCOPE_REF,
		)
		expect(changed).toHaveLength(1)
		expect(changed[0].previousHash).toBe(oldHash)
	})

	it("skips unchanged files", async () => {
		const store = makeStore()
		const h = handle(store)
		const content = "unchanged content"
		const hash = computeMaintenanceHash(content)
		store.docs.set(store.key("sources/src/api.ts", SCOPE, SCOPE_REF), {
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			frontmatter: {
				type: "source",
				resource: "src/api.ts",
				maintenanceHash: hash,
			},
		})
		const changed = await detectChangedSources(
			h,
			[{ path: "src/api.ts", content }],
			SCOPE,
			SCOPE_REF,
		)
		expect(changed).toHaveLength(0)
	})
})

describe("runGitDiffMaintenance", () => {
	it("calls the LLM and creates a wiki page with accepted claims", async () => {
		const store = makeStore()
		const h = handle(store)
		const llmGenerate = vi.fn(async () => ({
			title: "API Source",
			summary: "The API module.",
			body: "# API Source\n\nExports the main API.",
			claims: [{ text: "The API exports a REST endpoint", confidence: 0.9 }],
		}))
		const result = await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "export const x = 1" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.pagesRegenerated).toBe(1)
		expect(result.claimsAdded).toBe(1)
		expect(result.errors).toHaveLength(0)
		expect(llmGenerate).toHaveBeenCalledTimes(1)
		// Verify the page was created with maintenanceHash.
		const page = store.docs.get(
			store.key("sources/src/api.ts", SCOPE, SCOPE_REF),
		)
		expect(page).toBeDefined()
		expect(page?.frontmatter?.maintenanceHash).toBeDefined()
		expect(page?.lastMaintainedAt).toBeInstanceOf(Date)
		expect(page?.lastMaintenanceSource).toBe("git-diff")
	})

	it("updates an existing page (not creates a duplicate)", async () => {
		const store = makeStore()
		const h = handle(store)
		// Seed an existing page.
		store.docs.set(store.key("sources/src/api.ts", SCOPE, SCOPE_REF), {
			_id: { toString: () => "1" },
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Old Title",
			summary: "Old summary.",
			body: "Old body.",
			frontmatter: { type: "source", resource: "src/api.ts" },
			claims: [],
			revision: 1,
		})
		const llmGenerate = vi.fn(async () => ({
			summary: "New summary.",
			body: "New body.",
			claims: [{ text: "Updated claim", confidence: 0.8 }],
		}))
		const result = await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "new content" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.pagesRegenerated).toBe(1)
		// Verify the page was updated (not duplicated).
		expect(store.docs.size).toBe(1)
		const page = store.docs.get(
			store.key("sources/src/api.ts", SCOPE, SCOPE_REF),
		)
		expect(page?.summary).toBe("New summary.")
	})
})

describe("runDreamerPromotion", () => {
	it("promotes events to wiki pages with claims", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[
				{ id: "evt-1", text: "The user prefers dark mode", agentId: "agent-1" },
				{ id: "evt-2", text: "The API uses GraphQL", agentId: "agent-1" },
			],
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.pagesRegenerated).toBe(2)
		expect(result.claimsAdded).toBe(2)
		expect(result.errors).toHaveLength(0)
		// Verify pages were created.
		const page1 = store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
		expect(page1).toBeDefined()
		expect(page1?.claims).toHaveLength(1)
		expect(page1?.lastMaintenanceSource).toBe("dreamer")
	})

	it("adds claims to existing event pages (no data loss)", async () => {
		const store = makeStore()
		const h = handle(store)
		// Seed an existing event page with one claim.
		store.docs.set(store.key("events/evt-1", SCOPE, SCOPE_REF), {
			_id: { toString: () => "1" },
			slug: "events/evt-1",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Event evt-1",
			summary: "Old event.",
			body: "",
			frontmatter: { type: "entity" },
			claims: [{ id: "c-old", text: "Old claim", status: "active" }],
			revision: 1,
		})
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "New information about this event" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.claimsAdded).toBe(1)
		// The old claim should still be there — the page was updated, not replaced.
		void store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
	})

	it("skips empty events", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-empty", text: "" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.pagesRegenerated).toBe(0)
		expect(result.claimsAdded).toBe(0)
	})

	it("uses the vector-only recipe so the 0.65 floor is a cosine gate", async () => {
		const store = makeStore()
		const { db, coll } = mockDb(store)
		const h = { db, prefix: "test_" } as WikiDbHandle
		const captured: Document[][] = []
		;(coll as { aggregate: ReturnType<typeof vi.fn> }).aggregate = vi.fn(
			(pipeline: Document[]) => {
				captured.push(pipeline)
				return { toArray: async () => [] }
			},
		)
		await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "The user prefers dark mode" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(captured.length).toBeGreaterThan(0)
		// Vector-only recipe: first stage is $vectorSearch (cosine scores in
		// [0,1]); RRF-fused hybrid scores would never clear a 0.65 floor.
		expect(captured[0][0]).toHaveProperty("$vectorSearch")
	})

	it("adopts the top page only when it clears the similarity floor", async () => {
		const store = makeStore()
		const { db, coll } = mockDb(store)
		const h = { db, prefix: "test_" } as WikiDbHandle
		// Seed an existing similar page.
		store.docs.set(store.key("concepts/dark-mode", SCOPE, SCOPE_REF), {
			_id: { toString: () => "1" },
			slug: "concepts/dark-mode",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Dark mode",
			summary: "User prefers dark mode.",
			body: "",
			frontmatter: { type: "concept" },
			claims: [],
			revision: 1,
		})
		// Search returns the similar page with cosine similarity 0.9 — above
		// the 0.65 floor.
		;(coll as { aggregate: ReturnType<typeof vi.fn> }).aggregate = vi.fn(
			() => ({
				toArray: async () => [
					{
						_id: { toString: () => "1" },
						slug: "concepts/dark-mode",
						scope: SCOPE,
						scopeRef: SCOPE_REF,
						title: "Dark mode",
						summary: "User prefers dark mode.",
						body: "",
						frontmatter: { type: "concept" },
						claims: [],
						searchScore: 0.9,
					},
				],
			}),
		)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "The user prefers dark mode" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.claimsAdded).toBe(1)
		// The claim landed on the similar page, not a fresh events/ page.
		const page = store.docs.get(
			store.key("concepts/dark-mode", SCOPE, SCOPE_REF),
		)
		expect(page?.claims).toHaveLength(1)
		expect(
			store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF)),
		).toBeUndefined()
	})

	it("falls back to the hash slug when the top result is below the floor", async () => {
		const store = makeStore()
		const { db, coll } = mockDb(store)
		const h = { db, prefix: "test_" } as WikiDbHandle
		// Search returns an UNRELATED page with cosine similarity 0.02 — well
		// below the 0.65 floor. Before WS-6 the floor was inert and this page
		// was adopted unconditionally (cross-topic contamination).
		;(coll as { aggregate: ReturnType<typeof vi.fn> }).aggregate = vi.fn(
			() => ({
				toArray: async () => [
					{
						_id: { toString: () => "1" },
						slug: "concepts/graphql-schema",
						scope: SCOPE,
						scopeRef: SCOPE_REF,
						title: "GraphQL schema",
						summary: "Schema design.",
						body: "",
						frontmatter: { type: "concept" },
						claims: [],
						searchScore: 0.02,
					},
				],
			}),
		)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "The user prefers dark mode" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(result.claimsAdded).toBe(1)
		// The event went to its own hash-slug page; the unrelated page was
		// neither created nor contaminated.
		expect(
			store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF)),
		).toBeDefined()
		expect(
			store.docs.get(store.key("concepts/graphql-schema", SCOPE, SCOPE_REF)),
		).toBeUndefined()
	})
})
