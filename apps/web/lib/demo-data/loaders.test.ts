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
import { json } from "./test-upstream.js"
import {
	loadContradictions,
	loadEntityOverview,
	loadRunSources,
	loadWikiChanges,
	loadWikiMap,
	type DemoDataUpstream,
	type RunManifestView,
} from "./loaders.js"

const baseUpstream = {
	apiBaseUrl: "http://upstream.test",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

/** Stubs the global fetch MdbrainClient uses, keyed by exact upstream path. */
function stubUpstream(routes: Record<string, (url: URL) => Response>): URL[] {
	const calls: URL[] = []
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL): Promise<Response> => {
			const raw =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url
			const url = new URL(raw)
			calls.push(url)
			const handler = routes[url.pathname]
			if (!handler) {
				return json(
					{
						error: { code: "NO_STUB", message: `no stub for ${url.pathname}` },
					},
					500,
				)
			}
			return handler(url)
		},
	)
	return calls
}

afterEach(() => {
	vi.unstubAllGlobals()
})

function claimView(): MdbrainWikiClaim {
	return {
		id: "claim-1",
		text: "Havnor renews the Halvorsen facility in 2027.",
		status: "active",
		confidence: 0.92,
		evidence: [{ kind: "event", sourceId: "evt-1" }],
		derivedFrom: [],
	}
}

