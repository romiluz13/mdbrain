// Wiki responses that show claims carry each claim's citation marker, and each
// event evidence entry's marker, so a reader (or an agent) can cite exactly what
// it saw. Engine and store are mocked: only the response shaping is under test.

import { beforeEach, describe, expect, it, vi } from "vitest"

const wikiMocks = vi.hoisted(() => ({
	createWikiPage: vi.fn(),
	getWikiPage: vi.fn(),
	listWikiPages: vi.fn(),
	updateWikiPage: vi.fn(),
	searchWikiPages: vi.fn(),
	getWikiPageRevision: vi.fn(),
	renderMarkdown: vi.fn(),
	renderHtml: vi.fn(),
	resolveTransclusions: vi.fn(),
	recordWikiMutationIntent: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
}))

vi.mock("@mdbrain/wiki-engine", () => ({
	...wikiMocks,
	WikiDuplicateSlugError: class extends Error {},
	WikiRevisionConflictError: class extends Error {},
	WikiSearchUnavailableError: class extends Error {},
}))
vi.mock("./wiki-store-runtime.js", () => ({ ...storeMocks }))

import { createApp } from "./app.js"

const EVENT_MARKER = "[[event:evt-1]]"

function storedClaims() {
	return [
		{
			id: "renewal",
			text: "The renewal is at risk.",
			status: "active",
			evidence: [
				{ kind: "event", sourceId: "evt-1", note: "ETA plan" },
				{ kind: "manual", sourceId: "evt-1", note: "typed by hand" },
			],
		},
		{ id: "odd id/#@", text: "Needs encoding.", status: "active" },
		{ id: "bad\nid", text: "Cannot carry a marker.", status: "active" },
	]
}

function page(revision: number, slug = "accounts/halvorsen") {
	return {
		_id: "p1",
		slug,
		title: "Halvorsen",
		kind: "entity",
		summary: "An account.",
		body: "",
		aliases: [],
		revision,
		scope: "workspace",
		scopeRef: "ws-1",
		claims: storedClaims(),
	}
}

type Marked = {
	claims: Array<{
		id: string
		marker?: string
		evidence?: Array<{ kind: string; marker?: string }>
	}>
}

function expectMarked(subject: Marked, revision: number) {
	const [renewal, odd, bad] = subject.claims
	expect(renewal.marker).toBe(
		`[[wiki:accounts/halvorsen#renewal@r${revision}]]`,
	)
	expect(renewal.evidence?.[0].marker).toBe(EVENT_MARKER)
	expect(renewal.evidence?.[1]).not.toHaveProperty("marker")
	expect(odd.marker).toBe(
		`[[wiki:accounts/halvorsen#odd%20id/%23%40@r${revision}]]`,
	)
	expect(bad).not.toHaveProperty("marker")
}

const request = (path: string, init?: RequestInit) =>
	createApp().request(path, init)
const SCOPE = "scope=workspace&scopeRef=ws-1"

beforeEach(() => {
	for (const mock of Object.values(wikiMocks)) mock.mockReset()
	storeMocks.getWikiStoreHandle.mockReset()
	storeMocks.withWikiTransaction.mockReset()
	storeMocks.getWikiStoreHandle.mockResolvedValue({ db: {}, prefix: "t_" })
	storeMocks.withWikiTransaction.mockImplementation(
		async (operation: (handle: object, session: object) => Promise<unknown>) =>
			operation({ db: {}, prefix: "t_" }, {}),
	)
	wikiMocks.recordWikiMutationIntent.mockResolvedValue({ state: "recorded" })
})

