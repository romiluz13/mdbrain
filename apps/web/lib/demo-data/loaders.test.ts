import { afterEach, describe, expect, it, vi } from "vitest"
import type {
	MdbrainCitationEventResponse,
	MdbrainWikiChange,
	MdbrainWikiChangesResponse,
	MdbrainWikiClaim,
	MdbrainWikiOverviewContradiction,
	MdbrainWikiOverviewResponse,
	MdbrainWikiPageView,
	MdbrainWikiRevisionSummary,
} from "@mdbrain/client"
import { claimView, json, pageView, stubUpstream } from "./test-upstream.js"
import {
	loadContradictions,
	loadEntityOverview,
	loadWikiChanges,
	loadWikiMap,
	type DemoDataUpstream,
} from "./loaders.js"

const baseUpstream = {
	apiBaseUrl: "http://upstream.test",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("loadWikiMap", () => {
	it("walks the page list and builds the graph view", async () => {
		const listCall = vi.fn(() =>
			json({ pages: [pageView(), pageView({ slug: "havnor" })], total: 2 }),
		)
		const lintCall = vi.fn(() =>
			json({ pages: 2, total: 2, unresolvedContradictions: [] }),
		)
		const calls = stubUpstream({
			"/v1/wiki": listCall,
			"/v1/wiki/lint": lintCall,
		})
		const result = await loadWikiMap(baseUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		const expectedPage = (slug: string) => ({
			slug,
			title: "Halvorsen Renewal",
			kind: "person",
			type: "person",
			trustTier: "standard",
			state: "active",
			revision: 3,
			claimCount: 1,
			linkCount: 1,
			createdAt: "2026-11-16T10:00:00.000Z",
			updatedAt: "2026-11-16T10:30:00.000Z",
			links: [{ slug: "havnor", kind: "related" }],
			sourceIds: ["evt-1"],
			contradictedClaims: 0,
			claims: [claimView()],
		})
		expect(result.data.pages).toEqual([
			expectedPage("halvorsen-renewal"),
			expectedPage("havnor"),
		])
		expect(result.data.claimTotal).toBe(2)
		expect(result.data.sourceTotal).toBe(1)
		expect(listCall).toHaveBeenCalledTimes(1)
		expect(result.data.pageTotal).toBe(2)
		expect(result.data.unresolvedContradictionCount).toBe(0)
		expect(calls.filter((url) => url.pathname === "/v1/wiki")).toHaveLength(1)
	})

	it("lists all pages with a single call when total fits the limit", async () => {
		const listCall = vi.fn(() => json({ pages: [pageView()], total: 1 }))
		stubUpstream({ "/v1/wiki": listCall })
		const result = await loadWikiMap(baseUpstream)
		expect(listCall).toHaveBeenCalledTimes(1)
		if (result.kind === "ready") {
			expect(result.data.pageTotal).toBe(1)
		}
	})

	it("reports an error when the API call fails", async () => {
		stubUpstream({
			"/v1/wiki": () =>
				json({ error: { code: "UNAUTHORIZED", message: "bad key" } }, 401),
		})
		const result = await loadWikiMap(baseUpstream)
		expect(result.kind).toBe("error")
		if (result.kind !== "error") return
		expect(result.code).toBe("UNAUTHORIZED")
		expect(result.status).toBe(401)
		expect(result.message).not.toMatch(/test-read-key/)
	})

	it("reports empty when the scope has no pages", async () => {
		stubUpstream({ "/v1/wiki": () => json({ pages: [], total: 0 }) })
		const result = await loadWikiMap(baseUpstream)
		expect(result.kind).toBe("empty")
	})
})

describe("loadEntityOverview", () => {
	it("returns the ticket-04 overview view with a client-side page shape", async () => {
		const {
			backlinks: _backlinks,
			contradictions: _contradictions,
			...page
		} = pageView()
		const contradiction: MdbrainWikiOverviewContradiction = {
			id: "c1",
			detectedAt: "2026-11-16T12:00:00.000Z",
			resolution: "unresolved",
			claims: [],
		}
		const revision: MdbrainWikiRevisionSummary = {
			pageSlug: "halvorsen-renewal",
			scope: "workspace",
			scopeRef: "demo-run-2",
			revision: 3,
			editKind: "update",
			createdAt: "2026-11-16T10:30:00.000Z",
		}
		const overview: MdbrainWikiOverviewResponse = {
			page,
			contradictions: { items: [contradiction], hasMore: false },
			backlinks: { items: [], hasMore: false },
			neighbors: { items: [], hasMore: false },
			revisions: { items: [revision], hasMore: false },
			limits: {
				backlinks: 10,
				neighbors: 10,
				neighborClaims: 5,
				revisions: 5,
				contradictions: 10,
			},
		}
		stubUpstream({
			"/v1/wiki/overview/halvorsen-renewal": () => json(overview),
		})
		const result = await loadEntityOverview("halvorsen-renewal", baseUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.page.slug).toBe("halvorsen-renewal")
		expect(result.data.page.claims).toHaveLength(1)
		expect(result.data.page.validFrom).toBe("2026-11-16T10:00:00.000Z")
		expect(result.data.contradictions).toEqual([contradiction])
		expect(result.data.backlinks).toEqual([])
		expect(result.data.neighbors).toEqual([])
		expect(result.data.revisions).toEqual([revision])
		expect(result.data.limits).toEqual(overview.limits)
		expect(result.data.hasMore).toEqual({
			contradictions: false,
			backlinks: false,
			neighbors: false,
			revisions: false,
		})
	})

	it("reports empty for a missing page", async () => {
		stubUpstream({
			"/v1/wiki/overview/no-such-page": () =>
				json(
					{ error: { code: "WIKI_NOT_FOUND", message: "no such page" } },
					404,
				),
		})
		const result = await loadEntityOverview("no-such-page", baseUpstream)
		expect(result.kind).toBe("empty")
	})
})

describe("loadContradictions", () => {
	// The lint route lists one entry per unresolved record: the page that holds
	// it, and the stored record (SDK type unknown; see wiki-engine
	// UnresolvedContradiction).
	const entry = {
		pageSlug: "halvorsen-renewal",
		pageTitle: "Halvorsen Renewal",
		contradiction: {
			id: "c1",
			claimIds: ["claim-1", "claim-9"],
			claimRefs: [
				{ pageSlug: "halvorsen-renewal", claimId: "claim-1" },
				{ pageSlug: "risks", claimId: "claim-9" },
			],
			detectedAt: "2026-11-16T12:00:00.000Z",
			resolution: "unresolved",
		},
	}

	it("flattens the lint entries into one record per contradiction", async () => {
		const lintCall = vi.fn(() =>
			json({ pages: 2, total: 2, unresolvedContradictions: [entry] }),
		)
		stubUpstream({ "/v1/wiki/lint": lintCall })
		const result = await loadContradictions(baseUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.unresolved).toEqual([
			{
				id: "c1",
				pageSlug: "halvorsen-renewal",
				pageTitle: "Halvorsen Renewal",
				claimIds: ["claim-1", "claim-9"],
				detectedAt: "2026-11-16T12:00:00.000Z",
				resolution: "unresolved",
			},
		])
		expect(result.data.pageCount).toBe(2)
		expect(result.data.pageTotal).toBe(2)
		expect(lintCall).toHaveBeenCalledTimes(1)
	})

	it("drops an entry that does not carry a stored record", async () => {
		stubUpstream({
			"/v1/wiki/lint": () =>
				json({
					pages: 1,
					total: 1,
					unresolvedContradictions: [
						{ pageSlug: "x", pageTitle: "X" },
						{ id: "flat", detectedAt: "2026-11-16T12:00:00.000Z" },
					],
				}),
		})
		const result = await loadContradictions(baseUpstream)
		expect(result.kind).toBe("empty")
	})

	it("reports empty when there are none", async () => {
		stubUpstream({
			"/v1/wiki/lint": () =>
				json({ pages: 2, total: 2, unresolvedContradictions: [] }),
		})
		const result = await loadContradictions(baseUpstream)
		expect(result.kind).toBe("empty")
	})
})

describe("loadWikiChanges", () => {
	function changeResponse(
		changes: MdbrainWikiChange[],
		hasMore: boolean,
		nextCursor?: string,
	): MdbrainWikiChangesResponse {
		return {
			window: {
				since: "2026-11-16T00:00:00.000Z",
				until: "2026-11-17T00:00:00.000Z",
				settled: true,
			},
			limits: { limit: 50, maxClaims: 10 },
			changes,
			hasMore,
			...(nextCursor !== undefined ? { nextCursor } : {}),
		}
	}
	function change(slug: string, revision: number): MdbrainWikiChange {
		return {
			pageSlug: slug,
			revision,
			editKind: "update",
			createdAt: "2026-11-16T10:30:00.000Z",
			baseline: "previous",
			baselineRevision: revision - 1,
			claims: null,
		}
	}

	it("fans in one window and follows one cursor", async () => {
		const changesCall = vi
			.fn()
			.mockImplementationOnce(() =>
				json(changeResponse([change("halvorsen-renewal", 3)], true, "cur-2")),
			)
			.mockImplementationOnce(() =>
				json(changeResponse([change("havnor", 5)], false)),
			)
		const calls = stubUpstream({ "/v1/wiki/changes": changesCall })
		const result = await loadWikiChanges(
			baseUpstream,
			"2026-11-16T00:00:00.000Z",
		)
		expect(changesCall).toHaveBeenCalledTimes(2)
		expect(
			calls.filter((url) => url.pathname === "/v1/wiki/changes"),
		).toHaveLength(2)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.changes).toEqual([
			change("halvorsen-renewal", 3),
			change("havnor", 5),
		])
		expect(result.data.window).toEqual({
			since: "2026-11-16T00:00:00.000Z",
			until: "2026-11-17T00:00:00.000Z",
			settled: true,
		})
		expect(result.data.hasMore).toBe(false)
		expect(result.data.complete).toBe(true)
	})

	it("reports empty when nothing changed", async () => {
		stubUpstream({
			"/v1/wiki/changes": () => json(changeResponse([], false)),
		})
		const result = await loadWikiChanges(
			baseUpstream,
			"2026-11-16T00:00:00.000Z",
		)
		expect(result.kind).toBe("empty")
	})
})
