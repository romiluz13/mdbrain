// The loaders' production path, exercised for real. In production the /demo
// page runs these loaders in the browser against the same-origin /api/demo
// route, so the client transport must speak exactly the paths handleDemoRead
// serves - prefix included - and must leave the principal to the proxy
// (handleDemoRead injects scope and scopeRef, and refuses caller-set ones).
// These tests stub only the upstream fetch the proxy itself uses, so a
// loader read has to survive the whole path (client encoding -> /api/demo
// prefix -> slug rules -> principal injection -> upstream call) to pass.
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
	MdbrainWikiOverviewResponse,
	MdbrainWikiPageView,
} from "@mdbrain/client"
import {
	loadEntityOverview,
	loadWikiMap,
	type DemoDataUpstream,
} from "./loaders.js"
import { loadWikiSearch } from "./loaders-chapters.js"
import { handleDemoRead, type DemoProxyEnv } from "./proxy.js"

const proxyEnv: DemoProxyEnv = {
	apiBaseUrl: "http://upstream.test",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

// The loader reads against the demo route prefix, exactly as production
// does; the principal is left to the proxy and the key is a placeholder.
const proxyUpstream: DemoDataUpstream = {
	apiBaseUrl: "http://demo-proxy.local/api/demo",
	readKey: "loader-placeholder-key",
}

type UpstreamCall = { url: URL; authorization: string }

function stubUpstreamFetch(routes: Record<string, () => unknown>): {
	fetch: typeof fetch
	calls: UpstreamCall[]
} {
	const calls: UpstreamCall[] = []
	const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
		const raw =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url
		const url = new URL(raw)
		calls.push({
			url,
			authorization: new Headers(init?.headers).get("authorization") ?? "",
		})
		const handler = routes[url.pathname]
		if (!handler) {
			return new Response(
				JSON.stringify({
					error: { code: "NO_STUB", message: `no stub for ${url.pathname}` },
				}),
				{ status: 500, headers: { "content-type": "application/json" } },
			)
		}
		return new Response(JSON.stringify(handler()), {
			headers: { "content-type": "application/json" },
		})
	}
	return { fetch: impl as typeof fetch, calls }
}

/** The loaders' client fetches land on /api/demo; handleDemoRead - the same
 * handler the deployed route uses - carries them upstream. */
function stubProxyFetch(upstreamFetch: typeof fetch): void {
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const raw =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url
			return handleDemoRead(new Request(raw, init), proxyEnv, upstreamFetch)
		},
	)
}

function pageView(slug: string): MdbrainWikiPageView {
	return {
		_id: "page-1",
		kind: "team",
		title: "Support Team",
		slug,
		aliases: [],
		summary: "What changed",
		body: "",
		frontmatter: { type: "team" },
		claims: [],
		contradictions: [],
		questions: [],
		relationships: [],
		personCard: null,
		scope: "workspace",
		scopeRef: "demo-run-2",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 2,
		validFrom: "2026-11-16T10:00:00.000Z",
		freshness: "fresh",
		createdAt: "2026-11-16T10:00:00.000Z",
		updatedAt: "2026-11-16T10:30:00.000Z",
		backlinks: [],
		transcludes: [],
	}
}

function overviewResponse(slug: string): MdbrainWikiOverviewResponse {
	return {
		page: pageView(slug),
		contradictions: { items: [], hasMore: false },
		backlinks: { items: [], hasMore: false },
		neighbors: { items: [], hasMore: false },
		revisions: { items: [], hasMore: false },
		limits: {
			backlinks: 10,
			neighbors: 10,
			neighborClaims: 5,
			revisions: 5,
			contradictions: 10,
		},
	}
}

describe("loaders through the demo proxy route", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("walks the wiki map through /api/demo with the proxy's principal", async () => {
		const upstream = stubUpstreamFetch({
			"/v1/wiki": () => ({
				pages: [pageView("teams/support")],
				total: 1,
			}),
			"/v1/wiki/lint": () => ({
				pages: 1,
				total: 1,
				unresolvedContradictions: [],
			}),
		})
		stubProxyFetch(upstream.fetch)
		const result = await loadWikiMap(proxyUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.pages).toHaveLength(1)
		expect(result.data.pages[0].slug).toBe("teams/support")
		const list = upstream.calls.find((call) => call.url.pathname === "/v1/wiki")
		expect(list?.url.searchParams.get("scope")).toBe("workspace")
		expect(list?.url.searchParams.get("scopeRef")).toBe("demo-run-2")
		expect(list?.authorization).toBe("Bearer test-read-key-123")
	})

	it("reads a hierarchical overview slug through the proxy", async () => {
		const upstream = stubUpstreamFetch({
			"/v1/wiki/overview/teams%2Fsupport": () =>
				overviewResponse("teams/support"),
		})
		stubProxyFetch(upstream.fetch)
		const result = await loadEntityOverview("teams/support", proxyUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(result.data.page.slug).toBe("teams/support")
		expect(upstream.calls[0].url.pathname).toBe(
			"/v1/wiki/overview/teams%2Fsupport",
		)
		expect(upstream.calls[0].url.searchParams.get("scopeRef")).toBe(
			"demo-run-2",
		)
		expect(upstream.calls[0].authorization).toBe("Bearer test-read-key-123")
	})

	it("reads an overview slug that starts with changes/ through the proxy", async () => {
		const upstream = stubUpstreamFetch({
			"/v1/wiki/overview/changes%2Fold-page": () =>
				overviewResponse("changes/old-page"),
		})
		stubProxyFetch(upstream.fetch)
		const result = await loadEntityOverview("changes/old-page", proxyUpstream)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") return
		expect(upstream.calls[0].url.pathname).toBe(
			"/v1/wiki/overview/changes%2Fold-page",
		)
	})
})

describe("the search read through the whole production path", () => {
	it("goes out as one fixed-shape upstream POST with the server's scope", async () => {
		const seen: Array<{
			url: URL
			method: string
			body: Record<string, unknown>
		}> = []
		const upstreamFetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url,
			)
			seen.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(String(init.body)) : {},
			})
			return new Response(
				JSON.stringify({
					results: [],
					total: 0,
					recipe: "text",
					mode: "text-only",
				}),
				{ headers: { "content-type": "application/json" } },
			)
		}) as typeof fetch
		stubProxyFetch(upstreamFetch)
		const result = await loadWikiSearch(proxyUpstream, "Is the renewal safe?")
		expect(result.kind).toBe("empty")
		expect(seen).toHaveLength(1)
		expect(seen[0]?.method).toBe("POST")
		expect(seen[0]?.url.pathname).toBe("/v1/wiki/search")
		expect(seen[0]?.url.search).toBe("")
		expect(seen[0]?.body).toEqual({
			scope: "workspace",
			scopeRef: "demo-run-2",
			query: "Is the renewal safe?",
			recipe: "text",
			maxResults: 6,
		})
	})
})