describe("citation markers in wiki responses", () => {
	it("marks the claims of a fetched page with the page's revision", async () => {
		wikiMocks.getWikiPage.mockResolvedValue(page(4))

		const res = await request(`/v1/wiki/accounts/halvorsen?${SCOPE}`)

		expect(res.status).toBe(200)
		expectMarked((await res.json()) as Marked, 4)
	})

	it("marks a created page and an updated page", async () => {
		wikiMocks.createWikiPage.mockResolvedValue(page(1))
		wikiMocks.updateWikiPage.mockResolvedValue(page(2))
		wikiMocks.getWikiPage.mockResolvedValue(page(1))

		const created = await request("/v1/wiki", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "entity",
				title: "Halvorsen",
				slug: "accounts/halvorsen",
				summary: "An account.",
				body: "",
				frontmatter: { type: "account" },
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
			}),
		})
		const updated = await request(`/v1/wiki/accounts/halvorsen?${SCOPE}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ summary: "Edited." }),
		})

		expect(created.status).toBe(201)
		expectMarked((await created.json()) as Marked, 1)
		expect(updated.status).toBe(200)
		expectMarked((await updated.json()) as Marked, 2)
	})

	it("marks every page in a list and in search results", async () => {
		wikiMocks.listWikiPages.mockResolvedValue({ pages: [page(3)], total: 1 })
		wikiMocks.searchWikiPages.mockResolvedValue({
			results: [{ page: page(5), score: 1.2, source: "hybrid" }],
			total: 1,
			recipe: "hybrid",
			mode: "hybrid",
		})

		const list = (await (await request(`/v1/wiki?${SCOPE}`)).json()) as {
			pages: Marked[]
		}
		const search = (await (
			await request("/v1/wiki/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "renewal",
					scope: "workspace",
					scopeRef: "ws-1",
				}),
			})
		).json()) as { results: Array<{ page: Marked; score: number }> }

		expectMarked(list.pages[0], 3)
		expectMarked(search.results[0].page, 5)
		expect(search.results[0].score).toBe(1.2)
	})

	it("marks a stored revision's claims with that revision, not the page's current one", async () => {
		wikiMocks.getWikiPageRevision.mockResolvedValue({
			pageSlug: "accounts/halvorsen",
			scope: "workspace",
			scopeRef: "ws-1",
			revision: 2,
			editKind: "update",
			createdAt: "2026-10-02T09:00:00.000Z",
			snapshot: { ...page(2), revision: 2 },
		})

		const res = await request(
			`/v1/wiki/revisions/2?slug=accounts/halvorsen&${SCOPE}`,
		)

		expect(res.status).toBe(200)
		const record = (await res.json()) as { snapshot: Marked; revision: number }
		expect(record.revision).toBe(2)
		expectMarked(record.snapshot, 2)
	})

	it("leaves pages without claims or a revision untouched", async () => {
		wikiMocks.getWikiPage.mockResolvedValue({ slug: "bare", title: "Bare" })

		const res = await request(`/v1/wiki/bare?${SCOPE}`)

		expect(await res.json()).toEqual({ slug: "bare", title: "Bare" })
	})

	it("replaces or drops a marker a client echoed back into stored claims", async () => {
		wikiMocks.getWikiPage.mockResolvedValue({
			...page(6),
			claims: [
				{
					id: "renewal",
					text: "Echoed.",
					marker: "[[wiki:accounts/halvorsen#renewal@r2]]",
					evidence: [
						{ kind: "event", sourceId: "evt-1", marker: "[[event:stale]]" },
						{ kind: "manual", sourceId: "evt-1", marker: "[[event:evt-1]]" },
					],
				},
				{ id: "bad\nid", text: "No marker.", marker: "[[wiki:x#y@r1]]" },
			],
		})

		const res = await request(`/v1/wiki/accounts/halvorsen?${SCOPE}`)
		const body = (await res.json()) as Marked

		expect(body.claims[0].marker).toBe("[[wiki:accounts/halvorsen#renewal@r6]]")
		expect(body.claims[0].evidence?.[0].marker).toBe(EVENT_MARKER)
		expect(body.claims[0].evidence?.[1]).not.toHaveProperty("marker")
		expect(body.claims[1]).not.toHaveProperty("marker")
	})

	it("renders the marked page, so markdown and HTML show the markers", async () => {
		wikiMocks.getWikiPage.mockResolvedValue(page(4))
		wikiMocks.renderMarkdown.mockReturnValue("md")
		wikiMocks.renderHtml.mockReturnValue("<p>html</p>")

		await request(`/v1/wiki/accounts/halvorsen?${SCOPE}&format=markdown`)
		await request(`/v1/wiki/accounts/halvorsen?${SCOPE}&format=html`)

		for (const render of [wikiMocks.renderMarkdown, wikiMocks.renderHtml]) {
			expect(render).toHaveBeenCalledTimes(1)
			expectMarked(render.mock.calls[0][0] as Marked, 4)
		}
	})
})

describe("claims that could never be cited are refused on write", () => {
	const create = (claims: unknown[]) =>
		request("/v1/wiki", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "entity",
				title: "X",
				slug: "accounts/x",
				summary: "An account.",
				body: "",
				frontmatter: { type: "account" },
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
				claims,
			}),
		})

	it("refuses a create whose claim id makes a marker over the limit", async () => {
		const res = await create([
			{ id: "ok", text: "Fine.", status: "active" },
			{ id: "a".repeat(2300), text: "Too long to cite.", status: "active" },
		])
		expect(res.status).toBe(400)
		const body = (await res.json()) as {
			error: { code: string; message: string }
		}
		expect(body.error.code).toBe("VALIDATION_ERROR")
		expect(body.error.message).toMatch(/claims\[1\]\.id/)
		expect(body.error.message.length).toBeLessThan(300)
		expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
	})

	it("refuses a claim id with control characters", async () => {
		const res = await create([{ id: "bad\nid", text: "No.", status: "active" }])
		expect(res.status).toBe(400)
		expect(wikiMocks.createWikiPage).not.toHaveBeenCalled()
	})

	it("refuses a patch whose claims could not be cited", async () => {
		wikiMocks.getWikiPage.mockResolvedValue(page(1, "accounts/x"))
		const res = await request(`/v1/wiki/accounts/x?${SCOPE}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				claims: [{ id: "a".repeat(2300), text: "Too long.", status: "active" }],
			}),
		})
		expect(res.status).toBe(400)
		expect(wikiMocks.updateWikiPage).not.toHaveBeenCalled()
	})

	it("accepts a claim id that fits even at the largest revision", async () => {
		wikiMocks.createWikiPage.mockResolvedValue(page(1, "accounts/x"))
		const res = await create([
			{ id: "a".repeat(1900), text: "Long but citable.", status: "active" },
		])
		expect(res.status).toBe(201)
	})
})
