import { afterEach, describe, expect, it, vi } from "vitest"
import {
	formatCitationMarker,
	type MdbrainWikiClaim,
	type MdbrainWikiOverviewResponse,
	type MdbrainWikiPageView,
} from "@mdbrain/client"
import { json, stubUpstream } from "./test-upstream.js"
import type { DemoDataUpstream } from "./loaders.js"
import {
	loadAgentActivity,
	loadClaimSources,
	loadContradictionCase,
	loadWikiSearch,
} from "./loaders-chapters.js"

const direct: DemoDataUpstream = {
	apiBaseUrl: "http://upstream.test",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

const eventMarker = (id: string) =>
	formatCitationMarker({ kind: "event", eventId: id })

function claim(
	slug: string,
	id: string,
	text: string,
	eventIds: string[] = [],
): MdbrainWikiClaim {
	return {
		id,
		text,
		status: "active",
		confidence: 0.9,
		marker: formatCitationMarker({
			kind: "wiki",
			slug,
			claimId: id,
			revision: 2,
		}),
		evidence: eventIds.map((eventId) => ({
			kind: "event" as const,
			sourceId: eventId,
			marker: eventMarker(eventId),
		})),
		derivedFrom: [],
	}
}

function cited(eventId: string, text: string | undefined, timestamp?: string) {
	return {
		status: "resolved",
		kind: "event",
		marker: eventMarker(eventId),
		citedBy: "x",
		event: {
			eventId,
			canonicalId: eventId,
			...(text !== undefined ? { text } : {}),
			...(timestamp !== undefined ? { timestamp } : {}),
			scope: "workspace",
			scopeRef: "demo-run-2",
		},
	}
}

describe("loadClaimSources", () => {
	it("cites every event the claim rests on, keeping business time apart", async () => {
		const c = claim(
			"accounts/halvorsen",
			"healthy",
			"The renewal is healthy.",
			["evt-1", "evt-2"],
		)
		const calls = stubUpstream({
			"/v1/cite": (url) => {
				const marker = url.searchParams.get("marker") ?? ""
				return marker === eventMarker("evt-1")
					? json(
							cited(
								"evt-1",
								"CRM note: budget confirmed.",
								"2026-09-14T15:20:00.000Z",
							),
						)
					: json(cited("evt-2", "Call recap with no date."))
			},
		})
		const result = await loadClaimSources(direct, c)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.sources).toEqual([
			{
				eventId: "evt-1",
				marker: eventMarker("evt-1"),
				status: "resolved",
				text: "CRM note: budget confirmed.",
				businessTime: "2026-09-14T15:20:00.000Z",
			},
			{
				eventId: "evt-2",
				marker: eventMarker("evt-2"),
				status: "resolved",
				text: "Call recap with no date.",
			},
		])
		expect(calls).toHaveLength(2)
		for (const url of calls) {
			expect(url.searchParams.get("citedBy")).toBe(c.marker)
		}
	})

	it("marks a source that cannot be cited instead of failing the claim", async () => {
		const c = claim("accounts/halvorsen", "healthy", "x", ["evt-1", "evt-9"])
		stubUpstream({
			"/v1/cite": (url) =>
				url.searchParams.get("marker") === eventMarker("evt-1")
					? json(cited("evt-1", "found", "2026-09-14T15:20:00.000Z"))
					: json({ error: { code: "NOT_FOUND", message: "gone" } }, 404),
		})
		const result = await loadClaimSources(direct, c)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.sources.map((s) => [s.eventId, s.status])).toEqual([
			["evt-1", "resolved"],
			["evt-9", "unavailable"],
		])
	})

	it("reports empty for a claim with no event evidence", async () => {
		const c = claim("a", "b", "x", [])
		stubUpstream({})
		expect((await loadClaimSources(direct, c)).kind).toBe("empty")
	})

	it("reports an error for a claim that carries no marker to cite through", async () => {
		const { marker: _marker, ...bare } = claim("a", "b", "x", ["evt-1"])
		stubUpstream({})
		const result = await loadClaimSources(direct, bare)
		expect(result.kind).toBe("error")
		if (result.kind === "error") expect(result.code).toBe("NO_CLAIM_MARKER")
	})
})

