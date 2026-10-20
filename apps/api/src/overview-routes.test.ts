// GET /v1/wiki/overview/* — the entity overview route, and the `overview`
// reserved slug segment that keeps it from shadowing a page.
//
// The engine is mocked, so these tests pin the HTTP contract: validation,
// bounds, the governance context taken from the principal, the 404 shape,
// citation markers and slug precedence. Assembly and governance filtering of
// the overview itself are covered by the engine's own tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const wikiMocks = vi.hoisted(() => ({
	createWikiPage: vi.fn(),
	getWikiPage: vi.fn(),
	updateWikiPage: vi.fn(),
	deleteWikiPage: vi.fn(),
	getWikiEntityOverview: vi.fn(),
	recordWikiMutationIntent: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
}))

vi.mock("@mdbrain/wiki-engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("@mdbrain/wiki-engine")>()),
	...wikiMocks,
}))
vi.mock("./wiki-store-runtime.js", () => ({ ...storeMocks }))

import { createApp } from "./app.js"

type Json = {
	error?: { code: string; message: string }
	slug?: string
	[key: string]: unknown
}
const asJson = (res: Response) => res.json() as Promise<Json>

const CREATE_BODY = {
	kind: "concept",
	title: "Overview",
	slug: "tables/accounts",
	summary: "A page.",
	body: "Body.",
	frontmatter: { type: "table" },
	scope: "workspace",
	scopeRef: "ws-1",
	trustTier: "standard",
}

const SAMPLE_PAGE = {
	_id: "p1",
	kind: "concept",
	title: "Accounts",
	slug: "tables/accounts",
	aliases: [],
	summary: "A page.",
	body: "Body.",
	frontmatter: { type: "table" },
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

const createPage = (slug: string) =>
	createApp().request("/v1/wiki", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...CREATE_BODY, slug }),
	})

beforeEach(() => {
	process.env = { ...prevEnv }
	for (const mock of Object.values(wikiMocks)) mock.mockReset()
	for (const mock of Object.values(storeMocks)) mock.mockReset()
	storeMocks.getWikiStoreHandle.mockResolvedValue({ db: {}, prefix: "t_" })
	storeMocks.withWikiTransaction.mockImplementation(
		async (operation: (handle: object, session: object) => Promise<unknown>) =>
			operation({ db: {}, prefix: "t_" }, {}),
	)
	wikiMocks.recordWikiMutationIntent.mockResolvedValue({ state: "recorded" })
	wikiMocks.createWikiPage.mockResolvedValue(SAMPLE_PAGE)
})

afterEach(() => {
	process.env = { ...prevEnv }
})

describe("the overview slug segment is reserved", () => {
	it.each([
		["a slug that starts with the segment", "overview/accounts/halvorsen"],
		["the bare segment", "overview"],
	])("refuses to create %s", async (_name, slug) => {
		const res = await createPage(slug)

		expect(res.status).toBe(400)
		const json = await asJson(res)
		expect(json.error?.code).toBe("VALIDATION_ERROR")
		expect(json.error?.message).toMatch(/"overview" is reserved/)
		expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
	})

	it("still allows the word later in a slug", async () => {
		const res = await createPage("tables/overview")

		expect(res.status).toBe(201)
		expect(wikiMocks.createWikiPage).toHaveBeenCalledTimes(1)
	})
})

const SCOPE_QUERY = "scope=workspace&scopeRef=ws-1"

const getOverview = (path: string, headers: Record<string, string> = {}) =>
	createApp().request(`/v1/wiki/${path}`, { headers })

const claimOf = (id: string, text: string) => ({
	id,
	text,
	status: "active",
	evidence: [],
})

const noLimits = {
	backlinks: { items: [], hasMore: false },
	neighbors: { items: [], hasMore: false },
	contradictions: { items: [], hasMore: false },
	revisions: { items: [], hasMore: false },
	limits: {
		backlinks: 20,
		neighbors: 10,
		neighborClaims: 3,
		revisions: 5,
		contradictions: 20,
	},
}

