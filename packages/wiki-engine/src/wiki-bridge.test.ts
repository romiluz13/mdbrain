// wiki-bridge.ts + wiki-renderer.ts unit tests.
//
// Mocks the MongoDB collection (same pattern as wiki-schema.test.ts) so the
// bridge→collection behaviors are tested without a live DB: create (with embed
// hook), get, list, update (revision bump + questions normalization), delete
// (soft vs hard), duplicate-slug mapping, and renderer markdown/HTML output.

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock method assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import {
	createWikiPage,
	getWikiPage,
	listWikiPages,
	updateWikiPage,
	deleteWikiPage,
	WikiDuplicateSlugError,
	WikiRevisionConflictError,
	type WikiDbHandle,
	type WikiPageView,
} from "./wiki-bridge.js"
import { renderWikiPageMarkdown, renderWikiPageHtml } from "./wiki-renderer.js"

function mockCollection(): Collection {
	return {
		collectionName: "test_wiki_pages",
		insertOne: vi.fn(async (_doc: Document) => ({
			acknowledged: true,
			insertedId: {
				toString: () => "id-" + Math.random().toString(36).slice(2),
			},
		})),
		findOne: vi.fn(async () => null),
		find: vi.fn(() => ({
			sort: vi.fn(() => ({
				skip: vi.fn(() => ({
					limit: vi.fn(() => ({ toArray: async () => [] })),
				})),
			})),
		})),
		countDocuments: vi.fn(async () => 0),
		findOneAndUpdate: vi.fn(async () => null),
		findOneAndDelete: vi.fn(async () => null),
		updateOne: vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
		deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
		aggregate: vi.fn(() => ({ toArray: async () => [] })),
	} as unknown as Collection
}

function mockDb(): { db: Db; coll: Collection } {
	const coll = mockCollection()
	const db = {
		collection: vi.fn(() => coll),
	} as unknown as Db
	return { db, coll }
}

function handle(): WikiDbHandle {
	const { db } = mockDb()
	return { db, prefix: "test_" }
}

const VALID_INPUT = {
	kind: "concept" as const,
	title: "Accounts Table",
	slug: "tables/accounts",
	summary: "The accounts table holds customer balance data.",
	body: "## Schema",
	frontmatter: { type: "table", tags: ["finance"] },
	scope: "workspace" as const,
	scopeRef: "ws-1",
	trustTier: "standard" as const,
}

describe("createWikiPage", () => {
	it("inserts a normalized document and returns a view", async () => {
		const h = handle()
		const page = await createWikiPage(h, VALID_INPUT)
		expect(page.slug).toBe("tables/accounts")
		expect(page.state).toBe("active")
		expect(page.revision).toBe(1)
		expect(page.freshness).toBe("fresh")
		const inserted = (
			h as unknown as { db: { collection: ReturnType<typeof vi.fn> } }
		).db.collection.mock.calls[0]
		void inserted
	})

	it("sets the text field = title + summary + body for auto-embedding", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await createWikiPage(h, VALID_INPUT)
		const doc = (coll.insertOne as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0][0]
		expect(doc.text).toContain(VALID_INPUT.title)
		expect(doc.text).toContain(VALID_INPUT.summary)
		expect(doc.text).toContain(VALID_INPUT.body)
	})

	it("strips text + embedding from the API view", async () => {
		const h = handle()
		const page = await createWikiPage(h, VALID_INPUT)
		expect(page).not.toHaveProperty("text")
		expect(page).not.toHaveProperty("embedding")
	})

	it("generates and stores an embedding when an embed hook is provided", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const embed = vi.fn(async (text: string) => [text.length, 0.5])
		await createWikiPage(h, VALID_INPUT, { embed })
		expect(embed).toHaveBeenCalledTimes(1)
		// embed receives summary + body
		expect(embed.mock.calls[0][0]).toContain("accounts table holds")
		expect(embed.mock.calls[0][0]).toContain("## Schema")
		const doc = (coll.insertOne as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0][0]
		expect(doc.embedding).toEqual([expect.any(Number), 0.5])
	})

	it("leaves embedding undefined when no embed hook is provided", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await createWikiPage(h, VALID_INPUT)
		const doc = (coll.insertOne as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0][0]
		expect(doc.embedding).toBeUndefined()
	})

	it("records a revision entry with editKind=create and revision=1", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		await createWikiPage(h, VALID_INPUT)
		expect(revisionsColl.insertOne).toHaveBeenCalledTimes(1)
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(revisionDoc.editKind).toBe("create")
		expect(revisionDoc.revision).toBe(1)
		expect(revisionDoc.pageSlug).toBe("tables/accounts")
	})

	it("records the ACTUAL principal as editor on create (overrides sourceAgent)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		await createWikiPage(h, VALID_INPUT, {
			editor: { id: "api-key:ops", name: "Ops Key" },
		})
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(revisionDoc.editor).toEqual({ id: "api-key:ops", name: "Ops Key" })
	})

	it("throws WikiDuplicateSlugError on E11000", async () => {
		const { db, coll } = mockDb()
		;(
			coll.insertOne as unknown as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error("E11000 duplicate key error"))
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(createWikiPage(h, VALID_INPUT)).rejects.toBeInstanceOf(
			WikiDuplicateSlugError,
		)
	})
})