describe("loadContradictionCase", () => {
	const healthy = claim(
		"accounts/halvorsen",
		"healthy",
		"The renewal is healthy.",
		["evt-1"],
	)
	const unhealthy = claim(
		"risks/halvorsen",
		"unhealthy",
		"The renewal is not healthy.",
		["evt-2"],
	)
	const entry = {
		pageSlug: "accounts/halvorsen",
		pageTitle: "Halvorsen",
		contradiction: {
			id: "contra-1",
			claimIds: ["healthy", "unhealthy"],
			detectedAt: "2026-10-20T09:43:00.000Z",
			resolution: "unresolved",
		},
	}
	const overview = (items: unknown[]) =>
		({
			page: { slug: "accounts/halvorsen" } as MdbrainWikiPageView,
			contradictions: { items, hasMore: false },
			backlinks: { items: [], hasMore: false },
			neighbors: { items: [], hasMore: false },
			revisions: { items: [], hasMore: false },
			limits: {},
		}) as unknown as MdbrainWikiOverviewResponse
	const record = {
		id: "contra-1",
		detectedAt: "2026-10-20T09:43:00.000Z",
		resolution: "unresolved",
		note: "opposite negation",
		claims: [
			{
				pageSlug: "accounts/halvorsen",
				pageTitle: "Halvorsen",
				revision: 2,
				claim: healthy,
			},
			{
				pageSlug: "risks/halvorsen",
				pageTitle: "Halvorsen risk",
				revision: 1,
				claim: unhealthy,
			},
		],
	}

	it("reads the record from the overview of the page that holds it, with both sources", async () => {
		const calls = stubUpstream({
			"/v1/wiki/lint": () =>
				json({ pages: 3, total: 3, unresolvedContradictions: [entry] }),
			"/v1/wiki/overview/accounts%2Fhalvorsen": () => json(overview([record])),
			"/v1/cite": (url) => {
				const marker = url.searchParams.get("marker")
				return marker === eventMarker("evt-1")
					? json(cited("evt-1", "CRM: healthy", "2026-09-14T15:20:00.000Z"))
					: json(
							cited(
								"evt-2",
								"Ticket: eroded trust",
								"2026-09-20T08:00:00.000Z",
							),
						)
			},
		})
		const result = await loadContradictionCase(direct)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.id).toBe("contra-1")
		expect(result.data.detectedAt).toBe("2026-10-20T09:43:00.000Z")
		expect(result.data.unresolvedCount).toBe(1)
		expect(result.data.claims.map((c) => c.pageTitle)).toEqual([
			"Halvorsen",
			"Halvorsen risk",
		])
		expect(
			result.data.claims.map((c) =>
				c.sources.kind === "ready"
					? c.sources.data.sources[0]?.businessTime
					: undefined,
			),
		).toEqual(["2026-09-14T15:20:00.000Z", "2026-09-20T08:00:00.000Z"])
		expect(calls.map((u) => u.pathname)).toEqual([
			"/v1/wiki/lint",
			"/v1/wiki/overview/accounts%2Fhalvorsen",
			"/v1/cite",
			"/v1/cite",
		])
	})

	it("reports empty when the lint read lists none", async () => {
		stubUpstream({
			"/v1/wiki/lint": () =>
				json({ pages: 3, total: 3, unresolvedContradictions: [] }),
		})
		expect((await loadContradictionCase(direct)).kind).toBe("empty")
	})

	it("says a recorded contradiction is not readable instead of saying none is recorded", async () => {
		stubUpstream({
			"/v1/wiki/lint": () =>
				json({ pages: 3, total: 3, unresolvedContradictions: [entry] }),
			"/v1/wiki/overview/accounts%2Fhalvorsen": () => json(overview([])),
		})
		const result = await loadContradictionCase(direct)
		expect(result).toEqual({
			kind: "incomplete",
			reason: "CONTRADICTION_NOT_READABLE",
			state: null,
		})
	})

	it("says the same when the holding page is gone from the overview read", async () => {
		stubUpstream({
			"/v1/wiki/lint": () =>
				json({ pages: 3, total: 3, unresolvedContradictions: [entry] }),
			"/v1/wiki/overview/accounts%2Fhalvorsen": () =>
				json({ error: { code: "NOT_FOUND", message: "gone" } }, 404),
		})
		const result = await loadContradictionCase(direct)
		expect(result.kind).toBe("incomplete")
		if (result.kind === "incomplete") {
			expect(result.reason).toBe("CONTRADICTION_NOT_READABLE")
		}
	})

	it("keeps a claim whose sources cannot be read visible as an error, not as no sources", async () => {
		const { marker: _marker, ...unmarked } = claim(
			"accounts/halvorsen",
			"healthy",
			"The renewal is healthy.",
			["evt-1"],
		)
		stubUpstream({
			"/v1/wiki/lint": () =>
				json({ pages: 3, total: 3, unresolvedContradictions: [entry] }),
			"/v1/wiki/overview/accounts%2Fhalvorsen": () =>
				json(
					overview([
						{
							...record,
							claims: [
								{ ...record.claims[0], claim: unmarked },
								record.claims[1],
							],
						},
					]),
				),
			"/v1/cite": () =>
				json(cited("evt-2", "Ticket", "2026-09-20T08:00:00.000Z")),
		})
		const result = await loadContradictionCase(direct)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		const [first, second] = result.data.claims
		expect(first?.sources.kind).toBe("error")
		if (first?.sources.kind === "error") {
			expect(first.sources.code).toBe("NO_CLAIM_MARKER")
		}
		expect(second?.sources.kind).toBe("ready")
	})
})

