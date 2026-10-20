// The `changes` reserved slug segment: GET /v1/wiki/changes answers the feed, so
// create refuses the segment, and pages stored under it earlier stay reachable.
// The engine is mocked; the feed's own contract is in changes-routes.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const wikiMocks = vi.hoisted(() => ({
	createWikiPage: vi.fn(),
	getWikiPage: vi.fn(),
	updateWikiPage: vi.fn(),
	deleteWikiPage: vi.fn(),
	getWikiChanges: vi.fn(),
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
	[key: string]: unknown
}
const asJson = (res: Response) => res.json() as Promise<Json>

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
		body: JSON.stringify({
			kind: "concept",
			title: "T",
			slug,
			summary: "A page.",
			body: "Body.",
			frontmatter: { type: "table" },
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
		}),
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

const SCOPE_QUERY = "scope=workspace&scopeRef=ws-1"
const SINCE = "2026-10-01T00:00:00.000Z"

const windowAndLimits = {
	window: {
		since: SINCE,
		until: "2026-10-01T11:00:00.000Z",
		settled: true,
	},
	limits: { limit: 25, maxClaims: 10 },
	hasMore: false,
}

describe("the changes slug segment is reserved", () => {
	it.each([
		["a slug that starts with the segment", "changes/accounts/halvorsen"],
		["the bare segment", "changes"],
	])("refuses to create %s", async (_name, slug) => {
		const res = await createPage(slug)

		expect(res.status).toBe(400)
		const json = await asJson(res)
		expect(json.error?.code).toBe("VALIDATION_ERROR")
		expect(json.error?.message).toMatch(/"changes" is reserved/)
		expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
	})

	it("still allows the word later in a slug", async () => {
		const res = await createPage("tables/changes")

		expect(res.status).toBe(201)
	})
})

describe("pages stored under a changes slug before the segment was reserved", () => {
	beforeEach(() => {
		wikiMocks.getWikiPage.mockResolvedValue({
			...SAMPLE_PAGE,
			slug: "changes/old-page",
		})
		wikiMocks.getWikiChanges.mockResolvedValue({
			...windowAndLimits,
			changes: [],
		})
		wikiMocks.deleteWikiPage.mockResolvedValue(true)
		wikiMocks.updateWikiPage.mockResolvedValue({
			...SAMPLE_PAGE,
			slug: "changes/old-page",
		})
	})

	it("changes/<name> is still read as a page, by either spelling", async () => {
		for (const path of ["changes/old-page", "changes%2Fold-page"]) {
			const res = await createApp().request(`/v1/wiki/${path}?${SCOPE_QUERY}`)
			expect(res.status).toBe(200)
		}

		expect(wikiMocks.getWikiPage.mock.calls.map((call) => call[1])).toEqual([
			"changes/old-page",
			"changes/old-page",
		])
		expect(wikiMocks.getWikiChanges).not.toHaveBeenCalled()
	})

	it("changes/<name> can still be patched and deleted", async () => {
		for (const path of ["changes/old-page", "changes%2Fold-page"]) {
			const patched = await createApp().request(`/v1/wiki/${path}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					summary: "Edited.",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			})
			const deleted = await createApp().request(
				`/v1/wiki/${path}?${SCOPE_QUERY}`,
				{ method: "DELETE" },
			)
			expect(patched.status).toBe(200)
			expect(deleted.status).toBe(200)
		}

		expect(wikiMocks.updateWikiPage.mock.calls.map((call) => call[1])).toEqual([
			"changes/old-page",
			"changes/old-page",
		])
		expect(wikiMocks.deleteWikiPage.mock.calls.map((call) => call[1])).toEqual([
			"changes/old-page",
			"changes/old-page",
		])
	})

	it("a page named exactly changes is no longer read by GET, because that path is the feed; PATCH and DELETE still reach it", async () => {
		wikiMocks.updateWikiPage.mockResolvedValue({
			...SAMPLE_PAGE,
			slug: "changes",
		})

		const read = await createApp().request(
			`/v1/wiki/changes?${SCOPE_QUERY}&since=${SINCE}`,
		)
		expect(read.status).toBe(200)
		expect(wikiMocks.getWikiChanges).toHaveBeenCalledTimes(1)
		expect(wikiMocks.getWikiPage).not.toHaveBeenCalled()

		const patched = await createApp().request("/v1/wiki/changes", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				summary: "Edited.",
				scope: "workspace",
				scopeRef: "ws-1",
			}),
		})
		const deleted = await createApp().request(
			`/v1/wiki/changes?${SCOPE_QUERY}`,
			{ method: "DELETE" },
		)
		expect(patched.status).toBe(200)
		expect(deleted.status).toBe(200)
		expect(wikiMocks.updateWikiPage.mock.calls[0]?.[1]).toBe("changes")
		expect(wikiMocks.deleteWikiPage.mock.calls[0]?.[1]).toBe("changes")
	})
})