describe("getWikiPage", () => {
	it("queries by slug+scope+scopeRef and returns undefined when absent", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const page = await getWikiPage(h, "x", "workspace", "ws-1")
		expect(page).toBeUndefined()
		expect(coll.findOne).toHaveBeenCalledWith(
			{
				slug: "x",
				scope: "workspace",
				scopeRef: "ws-1",
			},
			undefined,
		)
	})
})

describe("listWikiPages", () => {
	it("builds a filter and caps limit at 100", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await listWikiPages(h, { kind: "concept", limit: 500 })
		expect(coll.find).toHaveBeenCalledWith({
			kind: "concept",
			state: { $ne: "superseded" },
		})
		// find().sort().skip().limit() chain — verify countDocuments filter too
		expect(coll.countDocuments).toHaveBeenCalledWith({
			kind: "concept",
			state: { $ne: "superseded" },
		})
	})
})

describe("updateWikiPage", () => {
	it("bumps revision via $inc and sets updatedAt", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await updateWikiPage(h, "x", "workspace", "ws-1", { summary: "new" })
		const [filter, update] = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(filter).toEqual({ slug: "x", scope: "workspace", scopeRef: "ws-1" })
		expect(update.$inc).toEqual({ revision: 1 })
		expect(update.$set.updatedAt).toBeInstanceOf(Date)
		expect(update.$set.summary).toBe("new")
	})

	it("records a revision entry with editKind=update after a successful update", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			_id: { toString: () => "id-x" },
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 3,
			summary: "new",
		})
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		await updateWikiPage(h, "x", "workspace", "ws-1", { summary: "new" })
		expect(revisionsColl.insertOne).toHaveBeenCalledTimes(1)
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(revisionDoc.editKind).toBe("update")
		expect(revisionDoc.revision).toBe(3)
		expect(revisionDoc.snapshot.summary).toBe("new")
	})

	it("normalizes patched questions (adds status + createdAt)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await updateWikiPage(h, "x", "workspace", "ws-1", {
			questions: [{ id: "q1", text: "What is the balance?" }],
		})
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		const q = update.$set.questions[0]
		expect(q.status).toBe("open")
		expect(q.createdAt).toBeInstanceOf(Date)
	})

	it("preserves existing question status/createdAt/answeredByClaimId across a re-submitted patch (WS-5 item 4)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const originalCreatedAt = new Date("2026-01-01T00:00:00.000Z")
		// The old page already has q1 answered; the patch re-submits the
		// questions array read from the page WITHOUT status/answeredByClaimId
		// (read-modify-write) — those fields must survive, not reset.
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 3,
			claims: [],
			relationships: [],
			questions: [
				{
					id: "q1",
					text: "Who owns this?",
					status: "answered",
					createdAt: originalCreatedAt,
					answeredByClaimId: "c9",
				},
			],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", {
			questions: [
				{ id: "q1", text: "Who owns this?" },
				{ id: "q2", text: "A brand new question?" },
			],
		})
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		const [q1, q2] = update.$set.questions
		// Existing question: status/createdAt/answeredByClaimId preserved.
		expect(q1.status).toBe("answered")
		expect(q1.createdAt).toBe(originalCreatedAt)
		expect(q1.answeredByClaimId).toBe("c9")
		// Explicit patch values still win over the stored ones.
		expect(q1.text).toBe("Who owns this?")
		// Novel question: create-path defaults apply.
		expect(q2.status).toBe("open")
		expect(q2.createdAt).toBeInstanceOf(Date)
		expect(q2.answeredByClaimId).toBeUndefined()
	})

	it("lets an explicit patch override a preserved question status", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 1,
			claims: [],
			relationships: [],
			questions: [{ id: "q1", text: "Who owns this?", status: "open" }],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", {
			questions: [{ id: "q1", text: "Who owns this?", status: "answered" }],
		})
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		expect(update.$set.questions[0].status).toBe("answered")
	})

	it("recomputes text field when title/summary/body is patched", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		// Mock findOne to return an existing page with old title/body.
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			title: "Old Title",
			summary: "old summary",
			body: "old body",
			claims: [],
			relationships: [],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", {
			summary: "new summary",
		})
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		// text must be recomputed from old title + new summary + old body
		expect(update.$set.text).toContain("Old Title")
		expect(update.$set.text).toContain("new summary")
		expect(update.$set.text).toContain("old body")
		expect(update.$set.text).not.toContain("old summary")
	})

	it("updateWikiPage preserves existing claims when adding new ones (no data loss)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		// Mock findOne to return an existing page with one claim.
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			claims: [
				{
					id: "c-existing",
					text: "Existing claim",
					status: "active",
					evidence: [{ kind: "event", ref: "event-1", capturedAt: new Date() }],
					writerAgent: { id: "agent-1", name: "Agent" },
					derivedFrom: ["source-1"],
					supersedesClaimId: "claim-0",
					sourceMemId: "memory-1",
				},
			],
			relationships: [],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", {
			claims: [{ id: "c-new", text: "New claim about something else" }],
		})
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		// The final claims array should include BOTH the existing claim and the new one.
		const claimIds = update.$set.claims.map((c: { id: string }) => c.id)
		expect(claimIds).toContain("c-existing")
		expect(claimIds).toContain("c-new")
		expect(update.$set.claims[0]).toMatchObject({
			evidence: [expect.objectContaining({ ref: "event-1" })],
			writerAgent: { id: "agent-1", name: "Agent" },
			derivedFrom: ["source-1"],
			supersedesClaimId: "claim-0",
			sourceMemId: "memory-1",
		})
	})

	it("updateWikiPage with empty claims array clears all claims", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			claims: [{ id: "c1", text: "old", status: "active" }],
			relationships: [],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", { claims: [] })
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		expect(update.$set.claims).toEqual([])
	})

	it("pins the observed revision in the update filter (compare-and-swap)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			title: "Old Title",
			revision: 4,
			claims: [],
			relationships: [],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", { summary: "new" })
		const [filter] = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(filter).toEqual({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 4,
		})
	})

	it("throws WikiRevisionConflictError when the revision moved (stale-read RMW)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const findOne = coll.findOne as unknown as ReturnType<typeof vi.fn>
		// First read: the page as this update was built against (revision 4).
		findOne.mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 4,
			claims: [],
			relationships: [],
		})
		// findOneAndUpdate misses (a concurrent writer bumped the revision),
		// and the follow-up existence probe finds the page still there.
		findOne.mockResolvedValueOnce({ _id: 1 })
		await expect(
			updateWikiPage(h, "x", "workspace", "ws-1", { summary: "stale merge" }),
		).rejects.toBeInstanceOf(WikiRevisionConflictError)
	})

	it("returns undefined (not a conflict) when the page vanished entirely", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const findOne = coll.findOne as unknown as ReturnType<typeof vi.fn>
		findOne.mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 4,
			claims: [],
			relationships: [],
		})
		findOne.mockResolvedValueOnce(null) // existence probe: gone
		const result = await updateWikiPage(h, "x", "workspace", "ws-1", {
			summary: "late",
		})
		expect(result).toBeUndefined()
	})

	it("upserts patch claims BY ID — a matching id replaces, never duplicates", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			claims: [
				{ id: "c1", text: "Original text", status: "active", confidence: 0.5 },
				{ id: "c2", text: "Kept claim", status: "active", confidence: 0.5 },
			],
			relationships: [],
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", {
			claims: [
				{ id: "c1", text: "Corrected text" },
				{ id: "c3", text: "Novel claim" },
			],
		})
		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		const ids = update.$set.claims.map((c: { id: string }) => c.id)
		expect(ids).toEqual(["c1", "c2", "c3"]) // no duplicate c1
		const c1 = update.$set.claims.find((c: { id: string }) => c.id === "c1")
		expect(c1.text).toBe("Corrected text") // replaced in place
	})

	it("records the ACTUAL calling principal as the revision editor", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			_id: { toString: () => "id-x" },
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 7,
			// A payload-supplied sourceAgent that must NOT be misattributed as
			// the editor when a real principal is supplied.
			sourceAgent: { id: "agent-from-body", name: "Spoofed" },
		})
		await updateWikiPage(
			h,
			"x",
			"workspace",
			"ws-1",
			{ summary: "new" },
			{
				editor: { id: "api-key:ops", name: "Ops Key" },
			},
		)
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(revisionDoc.editor).toEqual({ id: "api-key:ops", name: "Ops Key" })
	})

	it("falls back to sourceAgent for engine-internal callers with no editor", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			_id: { toString: () => "id-x" },
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 7,
			sourceAgent: { id: "dreamer-run", name: "Dreamer" },
		})
		await updateWikiPage(h, "x", "workspace", "ws-1", { summary: "new" })
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(revisionDoc.editor).toEqual({
			id: "dreamer-run",
			name: "Dreamer",
		})
	})
})

