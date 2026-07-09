// wiki-governance.ts tests (T10).
//
// Critical tests:
// - Cross-scope leak prevention (the arXiv GET-by-id bug)
// - Trust-tier propagation (restricted/standard/admin)
// - permissions.allowedRoles + allowedDepartments + privacyTier filtering
// - Supersession audit trail (claims retained with state="superseded")

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	buildScopeFilter,
	buildPermissionsFilter,
	buildGovernanceFilter,
	canPropagateCrossScope,
	getWikiPageGoverned,
	getWikiPageByIdGoverned,
	filterPagesByGovernance,
	type GovernanceContext,
} from "./wiki-governance.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

function mockDb(docs: Document[]): { db: Db; coll: Collection } {
	const coll = {
		findOne: vi.fn(async (filter: Document) => {
			for (const doc of docs) {
				if (matchesFilter(doc, filter)) return doc
			}
			return null
		}),
		aggregate: vi.fn((pipeline: Document[]) => {
			// Emulate $match → $unwind → $match → $count for superseded claims.
			let results = [...docs]
			for (const stage of pipeline) {
				if (stage.$match) {
					if (stage.$match["claims.status"]) {
						results = results
							.flatMap((d) =>
								(d.claims ?? []).map((c: Document) => ({ ...d, claims: [c] })),
							)
							.filter(
								(d) => d.claims[0]?.status === stage.$match["claims.status"],
							)
					} else {
						results = results.filter((d) => matchesFilter(d, stage.$match))
					}
				}
				if (stage.$unwind) {
					const field = stage.$unwind.slice(1)
					results = results.flatMap((d) =>
						(d[field] ?? []).map((item: Document) => ({
							...d,
							[field]: [item],
						})),
					)
				}
				if (stage.$count) {
					return { toArray: async () => [{ [stage.$count]: results.length }] }
				}
			}
			return { toArray: async () => results }
		}),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, coll }
}

function matchesFilter(doc: Document, filter: Document): boolean {
	for (const [key, value] of Object.entries(filter)) {
		if (key === "$and") {
			return (value as Document[]).every((f) => matchesFilter(doc, f))
		}
		if (key === "$or") {
			return (value as Document[]).some((f) => matchesFilter(doc, f))
		}
		if (key === "_id") {
			if (doc._id?.toString() !== value?.toString()) return false
			continue
		}
		// Handle dot notation (e.g. "permissions.privacyTier")
		const parts = key.split(".")
		let current: unknown = doc
		for (const p of parts) {
			current = (current as Record<string, unknown>)?.[p]
		}
		if (value && typeof value === "object" && !Array.isArray(value)) {
			if (value.$exists !== undefined) {
				const exists = current !== undefined
				if (value.$exists !== exists) return false
				continue
			}
			if (value.$in) {
				// MongoDB $in: if the field is an array, checks if any element is in $in.
				if (Array.isArray(current)) {
					if (!current.some((item) => value.$in.includes(item))) return false
				} else {
					if (!value.$in.includes(current)) return false
				}
				continue
			}
			if (value.$size !== undefined) {
				if (Array.isArray(current) && current.length !== value.$size)
					return false
				continue
			}
		}
		if (current !== value) return false
	}
	return true
}

function handle(docs: Document[]): WikiDbHandle {
	const { db } = mockDb(docs)
	return { db, prefix: "test_" }
}

const SCOPE_A = "workspace"
const SCOPE_A_REF = "ws-a"
const SCOPE_B = "workspace"
const SCOPE_B_REF = "ws-b"

const PAGE_A = {
	_id: { toString: () => "id-a" },
	slug: "page-a",
	scope: SCOPE_A,
	scopeRef: SCOPE_A_REF,
	title: "Page A",
	permissions: {},
	claims: [],
}

const PAGE_B = {
	_id: { toString: () => "id-b" },
	slug: "page-b",
	scope: SCOPE_B,
	scopeRef: SCOPE_B_REF,
	title: "Page B",
	permissions: {},
	claims: [],
}

