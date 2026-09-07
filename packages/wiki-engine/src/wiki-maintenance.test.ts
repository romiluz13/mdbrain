// wiki-maintenance.ts tests (T13 git-diff + T14 Dreamer).
//
// Tests:
// - computeMaintenanceHash is deterministic
// - detectChangedSources finds changed files (hash mismatch)
// - runGitDiffMaintenance: LLM regenerates pages, claims pass through pipeline gate
// - runDreamerPromotion: fails closed without a classifier (P5); LLM
//   classification routes phase 5 (ignore/new/update/contradiction); claims
//   carry per-claim confidence + event provenance; heuristic importer is an
//   explicit opt-in, disclosed via extractionMode
// - Both update lastMaintainedAt + lastMaintenanceSource

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import type {
	ClientSession,
	Collection,
	Db,
	Document,
	MongoClient,
} from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	computeMaintenanceHash,
	detectChangedSources,
	runGitDiffMaintenance,
	runDreamerPromotion,
	MaintenanceLlmUnconfiguredError,
	type DreamerClassification,
	type DreamerClassifier,
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
	client: MongoClient
	session: ClientSession
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
						doc.frontmatter?.resource === filter["frontmatter.resource"]) &&
					(!(filter.state as { $ne?: unknown } | undefined)?.$ne ||
						doc.state !== (filter.state as { $ne: unknown }).$ne)
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
			if (
				!existing ||
				(filter.revision !== undefined &&
					Number(existing.revision ?? 1) !== Number(filter.revision)) ||
				((filter.state as { $ne?: unknown } | undefined)?.$ne &&
					existing.state === (filter.state as { $ne: unknown }).$ne)
			)
				return null
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
		findOne: vi.fn(async () => null),
	} as unknown as Collection
	let active = false
	const session = {
		inTransaction: vi.fn(() => active),
		withTransaction: vi.fn(async (operation: () => Promise<unknown>) => {
			active = true
			try {
				return await operation()
			} finally {
				active = false
			}
		}),
		endSession: vi.fn(async () => undefined),
	} as unknown as ClientSession
	const client = {
		startSession: vi.fn(() => session),
	} as unknown as MongoClient
	const db = {
		collection: vi.fn((name: string) =>
			name.endsWith("wiki_revisions") ? revisionsColl : coll,
		),
		client,
	} as unknown as Db
	return { db, coll, client, session }
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

	it("does not schedule a source whose tracking page is superseded", async () => {
		const store = makeStore()
		const h = handle(store)
		store.docs.set(store.key("sources/src/api.ts", SCOPE, SCOPE_REF), {
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			state: "superseded",
			frontmatter: {
				type: "source",
				resource: "src/api.ts",
				maintenanceHash: computeMaintenanceHash("old content"),
			},
		})

		const changed = await detectChangedSources(
			h,
			[{ path: "src/api.ts", content: "new content" }],
			SCOPE,
			SCOPE_REF,
		)

		expect(changed).toEqual([])
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

	it("guards maintenance metadata writes against superseded targets", async () => {
		const store = makeStore()
		const { db, coll } = mockDb(store)
		const h: WikiDbHandle = { db, prefix: "test_" }
		const llmGenerate = vi.fn(async () => ({
			title: "API Source",
			summary: "The API module.",
			body: "# API Source",
			claims: [],
		}))

		await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "export const x = 1" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)

		expect(coll.updateOne).toHaveBeenCalledWith(
			{
				slug: "sources/src/api.ts",
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				state: { $ne: "superseded" },
			},
			expect.objectContaining({
				$set: expect.objectContaining({
					lastMaintenanceSource: "git-diff",
				}),
			}),
			{ session: expect.any(Object) },
		)
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

	it("reports a stale prepared update and continues with the next source", async () => {
		const store = makeStore()
		const { db, coll, client } = mockDb(store)
		const h: WikiDbHandle = { db, prefix: "test_" }
		for (const path of ["src/a.ts", "src/b.ts"]) {
			const slug = `sources/${path}`
			store.docs.set(store.key(slug, SCOPE, SCOPE_REF), {
				_id: { toString: () => `id-${slug}` },
				slug,
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				state: "active",
				title: path,
				summary: "Old summary.",
				body: "Old body.",
				frontmatter: { type: "source", resource: path },
				claims: [],
				relationships: [],
				revision: 1,
			})
		}
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce(null)
		const llmGenerate = vi.fn(
			async ({ sourceFile }: { sourceFile: string }) => ({
				summary: `Regenerated ${sourceFile}`,
				body: "New body.",
				claims: [],
			}),
		)

		const result = await runGitDiffMaintenance(
			h,
			[
				{ path: "src/a.ts", content: "first" },
				{ path: "src/b.ts", content: "second" },
			],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)

		expect(result.pagesProcessed).toBe(2)
		expect(result.pagesRegenerated).toBe(1)
		expect(result.errors).toEqual([
			expect.stringContaining("moved past revision 1"),
		])
		expect(
			store.docs.get(store.key("sources/src/a.ts", SCOPE, SCOPE_REF)),
		).toMatchObject({ summary: "Old summary." })
		expect(
			store.docs.get(store.key("sources/src/b.ts", SCOPE, SCOPE_REF)),
		).toMatchObject({ summary: "Regenerated src/b.ts" })
		expect(client.startSession).toHaveBeenCalledTimes(2)
	})

	it("publishes counters once when MongoDB retries a page transaction", async () => {
		const store = makeStore()
		const { db, session } = mockDb(store)
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			session.inTransaction as unknown as ReturnType<typeof vi.fn>
		).mockReturnValue(true)
		;(
			session.withTransaction as unknown as ReturnType<typeof vi.fn>
		).mockImplementation(async (operation: () => Promise<unknown>) => {
			const snapshot = new Map(store.docs)
			await operation()
			store.docs.clear()
			for (const [key, value] of snapshot) store.docs.set(key, value)
			return operation()
		})
		const llmGenerate = vi.fn(async () => ({
			title: "API Source",
			summary: "The API module.",
			body: "# API Source",
			claims: [{ text: "One claim", confidence: 0.9 }],
		}))

		const result = await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "export const x = 1" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)

		expect(result.pagesProcessed).toBe(1)
		expect(result.pagesRegenerated).toBe(1)
		expect(result.claimsAdded).toBe(1)
		expect(llmGenerate).toHaveBeenCalledTimes(1)
	})

	it("replaces only source-owned claims while preserving independent claims", async () => {
		const store = makeStore()
		const h = handle(store)
		const key = store.key("sources/src/api.ts", SCOPE, SCOPE_REF)
		store.docs.set(key, {
			_id: { toString: () => "1" },
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			state: "active",
			title: "API Source",
			summary: "Old summary.",
			body: "Old body.",
			frontmatter: { type: "source", resource: "src/api.ts" },
			claims: [
				{
					id: "claim-git-769911c416ccf851-787fd9438d4a313f",
					text: "The API uses REST endpoints.",
				},
				{
					id: "claim-git-769911c416ccf851-edb33b2badee665d",
					text: "The API uses OAuth authentication.",
				},
				{
					id: "claim-git-769911c416ccf851-84a55152dc76b052",
					text: "Exports are generated nightly.",
				},
				{
					id: "claim-dreamer-event-1",
					text: "User prefers concise reports.",
				},
				{ id: "claim-manual-1", text: "Manual deployment notes." },
			],
			relationships: [],
			revision: 1,
		})
		const llmGenerate = vi.fn(async () => ({
			summary: "New summary.",
			body: "New body.",
			claims: [
				{ text: "The API uses OAuth authentication." },
				{ text: "Exports are generated hourly." },
				{ text: "Metrics are retained for thirty days." },
			],
		}))

		await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "new content" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)

		const claims = store.docs.get(key)?.claims as Array<{
			id: string
			text: string
		}>
		expect(claims.map((claim) => claim.id)).toEqual([
			"claim-dreamer-event-1",
			"claim-manual-1",
			"claim-git-769911c416ccf851-edb33b2badee665d",
			"claim-git-769911c416ccf851-1074b3006b03cc90",
			"claim-git-769911c416ccf851-d396dcc3c76aa2b7",
		])
		expect(
			claims.find(
				(claim) => claim.id === "claim-git-769911c416ccf851-edb33b2badee665d",
			)?.text,
		).toBe("The API uses OAuth authentication.")
	})

	it("keeps content-keyed claim IDs stable across reorder and clears only owned claims", async () => {
		const store = makeStore()
		const h = handle(store)
		const key = store.key("sources/src/api.ts", SCOPE, SCOPE_REF)
		let generatedClaims = [
			{ text: "  Requests require OAuth authentication.  " },
			{ text: "The service uses PostgreSQL for storage." },
		]
		const llmGenerate = vi.fn(async () => ({
			title: "API Source",
			summary: "API summary.",
			body: "API body.",
			claims: generatedClaims,
		}))

		await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "first version" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		const firstIds = Object.fromEntries(
			(
				(store.docs.get(key)?.claims ?? []) as Array<{
					id: string
					text: string
				}>
			).map((claim) => [claim.text, claim.id]),
		)
		expect(firstIds).toEqual({
			"  Requests require OAuth authentication.  ":
				"claim-git-769911c416ccf851-8aaa7123aef43bad",
			"The service uses PostgreSQL for storage.":
				"claim-git-769911c416ccf851-a42d74d777df2816",
		})

		generatedClaims = [...generatedClaims].reverse()
		await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "second version" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		const reorderedIds = Object.fromEntries(
			(
				(store.docs.get(key)?.claims ?? []) as Array<{
					id: string
					text: string
				}>
			).map((claim) => [claim.text, claim.id]),
		)
		expect(reorderedIds).toEqual(firstIds)

		const page = store.docs.get(key)!
		page.claims.push({ id: "claim-manual-1", text: "Manual deployment notes." })
		generatedClaims = []
		await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "third version" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)
		expect(store.docs.get(key)?.claims).toEqual([
			{ id: "claim-manual-1", text: "Manual deployment notes." },
		])
	})

	it("never retargets a removed owned claim ID to edited text", async () => {
		const store = makeStore()
		const h = handle(store)
		const sourceKey = store.key("sources/src/api.ts", SCOPE, SCOPE_REF)
		const targetKey = store.key("target", SCOPE, SCOPE_REF)
		const oldClaimId = "claim-git-769911c416ccf851-a688e6e7c4514102"
		const newClaimId = "claim-git-769911c416ccf851-17cfd6a371821585"
		store.docs.set(sourceKey, {
			_id: { toString: () => "source" },
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			state: "active",
			title: "API Source",
			summary: "Old summary.",
			body: "Old body.",
			frontmatter: { type: "source", resource: "src/api.ts" },
			claims: [{ id: oldClaimId, text: "Legacy endpoint uses XML." }],
			relationships: [],
			revision: 1,
		})
		const historicalContradiction = {
			id: "contra-history",
			claimIds: [oldClaimId, "claim-target-1"],
			detectedAt: new Date("2026-01-01T00:00:00.000Z"),
			resolution: "unresolved",
		}
		store.docs.set(targetKey, {
			_id: { toString: () => "target" },
			slug: "target",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			state: "active",
			title: "Target",
			claims: [{ id: "claim-target-1", text: "Target claim" }],
			contradictions: [historicalContradiction],
			relationships: [],
			revision: 1,
		})
		const llmGenerate = vi.fn(async () => ({
			summary: "New summary.",
			body: "New body.",
			claims: [{ text: "Legacy endpoint uses xml." }],
		}))

		await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "new content" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)

		expect(store.docs.get(sourceKey)?.claims).toEqual([
			expect.objectContaining({
				id: newClaimId,
				text: "Legacy endpoint uses xml.",
			}),
		])
		const allClaims = Array.from(store.docs.values()).flatMap(
			(doc) =>
				(doc.claims ?? []) as Array<{
					id: string
					text: string
				}>,
		)
		expect(
			allClaims.some(
				(claim) =>
					claim.id === oldClaimId && claim.text === "Legacy endpoint uses xml.",
			),
		).toBe(false)
		expect(store.docs.get(targetKey)?.contradictions).toEqual([
			historicalContradiction,
		])
	})

	it("skips a superseded target without invoking the LLM or mutating it", async () => {
		const store = makeStore()
		const h = handle(store)
		const key = store.key("sources/src/api.ts", SCOPE, SCOPE_REF)
		store.docs.set(key, {
			_id: { toString: () => "deleted-source" },
			slug: "sources/src/api.ts",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			state: "superseded",
			title: "Deleted source",
			summary: "Deleted.",
			body: "Deleted body.",
			frontmatter: { type: "source", resource: "src/api.ts" },
			claims: [],
			revision: 2,
		})
		const llmGenerate = vi.fn()

		const result = await runGitDiffMaintenance(
			h,
			[{ path: "src/api.ts", content: "new content" }],
			llmGenerate,
			{ scope: SCOPE, scopeRef: SCOPE_REF },
		)

		expect(result.pagesProcessed).toBe(1)
		expect(result.pagesRegenerated).toBe(0)
		expect(result.errors).toEqual([])
		expect(llmGenerate).not.toHaveBeenCalled()
		expect(store.docs.get(key)).toMatchObject({
			state: "superseded",
			title: "Deleted source",
			revision: 2,
		})
	})
})