describe("GET /v1/wiki/overview/*", () => {
	it("returns the engine's overview with a citation marker on every claim it shows", async () => {
		wikiMocks.getWikiEntityOverview.mockResolvedValue({
			...noLimits,
			page: {
				...SAMPLE_PAGE,
				slug: "accounts/halvorsen",
				revision: 4,
				claims: [claimOf("renewal", "Renews in March.")],
			},
			backlinks: {
				items: [
					{
						slug: "deals/q4",
						title: "Q4 deal",
						revision: 9,
						kinds: ["mentions"],
						context: {
							claim: claimOf("c9", "Halvorsen signed."),
							text: "See it.",
						},
					},
				],
				hasMore: false,
			},
			neighbors: {
				items: [
					{
						slug: "people/anna",
						title: "Anna",
						summary: "A person.",
						revision: 2,
						linkKinds: ["owner"],
						claimCount: 1,
						claimsTruncated: false,
						claims: [claimOf("a1", "Anna owns it.")],
					},
				],
				hasMore: false,
			},
			contradictions: {
				items: [
					{
						id: "contra-1",
						detectedAt: "2026-10-01T00:00:00.000Z",
						resolution: "unresolved",
						claims: [
							{
								pageSlug: "accounts/halvorsen",
								pageTitle: "Halvorsen",
								revision: 4,
								claim: claimOf("renewal", "Renews in March."),
							},
							{
								pageSlug: "deals/q4",
								pageTitle: "Q4 deal",
								revision: 9,
								claim: claimOf("c9", "Halvorsen signed."),
							},
						],
					},
				],
				hasMore: false,
			},
		})

		const res = await getOverview(`overview/accounts/halvorsen?${SCOPE_QUERY}`)
		const json = (await res.json()) as {
			page: { claims: Array<{ marker?: string }> }
			backlinks: { items: Array<{ context: { claim: { marker?: string } } }> }
			neighbors: { items: Array<{ claims: Array<{ marker?: string }> }> }
			contradictions: {
				items: Array<{ claims: Array<{ claim: { marker?: string } }> }>
			}
			revisions: unknown
			limits: unknown
		}

		expect(res.status).toBe(200)
		expect(json.page.claims[0]?.marker).toBe(
			"[[wiki:accounts/halvorsen#renewal@r4]]",
		)
		expect(json.backlinks.items[0]?.context.claim.marker).toBe(
			"[[wiki:deals/q4#c9@r9]]",
		)
		expect(json.neighbors.items[0]?.claims[0]?.marker).toBe(
			"[[wiki:people/anna#a1@r2]]",
		)
		expect(
			json.contradictions.items[0]?.claims.map((c) => c.claim.marker),
		).toEqual([
			"[[wiki:accounts/halvorsen#renewal@r4]]",
			"[[wiki:deals/q4#c9@r9]]",
		])
		expect(json.revisions).toEqual(noLimits.revisions)
		expect(json.limits).toEqual(noLimits.limits)
	})

	it("marks the two claims of a contradiction with their own pages when both use one claim id", async () => {
		wikiMocks.getWikiEntityOverview.mockResolvedValue({
			...noLimits,
			page: SAMPLE_PAGE,
			contradictions: {
				items: [
					{
						id: "contra-status-status",
						detectedAt: "2026-10-01T00:00:00.000Z",
						resolution: "unresolved",
						claims: [
							{
								pageSlug: "hr/layoffs",
								pageTitle: "Layoffs",
								revision: 2,
								claim: claimOf("status", "Layoffs are planned."),
							},
							{
								pageSlug: "accounts/halvorsen",
								pageTitle: "Halvorsen",
								revision: 4,
								claim: claimOf("status", "Headcount is stable."),
							},
						],
					},
				],
				hasMore: false,
			},
		})

		const res = await getOverview(`overview/accounts/halvorsen?${SCOPE_QUERY}`)
		const json = (await res.json()) as {
			contradictions: {
				items: Array<{ claims: Array<{ claim: { marker?: string } }> }>
			}
		}

		expect(
			json.contradictions.items[0]?.claims.map((c) => c.claim.marker),
		).toEqual([
			"[[wiki:hr/layoffs#status@r2]]",
			"[[wiki:accounts/halvorsen#status@r4]]",
		])
	})

	it("asks the engine for the page named after overview/, in the request's scope", async () => {
		wikiMocks.getWikiEntityOverview.mockResolvedValue({
			...noLimits,
			page: SAMPLE_PAGE,
		})

		await getOverview(`overview/accounts/halvorsen?${SCOPE_QUERY}`)
		await getOverview(`overview/accounts%2Fhalvorsen?${SCOPE_QUERY}`)

		expect(wikiMocks.getWikiEntityOverview).toHaveBeenCalledTimes(2)
		for (const [, params] of wikiMocks.getWikiEntityOverview.mock.calls) {
			expect(params).toMatchObject({
				slug: "accounts/halvorsen",
				scope: "workspace",
				scopeRef: "ws-1",
				limits: {},
			})
		}
		expect(wikiMocks.getWikiPage).not.toHaveBeenCalled()
	})

	it("passes the caller's own trust tier, roles and groups as the governance context", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "exec",
				scopes: ["workspace"],
				scopeRefs: ["ws-1"],
				trustTier: "standard",
				roles: ["exec"],
				departments: ["fin"],
				capabilities: ["read"],
			},
		])
		wikiMocks.getWikiEntityOverview.mockResolvedValue({
			...noLimits,
			page: SAMPLE_PAGE,
		})

		await getOverview(`overview/tables/accounts?${SCOPE_QUERY}`, {
			Authorization: "Bearer exec",
		})

		expect(
			wikiMocks.getWikiEntityOverview.mock.calls[0]?.[1].governance,
		).toMatchObject({
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			roles: ["exec"],
			departments: ["fin"],
		})
	})

	it("answers 404 WIKI_NOT_FOUND, like the page route, when the engine finds nothing readable", async () => {
		wikiMocks.getWikiEntityOverview.mockResolvedValue(undefined)

		const res = await getOverview(`overview/tables/missing?${SCOPE_QUERY}`)
		const json = await asJson(res)

		expect(res.status).toBe(404)
		expect(json.error?.code).toBe("WIKI_NOT_FOUND")
		expect(json.error?.message).toBe(
			'wiki page "tables/missing" not found in scope workspace:ws-1',
		)
	})

	it("refuses a caller who holds no grant for the scope, without asking the engine", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "ws1-only",
				scopes: ["workspace"],
				scopeRefs: ["ws-1"],
				capabilities: ["read"],
			},
		])

		const res = await getOverview(
			"overview/tables/accounts?scope=workspace&scopeRef=ws-2",
			{ Authorization: "Bearer ws1-only" },
		)

		expect(res.status).toBe(403)
		expect(wikiMocks.getWikiEntityOverview).not.toHaveBeenCalled()
	})

	it("requires a scope", async () => {
		const res = await getOverview("overview/tables/accounts")

		expect(res.status).toBe(400)
		expect((await asJson(res)).error?.code).toBe("VALIDATION_ERROR")
		expect(wikiMocks.getWikiEntityOverview).not.toHaveBeenCalled()
	})

	it("reports an engine failure as 500 WIKI_OVERVIEW_FAILED", async () => {
		wikiMocks.getWikiEntityOverview.mockRejectedValue(new Error("db down"))

		const res = await getOverview(`overview/tables/accounts?${SCOPE_QUERY}`)

		expect(res.status).toBe(500)
		expect((await asJson(res)).error).toEqual({
			code: "WIKI_OVERVIEW_FAILED",
			message: "db down",
		})
	})

	describe("bounds", () => {
		beforeEach(() => {
			wikiMocks.getWikiEntityOverview.mockResolvedValue({
				...noLimits,
				page: SAMPLE_PAGE,
			})
		})

		it("forwards each bound it is given, and only those", async () => {
			await getOverview(
				`overview/tables/accounts?${SCOPE_QUERY}&maxBacklinks=5&maxNeighbors=6&maxNeighborClaims=2&maxRevisions=7&maxContradictions=8`,
			)

			expect(wikiMocks.getWikiEntityOverview.mock.calls[0]?.[1].limits).toEqual(
				{
					backlinks: 5,
					neighbors: 6,
					neighborClaims: 2,
					revisions: 7,
					contradictions: 8,
				},
			)
		})

		it("hands a value above the maximum to the engine, which clamps and discloses it", async () => {
			const res = await getOverview(
				`overview/tables/accounts?${SCOPE_QUERY}&maxBacklinks=100000`,
			)

			expect(res.status).toBe(200)
			expect(wikiMocks.getWikiEntityOverview.mock.calls[0]?.[1].limits).toEqual(
				{
					backlinks: 100000,
				},
			)
		})

		it.each([
			["maxBacklinks", "abc"],
			["maxNeighbors", "1.5"],
			["maxNeighborClaims", "0"],
			["maxRevisions", "-2"],
			["maxContradictions", ""],
		])("answers 400 for %s=%s", async (name, value) => {
			const res = await getOverview(
				`overview/tables/accounts?${SCOPE_QUERY}&${name}=${value}`,
			)
			const json = await asJson(res)

			expect(res.status).toBe(400)
			expect(json.error?.code).toBe("VALIDATION_ERROR")
			expect(json.error?.message).toContain(name)
			expect(wikiMocks.getWikiEntityOverview).not.toHaveBeenCalled()
		})
	})
})