function pageView(
	overrides: Partial<MdbrainWikiPageView> = {},
): MdbrainWikiPageView {
	return {
		_id: "page-1",
		kind: "person",
		title: "Halvorsen Renewal",
		slug: "halvorsen-renewal",
		aliases: [],
		summary: "What changed",
		body: "",
		frontmatter: { type: "person" },
		claims: [claimView()],
		contradictions: [],
		questions: [],
		relationships: [
			{ targetPageSlug: "havnor", targetTitle: "Havnor", kind: "related" },
		],
		personCard: null,
		scope: "workspace",
		scopeRef: "demo-run-2",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 3,
		validFrom: "2026-11-16T10:00:00.000Z",
		freshness: "fresh",
		createdAt: "2026-11-16T10:00:00.000Z",
		updatedAt: "2026-11-16T10:30:00.000Z",
		backlinks: [],
		transcludes: [],
		...overrides,
	}
}

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
		expect(result.data.pages).toEqual([
			{
				slug: "halvorsen-renewal",
				title: "Halvorsen Renewal",
				kind: "person",
				trustTier: "standard",
				state: "active",
				revision: 3,
				claimCount: 1,
				linkCount: 1,
				updatedAt: "2026-11-16T10:30:00.000Z",
			},
			{
				slug: "havnor",
				title: "Halvorsen Renewal",
				kind: "person",
				trustTier: "standard",
				state: "active",
				revision: 3,
				claimCount: 1,
				linkCount: 1,
				updatedAt: "2026-11-16T10:30:00.000Z",
			},
		])
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
	it("returns a flat unresolved list from the lint read", async () => {
		const lintCall = vi.fn(() =>
			json({
				pages: 2,
				total: 2,
				unresolvedContradictions: [
					{
						id: "c1",
						detectedAt: "2026-11-16T12:00:00.000Z",
						resolution: "unresolved",
						claims: [],
					},
				],
			}),
		)
		stubUpstream({ "/v1/wiki/lint": lintCall })
		const result = await loadContradictions(baseUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.unresolved).toEqual([
			{
				id: "c1",
				detectedAt: "2026-11-16T12:00:00.000Z",
				resolution: "unresolved",
				claims: [],
			},
		])
		expect(result.data.pageCount).toBe(2)
		expect(result.data.pageTotal).toBe(2)
		expect(lintCall).toHaveBeenCalledTimes(1)
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

describe("loadRunSources (D19 shape)", () => {
	function citeResponse(url: URL): Response {
		const marker = url.searchParams.get("marker") ?? ""
		const eventId = marker.replaceAll("[[event:", "").replaceAll("]]", "")
		const response: MdbrainCitationEventResponse = {
			status: "resolved",
			kind: "event",
			marker,
			citedBy: url.searchParams.get("citedBy") ?? "",
			event: {
				eventId,
				canonicalId: eventId,
				text: "Havnor renews the facility.",
				timestamp: "2026-11-16T08:00:00.000Z",
				scope: "workspace",
				scopeRef: "demo-run-2",
			},
		}
		return json(response)
	}
	function manifest(state: string, eventsWritten: string[]): RunManifestView {
		return {
			runId: "run-1",
			slotIndex: 1,
			scopeRef: "demo-run-2",
			agentId: "demo-run-2",
			state,
			eventsWritten,
		}
	}

	it("cites each manifest event in order through the pinned claim", async () => {
		const calls = stubUpstream({ "/v1/cite": citeResponse })
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () =>
				manifest("ready", ["evt-3", "evt-1", "evt-2"]),
			pinnedPage: {
				slug: "halvorsen-renewal",
				revision: 3,
				claims: [{ id: "claim-eta" }],
			},
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.runId).toBe("run-1")
		expect(result.data.state).toBe("ready")
		expect(result.data.events.map((event) => event.id)).toEqual([
			"evt-3",
			"evt-1",
			"evt-2",
		])
		expect(
			result.data.events.every(
				(event) => event.timestamp === "2026-11-16T08:00:00.000Z",
			),
		).toBe(true)
		expect(result.data.unresolvedEventIds).toEqual([])
		const citeCalls = calls.filter((url) => url.pathname === "/v1/cite")
		expect(citeCalls).toHaveLength(3)
		expect(citeCalls.map((url) => url.searchParams.get("marker"))).toEqual([
			"[[event:evt-3]]",
			"[[event:evt-1]]",
			"[[event:evt-2]]",
		])
		const citedBys = citeCalls.map((url) => url.searchParams.get("citedBy"))
		expect(citedBys[0]).toBe("[[wiki:halvorsen-renewal#claim-eta@r3]]")
		expect(citedBys.every((citedBy) => citedBy?.startsWith("[[wiki:"))).toBe(
			true,
		)
	})

	it("falls back to the first listed page's first claim when no page is pinned", async () => {
		const calls = stubUpstream({
			"/v1/wiki": () => json({ pages: [pageView()], total: 1 }),
			"/v1/wiki/halvorsen-renewal": () => json(pageView()),
			"/v1/cite": citeResponse,
		})
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () => manifest("ready", ["evt-1"]),
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.events).toHaveLength(1)
		const cite = calls.find((url) => url.pathname === "/v1/cite")
		expect(cite?.searchParams.get("citedBy")).toBe(
			"[[wiki:halvorsen-renewal#claim-1@r3]]",
		)
	})

	it("reports incomplete when the manifest state is not ready", async () => {
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () => manifest("seeding", ["evt-1"]),
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("incomplete")
		if (result.kind !== "incomplete") return
		expect(result.state).toBe("seeding")
		expect(result.reason).toBe("RUN_NOT_READY")
	})

	it("reports the run manifest gap when no manifest source exists", async () => {
		const result = await loadRunSources(baseUpstream)
		expect(result.kind).toBe("incomplete")
		if (result.kind !== "incomplete") return
		expect(result.reason).toBe("RUN_MANIFEST_NOT_EXPOSED")
		expect(result.state).toBeNull()
	})

	it("keeps the events whose cite resolves and names the rest unresolved", async () => {
		stubUpstream({
			"/v1/cite": (url) => {
				const marker = url.searchParams.get("marker") ?? ""
				if (marker === "[[event:evt-1]]") {
					return citeResponse(url)
				}
				return json(
					{ error: { code: "CITE_NOT_FOUND", message: "no such event" } },
					404,
				)
			},
		})
		const upstream: DemoDataUpstream = {
			...baseUpstream,
			getRunManifest: async () => manifest("ready", ["evt-1", "evt-2"]),
			pinnedPage: {
				slug: "halvorsen-renewal",
				revision: 3,
				claims: [{ id: "claim-eta" }],
			},
		}
		const result = await loadRunSources(upstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.events.map((event) => event.id)).toEqual(["evt-1"])
		expect(result.data.unresolvedEventIds).toEqual(["evt-2"])
	})
})
