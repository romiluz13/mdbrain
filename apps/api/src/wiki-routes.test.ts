// Wiki routes (/v1/wiki/*) integration tests.
//
// Mocks the @mdbrain/wiki-engine + @mdbrain/memory-bridge modules so the
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
	importOkfBundle: vi.fn(),
	exportOkfBundle: vi.fn(),
	searchWikiPages: vi.fn(),
	listUnresolvedContradictions: vi.fn(),
	listWikiPageRevisions: vi.fn(),
	listMemoryDeliveryIntents: vi.fn(),
	getWikiPageRevision: vi.fn(),
	resolveTransclusions: vi.fn(),
	recordWikiMutationIntent: vi.fn(),
}))

const wikiStoreMocks = vi.hoisted(() => ({
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
}))

vi.mock("@mdbrain/wiki-engine", () => ({
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
	WikiRevisionConflictError: class WikiRevisionConflictError extends Error {
		constructor(
			public slug: string,
			public scope: string,
			public scopeRef: string,
			public expectedRevision: number,
		) {
			super(
				`wiki page "${slug}" in scope ${scope}:${scopeRef} moved past revision ${expectedRevision} — concurrent update, re-read and retry`,
			)
			this.name = "WikiRevisionConflictError"
		}
	},
	WikiSearchUnavailableError: class WikiSearchUnavailableError extends Error {
		constructor(message = "wiki search unavailable") {
			super(message)
			this.name = "WikiSearchUnavailableError"
		}
	},
}))

vi.mock("./wiki-store-runtime.js", () => ({
	...wikiStoreMocks,
}))