describe("a page stored under an overview/ slug before the segment was reserved", () => {
	beforeEach(() => {
		wikiMocks.getWikiPage.mockResolvedValue({
			...SAMPLE_PAGE,
			slug: "overview/old-page",
		})
		wikiMocks.getWikiEntityOverview.mockResolvedValue({
			...noLimits,
			page: SAMPLE_PAGE,
		})
		wikiMocks.deleteWikiPage.mockResolvedValue(true)
		wikiMocks.updateWikiPage.mockResolvedValue({
			...SAMPLE_PAGE,
			slug: "overview/old-page",
		})
	})

	it("is still read by the SDK's percent-encoded form", async () => {
		const res = await getOverview(`overview%2Fold-page?${SCOPE_QUERY}`)

		expect(res.status).toBe(200)
		expect(wikiMocks.getWikiPage.mock.calls[0]?.[1]).toBe("overview/old-page")
		expect(wikiMocks.getWikiEntityOverview).not.toHaveBeenCalled()
	})

	it("is not reached by the raw-slash GET: that is the overview of the page named after it", async () => {
		await getOverview(`overview/old-page?${SCOPE_QUERY}`)

		expect(wikiMocks.getWikiEntityOverview.mock.calls[0]?.[1].slug).toBe(
			"old-page",
		)
		expect(wikiMocks.getWikiPage).not.toHaveBeenCalled()
	})

	it("can still be deleted, by either spelling", async () => {
		for (const path of ["overview/old-page", "overview%2Fold-page"]) {
			const res = await createApp().request(`/v1/wiki/${path}?${SCOPE_QUERY}`, {
				method: "DELETE",
			})
			expect(res.status).toBe(200)
		}

		expect(wikiMocks.deleteWikiPage.mock.calls.map((call) => call[1])).toEqual([
			"overview/old-page",
			"overview/old-page",
		])
	})

	it("can still be patched, by either spelling", async () => {
		for (const path of ["overview/old-page", "overview%2Fold-page"]) {
			const res = await createApp().request(`/v1/wiki/${path}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					summary: "Edited.",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			})
			expect(res.status).toBe(200)
		}

		expect(wikiMocks.updateWikiPage.mock.calls.map((call) => call[1])).toEqual([
			"overview/old-page",
			"overview/old-page",
		])
	})

	it("leaves a page named exactly overview readable, since the bare path names no page to summarize", async () => {
		wikiMocks.getWikiPage.mockResolvedValue({
			...SAMPLE_PAGE,
			slug: "overview",
		})

		const res = await getOverview(`overview?${SCOPE_QUERY}`)

		expect(res.status).toBe(200)
		expect(wikiMocks.getWikiPage.mock.calls[0]?.[1]).toBe("overview")
		expect(wikiMocks.getWikiEntityOverview).not.toHaveBeenCalled()
	})
})
