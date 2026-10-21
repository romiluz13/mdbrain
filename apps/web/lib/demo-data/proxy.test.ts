import { describe, expect, it, vi } from "vitest"
import { handleDemoRead, readDemoProxyEnv, type DemoProxyEnv } from "./proxy.js"

const env: DemoProxyEnv = {
	apiBaseUrl: "http://127.0.0.1:3857",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-2",
	agentId: "demo-run-2",
}

function request(pathAndQuery: string, method = "GET"): Request {
	return new Request(`http://demo.local${pathAndQuery}`, { method })
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

type UpstreamCall = { url: URL; headers: Headers }

function stubUpstream(
	handle: (url: URL) => Response = () => json({ ok: true }),
): { fetch: typeof fetch; calls: UpstreamCall[] } {
	const calls: UpstreamCall[] = []
	const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
		const raw =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url
		const url = new URL(raw)
		calls.push({ url, headers: new Headers(init?.headers) })
		return handle(url)
	}
	return { fetch: impl as typeof fetch, calls }
}

async function bodyOf(response: Response): Promise<unknown> {
	return JSON.parse(await response.text())
}

describe("allowlist forwarding", () => {
	it("forwards the wiki list read with the scope set by the server", async () => {
		const upstream = stubUpstream(() => json({ pages: [], total: 0 }))
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki?limit=100"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(200)
		expect(await bodyOf(response)).toEqual({ pages: [], total: 0 })
		expect(upstream.calls).toHaveLength(1)
		const call = upstream.calls[0]
		expect(call.url.pathname).toBe("/v1/wiki")
		expect(call.url.searchParams.get("scope")).toBe("workspace")
		expect(call.url.searchParams.get("scopeRef")).toBe("demo-run-2")
		expect(call.url.searchParams.get("limit")).toBe("100")
		expect(call.headers.get("authorization")).toBe("Bearer test-read-key-123")
	})

	it("forwards a page read", async () => {
		const upstream = stubUpstream(() => json({ slug: "halvorsen-renewal" }))
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki/halvorsen-renewal"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(200)
		expect(upstream.calls[0].url.pathname).toBe("/v1/wiki/halvorsen-renewal")
		expect(upstream.calls[0].url.searchParams.get("scopeRef")).toBe(
			"demo-run-2",
		)
	})

	it("forwards the overview read with its bounds", async () => {
		const upstream = stubUpstream(() => json({ page: {} }))
		await handleDemoRead(
			request(
				"/api/demo/v1/wiki/overview/halvorsen-renewal?maxBacklinks=10&maxContradictions=5",
			),
			env,
			upstream.fetch,
		)
		const { url } = upstream.calls[0]
		expect(url.pathname).toBe("/v1/wiki/overview/halvorsen-renewal")
		expect(url.searchParams.get("maxBacklinks")).toBe("10")
		expect(url.searchParams.get("maxContradictions")).toBe("5")
	})

	it("forwards the changes read", async () => {
		const upstream = stubUpstream(() => json({ changes: [] }))
		await handleDemoRead(
			request("/api/demo/v1/wiki/changes?since=2026-01-01T00:00:00Z&limit=50"),
			env,
			upstream.fetch,
		)
		const { url } = upstream.calls[0]
		expect(url.pathname).toBe("/v1/wiki/changes")
		expect(url.searchParams.get("since")).toBe("2026-01-01T00:00:00Z")
		expect(url.searchParams.get("scopeRef")).toBe("demo-run-2")
	})

	it("forwards the lint read", async () => {
		const upstream = stubUpstream(() => json({ unresolvedContradictions: [] }))
		await handleDemoRead(
			request("/api/demo/v1/wiki/lint?limit=100"),
			env,
			upstream.fetch,
		)
		expect(upstream.calls[0].url.pathname).toBe("/v1/wiki/lint")
	})

	it("forwards a citation with its marker and citing claim", async () => {
		const upstream = stubUpstream(() => json({ kind: "event" }))
		const marker = "[[event:evt-42]]"
		const citedBy = "[[wiki:halvorsen-renewal#claim-eta@r3]]"
		const query = `marker=${encodeURIComponent(marker)}&citedBy=${encodeURIComponent(citedBy)}`
		const response = await handleDemoRead(
			request(`/api/demo/v1/cite?${query}`),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(200)
		const { url } = upstream.calls[0]
		expect(url.pathname).toBe("/v1/cite")
		expect(url.searchParams.get("marker")).toBe(marker)
		expect(url.searchParams.get("citedBy")).toBe(citedBy)
	})

	it("passes upstream statuses and envelopes through unchanged", async () => {
		const upstream = stubUpstream(() =>
			json({ error: { code: "WIKI_NOT_FOUND", message: "no such page" } }, 404),
		)
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki/no-such-page"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(404)
		expect(await bodyOf(response)).toEqual({
			error: { code: "WIKI_NOT_FOUND", message: "no such page" },
		})
	})
})

describe("hierarchical and reserved slugs", () => {
	it("forwards a multi-segment page slug in the raw-slash form", async () => {
		const upstream = stubUpstream(() => json({ slug: "teams/support" }))
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki/teams/support"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(200)
		expect(upstream.calls[0].url.pathname).toBe("/v1/wiki/teams%2Fsupport")
		expect(upstream.calls[0].url.searchParams.get("scopeRef")).toBe(
			"demo-run-2",
		)
	})

	it("forwards a multi-segment page slug in the SDK's encoded form", async () => {
		const upstream = stubUpstream(() => json({ slug: "teams/support" }))
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki/teams%2Fsupport"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(200)
		expect(upstream.calls[0].url.pathname).toBe("/v1/wiki/teams%2Fsupport")
	})

	it("forwards a multi-segment overview slug in both forms", async () => {
		for (const path of [
			"/api/demo/v1/wiki/overview/teams/support",
			"/api/demo/v1/wiki/overview/teams%2Fsupport",
		]) {
			const upstream = stubUpstream(() => json({ page: {} }))
			const response = await handleDemoRead(request(path), env, upstream.fetch)
			expect(response.status, path).toBe(200)
			expect(upstream.calls[0].url.pathname, path).toBe(
				"/v1/wiki/overview/teams%2Fsupport",
			)
		}
	})

	it("reads a page whose slug starts with overview/ through the SDK form", async () => {
		const upstream = stubUpstream(() => json({ slug: "overview/old-page" }))
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki/overview%2Fold-page"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(200)
		expect(upstream.calls[0].url.pathname).toBe("/v1/wiki/overview%2Fold-page")
	})

	it("reads a page whose slug starts with changes/ in both forms", async () => {
		for (const path of [
			"/api/demo/v1/wiki/changes/old-page",
			"/api/demo/v1/wiki/changes%2Fold-page",
		]) {
			const upstream = stubUpstream(() => json({ slug: "changes/old-page" }))
			const response = await handleDemoRead(request(path), env, upstream.fetch)
			expect(response.status, path).toBe(200)
			expect(upstream.calls[0].url.pathname, path).toBe(
				"/v1/wiki/changes%2Fold-page",
			)
		}
	})

	it("reads a page whose slug starts with a reserved segment through the SDK form", async () => {
		for (const encoded of [
			"lint%2Fnotes",
			"revisions%2Fnotes",
			"okf-export%2Fsheet",
		]) {
			const upstream = stubUpstream(() => json({}))
			const response = await handleDemoRead(
				request(`/api/demo/v1/wiki/${encoded}`),
				env,
				upstream.fetch,
			)
			expect(response.status, encoded).toBe(200)
			expect(upstream.calls[0].url.pathname, encoded).toBe(
				`/v1/wiki/${encoded}`,
			)
		}
	})

	it("still refuses the revisions and okf sub-routes at any depth", async () => {
		const upstream = stubUpstream()
		const refused = [
			"/api/demo/v1/wiki/revisions",
			"/api/demo/v1/wiki/revisions/5",
			"/api/demo/v1/wiki/okf-export",
			"/api/demo/v1/wiki/okf-import/x",
			"/api/demo/v1/wiki/overview",
		]
		for (const path of refused) {
			const response = await handleDemoRead(request(path), env, upstream.fetch)
			expect(response.status, path).toBe(404)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "UNKNOWN_OPERATION" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses unsafe segments inside a multi-segment slug", async () => {
		const upstream = stubUpstream()
		const refused = [
			"/api/demo/v1/wiki/teams//support",
			"/api/demo/v1/wiki/teams%2F.",
			"/api/demo/v1/wiki/teams%2F..%2Fadmin",
			"/api/demo/v1/wiki/teams%5cadmin",
			"/api/demo/v1/wiki/teams%2Fslug%00",
		]
		for (const path of refused) {
			const response = await handleDemoRead(request(path), env, upstream.fetch)
			expect(response.status, path).toBe(400)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "UNSAFE_PATH" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})
})
describe("refusals", () => {
	it("refuses non-GET methods", async () => {
		const upstream = stubUpstream()
		for (const method of ["POST", "PATCH", "DELETE", "PUT"] as const) {
			const response = await handleDemoRead(
				request("/api/demo/v1/wiki", method),
				env,
				upstream.fetch,
			)
			expect(response.status, method).toBe(405)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "METHOD_NOT_ALLOWED" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses operations outside the allowlist, including admin routes and writes", async () => {
		const upstream = stubUpstream()
		const refused = [
			"/api/demo/v1/admin/deliveries",
			"/api/demo/v1/admin/wiki-promotions/op-1/approve",
			"/api/demo/v1/wiki/okf-export",
			"/api/demo/v1/wiki/okf-import",
			"/api/demo/v1/lifecycle/delete",
			"/api/demo/v1/search",
			"/api/demo/v1/state",
			"/api/demo/v1/wiki/revisions",
			"/api/demo/v2/wiki",
			"/api/demo/anything",
			"/api/demo",
			"/api/other/v1/wiki",
		]
		for (const path of refused) {
			const response = await handleDemoRead(request(path), env, upstream.fetch)
			expect(response.status, path).toBe(404)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "UNKNOWN_OPERATION" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses a scope, scopeRef or agentId from the caller, even the pinned one", async () => {
		const upstream = stubUpstream()
		const queries = [
			"scopeRef=demo-run-9",
			"scopeRef=demo-run-2",
			"scope=workspace",
			"agentId=demo-run-2",
			"containerTag=demo-run-2",
		]
		for (const query of queries) {
			const response = await handleDemoRead(
				request(`/api/demo/v1/wiki?limit=5&${query}`),
				env,
				upstream.fetch,
			)
			expect(response.status, query).toBe(400)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "UNKNOWN_PARAMETER" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses unknown query parameters", async () => {
		const upstream = stubUpstream()
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki?limit=5&frobnicate=yes"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(400)
		expect(await bodyOf(response)).toMatchObject({
			error: {
				code: "UNKNOWN_PARAMETER",
				message: expect.stringContaining("frobnicate"),
			},
		})
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses repeated query parameters", async () => {
		const upstream = stubUpstream()
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki?limit=5&limit=6"),
			env,
			upstream.fetch,
		)
		expect(response.status).toBe(400)
		expect(await bodyOf(response)).toMatchObject({
			error: { code: "INVALID_PARAMETER" },
		})
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses invalid values for allowlisted parameters", async () => {
		const upstream = stubUpstream()
		const cases: Array<[string, string]> = [
			["/api/demo/v1/wiki", "limit=0"],
			["/api/demo/v1/wiki", "limit=101"],
			["/api/demo/v1/wiki", "limit=many"],
			["/api/demo/v1/wiki", "skip=-1"],
			["/api/demo/v1/wiki", "kind=../../admin"],
			["/api/demo/v1/wiki/slug", "format=xml"],
			["/api/demo/v1/wiki/slug", "transclude=maybe"],
			["/api/demo/v1/wiki/overview/slug", "maxBacklinks=0"],
			["/api/demo/v1/wiki/changes", "since=not-a-date"],
			["/api/demo/v1/wiki/changes", "cursor=has%20spaces"],
			["/api/demo/v1/cite", "marker=[[bogus:thing]]"],
			["/api/demo/v1/cite", "marker=[[event:evt-1]]"],
			["/api/demo/v1/cite", "marker=[[event:evt-1]]&citedBy=[[event:evt-2]]"],
		]
		for (const [path, query] of cases) {
			const response = await handleDemoRead(
				request(`${path}?${query}`),
				env,
				upstream.fetch,
			)
			expect(response.status, query).toBe(400)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "INVALID_PARAMETER" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})

	it("refuses path traversal and encoded traversal in slugs", async () => {
		const upstream = stubUpstream()
		// The URL parser normalizes ".", "..", "%2e" and "%2e%2e" dot segments
		// away before any handler sees them, so the forms that can actually
		// arrive are the ones that decode to traversal or unsafe segments. An
		// encoded separator alone is the SDK's own form for a hierarchical
		// slug; what stays refused is what the slug decodes to.
		const refused = [
			"/api/demo/v1/wiki/..%2f..%2fadmin",
			"/api/demo/v1/wiki/overview/team%2F..%2Fadmin",
			"/api/demo/v1/wiki/overview/%2e%2e%2fadmin",
			"/api/demo/v1/wiki/slug%00",
		]
		for (const path of refused) {
			const response = await handleDemoRead(request(path), env, upstream.fetch)
			expect(response.status, path).toBe(400)
			expect(await bodyOf(response)).toMatchObject({
				error: { code: "UNSAFE_PATH" },
			})
		}
		expect(upstream.calls).toHaveLength(0)
	})
})

describe("key protection", () => {
	it("redacts the read key if the upstream echoes it", async () => {
		const upstream = stubUpstream(() =>
			json(
				{
					error: {
						code: "INTERNAL",
						message: "auth failed for test-read-key-123",
					},
				},
				500,
			),
		)
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki?limit=5"),
			env,
			upstream.fetch,
		)
		const text = await response.text()
		expect(response.status).toBe(500)
		expect(text).not.toContain("test-read-key-123")
		expect(text).toContain("[redacted]")
	})

	it("reports upstream reachability failures without the key and never logs it", async () => {
		const spies = [
			vi.spyOn(console, "log"),
			vi.spyOn(console, "info"),
			vi.spyOn(console, "warn"),
			vi.spyOn(console, "error"),
		].map((spy) => spy.mockImplementation(() => {}))
		const fetchImpl = (async () => {
			throw new Error("connect ECONNREFUSED for test-read-key-123")
		}) as typeof fetch
		const response = await handleDemoRead(
			request("/api/demo/v1/wiki?limit=5"),
			env,
			fetchImpl,
		)
		expect(response.status).toBe(502)
		const text = await response.text()
		expect(text).not.toContain("test-read-key-123")
		expect(JSON.parse(text)).toMatchObject({
			error: { code: "UPSTREAM_UNREACHABLE" },
		})
		const logged = spies
			.map((spy) => spy.mock.calls.flat().map(String).join(" "))
			.join(" ")
		expect(logged).not.toContain("test-read-key-123")
		for (const spy of spies) spy.mockRestore()
	})
})

describe("readDemoProxyEnv", () => {
	it("reads the server-only variables", () => {
		expect(
			readDemoProxyEnv({
				MDBRAIN_DEMO_API_BASE_URL: "http://127.0.0.1:3857",
				MDBRAIN_DEMO_READ_KEY: "k",
				MDBRAIN_DEMO_SCOPE_REF: "demo-run-1",
				MDBRAIN_DEMO_AGENT_ID: "demo-run-1",
			}),
		).toEqual({
			apiBaseUrl: "http://127.0.0.1:3857",
			readKey: "k",
			scope: "workspace",
			scopeRef: "demo-run-1",
			agentId: "demo-run-1",
		})
	})

	it("returns null when the env is incomplete or malformed", () => {
		expect(readDemoProxyEnv({})).toBeNull()
		expect(
			readDemoProxyEnv({
				MDBRAIN_DEMO_API_BASE_URL: "http://x",
				MDBRAIN_DEMO_READ_KEY: "k",
			}),
		).toBeNull()
		expect(
			readDemoProxyEnv({
				MDBRAIN_DEMO_API_BASE_URL: "not-a-url",
				MDBRAIN_DEMO_READ_KEY: "k",
				MDBRAIN_DEMO_SCOPE_REF: "demo-run-1",
			}),
		).toBeNull()
		expect(
			readDemoProxyEnv({
				MDBRAIN_DEMO_API_BASE_URL: "http://x",
				MDBRAIN_DEMO_READ_KEY: "",
				MDBRAIN_DEMO_SCOPE_REF: "demo-run-1",
			}),
		).toBeNull()
		expect(
			readDemoProxyEnv({
				MDBRAIN_DEMO_API_BASE_URL: "http://x",
				MDBRAIN_DEMO_READ_KEY: "k",
				MDBRAIN_DEMO_SCOPE_REF: "bad ref!",
			}),
		).toBeNull()
	})

	it("honors an explicit demo scope", () => {
		expect(
			readDemoProxyEnv({
				MDBRAIN_DEMO_API_BASE_URL: "http://x",
				MDBRAIN_DEMO_READ_KEY: "k",
				MDBRAIN_DEMO_SCOPE_REF: "demo-run-1",
				MDBRAIN_DEMO_AGENT_ID: "demo-run-1",
				MDBRAIN_DEMO_SCOPE: "other",
			})?.scope,
		).toBe("other")
	})
})