const RESTRICTED_PAGE = {
	_id: { toString: (): string => "id-r" },
	slug: "page-restricted",
	scope: SCOPE_A,
	scopeRef: SCOPE_A_REF,
	title: "Restricted Page",
	permissions: {
		privacyTier: "restricted",
		allowedRoles: ["admin-role", "finance"],
		allowedDepartments: ["finance"],
	},
	claims: [],
}

describe("buildScopeFilter", () => {
	it("enforces scope + scopeRef for standard requesters", () => {
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
		}
		const filter = buildScopeFilter(ctx)
		expect(filter).toEqual({ scope: SCOPE_A, scopeRef: SCOPE_A_REF })
	})

	it("bypasses scope for admin with crossScope override", () => {
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "admin",
		}
		const filter = buildScopeFilter(ctx, { crossScope: true })
		expect(filter).toEqual({})
	})

	it("does NOT bypass for standard even with crossScope flag", () => {
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
		}
		const filter = buildScopeFilter(ctx, { crossScope: true })
		expect(filter).toEqual({ scope: SCOPE_A, scopeRef: SCOPE_A_REF })
	})
})

describe("buildPermissionsFilter", () => {
	it("admin gets an empty filter (sees everything)", () => {
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "admin",
		}
		const filter = buildPermissionsFilter(ctx)
		expect(filter).toEqual({})
	})

	it("standard without roles gets a permissions filter", () => {
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
		}
		const filter = buildPermissionsFilter(ctx)
		expect(filter.$or).toBeDefined()
	})
})

describe("buildGovernanceFilter", () => {
	it("combines scope + permissions for standard requester", () => {
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
			roles: ["eng"],
		}
		const filter = buildGovernanceFilter(ctx)
		expect(filter.$and).toBeDefined()
		expect(filter.$and).toHaveLength(2)
	})
})

describe("cross-scope leak prevention (arXiv GET-by-id bug)", () => {
	it("getWikiPageGoverned: scope A user cannot read scope B's page by slug", async () => {
		const h = handle([PAGE_A, PAGE_B])
		const ctxB: GovernanceContext = {
			scope: SCOPE_B,
			scopeRef: SCOPE_B_REF,
			trustTier: "standard",
		}
		// Try to read PAGE_A (in scope A) from scope B.
		const result = await getWikiPageGoverned(h, "page-a", ctxB)
		expect(result).toBeNull()
	})

	it("getWikiPageByIdGoverned: scope A user cannot read scope B's page by _id", async () => {
		const h = handle([PAGE_A, PAGE_B])
		const ctxB: GovernanceContext = {
			scope: SCOPE_B,
			scopeRef: SCOPE_B_REF,
			trustTier: "standard",
		}
		// Try to read PAGE_A by _id from scope B — the arXiv leak path.
		const result = await getWikiPageByIdGoverned(h, "id-a", ctxB)
		expect(result).toBeNull()
	})

	it("getWikiPageByIdGoverned: scope A user CAN read their own page by _id", async () => {
		const h = handle([PAGE_A, PAGE_B])
		const ctxA: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
		}
		const result = await getWikiPageByIdGoverned(h, "id-a", ctxA)
		expect(result).not.toBeNull()
		expect(result?.slug).toBe("page-a")
	})

	it("admin with crossScope can read across scopes by _id", async () => {
		const h = handle([PAGE_A, PAGE_B])
		const ctxAdmin: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "admin",
		}
		const result = await getWikiPageByIdGoverned(h, "id-b", ctxAdmin, {
			crossScope: true,
		})
		// Admin with crossScope override bypasses scope filter.
		expect(result).not.toBeNull()
		expect(result?.slug).toBe("page-b")
	})

	it("filterPagesByGovernance: cross-scope pages are filtered out", () => {
		const ctxA: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
		}
		const filtered = filterPagesByGovernance([PAGE_A, PAGE_B], ctxA)
		expect(filtered).toHaveLength(1)
		expect(filtered[0].slug).toBe("page-a")
	})
})

