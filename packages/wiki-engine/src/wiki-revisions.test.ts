import type { Collection, Db, Document } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import {
	getWikiPageRevision,
	listWikiPageRevisions,
	recordWikiPageRevision,
} from "./wiki-revisions.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import type { GovernanceContext } from "./wiki-governance.js"

function mockCollection(): Collection {
	return {
		collectionName: "test_wiki_revisions",
		insertOne: vi.fn(async () => ({
			acknowledged: true,
			insertedId: { toString: () => "rev-1" },
		})),
		findOne: vi.fn(async () => null),
		find: vi.fn(() => ({
			sort: vi.fn(() => ({
				limit: vi.fn(() => ({ toArray: async () => [] })),
			})),
		})),
	} as unknown as Collection
}

function mockDb(): { db: Db; coll: Collection } {
	const coll = mockCollection()
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, coll }
}

describe("recordWikiPageRevision", () => {
	it("inserts a snapshot with the embedding field stripped", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await recordWikiPageRevision(h, {
			pageSlug: "tables/accounts",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			editKind: "create",
			snapshot: { slug: "tables/accounts", embedding: [1, 2, 3], title: "X" },
		})
		expect(coll.insertOne).toHaveBeenCalledTimes(1)
		const [doc] = (coll.insertOne as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0]
		expect(doc.pageSlug).toBe("tables/accounts")
		expect(doc.editKind).toBe("create")
		expect(doc.revision).toBe(1)
		expect(doc.snapshot.embedding).toBeUndefined()
		expect(doc.snapshot.title).toBe("X")
		expect(doc.createdAt).toBeInstanceOf(Date)
	})

	it("never throws — logs and swallows insertOne failures", async () => {
		const { db, coll } = mockDb()
		;(
			coll.insertOne as unknown as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("boom"))
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(
			recordWikiPageRevision(h, {
				pageSlug: "x",
				scope: "workspace",
				scopeRef: "ws-1",
				revision: 1,
				editKind: "create",
				snapshot: {},
			}),
		).resolves.toBeUndefined()
	})

	it("surfaces insert failures for atomic mutation transactions", async () => {
		const { db, coll } = mockDb()
		;(
			coll.insertOne as unknown as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("revision failed"))
		const h: WikiDbHandle = { db, prefix: "test_" }

		await expect(
			recordWikiPageRevision(
				h,
				{
					pageSlug: "x",
					scope: "workspace",
					scopeRef: "ws-1",
					revision: 1,
					editKind: "create",
					snapshot: { slug: "x" },
				},
				{ strict: true },
			),
		).rejects.toThrow("revision failed")
	})
})

describe("listWikiPageRevisions", () => {
	it("queries by page identity, sorts by revision desc, excludes snapshot", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const sortFn = vi.fn(() => ({
			limit: vi.fn(() => ({
				toArray: async () => [
					{
						pageSlug: "x",
						scope: "workspace",
						scopeRef: "ws-1",
						revision: 2,
						editKind: "update",
						createdAt: new Date("2026-01-02T00:00:00.000Z"),
					},
				],
			})),
		}))
		;(coll.find as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			sort: sortFn,
		})
		const revisions = await listWikiPageRevisions(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
		})
		expect(coll.find).toHaveBeenCalledWith(
			{ pageSlug: "x", scope: "workspace", scopeRef: "ws-1" },
			{ projection: { snapshot: 0 } },
		)
		expect(sortFn).toHaveBeenCalledWith({ revision: -1 })
		expect(revisions).toEqual([
			{
				pageSlug: "x",
				scope: "workspace",
				scopeRef: "ws-1",
				revision: 2,
				editKind: "update",
				editor: undefined,
				createdAt: "2026-01-02T00:00:00.000Z",
			},
		])
	})

	it("caps limit at 200", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const limitFn = vi.fn(() => ({ toArray: async () => [] }))
		;(coll.find as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			sort: vi.fn(() => ({ limit: limitFn })),
		})
		await listWikiPageRevisions(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			limit: 9999,
		})
		expect(limitFn).toHaveBeenCalledWith(200)
	})
})

