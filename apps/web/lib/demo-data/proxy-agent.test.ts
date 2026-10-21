import { describe, expect, it } from "vitest"
import { handleDemoRead, readDemoProxyEnv, type DemoProxyEnv } from "./proxy.js"

const env: DemoProxyEnv = {
	apiBaseUrl: "http://127.0.0.1:3857",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-8",
	agentId: "demo-run-8",
}

const MARKER = "[[event:2586db50-1f0e-4c8d-9d6b-2a7d5f3e9a11]]"
const CITED_BY = "[[wiki:products/northstar-track#track-9-3-links@r1]]"
const CITE = `/api/demo/v1/cite?marker=${encodeURIComponent(MARKER)}&citedBy=${encodeURIComponent(CITED_BY)}`

type Seen = { url: URL; body: string | null }

function recorder(): { fetch: typeof fetch; seen: Seen[] } {
	const seen: Seen[] = []
	const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
		const raw =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url
		seen.push({
			url: new URL(raw),
			body: typeof init?.body === "string" ? init.body : null,
		})
		return new Response("{}", {
			status: 200,
			headers: { "content-type": "application/json" },
		})
	}
	return { fetch: impl as typeof fetch, seen }
}

function get(pathAndQuery: string): Request {
	return new Request(`http://demo.local${pathAndQuery}`)
}

describe("the pinned run's agent", () => {
	it("is sent on a citation read, because event recall searches as that agent", async () => {
		const upstream = recorder()
		const response = await handleDemoRead(get(CITE), env, upstream.fetch)
		expect(response.status).toBe(200)
		expect(upstream.seen[0].url.pathname).toBe("/v1/cite")
		expect(upstream.seen[0].url.searchParams.get("agentId")).toBe("demo-run-8")
	})

	it("is sent on no other read, because none of them reads it", async () => {
		const upstream = recorder()
		for (const path of [
			"/api/demo/v1/wiki?limit=5",
			"/api/demo/v1/wiki/products%2Fnorthstar-track",
			"/api/demo/v1/wiki/overview/products%2Fnorthstar-track",
			"/api/demo/v1/wiki/changes?since=2026-10-20T00:00:00Z",
			"/api/demo/v1/wiki/lint?limit=5",
			"/api/demo/v1/wiki/search?query=northstar",
		]) {
			await handleDemoRead(get(path), env, upstream.fetch)
		}
		expect(upstream.seen).toHaveLength(6)
		for (const call of upstream.seen) {
			expect(call.url.searchParams.has("agentId"), call.url.pathname).toBe(
				false,
			)
			expect(call.body ?? "").not.toContain("agentId")
		}
	})

	it("still comes only from the server: a caller's agentId on a citation is refused", async () => {
		const upstream = recorder()
		for (const agentId of ["demo-run-8", "main", ""]) {
			const response = await handleDemoRead(
				get(`${CITE}&agentId=${agentId}`),
				env,
				upstream.fetch,
			)
			expect(response.status).toBe(400)
		}
		expect(upstream.seen).toHaveLength(0)
	})
})

describe("MDBRAIN_DEMO_AGENT_ID", () => {
	const base = {
		MDBRAIN_DEMO_API_BASE_URL: "http://127.0.0.1:3857",
		MDBRAIN_DEMO_READ_KEY: "k",
		MDBRAIN_DEMO_SCOPE_REF: "demo-run-8",
	}

	it("is read with the other server-only variables", () => {
		expect(
			readDemoProxyEnv({ ...base, MDBRAIN_DEMO_AGENT_ID: "demo-run-8" }),
		).toEqual({
			apiBaseUrl: "http://127.0.0.1:3857",
			readKey: "k",
			scope: "workspace",
			scopeRef: "demo-run-8",
			agentId: "demo-run-8",
		})
	})

	it("is required, so a proxy that cannot cite never starts", () => {
		expect(readDemoProxyEnv(base)).toBeNull()
		expect(
			readDemoProxyEnv({ ...base, MDBRAIN_DEMO_AGENT_ID: "  " }),
		).toBeNull()
	})

	it("is validated like the scope ref", () => {
		for (const bad of ["bad agent!", "a/b", "x".repeat(129), "demo run"]) {
			expect(
				readDemoProxyEnv({ ...base, MDBRAIN_DEMO_AGENT_ID: bad }),
				bad,
			).toBeNull()
		}
		expect(
			readDemoProxyEnv({ ...base, MDBRAIN_DEMO_AGENT_ID: " demo-run-8 " })
				?.agentId,
		).toBe("demo-run-8")
	})
})
