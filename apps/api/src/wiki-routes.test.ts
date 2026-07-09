// Wiki routes (/v1/wiki/*) integration tests.
//
// Mocks the @mdbrian/wiki-engine + @mdbrian/memory-bridge modules so the
// HTTP contract is tested in isolation (same pattern as app.test.ts mocks
// the memory-bridge). The route handlers are thin: validation → bridge →
// response shaping. The bridge logic itself is covered by wiki-bridge tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

// Hoisted mocks — vi.hoisted ensures these exist before the vi.mock calls
// (which are hoisted to the top of the file by Vitest).
const wikiMocks = vi.hoisted(() => ({
	createWikiPage: vi.fn(),
	getWikiPage: vi.fn(),
	listWikiPages: vi.fn(),
	updateWikiPage: vi.fn(),
	deleteWikiPage: vi.fn(),
	renderMarkdown: vi.fn(),
	renderHtml: vi.fn(),
	getWikiDbHandle: vi.fn(),
	importOkfBundle: vi.fn(),
	exportOkfBundle: vi.fn(),
	searchWikiPages: vi.fn(),
}))

const bridgeMocks = vi.hoisted(() => ({
	mdbrianBridgeGetManager: vi.fn(),
}))

vi.mock("@mdbrian/wiki-engine", () => ({
	...wikiMocks,
	WikiDuplicateSlugError: class WikiDuplicateSlugError extends Error {
		constructor(
			public slug: string,
			public scope: string,
			public scopeRef: string,
		) {
			super(
				`wiki page slug "${slug}" already exists in scope ${scope}:${scopeRef}`,
			)
			this.name = "WikiDuplicateSlugError"
		}
	},
}))

vi.mock("@mdbrian/memory-bridge", () => ({
	...bridgeMocks,
}))

import { createApp } from "./app.js"
import { WikiDuplicateSlugError } from "@mdbrian/wiki-engine"

type WikiJson = {
	slug?: string
	error?: { code: string; message: string }
	total?: number
	pages?: Array<{ slug: string }>
	ok?: boolean
	hard?: boolean
	revision?: number
	imported?: number
	exported?: number
}
const asJson = (res: Response): Promise<WikiJson> =>
	res.json() as Promise<WikiJson>

const VALID_BODY = {
	kind: "concept",
	title: "Accounts Table",
	slug: "tables/accounts",
	summary: "The accounts table holds customer balance data.",
	body: "## Schema\n\n- id: uuid\n- balance: numeric",
	frontmatter: { type: "table", tags: ["finance"] },
	scope: "workspace",
	scopeRef: "ws-1",
	trustTier: "standard",
}

const SAMPLE_PAGE = {
	_id: "65f1a0",
	kind: "concept",
	title: "Accounts Table",
	slug: "tables/accounts",
	aliases: [],
	summary: "The accounts table holds customer balance data.",
	body: "## Schema",
	frontmatter: { type: "table", tags: ["finance"] },
	claims: [],
	contradictions: [],
	questions: [],
	relationships: [],
	personCard: null,
	scope: "workspace",
	scopeRef: "ws-1",
	trustTier: "standard",
	permissions: {},
	state: "active",
	revision: 1,
	validFrom: "2026-07-09T00:00:00.000Z",
	freshness: "fresh",
	backlinks: [],
	createdAt: "2026-07-09T00:00:00.000Z",
	updatedAt: "2026-07-09T00:00:00.000Z",
}