describe("deleteWikiPage", () => {
	it("soft-deletes by default (sets state=superseded + validTo)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await deleteWikiPage(h, "x", "workspace", "ws-1")
		const [filter, update] = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(filter.state).toEqual({ $ne: "superseded" })
		expect(update.$set.state).toBe("superseded")
		expect(update.$set.validTo).toBeInstanceOf(Date)
		expect(update.$inc.revision).toBe(1)
	})

	it("records a revision entry with editKind=delete when a page is soft-deleted", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 2,
			state: "superseded",
		})
		const revisionsColl = mockCollection()
		const collectionCalls: string[] = []
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) => {
				collectionCalls.push(name)
				return name.endsWith("wiki_revisions") ? revisionsColl : coll
			},
		)
		const deleted = await deleteWikiPage(h, "x", "workspace", "ws-1")
		expect(deleted).toBe(true)
		expect(revisionsColl.insertOne).toHaveBeenCalledTimes(1)
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(revisionDoc.editKind).toBe("delete")
		expect(revisionDoc.revision).toBe(2)
	})

	it("hard-deletes atomically via findOneAndDelete and snapshots the deleted doc", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		;(
			coll.findOneAndDelete as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			_id: { toString: () => "id-x" },
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 5,
			state: "active",
		})
		const deleted = await deleteWikiPage(h, "x", "workspace", "ws-1", {
			hard: true,
			editor: { id: "api-key:admin", name: "Admin" },
		})
		expect(deleted).toBe(true)
		expect(coll.findOneAndDelete).toHaveBeenCalledWith(
			{ slug: "x", scope: "workspace", scopeRef: "ws-1" },
			{ session: undefined },
		)
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		// The delete revision snapshot is EXACTLY the atomically-returned
		// document (no separate read that could race a concurrent write).
		expect(revisionDoc.editKind).toBe("delete")
		expect(revisionDoc.revision).toBe(6)
		expect(revisionDoc.editor).toEqual({ id: "api-key:admin", name: "Admin" })
		expect(revisionDoc.snapshot.slug).toBe("x")
		expect(revisionDoc.snapshot.revision).toBe(5)
	})

	it("hard-delete with no match returns false and records no revision", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const revisionsColl = mockCollection()
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)
		const deleted = await deleteWikiPage(h, "x", "workspace", "ws-1", {
			hard: true,
		})
		expect(deleted).toBe(false)
		expect(revisionsColl.insertOne).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const SAMPLE_VIEW: WikiPageView = {
	_id: "abc",
	kind: "concept",
	title: "Accounts Table",
	slug: "tables/accounts",
	aliases: ["acct"],
	summary: "Holds balances.",
	body: "## Schema\n\n- id: uuid",
	frontmatter: { type: "table", tags: ["finance"] },
	claims: [
		{ id: "c1", text: "Balance is numeric", status: "active", confidence: 0.9 },
	],
	contradictions: [],
	questions: [{ id: "q1", text: "Who owns this?", status: "open" }],
	relationships: [
		{
			targetPageSlug: "tables/users",
			targetTitle: "Users",
			kind: "relates_to",
		},
	],
	personCard: null,
	scope: "workspace",
	scopeRef: "ws-1",
	trustTier: "standard",
	permissions: {},
	state: "active",
	revision: 1,
	validFrom: "2026-07-09T00:00:00.000Z",
	freshness: "fresh",
	backlinks: [
		{ sourcePageSlug: "tables/transactions", sourceTitle: "Transactions" },
	],
	createdAt: "2026-07-09T00:00:00.000Z",
	updatedAt: "2026-07-09T00:00:00.000Z",
}