describe("getWikiPageRevision", () => {
	it("returns undefined when not found", async () => {
		const { db } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revision = await getWikiPageRevision(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
		})
		expect(revision).toBeUndefined()
	})

	it("returns the full snapshot when found", async () => {
		const { db, coll } = mockDb()
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			editKind: "create",
			snapshot: { title: "X", body: "content" },
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
		} as Document)
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revision = await getWikiPageRevision(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
		})
		expect(revision?.snapshot).toEqual({ title: "X", body: "content" })
		expect(revision?.createdAt).toBe("2026-01-01T00:00:00.000Z")
	})
})

// ---------------------------------------------------------------------------
// Governed reads — per-revision snapshot metadata, not current-page state.
// WS-5 item 5: a page that was later restricted or hard-deleted must not
// hide its earlier history from readers who could see those revisions, and
// must not leak them to readers who could not.
// ---------------------------------------------------------------------------

const GOVERNED_CTX: GovernanceContext = {
	scope: "workspace",
	scopeRef: "ws-1",
	subjectId: "api-key:me",
	groups: [],
	trustTier: "standard",
	roles: [],
	departments: [],
	capabilities: ["read", "write"],
}

describe("listWikiPageRevisions (governed)", () => {
	it("authorizes each revision against its own snapshot, not the current page", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(coll.find as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			sort: vi.fn(() => ({
				limit: vi.fn(() => ({
					toArray: async () => [
						{
							// Restricted AFTER this caller's access — but the
							// snapshot at revision 2 was open; revision 2 stays
							// visible.
							pageSlug: "x",
							scope: "workspace",
							scopeRef: "ws-1",
							revision: 2,
							editKind: "update",
							createdAt: new Date("2026-01-02T00:00:00.000Z"),
							snapshot: {
								slug: "x",
								scope: "workspace",
								scopeRef: "ws-1",
								permissions: {},
							},
						},
						{
							// Written while restricted to another subject —
							// hidden from this caller even though the page is
							// now open.
							pageSlug: "x",
							scope: "workspace",
							scopeRef: "ws-1",
							revision: 1,
							editKind: "create",
							createdAt: new Date("2026-01-01T00:00:00.000Z"),
							snapshot: {
								slug: "x",
								scope: "workspace",
								scopeRef: "ws-1",
								permissions: {
									allowedSubjects: ["api-key:someone-else"],
								},
							},
						},
					],
				})),
			})),
		})
		const revisions = await listWikiPageRevisions(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			governance: GOVERNED_CTX,
		})
		// Only the revision whose own snapshot permits this caller survives —
		// and no pages-collection read ever happens (the current page state,
		// including hard deletion, is irrelevant).
		expect(revisions.map((r) => r.revision)).toEqual([2])
	})

	it("returns [] when no revision's snapshot permits the caller", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(coll.find as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			sort: vi.fn(() => ({
				limit: vi.fn(() => ({
					toArray: async () => [
						{
							pageSlug: "x",
							scope: "workspace",
							scopeRef: "ws-1",
							revision: 1,
							editKind: "create",
							createdAt: new Date("2026-01-01T00:00:00.000Z"),
							snapshot: {
								slug: "x",
								scope: "workspace",
								scopeRef: "ws-1",
								permissions: {
									allowedSubjects: ["api-key:someone-else"],
								},
							},
						},
					],
				})),
			})),
		})
		const revisions = await listWikiPageRevisions(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			governance: GOVERNED_CTX,
		})
		expect(revisions).toEqual([])
	})
})

describe("getWikiPageRevision (governed)", () => {
	it("returns a revision whose snapshot permits the caller, even if the current page is gone", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 3,
			editKind: "delete", // the hard-delete revision itself
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			snapshot: {
				slug: "x",
				scope: "workspace",
				scopeRef: "ws-1",
				permissions: {},
			},
		} as Document)
		const revision = await getWikiPageRevision(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 3,
			governance: GOVERNED_CTX,
		})
		expect(revision?.revision).toBe(3)
		expect(revision?.editKind).toBe("delete")
	})

	it("returns undefined when the revision's own snapshot denies the caller", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			editKind: "create",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			snapshot: {
				slug: "x",
				scope: "workspace",
				scopeRef: "ws-1",
				permissions: { allowedSubjects: ["api-key:someone-else"] },
			},
		} as Document)
		const revision = await getWikiPageRevision(h, {
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			governance: GOVERNED_CTX,
		})
		expect(revision).toBeUndefined()
	})
})
