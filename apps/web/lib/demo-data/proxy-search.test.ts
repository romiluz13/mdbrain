import { describe, expect, it } from "vitest"
import {
	DEMO_READ_OPERATIONS,
	handleDemoRead,
	type DemoProxyEnv,
} from "./proxy.js"

const env: DemoProxyEnv = {
	apiBaseUrl: "http://127.0.0.1:3857",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
}

type UpstreamCall = { url: URL; method: string; headers: Headers; body: string }

function upstream(answer: () => Response = () => json({ results: [], total: 0 })) {
	const calls: UpstreamCall[] = []
	const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(
			typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
		)
		calls.push({
			url,
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			body: init?.body ? String(init.body) : "",
		})
		return answer()
	}
	return { fetch: impl as typeof fetch, calls }
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

const get = (pathAndQuery: string, method = "GET") =>
	new Request(`http://demo.local${pathAndQuery}`, { method })

describe("the governed search read", () => {
	it("is on the allowlist for the ask chapter", () => {
		expect(DEMO_READ_OPERATIONS).toContainEqual({
			operation: "wiki-search",
			upstream: "POST /v1/wiki/search",
			chapter: "ask",
		})
	})

	it("sends one fixed-shape upstream read: the text lane, the server's scope, a bounded result count", async () => {
		const up = upstream(() => json({ results: [], total: 0, recipe: "text" }))
		const response = await handleDemoRead(
			get("/api/demo/v1/wiki/search?query=Is%20the%20Halvorsen%20renewal%20safe%3F"),
			env,
			up.fetch,
		)
		expect(response.status).toBe(200)
		expect(up.calls).toHaveLength(1)
		const call = up.calls[0] as UpstreamCall
		expect(call.method).toBe("POST")
		expect(call.url.pathname).toBe("/v1/wiki/search")
		expect(call.url.search).toBe("")
		expect(call.headers.get("authorization")).toBe("Bearer test-read-key-123")
		expect(call.headers.get("content-type")).toBe("application/json")
		expect(JSON.parse(call.body)).toEqual({
			scope: "workspace",
			scopeRef: "demo-run-2",
			query: "Is the Halvorsen renewal safe?",
			recipe: "text",
			maxResults: 6,
		})
	})

	it("lets the caller lower the result count, within bounds", async () => {
		const up = upstream()
		await handleDemoRead(get("/api/demo/v1/wiki/search?query=renewal&maxResults=3"), env, up.fetch)
		expect(JSON.parse((up.calls[0] as UpstreamCall).body).maxResults).toBe(3)
		for (const bad of ["0", "11", "x"]) {
			const refused = await handleDemoRead(
				get(`/api/demo/v1/wiki/search?query=renewal&maxResults=${bad}`),
				env,
				up.fetch,
			)
			expect(refused.status).toBe(400)
		}
		expect(up.calls).toHaveLength(1)
	})

	it.each([
		["a missing query", "/api/demo/v1/wiki/search"],
		["a blank query", "/api/demo/v1/wiki/search?query=%20%20"],
		["a query over 200 characters", `/api/demo/v1/wiki/search?query=${"a".repeat(201)}`],
		["a control character", "/api/demo/v1/wiki/search?query=a%00b"],
		["a repeated query", "/api/demo/v1/wiki/search?query=a&query=b"],
		["a caller-chosen lane", "/api/demo/v1/wiki/search?query=a&recipe=hybrid"],
		["a caller-set filter", "/api/demo/v1/wiki/search?query=a&state=draft"],
		["a caller-set scope", "/api/demo/v1/wiki/search?query=a&scope=agent"],
		["a caller-set scopeRef", "/api/demo/v1/wiki/search?query=a&scopeRef=demo-run-2"],
	])("refuses %s before any upstream call", async (_name, path) => {
		const up = upstream()
		const response = await handleDemoRead(get(path), env, up.fetch)
		expect(response.status).toBe(400)
		expect(up.calls).toHaveLength(0)
	})

	it("is a GET toward the caller: a POST is refused", async () => {
		const up = upstream()
		const response = await handleDemoRead(get("/api/demo/v1/wiki/search?query=a", "POST"), env, up.fetch)
		expect(response.status).toBe(405)
		expect(up.calls).toHaveLength(0)
	})

	it("passes an upstream outage through and keeps the key out of the body", async () => {
		const up = upstream(() =>
			json({ error: { code: "SEARCH_UNAVAILABLE", message: "down test-read-key-123" } }, 503),
		)
		const response = await handleDemoRead(get("/api/demo/v1/wiki/search?query=a"), env, up.fetch)
		expect(response.status).toBe(503)
		const text = await response.text()
		expect(text).toContain("SEARCH_UNAVAILABLE")
		expect(text).not.toContain("test-read-key-123")
	})
})