/** Fake LLM classifier: defaults to "new" with one claim per event
 *  (per-claim confidence 0.85, distinct from the old hardcoded 0.7). */
function fakeClassifier(
	overrides?: (input: {
		event: { id: string; text: string }
		existingPage: unknown
	}) => Partial<DreamerClassification>,
): DreamerClassifier {
	return async ({ event, existingPage }) => ({
		injection: "new",
		claims: [{ text: event.text, confidence: 0.85 }],
		...(overrides?.({ event, existingPage }) ?? {}),
	})
}

describe("runDreamerPromotion", () => {
	it("fails closed without a classifier (P5: no silent heuristic default)", async () => {
		const store = makeStore()
		const h = handle(store)
		await expect(
			runDreamerPromotion(h, [{ id: "evt-1", text: "something" }], {
				scope: SCOPE,
				scopeRef: SCOPE_REF,
			}),
		).rejects.toBeInstanceOf(MaintenanceLlmUnconfiguredError)
		expect(store.docs.size).toBe(0)
	})

	it("promotes events to wiki pages with claims (LLM path)", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[
				{ id: "evt-1", text: "The user prefers dark mode", agentId: "agent-1" },
				{ id: "evt-2", text: "The API uses GraphQL", agentId: "agent-1" },
			],
			{ scope: SCOPE, scopeRef: SCOPE_REF, classifier: fakeClassifier() },
		)
		expect(result.pagesRegenerated).toBe(2)
		expect(result.claimsAdded).toBe(2)
		expect(result.errors).toHaveLength(0)
		expect(result.extractionMode).toBe("llm")
		// Verify pages were created with per-claim confidence + provenance.
		const page1 = store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
		expect(page1).toBeDefined()
		expect(page1?.claims).toHaveLength(1)
		expect(page1?.claims?.[0]).toMatchObject({
			text: "The user prefers dark mode",
			confidence: 0.85,
			evidence: [{ kind: "event", sourceId: "evt-1" }],
		})
		expect(page1?.lastMaintenanceSource).toBe("dreamer")
	})

	it("heuristic importer is an explicit opt-in, disclosed via extractionMode", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "The user prefers dark mode" }],
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				importer: "heuristic-importer",
			},
		)
		expect(result.extractionMode).toBe("heuristic-importer")
		expect(result.claimsAdded).toBe(1)
		const page = store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
		expect(page?.claims?.[0]).toMatchObject({
			text: "The user prefers dark mode",
			confidence: 0.7,
			evidence: [{ kind: "event", sourceId: "evt-1" }],
		})
	})

	it("ignore classification contributes nothing and counts as rejected", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "chit-chat with no durable facts" }],
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				classifier: fakeClassifier(() => ({ injection: "ignore", claims: [] })),
			},
		)
		expect(result.pagesRegenerated).toBe(0)
		expect(result.claimsAdded).toBe(0)
		expect(result.claimsRejected).toBe(1)
		expect(store.docs.size).toBe(0)
	})

	it("contradiction classification routes to the update path and is counted", async () => {
		const store = makeStore()
		const h = handle(store)
		// Seed an existing page the event contradicts.
		store.docs.set(store.key("events/evt-1", SCOPE, SCOPE_REF), {
			_id: { toString: () => "1" },
			slug: "events/evt-1",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Event evt-1",
			summary: "Old event.",
			body: "",
			frontmatter: { type: "entity" },
			claims: [
				{ id: "c-old", text: "The user prefers light mode", status: "active" },
			],
			revision: 1,
		})
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "The user now prefers dark mode" }],
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				classifier: fakeClassifier(() => ({
					injection: "contradiction",
					claims: [{ text: "The user now prefers dark mode", confidence: 0.9 }],
				})),
			},
		)
		expect(result.contradictionsDetected).toBe(1)
		expect(result.claimsAdded).toBe(1)
		// Updated the existing page, not created a second one.
		expect(store.docs.size).toBe(1)
	})

	it("invalid classifier output lands in errors without touching the store", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "The user prefers dark mode" }],
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				classifier: fakeClassifier(() => ({
					injection: "new" as const,
					claims: [{ text: "x", confidence: 1.5 }],
				})),
			},
		)
		expect(result.errors).toHaveLength(1)
		expect(result.errors[0]).toContain("confidence outside")
		expect(store.docs.size).toBe(0)
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
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				classifier: fakeClassifier(() => ({ injection: "update" })),
			},
		)
		expect(result.claimsAdded).toBe(1)
		// The old claim should still be there — the page was updated, not replaced.
		const page = store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
		expect(
			(page?.claims as Array<{ id: string }> | undefined)?.some(
				(c) => c.id === "c-old",
			),
		).toBe(true)
	})

	it("skips empty events", async () => {
		const store = makeStore()
		const h = handle(store)
		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-empty", text: "" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF, classifier: fakeClassifier() },
		)
		expect(result.pagesRegenerated).toBe(0)
		expect(result.claimsAdded).toBe(0)
	})

	it("skips a superseded fallback target without classifying or mutating it", async () => {
		const store = makeStore()
		const h = handle(store)
		const key = store.key("events/evt-1", SCOPE, SCOPE_REF)
		store.docs.set(key, {
			_id: { toString: () => "deleted-event" },
			slug: "events/evt-1",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			state: "superseded",
			title: "Deleted event",
			summary: "Deleted.",
			body: "Deleted body.",
			frontmatter: { type: "entity" },
			claims: [],
			revision: 2,
		})
		const classifier = vi.fn(fakeClassifier())

		const result = await runDreamerPromotion(
			h,
			[{ id: "evt-1", text: "New event text" }],
			{ scope: SCOPE, scopeRef: SCOPE_REF, classifier },
		)

		expect(result.pagesProcessed).toBe(1)
		expect(result.pagesRegenerated).toBe(0)
		expect(result.errors).toEqual([])
		expect(classifier).not.toHaveBeenCalled()
		expect(store.docs.get(key)).toMatchObject({
			state: "superseded",
			title: "Deleted event",
			revision: 2,
		})
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
			{ scope: SCOPE, scopeRef: SCOPE_REF, classifier: fakeClassifier() },
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
			{ scope: SCOPE, scopeRef: SCOPE_REF, classifier: fakeClassifier() },
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
			{ scope: SCOPE, scopeRef: SCOPE_REF, classifier: fakeClassifier() },
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

	it("is idempotent: re-running the same event does not duplicate claims", async () => {
		const store = makeStore()
		const h = handle(store)
		const events = [{ id: "evt-1", text: "The user prefers dark mode" }]
		const opts = {
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			classifier: fakeClassifier(),
		}
		await runDreamerPromotion(h, events, opts)
		const first = store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
		expect(first?.claims).toHaveLength(1)
		const second = await runDreamerPromotion(h, events, opts)
		// The second run's identical claim is deduped by the pipeline gate
		// (near-duplicate detection inside updateWikiPage), never appended.
		const page = store.docs.get(store.key("events/evt-1", SCOPE, SCOPE_REF))
		expect(page?.claims).toHaveLength(1)
		expect(second.claimsAdded).toBe(1)
	})
})
