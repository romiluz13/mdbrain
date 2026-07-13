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
		findOneAndUpdate: vi.fn(async () => ({ value: null })),
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
		expect(coll.findOne).toHaveBeenCalledWith({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
		})
	})
})

describe("listWikiPages", () => {
	it("builds a filter and caps limit at 100", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await listWikiPages(h, { kind: "concept", limit: 500 })
		expect(coll.find).toHaveBeenCalledWith({ kind: "concept" })
		// find().sort().skip().limit() chain — verify countDocuments filter too
		expect(coll.countDocuments).toHaveBeenCalledWith({ kind: "concept" })
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
			claims: [{ id: "c-existing", text: "Existing claim", status: "active" }],
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
})

describe("deleteWikiPage", () => {
	it("soft-deletes by default (sets state=superseded + validTo)", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await deleteWikiPage(h, "x", "workspace", "ws-1")
		const [filter, update] = (
			coll.updateOne as unknown as ReturnType<typeof vi.fn>
		).mock.calls[0]
		expect(filter.state).toEqual({ $ne: "superseded" })
		expect(update.$set.state).toBe("superseded")
		expect(update.$set.validTo).toBeInstanceOf(Date)
	})

	it("hard-deletes when hard=true", async () => {
		const { db, coll } = mockDb()
		const h: WikiDbHandle = { db, prefix: "test_" }
		await deleteWikiPage(h, "x", "workspace", "ws-1", { hard: true })
		expect(coll.deleteOne).toHaveBeenCalledWith({
			slug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
		})
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