describe("renderWikiPageMarkdown", () => {
	it("renders title, summary, body, claims, questions, relationships, backlinks", () => {
		const md = renderWikiPageMarkdown(SAMPLE_VIEW)
		expect(md).toContain("# Accounts Table")
		expect(md).toContain("Holds balances.")
		expect(md).toContain("## Schema")
		expect(md).toContain("- Balance is numeric _[active]_")
		expect(md).toContain("## Open Questions")
		expect(md).toContain("? Who owns this?")
		expect(md).toContain("## Relationships")
		expect(md).toContain("[relates_to] → [[tables/users]] Users")
		expect(md).toContain("## Backlinks")
		expect(md).toContain("[[tables/transactions]] Transactions")
	})

	it("includes footer metadata line", () => {
		const md = renderWikiPageMarkdown(SAMPLE_VIEW)
		expect(md).toContain("kind: concept")
		expect(md).toContain("rev: 1")
		expect(md).toContain("freshness: fresh")
	})

	it("omits empty sections", () => {
		const md = renderWikiPageMarkdown({
			...SAMPLE_VIEW,
			claims: [],
			questions: [],
			relationships: [],
			backlinks: [],
		})
		expect(md).not.toContain("## Claims")
		expect(md).not.toContain("## Open Questions")
		expect(md).not.toContain("## Relationships")
		expect(md).not.toContain("## Backlinks")
	})
})

