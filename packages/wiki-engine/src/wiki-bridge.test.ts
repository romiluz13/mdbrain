// wiki-bridge.ts + wiki-renderer.ts unit tests.
//
// Mocks the MongoDB collection (same pattern as wiki-schema.test.ts) so the
// bridge→collection behaviors are tested without a live DB: create (with embed
// hook), get, list, update (revision bump + questions normalization), delete
// (soft vs hard), duplicate-slug mapping, and renderer markdown/HTML output.

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock method assertions */
import type {
	ClientSession,
	Collection,
	Db,
	Document,
	MongoClient,
} from "mongodb"
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

function mockDb(): {
	db: Db
	coll: Collection
	client: MongoClient
	session: ClientSession
} {
	const coll = mockCollection()
	let active = false
	const session = {
		inTransaction: vi.fn(() => active),
		withTransaction: vi.fn(async (callback: () => Promise<unknown>) => {
			active = true
			try {
				return await callback()
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
		collection: vi.fn(() => coll),
		client,
	} as unknown as Db
	return { db, coll, client, session }
}

function mockActivePage(
	coll: Collection,
	overrides: Record<string, unknown> = {},
): void {
	;(coll.findOne as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
		slug: "x",
		scope: "workspace",
		scopeRef: "ws-1",
		state: "active",
		revision: 1,
		claims: [],
		relationships: [],
		...overrides,
	})
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
	it("prepares external embeddings before its one owned transaction", async () => {
		const { db, coll, client, session } = mockDb()
		const events: string[] = []
		;(coll.insertOne as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			async (doc: Document, options?: { session?: ClientSession }) => {
				events.push("slug" in doc ? "page-insert" : "revision-insert")
				expect(options?.session).toBe(session)
				return {
					acknowledged: true,
					insertedId: { toString: () => `id-${doc.slug}` },
				}
			},
		)
		;(
			session.withTransaction as unknown as ReturnType<typeof vi.fn>
		).mockImplementation(async (callback: () => Promise<unknown>) => {
			events.push("transaction")
			return callback()
		})
		const embed = vi.fn(async () => {
			events.push("embed")
			return [0.1, 0.2]
		})

		await createWikiPage({ db, prefix: "test_" }, VALID_INPUT, { embed })

		expect(events).toEqual([
			"embed",
			"transaction",
			"page-insert",
			"revision-insert",
		])
		expect(client.startSession).toHaveBeenCalledTimes(1)
		expect(session.endSession).toHaveBeenCalledTimes(1)
	})

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

	it("coalesces duplicate incoming claim ids before persistence", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const validTo = new Date("2026-12-31T00:00:00.000Z")

		await createWikiPage(h, {
			...VALID_INPUT,
			claims: [
				{ id: "x", text: "The overwritten claim" },
				{
					id: "x",
					text: "The surviving claim",
					writerAgent: { id: "agent-1", name: "Agent" },
					derivedFrom: ["source-1"],
					supersedesClaimId: "claim-0",
					sourceMemId: "memory-1",
					validTo,
				},
				{ id: "y", text: "A distinct claim" },
			],
		})

		const doc = (coll.insertOne as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0][0]
		expect(
			doc.claims.map((claim: { id: string; text: string }) => [
				claim.id,
				claim.text,
			]),
		).toEqual([
			["x", "The surviving claim"],
			["y", "A distinct claim"],
		])
		expect(doc.claims[0]).toMatchObject({
			status: "active",
			confidence: 0,
			evidence: [],
			writerAgent: { id: "agent-1", name: "Agent" },
			derivedFrom: ["source-1"],
			supersedesClaimId: "claim-0",
			sourceMemId: "memory-1",
			validTo,
			validFrom: expect.any(Date),
			updatedAt: expect.any(Date),
		})
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

	it("continues a recreated slug from its highest retained revision", async () => {
		const { db, coll, session } = mockDb()
		const revisionsColl = mockCollection()
		;(
			revisionsColl.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({ revision: 4 })
		;(db.collection as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			(name: string) =>
				name.endsWith("wiki_revisions") ? revisionsColl : coll,
		)

		const recreated = await createWikiPage({ db, prefix: "test_" }, VALID_INPUT)

		expect(recreated.revision).toBe(5)
		const [pageDoc] = (coll.insertOne as unknown as ReturnType<typeof vi.fn>)
			.mock.calls[0]
		const [revisionDoc] = (
			revisionsColl.insertOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(pageDoc.revision).toBe(5)
		expect(revisionDoc.revision).toBe(5)
		expect(revisionsColl.findOne).toHaveBeenCalledWith(
			{
				pageSlug: VALID_INPUT.slug,
				scope: VALID_INPUT.scope,
				scopeRef: VALID_INPUT.scopeRef,
			},
			{
				projection: { revision: 1 },
				sort: { revision: -1 },
				session,
			},
		)
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
				state: { $ne: "superseded" },
			},
			undefined,
		)
	})

	it("does not return a superseded page through an ordinary exact read", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(coll.findOne as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			async (filter: Record<string, unknown>) =>
				(filter.state as { $ne?: string } | undefined)?.$ne === "superseded"
					? null
					: {
							_id: { toString: () => "id-superseded" },
							...VALID_INPUT,
							state: "superseded",
							revision: 2,
						},
		)

		await expect(
			getWikiPage(h, "tables/accounts", "workspace", "ws-1"),
		).resolves.toBeUndefined()
	})

	it("returns a superseded page only for an explicit administrative read", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			_id: { toString: () => "id-superseded" },
			...VALID_INPUT,
			state: "superseded",
			revision: 2,
		})

		await expect(
			getWikiPage(
				h,
				"tables/accounts",
				"workspace",
				"ws-1",
				undefined,
				undefined,
				{ includeSuperseded: true },
			),
		).resolves.toEqual(
			expect.objectContaining({
				slug: "tables/accounts",
				state: "superseded",
			}),
		)
		expect(coll.findOne).toHaveBeenCalledWith(
			{
				slug: "tables/accounts",
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
		mockActivePage(coll)
		await updateWikiPage(h, "x", "workspace", "ws-1", { summary: "new" })
		const [filter, update] = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(filter).toEqual({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			state: { $ne: "superseded" },
			revision: 1,
		})
		expect(update.$inc).toEqual({ revision: 1 })
		expect(update.$set.updatedAt).toBeInstanceOf(Date)
		expect(update.$set.summary).toBe("new")
	})

	it("records a revision entry with editKind=update after a successful update", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		mockActivePage(coll)
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
		mockActivePage(coll)
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

	it("replaces only claims owned by an internal prefix", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		;(
			coll.findOne as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			claims: [
				{ id: "claim-git-source-t1", text: "Old source claim" },
				{ id: "claim-git-source-t2", text: "Stable source claim" },
				{ id: "claim-dreamer-event-1", text: "Dreamer claim" },
				{ id: "claim-manual-1", text: "Manual claim" },
			],
			relationships: [],
		})

		await updateWikiPage(
			h,
			"x",
			"workspace",
			"ws-1",
			{
				claims: [
					{ id: "claim-git-source-t2", text: "Stable source claim" },
					{ id: "claim-git-source-t3-new", text: "Edited source claim" },
					{ id: "claim-git-source-t4", text: "New source claim" },
					{ id: "claim-git-source-t4-copy", text: "New source claim" },
				],
			},
			{ claimsReplace: { idPrefix: "claim-git-source-" } },
		)

		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		expect(update.$set.claims.map((claim: { id: string }) => claim.id)).toEqual(
			[
				"claim-dreamer-event-1",
				"claim-manual-1",
				"claim-git-source-t2",
				"claim-git-source-t3-new",
				"claim-git-source-t4",
			],
		)
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
			state: { $ne: "superseded" },
		})
	})

	it("returns undefined when the target is superseded at the initial read", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const findOne = coll.findOne as unknown as ReturnType<typeof vi.fn>
		findOne.mockImplementationOnce(async (filter: Record<string, unknown>) =>
			(filter.state as { $ne?: string } | undefined)?.$ne === "superseded"
				? null
				: {
						slug: "x",
						scope: "workspace",
						scopeRef: "ws-1",
						state: "superseded",
						revision: 5,
					},
		)
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockImplementationOnce(async (filter: Record<string, unknown>) =>
			(filter.state as { $ne?: string } | undefined)?.$ne === "superseded"
				? null
				: {
						_id: { toString: () => "id-x" },
						slug: "x",
						scope: "workspace",
						scopeRef: "ws-1",
						state: "superseded",
						revision: 6,
					},
		)

		await expect(
			updateWikiPage(h, "x", "workspace", "ws-1", {
				claims: [{ id: "c-new", text: "must not run against a tombstone" }],
			}),
		).resolves.toBeUndefined()
		expect(coll.findOneAndUpdate).not.toHaveBeenCalled()
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

	it("keeps the 409 conflict contract when a soft delete wins after an active initial read", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const findOne = coll.findOne as unknown as ReturnType<typeof vi.fn>
		findOne.mockResolvedValueOnce({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			state: "active",
			revision: 4,
			claims: [],
			relationships: [],
		})
		// The CAS misses after a concurrent soft delete. The post-CAS
		// existence probe intentionally remains state-blind, so it still sees
		// the tombstone and preserves the existing race classification.
		findOne.mockResolvedValueOnce({ _id: 1, state: "superseded" })

		await expect(
			updateWikiPage(h, "x", "workspace", "ws-1", { summary: "late" }),
		).rejects.toBeInstanceOf(WikiRevisionConflictError)
		const [, followUpFilter] = findOne.mock.calls
		expect(followUpFilter[0]).toEqual({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
		})
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

	it("does not record a contradiction for overwritten same-id claim text", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const oldPage = {
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			state: "active",
			revision: 1,
			claims: [],
			relationships: [{ targetPageSlug: "y" }],
		}
		;(coll.findOne as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			async (filter: Record<string, unknown>) => {
				if (filter.slug === "x") return oldPage
				if (filter.slug === "y") {
					return {
						slug: "y",
						scope: "workspace",
						scopeRef: "ws-1",
						claims: [{ id: "target", text: "The API uses REST endpoints" }],
						contradictions: [],
					}
				}
				return null
			},
		)
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			...oldPage,
			_id: { toString: () => "id-x" },
			revision: 2,
		})

		await updateWikiPage(h, "x", "workspace", "ws-1", {
			claims: [
				{ id: "claim-x", text: "The API does not use REST endpoints" },
				{ id: "claim-x", text: "The database stores audit logs" },
			],
		})

		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		expect(
			update.$set.claims.map((claim: { id: string; text: string }) => [
				claim.id,
				claim.text,
			]),
		).toEqual([["claim-x", "The database stores audit logs"]])
		const contradictionWrites = (
			coll.updateOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls.filter(([, write]) => write.$push?.contradictions)
		expect(contradictionWrites).toEqual([])
	})

	it("records a contradiction when the surviving same-id claim contradicts", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		const oldPage = {
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			state: "active",
			revision: 1,
			claims: [],
			relationships: [{ targetPageSlug: "y" }],
		}
		;(coll.findOne as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			async (filter: Record<string, unknown>) => {
				if (filter.slug === "x") return oldPage
				if (filter.slug === "y") {
					return {
						slug: "y",
						scope: "workspace",
						scopeRef: "ws-1",
						claims: [{ id: "target", text: "The API uses REST endpoints" }],
						contradictions: [],
					}
				}
				return null
			},
		)
		;(
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValueOnce({
			...oldPage,
			_id: { toString: () => "id-x" },
			revision: 2,
		})

		await updateWikiPage(h, "x", "workspace", "ws-1", {
			claims: [
				{ id: "claim-x", text: "The database stores audit logs" },
				{ id: "claim-x", text: "The API does not use REST endpoints" },
			],
		})

		const update = (
			coll.findOneAndUpdate as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0][1]
		expect(
			update.$set.claims.map((claim: { id: string; text: string }) => [
				claim.id,
				claim.text,
			]),
		).toEqual([["claim-x", "The API does not use REST endpoints"]])
		const contradictionWrites = (
			coll.updateOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls.filter(([, write]) => write.$push?.contradictions)
		expect(contradictionWrites).toHaveLength(1)
		expect(contradictionWrites[0][1].$push.contradictions.claimIds).toEqual([
			"claim-x",
			"target",
		])
	})

	it("records the ACTUAL calling principal as the revision editor", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		mockActivePage(coll)
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
		mockActivePage(coll)
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
		const { db, coll, client, session } = mockDb()
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
			{ session },
		)
		expect(client.startSession).toHaveBeenCalledTimes(1)
		expect(session.endSession).toHaveBeenCalledTimes(1)
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