import { createApp } from "./app.js"
import {
	WikiDuplicateSlugError,
	WikiRevisionConflictError,
	WikiSearchUnavailableError,
} from "@mdbrain/wiki-engine"

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
	fileContents?: Record<string, string>
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
		wikiStoreMocks.getWikiStoreHandle.mockReset()
		wikiStoreMocks.withWikiTransaction.mockReset()
		wikiStoreMocks.getWikiStoreHandle.mockResolvedValue({
			db: {},
			prefix: "test_",
		})
		wikiStoreMocks.withWikiTransaction.mockImplementation(
			async (
				operation: (
					handle: { db: object; prefix: string },
					session: object,
				) => Promise<unknown>,
			) => operation({ db: {}, prefix: "test_" }, {}),
		)
		wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
		wikiMocks.recordWikiMutationIntent.mockResolvedValue({
			operationId: "op-1",
			state: "recorded",
		})
	})

	it("lists delivery failures without exposing stored payloads", async () => {
		wikiMocks.listMemoryDeliveryIntents.mockResolvedValue([
			{
				operationId: "write-event:key-1",
				state: "outcome-unknown",
				payload: { body: "sensitive" },
				idempotencyKey: "caller-value",
				payloadFingerprint: "fingerprint",
				principalSubjectId: "tenant:t1:user:u1",
				updatedAt: new Date("2026-08-17T00:00:00.000Z"),
			},
		])

		const res = await createApp().request(
			"/v1/admin/deliveries?state=outcome-unknown",
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as {
			deliveries: Array<Record<string, unknown>>
		}
		expect(json.deliveries[0]).toMatchObject({
			operationId: "write-event:key-1",
			state: "outcome-unknown",
		})
		expect(json.deliveries[0]).not.toHaveProperty("payload")
		expect(json.deliveries[0]).not.toHaveProperty("idempotencyKey")
		expect(json.deliveries[0]).not.toHaveProperty("payloadFingerprint")
		expect(json.deliveries[0]).not.toHaveProperty("principalSubjectId")
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
			const session = wikiMocks.createWikiPage.mock.calls[0][2].session
			expect(wikiMocks.recordWikiMutationIntent).toHaveBeenCalledWith(
				handle,
				expect.objectContaining({
					kind: "create",
					pageSlug: "tables/accounts",
					principalSubjectId: "development:anonymous",
				}),
				session,
			)
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
				expect.objectContaining({
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
					subjectId: "development:anonymous",
				}),
			)
		})

		it("uses server-derived identity even when request trust is wider", async () => {
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{
					token: "reader-secret",
					subjectId: "user:alice",
					groups: ["idp:engineering"],
					roles: ["reader"],
					departments: ["engineering"],
					trustTier: "restricted",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					capabilities: ["read"],
				},
			])
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)

			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1&trustTier=admin",
				{ headers: { Authorization: "Bearer reader-secret" } },
			)

			expect(res.status).toBe(200)
			expect(wikiMocks.getWikiPage).toHaveBeenCalledWith(
				{ db: {}, prefix: "test_" },
				"tables/accounts",
				"workspace",
				"ws-1",
				{
					scope: "workspace",
					scopeRef: "ws-1",
					subjectId: "user:alice",
					groups: ["idp:engineering"],
					roles: ["reader"],
					departments: ["engineering"],
					trustTier: "restricted",
					capabilities: ["read"],
				},
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

		it("does not resolve transclusions by default (raw markers stay in body)", async () => {
			wikiMocks.getWikiPage.mockResolvedValue({
				...SAMPLE_PAGE,
				body: "{{page:other}}",
			})
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
			)
			const json = await asJson(res)
			expect((json as unknown as { body: string }).body).toBe("{{page:other}}")
			expect(wikiMocks.resolveTransclusions).not.toHaveBeenCalled()
		})

		it("resolves transclusions when transclude=true", async () => {
			wikiMocks.getWikiPage.mockResolvedValue({
				...SAMPLE_PAGE,
				body: "{{page:other}}",
			})
			wikiMocks.resolveTransclusions.mockResolvedValue("Resolved content.")
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1&transclude=true",
			)
			const json = await asJson(res)
			expect((json as unknown as { body: string }).body).toBe(
				"Resolved content.",
			)
			expect(wikiMocks.resolveTransclusions).toHaveBeenCalledWith(
				{ db: {}, prefix: "test_" },
				"{{page:other}}",
				expect.objectContaining({
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
					subjectId: "development:anonymous",
				}),
			)
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
					governance: expect.objectContaining({
						scope: "workspace",
						scopeRef: "ws-1",
						trustTier: "admin",
						subjectId: "development:anonymous",
					}),
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

		it("maps a revision conflict (concurrent writer) to 409 REVISION_CONFLICT", async () => {
			wikiMocks.updateWikiPage.mockRejectedValue(
				new WikiRevisionConflictError(
					"tables/accounts",
					"workspace",
					"ws-1",
					3,
				),
			)
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "stale" }),
				},
			)
			expect(res.status).toBe(409)
			const json = await asJson(res)
			expect(json.error?.code).toBe("REVISION_CONFLICT")
		})

		it("passes the calling principal as the revision editor", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			wikiMocks.updateWikiPage.mockResolvedValue({
				...SAMPLE_PAGE,
				revision: 2,
			})
			await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "Updated summary" }),
				},
			)
			const opts = wikiMocks.updateWikiPage.mock.calls[0][5]
			// The default test principal — not a payload-supplied agent string.
			// The development principal carries a displayName; the editor name
			// uses it, falling back to subjectId when absent.
			expect(opts.editor).toEqual({
				id: "development:anonymous",
				name: "Unauthenticated local development",
			})
		})

		it("requires change-permissions capability for ACL or trust edits", async () => {
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{
					token: "writer-secret",
					subjectId: "user:writer",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					capabilities: ["write"],
				},
			])
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: {
						Authorization: "Bearer writer-secret",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ trustTier: "admin" }),
				},
			)

			expect(res.status).toBe(403)
			expect(wikiStoreMocks.withWikiTransaction).not.toHaveBeenCalled()
			expect(wikiMocks.updateWikiPage).not.toHaveBeenCalled()
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

		it("requires hard-delete capability for permanent deletion", async () => {
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{
					token: "writer-secret",
					subjectId: "user:writer",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					capabilities: ["write"],
				},
			])
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1&hard=true",
				{
					method: "DELETE",
					headers: { Authorization: "Bearer writer-secret" },
				},
			)

			expect(res.status).toBe(403)
			expect(wikiStoreMocks.withWikiTransaction).not.toHaveBeenCalled()
			expect(wikiMocks.deleteWikiPage).not.toHaveBeenCalled()
		})
	})

	describe("POST /v1/wiki/okf-import", () => {
		it("allows a permission-changing principal to import the requested trust tier", async () => {
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{
					token: "permission-editor-secret",
					subjectId: "user:permission-editor",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					trustTier: "restricted",
					capabilities: ["write", "change-permissions"],
				},
			])
			wikiMocks.importOkfBundle.mockResolvedValue({
				imported: 2,
				skipped: 0,
				conceptIds: ["tables/accounts", "tables/users"],
				errors: [],
			})
			const res = await createApp().request("/v1/wiki/okf-import", {
				method: "POST",
				headers: {
					Authorization: "Bearer permission-editor-secret",
					"Content-Type": "application/json",
					"X-Request-ID": "okf-import-1",
				},
				body: JSON.stringify({
					bundleDir: "/tmp/bundle",
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "admin",
					okfBundleId: "b1",
				}),
			})
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.imported).toBe(2)
			expect(wikiMocks.importOkfBundle).toHaveBeenCalledTimes(1)
			expect(wikiStoreMocks.withWikiTransaction).toHaveBeenCalledTimes(1)
			expect(wikiMocks.importOkfBundle).toHaveBeenCalledWith(
				expect.anything(),
				"/tmp/bundle",
				expect.objectContaining({
					trustTier: "admin",
					session: expect.anything(),
				}),
			)
			expect(wikiMocks.recordWikiMutationIntent).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					operationId: "okf-import-1",
					kind: "okf-import",
					pageSlug: "b1",
					scope: "workspace",
					scopeRef: "ws-1",
					principalSubjectId: "user:permission-editor",
				}),
				expect.anything(),
			)
		})

		it("rejects a write-only principal before starting the import transaction", async () => {
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{
					token: "writer-secret",
					subjectId: "user:writer",
					scopes: ["workspace"],
					scopeRefs: ["ws-1"],
					trustTier: "standard",
					capabilities: ["write"],
				},
			])

			const res = await createApp().request("/v1/wiki/okf-import", {
				method: "POST",
				headers: {
					Authorization: "Bearer writer-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					bundleDir: "/tmp/bundle",
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					okfBundleId: "b1",
				}),
			})

			expect(res.status).toBe(403)
			expect((await asJson(res)).error?.message).toMatch(/change-permissions/)
			expect(wikiStoreMocks.withWikiTransaction).not.toHaveBeenCalled()
			expect(wikiMocks.importOkfBundle).not.toHaveBeenCalled()
		})

		it("rolls back imported pages when mutation-intent audit recording fails", async () => {
			let pageVisible = false
			wikiMocks.importOkfBundle.mockImplementation(async () => {
				pageVisible = true
				return {
					imported: 1,
					skipped: 0,
					conceptIds: ["accounts"],
					errors: [],
				}
			})
			wikiMocks.recordWikiMutationIntent.mockRejectedValue(
				new Error("injected mutation-intent audit failure"),
			)
			wikiMocks.getWikiPage.mockImplementation(async () =>
				pageVisible ? SAMPLE_PAGE : undefined,
			)
			wikiStoreMocks.withWikiTransaction.mockImplementation(
				async (
					operation: (
						handle: { db: object; prefix: string },
						session: object,
					) => Promise<unknown>,
				) => {
					const wasVisible = pageVisible
					try {
						return await operation({ db: {}, prefix: "test_" }, {})
					} catch (error) {
						pageVisible = wasVisible
						throw error
					}
				},
			)

			const app = createApp()
			const importResponse = await app.request("/v1/wiki/okf-import", {
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

			expect(importResponse.status).toBe(500)
			expect((await asJson(importResponse)).error?.message).toContain(
				"injected mutation-intent audit failure",
			)
			const pageResponse = await app.request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
			)
			expect(pageResponse.status).toBe(404)
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
					okfBundleId: "bundle-1",
					trustTier: "admin",
				}),
			})
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.exported).toBe(3)
			expect(wikiMocks.exportOkfBundle).toHaveBeenCalledTimes(1)
			const [, params] = wikiMocks.exportOkfBundle.mock.calls[0]
			expect(params.scope).toBe("workspace")
			expect(params.scopeRef).toBe("ws-1")
			expect(params.outDir).toBe("/tmp/out")
			expect(params.okfBundleId).toBe("bundle-1")
			// Export must always be governance-filtered — never an unfiltered dump.
			expect(params.governance).toBeDefined()
			expect(params.governance.scope).toBe("workspace")
			expect(params.governance.scopeRef).toBe("ws-1")
			expect(params.governance.trustTier).toBe("admin")
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

		it("passes returnContent through to exportOkfBundle and surfaces fileContents in the response", async () => {
			wikiMocks.exportOkfBundle.mockResolvedValue({
				dir: "/tmp/out",
				exported: 1,
				files: ["index.md"],
				fileContents: { "index.md": "# Index\n" },
			})
			const res = await createApp().request("/v1/wiki/okf-export", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope: "workspace",
					scopeRef: "ws-1",
					outDir: "/tmp/out",
					returnContent: true,
				}),
			})
			expect(res.status).toBe(200)
			const json = await asJson(res)
			expect(json.fileContents).toEqual({ "index.md": "# Index\n" })
			expect(wikiMocks.exportOkfBundle).toHaveBeenCalledTimes(1)
			const [, params] = wikiMocks.exportOkfBundle.mock.calls[0]
			expect(params.returnContent).toBe(true)
		})

		it("defaults returnContent to false when omitted from the request body", async () => {
			wikiMocks.exportOkfBundle.mockResolvedValue({
				dir: "/tmp/out",
				exported: 1,
				files: ["index.md"],
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
			expect(json.fileContents).toBeUndefined()
			expect(wikiMocks.exportOkfBundle).toHaveBeenCalledTimes(1)
			const [, params] = wikiMocks.exportOkfBundle.mock.calls[0]
			expect(params.returnContent).toBe(false)
		})
	})

	describe("GET /v1/wiki/revisions", () => {
		it("returns revision list when the caller can read the live page", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			wikiMocks.listWikiPageRevisions.mockResolvedValue([
				{
					pageSlug: "tables/accounts",
					scope: "workspace",
					scopeRef: "ws-1",
					revision: 2,
					editKind: "update",
					createdAt: "2026-07-10T00:00:00.000Z",
				},
			])
			const res = await createApp().request(
				"/v1/wiki/revisions?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(200)
			const json = (await res.json()) as { revisions: unknown[] }
			expect(json.revisions).toHaveLength(1)
			expect(wikiMocks.listWikiPageRevisions).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					pageSlug: "tables/accounts",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			)
		})

		it("does NOT fall through to the GET /wiki/* get-by-slug handler — confirms no route collision with the wildcard", async () => {
			wikiMocks.listWikiPageRevisions.mockResolvedValue([])
			await createApp().request(
				"/v1/wiki/revisions?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			// The revisions handler resolves history WITHOUT a current-page read
			// (governance is per revision snapshot). A fall-through to
			// GET /wiki/* would instead call getWikiPage with slug="revisions".
			expect(wikiMocks.getWikiPage).not.toHaveBeenCalled()
			expect(wikiMocks.listWikiPageRevisions).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ pageSlug: "tables/accounts" }),
			)
			expect(wikiMocks.renderMarkdown).not.toHaveBeenCalled()
			expect(wikiMocks.renderHtml).not.toHaveBeenCalled()
		})

		it("authorizes per revision — an unreadable CURRENT page no longer hides history", async () => {
			// The live page is gone (hard-deleted) or restricted; the engine
			// decides visibility per revision snapshot and returns [] here.
			wikiMocks.getWikiPage.mockResolvedValue(undefined)
			wikiMocks.listWikiPageRevisions.mockResolvedValue([])
			const res = await createApp().request(
				"/v1/wiki/revisions?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(200)
			expect(wikiMocks.listWikiPageRevisions).toHaveBeenCalledTimes(1)
		})

		it("rejects missing slug", async () => {
			const res = await createApp().request(
				"/v1/wiki/revisions?scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(400)
		})
	})

	describe("GET /v1/wiki/revisions/:revision", () => {
		it("returns a specific revision snapshot", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			wikiMocks.getWikiPageRevision.mockResolvedValue({
				pageSlug: "tables/accounts",
				scope: "workspace",
				scopeRef: "ws-1",
				revision: 2,
				editKind: "update",
				snapshot: { title: "Accounts Table (old)" },
				createdAt: "2026-07-10T00:00:00.000Z",
			})
			const res = await createApp().request(
				"/v1/wiki/revisions/2?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(200)
			const json = (await res.json()) as { revision: number }
			expect(json.revision).toBe(2)
			expect(wikiMocks.getWikiPageRevision).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					pageSlug: "tables/accounts",
					revision: 2,
				}),
			)
		})

		it("returns 404 when the revision does not exist", async () => {
			wikiMocks.getWikiPage.mockResolvedValue(SAMPLE_PAGE)
			wikiMocks.getWikiPageRevision.mockResolvedValue(undefined)
			const res = await createApp().request(
				"/v1/wiki/revisions/99?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(404)
		})

		it("authorizes per revision — an unreadable CURRENT page no longer hides a readable revision", async () => {
			// The live page is gone (hard-deleted) or restricted; the revision's
			// own snapshot still permits this caller, so the engine returns it.
			wikiMocks.getWikiPage.mockResolvedValue(undefined)
			wikiMocks.getWikiPageRevision.mockResolvedValue({
				pageSlug: "tables/accounts",
				scope: "workspace",
				scopeRef: "ws-1",
				revision: 1,
				editKind: "create",
				snapshot: { title: "Accounts Table (original)" },
				createdAt: "2026-07-09T00:00:00.000Z",
			})
			const res = await createApp().request(
				"/v1/wiki/revisions/1?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(200)
			expect(wikiMocks.getWikiPageRevision).toHaveBeenCalledTimes(1)
		})

		it("rejects a non-numeric revision", async () => {
			const res = await createApp().request(
				"/v1/wiki/revisions/abc?slug=tables/accounts&scope=workspace&scopeRef=ws-1",
			)
			expect(res.status).toBe(400)
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
					scope: "workspace",
					scopeRef: "ws-1",
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
			expect(params.scope).toBe("workspace")
			expect(params.scopeRef).toBe("ws-1")
			expect(params.governance).toBeDefined()
			expect(params.governance.scope).toBe("workspace")
		})

		it("rejects missing scope/scopeRef", async () => {
			const res = await createApp().request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: "x" }),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(
				/scope and scopeRef are required/,
			)
		})

		it("returns 503 SEARCH_UNAVAILABLE when the search subsystem is down", async () => {
			// A search outage is NOT "no matches" — callers must be able to
			// distinguish and retry instead of caching an empty answer.
			wikiMocks.searchWikiPages.mockRejectedValueOnce(
				new WikiSearchUnavailableError("wiki search failed"),
			)
			const res = await createApp().request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "accounts",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			})
			expect(res.status).toBe(503)
			const json = await asJson(res)
			expect(json.error?.code).toBe("SEARCH_UNAVAILABLE")
		})

		it("keeps 500 WIKI_SEARCH_FAILED for non-outage errors", async () => {
			wikiMocks.searchWikiPages.mockRejectedValueOnce(
				new Error("unexpected failure"),
			)
			const res = await createApp().request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "accounts",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			})
			expect(res.status).toBe(500)
			const json = await asJson(res)
			expect(json.error?.code).toBe("WIKI_SEARCH_FAILED")
		})
	})

	describe("reserved wiki slugs (REV-07 N2)", () => {
		it("rejects creating a page whose first slug segment shadows GET /wiki/lint", async () => {
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...VALID_BODY, slug: "lint" }),
			})
			expect(res.status).toBe(400)
			const json = await asJson(res)
			expect(json.error?.code).toBe("VALIDATION_ERROR")
			expect(json.error?.message).toMatch(/reserved/)
			expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
		})

		it("rejects creating a page whose first slug segment shadows GET /wiki/revisions", async () => {
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...VALID_BODY, slug: "revisions/accounts" }),
			})
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(
				/"revisions" is reserved/,
			)
			expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
		})

		it("allows slugs that merely contain a reserved segment later in the path", async () => {
			wikiMocks.createWikiPage.mockResolvedValue(SAMPLE_PAGE)
			const res = await createApp().request("/v1/wiki", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...VALID_BODY,
					slug: "tables/revisions-of-accounts",
				}),
			})
			expect(res.status).toBe(201)
			expect(wikiMocks.createWikiPage).toHaveBeenCalledTimes(1)
		})

		it("ignores a slug in the PATCH body (rename is not a patch field)", async () => {
			wikiMocks.updateWikiPage.mockResolvedValue(SAMPLE_PAGE)
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ slug: "lint", summary: "updated" }),
				},
			)
			expect(res.status).toBe(200)
			const [, , , , patch] = wikiMocks.updateWikiPage.mock.calls[0]
			// The runtime strips slug from the patch (updateWikiPage cannot
			// rename), so a reserved first segment in a PATCH body can never
			// shadow GET /wiki/lint.
			expect(patch).not.toHaveProperty("slug")
			expect(patch.summary).toBe("updated")
		})
	})

	describe("PATCH expectedRevision precondition (REV-07 C24)", () => {
		it("applies the patch when the page is at the expected revision", async () => {
			wikiMocks.updateWikiPage.mockResolvedValue({
				...SAMPLE_PAGE,
				revision: 2,
			})
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "cas update", expectedRevision: 1 }),
				},
			)
			expect(res.status).toBe(200)
			const [, , , , patch] = wikiMocks.updateWikiPage.mock.calls[0]
			expect(patch.summary).toBe("cas update")
			// The precondition field never reaches the engine as a page field.
			expect(patch).not.toHaveProperty("expectedRevision")
		})

		it("returns 409 REVISION_CONFLICT when the page moved past the expected revision", async () => {
			// beforeEach resolves getWikiPage to SAMPLE_PAGE at revision 1;
			// a caller that observed revision 5 is stale.
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "stale", expectedRevision: 5 }),
				},
			)
			expect(res.status).toBe(409)
			const json = await asJson(res)
			expect(json.error?.code).toBe("REVISION_CONFLICT")
			expect(json.error?.message).toMatch(/revision 5/)
			expect(wikiMocks.updateWikiPage).not.toHaveBeenCalled()
		})

		it("ignores expectedRevision when absent (plain last-writer-wins stays available)", async () => {
			wikiMocks.updateWikiPage.mockResolvedValue({
				...SAMPLE_PAGE,
				revision: 2,
			})
			const res = await createApp().request(
				"/v1/wiki/tables/accounts?scope=workspace&scopeRef=ws-1",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ summary: "no precondition" }),
				},
			)
			expect(res.status).toBe(200)
			expect(wikiMocks.updateWikiPage).toHaveBeenCalledTimes(1)
		})
	})

	describe("GET /v1/wiki/lint", () => {
		it("forwards kind and limit to the page list (placebo-parameter fix)", async () => {
			wikiMocks.listWikiPages.mockResolvedValue({
				pages: [SAMPLE_PAGE],
				total: 1,
			})
			wikiMocks.listUnresolvedContradictions.mockResolvedValue([])
			const res = await createApp().request(
				"/v1/wiki/lint?scope=workspace&scopeRef=ws-1&kind=concept&limit=5",
			)
			expect(res.status).toBe(200)
			const [, params] = wikiMocks.listWikiPages.mock.calls[0]
			expect(params.kind).toBe("concept")
			expect(params.limit).toBe(5)
			expect(params.scope).toBe("workspace")
			expect(params.scopeRef).toBe("ws-1")
		})

		it("clamps an out-of-range limit and defaults kind to undefined", async () => {
			wikiMocks.listWikiPages.mockResolvedValue({ pages: [], total: 0 })
			wikiMocks.listUnresolvedContradictions.mockResolvedValue([])
			await createApp().request(
				"/v1/wiki/lint?scope=workspace&scopeRef=ws-1&limit=500",
			)
			const [, params] = wikiMocks.listWikiPages.mock.calls[0]
			expect(params.kind).toBeUndefined()
			// Clamped to MAX_LIST_LIMIT (100), matching GET /v1/wiki behavior.
			expect(params.limit).toBe(100)
		})

		it("rejects a non-numeric limit", async () => {
			const res = await createApp().request(
				"/v1/wiki/lint?scope=workspace&scopeRef=ws-1&limit=abc",
			)
			expect(res.status).toBe(400)
			expect((await asJson(res)).error?.message).toMatch(/limit/)
		})
	})
})