describe("renderWikiPageHtml", () => {
	it("produces an <article> with title, escaped content, and links", () => {
		const html = renderWikiPageHtml(SAMPLE_VIEW)
		expect(html).toContain('<article class="mdbrain-wiki-page"')
		expect(html).toContain("<h1>Accounts Table</h1>")
		expect(html).toContain("<blockquote>Holds balances.</blockquote>")
		expect(html).toContain('<a href="/wiki/tables/users">Users</a>')
		expect(html).toContain("<li>Balance is numeric <em>[active]</em></li>")
	})

	it("escapes HTML in user content (XSS hardening)", () => {
		const view: WikiPageView = {
			...SAMPLE_VIEW,
			title: "<script>alert(1)</script>",
			summary: "a & b < c",
		}
		const html = renderWikiPageHtml(view)
		expect(html).not.toContain("<script>alert(1)</script>")
		expect(html).toContain("&lt;script&gt;")
		expect(html).toContain("a &amp; b &lt; c")
	})

	it("renders body markdown to HTML headings/paragraphs", () => {
		const view: WikiPageView = {
			...SAMPLE_VIEW,
			body: "## Section\n\nSome **bold** text and `code`.",
		}
		const html = renderWikiPageHtml(view)
		expect(html).toContain("<h2>Section</h2>")
		expect(html).toContain("<strong>bold</strong>")
		expect(html).toContain("<code>code</code>")
	})
})