describe("loadWikiSearch", () => {
	const page = (slug: string, claims: MdbrainWikiClaim[]) =>
		({
			slug,
			title: slug,
			summary: `About ${slug}`,
			claims,
		}) as unknown as MdbrainWikiPageView
	const envelope = {
		results: [
			{
				page: page("accounts/halvorsen", [
					claim("accounts/halvorsen", "fleet", "Halvorsen runs 4,200 trucks."),
					claim(
						"accounts/halvorsen",
						"healthy",
						"The Halvorsen renewal is healthy.",
					),
					claim("accounts/halvorsen", "arr", "Halvorsen brings $1.26M ARR."),
					claim("accounts/halvorsen", "owner", "Camille owns the account."),
				]),
				score: 4.2,
				source: "text",
			},
		],
		total: 1,
		recipe: "text",
		mode: "text-only",
	}

	it("asks the text lane for a bounded fixed-shape read and ranks claims by word overlap", async () => {
		let body: Record<string, unknown> = {}
		stubUpstream({
			"/v1/wiki/search": (_url, init) => {
				body = JSON.parse(String(init?.body))
				return json(envelope)
			},
		})
		const result = await loadWikiSearch(
			direct,
			"Is the Halvorsen renewal safe?",
		)
		expect(body).toMatchObject({
			query: "Is the Halvorsen renewal safe?",
			recipe: "text",
			scope: "workspace",
			scopeRef: "demo-run-2",
		})
		expect(typeof body.maxResults).toBe("number")
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.hits).toHaveLength(1)
		const hit = result.data.hits[0]
		expect(hit?.slug).toBe("accounts/halvorsen")
		expect(hit?.score).toBe(4.2)
		expect(hit?.claims).toHaveLength(3)
		expect(hit?.claims[0]?.id).toBe("healthy")
	})

	it("reports empty when nothing matches", async () => {
		stubUpstream({
			"/v1/wiki/search": () => json({ ...envelope, results: [], total: 0 }),
		})
		expect((await loadWikiSearch(direct, "zzz")).kind).toBe("empty")
	})

	it("says the lane is unavailable instead of an empty answer", async () => {
		stubUpstream({
			"/v1/wiki/search": () =>
				json(
					{
						error: {
							code: "SEARCH_UNAVAILABLE",
							message: "wiki search is currently unavailable",
						},
					},
					503,
				),
		})
		const result = await loadWikiSearch(direct, "renewal")
		expect(result.kind).toBe("error")
		if (result.kind === "error") expect(result.code).toBe("SEARCH_UNAVAILABLE")
	})

	it("refuses a blank question before any read", async () => {
		const calls = stubUpstream({})
		const result = await loadWikiSearch(direct, "   ")
		expect(result.kind).toBe("empty")
		expect(calls).toHaveLength(0)
	})
})

describe("loadAgentActivity", () => {
	it("reads as not yet in this run, never as an error and never as invented activity", () => {
		expect(loadAgentActivity()).toEqual({
			kind: "incomplete",
			reason: "AGENT_ACTIVITY_NOT_EXPOSED",
			state: null,
		})
	})
})