describe("wiki routes", () => {
	beforeEach(() => {
		process.env = { ...prevEnv }
		for (const k of Object.keys(wikiMocks)) {
			;(wikiMocks as Record<string, ReturnType<typeof vi.fn>>)[k].mockReset()
		}
		bridgeMocks.mdbrianBridgeGetManager.mockReset()
		bridgeMocks.mdbrianBridgeGetManager.mockResolvedValue({
			db: {},
			prefix: "test_",
		})
		wikiMocks.getWikiDbHandle.mockReturnValue({ db: {}, prefix: "test_" })
	})

	afterEach(() => {
		process.env = { ...prevEnv }
	})

	describe("POST /v1/wiki", () => {
		it("creates a page and returns 201", async () => {
			wikiMocks.createWikiPage.mockResolvedValue(SAMPLE_PAGE)
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			})
			expect(res.status).toBe(201)
			const json = await asJson(res)
			expect(json.slug).toBe("tables/accounts")
			expect(wikiMocks.createWikiPage).toHaveBeenCalledTimes(1)
			const [handle, input] = wikiMocks.createWikiPage.mock.calls[0]
			expect(handle).toEqual({ db: {}, prefix: "test_" })
			expect(input.slug).toBe("tables/accounts")
			expect(input.scope).toBe("workspace")
		})

		it("rejects missing title", async () => {
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...VALID_BODY, title: "" }),
			})
			expect(res.status).toBe(400)
			const json = await asJson(res)
			expect(json.error?.code).toBe("VALIDATION_ERROR")
			expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
		})

		it("rejects invalid kind", async () => {
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...VALID_BODY, kind: "unknown" }),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/kind must be one of/)
		})

		it("rejects missing OKF frontmatter.type", async () => {
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...VALID_BODY, frontmatter: {} }),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/frontmatter.type/)
		})

		it("returns 409 on duplicate slug", async () => {
			wikiMocks.createWikiPage.mockRejectedValue(
				new WikiDuplicateSlugError("tables/accounts", "workspace", "ws-1"),
			)
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(VALID_BODY),
			})
			expect(res.status).toBe(409)
			expect((await asJson(res)).error?.code).toBe("DUPLICATE_SLUG")
		})
	})

	describe("GET /v1/wiki/:slug", () => {
		it("returns a page as JSON by default", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.slug).toBe("tables/accounts")
			expect(wikiMocks.getWikiPage).toHaveBeenCalledWith(
				{ db: {}, prefix: "test_" },
				"tables/accounts",
				"workspace",
				"ws-1",
			)
		})

		it("returns markdown when format=markdown", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			wikiMocks.renderMarkdown.mockReturnValue("# Accounts Table\n\n...")
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1&format=markdown",
			)
			expect(res.status).toBe(200)
			expect(res.headers.get("content-type")).toMatch(/text\/markdown/)
			const text = await res.text()
			expect(text).toContain("# Accounts Table")
			expect(wikiMocks.renderMarkdown).toHaveBeenCalledTimes(1)
		})

		it("returns HTML when format=html", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			wikiMocks.renderHtml.mockReturnValue("<article>...</article>")
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1&format=html",
			)
			expect(res.status).toBe(200)
			expect(res.headers.get("content-type")).toMatch(/text\/html/)
			expect(await res.text()).toContain("<article>")
		})

		it("returns 404 when not found", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(undefined)
			const res = await createApp().request(
				"/v1/wiki/missing?scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(404)
			expect((await asJson(res)).error?.code).toBe("WIKI_NOT_FOUND")
		})

		it("rejects missing scope/scopeRef", async () => {
			const res = await createApp().request("/v1/wiki/x")
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/scope and scopeRef/)
		})
	})

	describe("GET /v1/wiki", () => {
		it("lists pages with filters", async () => {
			wikiMocks.listWikiPages.mockResolvedValue({
				pages: [SAMPLE_PAGE],
				total: 1,
			})
			const res = await createApp().request(
				"/v1/wiki?scope=workspace&scopeRef=ws-1&kind=concept&limit=10",
			)
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.total).toBe(1)
			expect(json.pages?.[0].slug).toBe("tables/accounts")
			expect(wikiMocks.listWikiPages).toHaveBeenCalledWith(
				{ db: {}, prefix: "test_" },
				{
					kind: "concept",
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: undefined,
					state: undefined,
					limit: 10,
					skip: undefined,
				},
			)
		})
	})

	describe("PATCH /v1/wiki/:slug", () => {
		it("updates a page and bumps revision", async () => {
			wikiMocks.updateWikiPage.mockResolvedValue({
				...SAMPLE_PAGE,
				revision: 2,
			})
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "Updated summary" }),
				},
			)
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.revision).toBe(2)
			const [, , , , patch] = wikiMocks.updateWikiPage.mock.calls[0]
			expect(patch.summary).toBe("Updated summary")
		})

		it("returns 404 when updating a missing page", async () => {
			wikiMocks.updateWikiPage.mockResolvedValue(undefined)
			const res = await createApp().request(
				"/v1/wiki/missing?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "x" }),
				},
			)
			expect(res.status).toBe(404)
		})
	})

	describe("DELETE /v1/wiki/:slug", () => {
		it("soft-deletes (marks superseded) by default", async () => {
			wikiMocks.deleteWikiPage.mockResolvedValue(true)
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{ method: "DELETE" },
			)
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.ok).toBe(true)
			expect(json.hard).toBe(false)
			const [, , , , opts] = wikiMocks.deleteWikiPage.mock.calls[0]
			expect(opts.hard).toBe(false)
		})

		it("hard-deletes when hard=true", async () => {
			wikiMocks.deleteWikiPage.mockResolvedValue(true)
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1&hard=true",
				{ method: "DELETE" },
			)
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.hard).toBe(true)
			const [, , , , opts] = wikiMocks.deleteWikiPage.mock.calls[0]
			expect(opts.hard).toBe(true)
		})

		it("returns 404 when deleting a missing page", async () => {
			wikiMocks.deleteWikiPage.mockResolvedValue(false)
			const res = await createApp().request(
				"/v1/wiki/missing?scope=workspace&scopeRef=ws-1",
				{ method: "DELETE" },
			)
			expect(res.status).toBe(404)
		})
	})

	describe("POST /v1/wiki/okf-import", () => {
		it("imports a bundle and returns the result", async () => {
			wikiMocks.importOkfBundle.mockResolvedValue({
				imported: 2,
				skipped: 0,
				conceptIds: ["tables/accounts", "tables/users"],
				errors: [],
			})
			const res = await createApp().request("/v1/wiki/okf-import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					bundleDir: "/tmp/bundle",
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					okfBundleId: "b1",
				}),
			})
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.imported).toBe(2)
			expect(wikiMocks.importOkfBundle).toHaveBeenCalledTimes(1)
		})

		it("rejects missing bundleDir", async () => {
			const res = await createApp().request("/v1/wiki/okf-import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					okfBundleId: "b1",
				}),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/bundleDir/)
		})
	})

	describe("POST /v1/wiki/okf-export", () => {
		it("exports a bundle and returns the result", async () => {
			wikiMocks.exportOkfBundle.mockResolvedValue({
				dir: "/tmp/out",
				exported: 3,
				files: ["tables/accounts.md", "index.md"],
			})
			const res = await createApp().request("/v1/wiki/okf-export", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope: "workspace",
					scopeRef: "ws-1",
					outDir: "/tmp/out",
				}),
			})
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.exported).toBe(3)
			expect(wikiMocks.exportOkfBundle).toHaveBeenCalledTimes(1)
		})

		it("rejects missing outDir", async () => {
			const res = await createApp().request("/v1/wiki/okf-export", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ scope: "workspace", scopeRef: "ws-1" }),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/outDir/)
		})
	})

	describe("POST /v1/wiki/search", () => {
		it("returns ranked results for a query", async () => {
			wikiMocks.searchWikiPages.mockResolvedValue({
				results: [
					{ page: { slug: "tables/accounts" }, score: 1.5, source: "hybrid" },
				],
				total: 1,
				recipe: "hybrid",
				mode: "hybrid",
			})
			const res = await createApp().request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "accounts",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			})
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.total).toBe(1)
			expect(wikiMocks.searchWikiPages).toHaveBeenCalledTimes(1)
			const [, params] = wikiMocks.searchWikiPages.mock.calls[0]
			expect(params.query).toBe("accounts")
			expect(params.scope).toBe("workspace")
		})

		it("rejects missing query", async () => {
			const res = await createApp().request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/query is required/)
		})

		it("forwards recipe + filter params", async () => {
			wikiMocks.searchWikiPages.mockResolvedValue({
				results: [],
				total: 0,
				recipe: "fast",
				mode: "vector-only",
			})
			await createApp().request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "x",
					recipe: "fast",
					kind: "concept",
					trustTier: "standard",
					privacyTier: "internal",
					maxResults: 5,
				}),
			})
			const [, params] = wikiMocks.searchWikiPages.mock.calls[0]
			expect(params.recipe).toBe("fast")
			expect(params.kind).toBe("concept")
			expect(params.trustTier).toBe("standard")
			expect(params.privacyTier).toBe("internal")
			expect(params.maxResults).toBe(5)
		})
	})
})