describe("permissions filtering", () => {
	it("restricted page is visible to a user with matching role", async () => {
		const h = handle([RESTRICTED_PAGE])
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
			roles: ["finance"],
		}
		const result = await getWikiPageGoverned(h, "page-restricted", ctx)
		expect(result).not.toBeNull()
	})

	it("restricted page is NOT visible to a user without matching role", async () => {
		const h = handle([RESTRICTED_PAGE])
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
			roles: ["engineering"],
		}
		const result = await getWikiPageGoverned(h, "page-restricted", ctx)
		expect(result).toBeNull()
	})

	it("admin sees restricted pages regardless of role", async () => {
		const h = handle([RESTRICTED_PAGE])
		const ctx: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "admin",
		}
		const result = await getWikiPageGoverned(h, "page-restricted", ctx)
		expect(result).not.toBeNull()
	})

	it("filterPagesByGovernance: restricted page filtered by role", () => {
		const ctxWithoutRole: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "standard",
			roles: ["engineering"],
		}
		const filtered = filterPagesByGovernance([RESTRICTED_PAGE], ctxWithoutRole)
		expect(filtered).toHaveLength(0)
	})
})

describe("trust-tier propagation", () => {
	it("restricted writer: claims do NOT propagate cross-scope", () => {
		expect(canPropagateCrossScope("restricted", "standard", "public")).toBe(
			false,
		)
	})

	it("standard writer: claims propagate cross-scope only if public/internal", () => {
		expect(canPropagateCrossScope("standard", "standard", "public")).toBe(true)
		expect(canPropagateCrossScope("standard", "standard", "internal")).toBe(
			true,
		)
		expect(canPropagateCrossScope("standard", "standard", "restricted")).toBe(
			false,
		)
	})

	it("admin writer: claims propagate cross-scope", () => {
		expect(canPropagateCrossScope("admin", "standard", "restricted")).toBe(true)
	})

	it("admin reader: always sees cross-scope", () => {
		expect(canPropagateCrossScope("restricted", "admin", "public")).toBe(true)
	})

	it("restricted reader: NEVER sees cross-scope, even from admin writer", () => {
		expect(canPropagateCrossScope("admin", "restricted", "public")).toBe(false)
		expect(canPropagateCrossScope("standard", "restricted", "public")).toBe(
			false,
		)
		expect(canPropagateCrossScope("admin", "restricted", "restricted")).toBe(
			false,
		)
	})
})

describe("filterPagesByGovernance crossScope option", () => {
	it("admin without crossScope does NOT see cross-scope pages", () => {
		const ctxAdmin: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "admin",
		}
		const filtered = filterPagesByGovernance([PAGE_A, PAGE_B], ctxAdmin)
		expect(filtered).toHaveLength(1)
		expect(filtered[0].slug).toBe("page-a")
	})

	it("admin with crossScope sees all pages", () => {
		const ctxAdmin: GovernanceContext = {
			scope: SCOPE_A,
			scopeRef: SCOPE_A_REF,
			trustTier: "admin",
		}
		const filtered = filterPagesByGovernance([PAGE_A, PAGE_B], ctxAdmin, {
			crossScope: true,
		})
		expect(filtered).toHaveLength(2)
	})
})

describe("supersession audit trail", () => {
	it("countSupersededClaims counts claims with status=superseded", async () => {
		const h = handle([
			{
				_id: { toString: () => "1" },
				slug: "p1",
				scope: SCOPE_A,
				scopeRef: SCOPE_A_REF,
				claims: [
					{ id: "c1", status: "active", text: "active claim" },
					{ id: "c2", status: "superseded", text: "old claim" },
				],
			},
			{
				_id: { toString: () => "2" },
				slug: "p2",
				scope: SCOPE_A,
				scopeRef: SCOPE_A_REF,
				claims: [{ id: "c3", status: "superseded", text: "another old claim" }],
			},
		])
		const count = await (
			await import("./wiki-governance.js")
		).countSupersededClaims(h, SCOPE_A, SCOPE_A_REF)
		expect(count).toBe(2)
	})
})
