// wiki-contradictions.ts tests (T12).
//
// Critical tests:
// - arXIV pipeline bug: a contradictory write is NOT rejected by dedup;
//   the contradiction is detected
// - Two conflicting claims → contradiction recorded with both claimIds
// - Dedup gate rejects near-duplicates (but AFTER contradiction detection)
// - listUnresolvedContradictions for wiki_lint
// - resolveContradiction updates the resolution state

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	hasNegation,
	textOverlap,
	areContradictory,
	checkNearDuplicate,
	runWritePipelineGate,
	listUnresolvedContradictions,
	resolveContradiction,
	type ClaimRecord,
} from "./wiki-contradictions.js"
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
		updateOne: vi.fn(async (filter: Document, update: Document) => {
			const k = store.key(filter.slug, filter.scope, filter.scopeRef)
			const existing = store.docs.get(k)
			if (!existing) return { matchedCount: 0, modifiedCount: 0 }
			if (update.$push) {
				const field = Object.keys(update.$push)[0]
				existing[field] = [...(existing[field] ?? []), update.$push[field]]
			}
			if (update.$set) {
				// Handle dot notation including MongoDB positional $ operator.
				for (const [k2, v] of Object.entries(update.$set)) {
					if (k2.includes(".")) {
						const parts = k2.split(".")
						if (parts[1] === "$") {
							// Positional operator: find the array element matching the filter.
							const arr = existing[parts[0]] as Array<Record<string, unknown>>
							const filterKey = `${parts[0]}.id`
							const matchId = filter[filterKey] ?? filter[`${parts[0]}.id`]
							const elem = arr.find((e) => e.id === matchId)
							if (elem) elem[parts[2]] = v
						} else {
							let current: Record<string, unknown> = existing
							for (let i = 0; i < parts.length - 1; i++) {
								current = current[parts[i]] as Record<string, unknown>
							}
							current[parts[parts.length - 1]] = v
						}
					} else {
						existing[k2] = v
					}
				}
			}
			return { matchedCount: 1, modifiedCount: 1 }
		}),
		aggregate: vi.fn((pipeline: Document[]) => {
			const match = pipeline[0]?.$match
			if (!match) return { toArray: async () => [] }
			if (match["contradictions.resolution"]) {
				const results = Array.from(store.docs.values()).filter(
					(doc) =>
						doc.scope === match.scope &&
						doc.scopeRef === match.scopeRef &&
						Array.isArray(doc.contradictions) &&
						doc.contradictions.some(
							(c: Document) =>
								c.resolution === match["contradictions.resolution"],
						),
				)
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

describe("negation detection", () => {
	it("hasNegation detects negation markers", () => {
		expect(hasNegation("This is not correct")).toBe(true)
		expect(hasNegation("The API was discontinued")).toBe(true)
		expect(hasNegation("This is correct")).toBe(false)
	})

	it("textOverlap computes word-level Jaccard similarity", () => {
		expect(textOverlap("the API uses REST", "the API uses REST")).toBe(1)
		expect(
			textOverlap("the API uses REST", "the database uses SQL"),
		).toBeGreaterThan(0)
		expect(
			textOverlap("completely different text here", "totally unrelated words"),
		).toBe(0)
	})

	it("areContradictory: high overlap + one negation = contradiction", () => {
		const a: ClaimRecord = { id: "c1", text: "The API uses REST endpoints" }
		const b: ClaimRecord = {
			id: "c2",
			text: "The API does not use REST endpoints",
		}
		expect(areContradictory(a, b)).toBe(true)
	})

	it("areContradictory: same polarity + high overlap = NOT a contradiction", () => {
		const a: ClaimRecord = { id: "c1", text: "The API uses REST endpoints" }
		const b: ClaimRecord = { id: "c2", text: "The API uses REST endpoints" }
		expect(areContradictory(a, b)).toBe(false)
	})

	it("areContradictory: low overlap = NOT a contradiction", () => {
		const a: ClaimRecord = { id: "c1", text: "The API uses REST" }
		const b: ClaimRecord = { id: "c2", text: "The database is not PostgreSQL" }
		expect(areContradictory(a, b)).toBe(false)
	})
})

describe("near-duplicate gate", () => {
	it("checkNearDuplicate rejects high-similarity claims on the same page", () => {
		const existing: ClaimRecord[] = [
			{ id: "c1", text: "The API uses REST endpoints for all operations" },
		]
		const result = checkNearDuplicate(
			"The API uses REST endpoints for all operations",
			existing,
		)
		expect(result.isDuplicate).toBe(true)
		expect(result.existingClaimId).toBe("c1")
	})

	it("checkNearDuplicate passes for sufficiently different claims", () => {
		const existing: ClaimRecord[] = [
			{ id: "c1", text: "The API uses REST endpoints" },
		]
		const result = checkNearDuplicate(
			"The database runs on PostgreSQL",
			existing,
		)
		expect(result.isDuplicate).toBe(false)
	})
})

describe("arXIV pipeline bug: contradictory write NOT rejected by dedup", () => {
	it("a contradictory near-duplicate is detected, not rejected", async () => {
		const store = makeStore()
		const h = handle(store)
		// Seed page B with a positive claim.
		store.docs.set(store.key("b", SCOPE, SCOPE_REF), {
			_id: { toString: () => "id-b" },
			slug: "b",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Page B",
			claims: [
				{ id: "c-b1", text: "The API uses REST endpoints", status: "active" },
			],
			contradictions: [],
		})
		// Seed page A with a relationship to B.
		store.docs.set(store.key("a", SCOPE, SCOPE_REF), {
			_id: { toString: () => "id-a" },
			slug: "a",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Page A",
			claims: [],
			contradictions: [],
			relationships: [{ targetPageSlug: "b", kind: "relates_to" }],
		})

		// New claim on page A that contradicts B's claim AND is a near-duplicate
		// of B's claim (high text overlap). The pipeline must detect the
		// contradiction BEFORE dedup — the write should NOT be rejected.
		const newClaim: ClaimRecord = {
			id: "c-a1",
			text: "The API does not use REST endpoints",
		}
		// Existing claims on page A (same page — for dedup).
		const existingOnA: ClaimRecord[] = []

		const result = await runWritePipelineGate(
			h,
			"a",
			newClaim,
			existingOnA,
			SCOPE,
			SCOPE_REF,
		)

		// The contradiction was detected (NOT rejected by dedup).
		expect(result.rejected).toBe(false)
		expect(result.contradictions).toHaveLength(1)
		expect(result.contradictions[0].contradiction.claimIds).toContain("c-a1")
		expect(result.contradictions[0].contradiction.claimIds).toContain("c-b1")
		expect(result.contradictions[0].contradiction.resolution).toBe("unresolved")

		// The contradiction was recorded on page B.
		const pageB = store.docs.get(store.key("b", SCOPE, SCOPE_REF))!
		expect(pageB.contradictions).toHaveLength(1)
		expect(pageB.contradictions[0].claimIds).toEqual(["c-a1", "c-b1"])
	})

	it("a non-contradictory near-duplicate IS rejected by dedup", async () => {
		const store = makeStore()
		const h = handle(store)
		// Seed page A with an existing claim.
		store.docs.set(store.key("a", SCOPE, SCOPE_REF), {
			_id: { toString: () => "id-a" },
			slug: "a",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Page A",
			claims: [
				{ id: "c-a1", text: "The API uses REST endpoints", status: "active" },
			],
			contradictions: [],
		})

		// New claim that is a near-duplicate of the existing claim (same text,
		// no negation → no contradiction, just a duplicate).
		const newClaim: ClaimRecord = {
			id: "c-a2",
			text: "The API uses REST endpoints",
		}
		const existingOnA: ClaimRecord[] = [
			{ id: "c-a1", text: "The API uses REST endpoints" },
		]

		const result = await runWritePipelineGate(
			h,
			"a",
			newClaim,
			existingOnA,
			SCOPE,
			SCOPE_REF,
		)

		// No contradiction detected.
		expect(result.contradictions).toHaveLength(0)
		// Dedup rejects the near-duplicate.
		expect(result.rejected).toBe(true)
		expect(result.dedup.isDuplicate).toBe(true)
	})
})

describe("listUnresolvedContradictions (wiki_lint)", () => {
	it("lists unresolved contradictions across pages in a scope", async () => {
		const store = makeStore()
		const h = handle(store)
		store.docs.set(store.key("a", SCOPE, SCOPE_REF), {
			_id: { toString: () => "1" },
			slug: "a",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Page A",
			contradictions: [
				{
					id: "c1",
					claimIds: ["c-a1", "c-b1"],
					detectedAt: new Date(),
					resolution: "unresolved",
				},
				{
					id: "c2",
					claimIds: ["c-a2", "c-c1"],
					detectedAt: new Date(),
					resolution: "newest_wins",
				},
			],
		})
		store.docs.set(store.key("b", SCOPE, SCOPE_REF), {
			_id: { toString: () => "2" },
			slug: "b",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Page B",
			contradictions: [
				{
					id: "c3",
					claimIds: ["c-b2", "c-d1"],
					detectedAt: new Date(),
					resolution: "unresolved",
				},
			],
		})

		const result = await listUnresolvedContradictions(h, SCOPE, SCOPE_REF)
		expect(result).toHaveLength(2) // c1 (unresolved) + c3 (unresolved); c2 is resolved
		expect(result[0].pageSlug).toBe("a")
		expect(result[0].contradiction.id).toBe("c1")
		expect(result[1].pageSlug).toBe("b")
		expect(result[1].contradiction.id).toBe("c3")
	})
})

describe("resolveContradiction", () => {
	it("updates the resolution state of a contradiction", async () => {
		const store = makeStore()
		const h = handle(store)
		store.docs.set(store.key("a", SCOPE, SCOPE_REF), {
			_id: { toString: () => "1" },
			slug: "a",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			title: "Page A",
			contradictions: [
				{
					id: "c1",
					claimIds: ["c-a1", "c-b1"],
					detectedAt: new Date(),
					resolution: "unresolved",
				},
			],
		})

		const result = await resolveContradiction(
			h,
			"a",
			"c1",
			"newest_wins",
			SCOPE,
			SCOPE_REF,
			{ resolvedBy: "agent-1", note: "Newer claim is authoritative" },
		)
		expect(result).toBe(true)
		const page = store.docs.get(store.key("a", SCOPE, SCOPE_REF))!
		expect(page.contradictions[0].resolution).toBe("newest_wins")
		expect(page.contradictions[0].resolvedBy).toBe("agent-1")
		expect(page.contradictions[0].note).toBe("Newer claim is authoritative")
	})
})
