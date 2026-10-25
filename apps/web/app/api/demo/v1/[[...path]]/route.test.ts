import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { json } from "@/lib/demo-data/test-upstream.js"

const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: () => ({ env: cf.env }),
}))

const NOT_CONFIGURED = {
	error: {
		code: "PROXY_NOT_CONFIGURED",
		message: "the demo read proxy is missing its server configuration",
	},
}

const reader = {
	subjectId: "demo-reader-2",
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef: "demo-run-2" }],
}

function stubApi(principal: () => Response | Promise<Response>): string[] {
	const calls: string[] = []
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		calls.push(url.pathname)
		return url.pathname === "/v1/principal/self"
			? principal()
			: json({ pages: [], total: 0 })
	})
	return calls
}

// The check's verdict lives for the module, as it does for the process.
async function freshRoute() {
	vi.resetModules()
	return import("./route.js")
}

const visit = (path = "/api/demo/v1/wiki?limit=100") =>
	new Request(`http://demo.local${path}`)

beforeEach(() => {
	vi.stubEnv("MDBRAIN_DEMO_API_BASE_URL", "http://upstream.test")
	vi.stubEnv("MDBRAIN_DEMO_READ_KEY", "configured-key")
	vi.stubEnv("MDBRAIN_DEMO_SCOPE", "workspace")
	vi.stubEnv("MDBRAIN_DEMO_SCOPE_REF", "demo-run-2")
	vi.stubEnv("MDBRAIN_DEMO_AGENT_ID", "demo-run-2")
	vi.stubEnv("MDBRAIN_DEMO_CONTROL_URI", "")
	vi.stubEnv("MDBRAIN_DEMO_RUN_ID", "")
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	cf.env = {}
})

describe("the demo read route", () => {
	it("answers not-configured to every visitor, and sends no visitor read upstream, when the key can do more than read its one scope", async () => {
		const calls = stubApi(() =>
			json({
				subjectId: "api-key:admin",
				trustTier: "admin",
				capabilities: ["read", "write", "administer"],
				grants: [{ scope: "*", scopeRef: "*" }],
			}),
		)
		const { GET } = await freshRoute()
		for (const path of [
			"/api/demo/v1/wiki?limit=100",
			"/api/demo/v1/wiki/changes?since=2026-01-01T00:00:00Z",
		]) {
			const response = await GET(visit(path))
			expect(response.status).toBe(503)
			expect(await response.json()).toEqual(NOT_CONFIGURED)
		}
		expect(calls).toEqual(["/v1/principal/self"])
	})

	it("answers not-configured with no transport text when the check cannot reach the API", async () => {
		const calls = stubApi(() =>
			Promise.reject(new Error("connect ECONNREFUSED upstream.test:3857")),
		)
		const { GET } = await freshRoute()
		const response = await GET(visit())
		expect(response.status).toBe(503)
		const text = await response.text()
		expect(JSON.parse(text)).toEqual(NOT_CONFIGURED)
		expect(text).not.toContain("ECONNREFUSED")
		expect(calls).toEqual(["/v1/principal/self"])
	})

	it("serves reads with the exact reader, asking about the key once", async () => {
		const calls = stubApi(() => json(reader))
		const { GET } = await freshRoute()
		for (let read = 0; read < 2; read++) {
			const response = await GET(visit())
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ pages: [], total: 0 })
		}
		expect(calls).toEqual(["/v1/principal/self", "/v1/wiki", "/v1/wiki"])
	})
})

describe("the demo read route's per-client limit", () => {
	const limiter = (success: boolean) => ({
		limit: vi.fn(async (_options: { key: string }) => ({ success })),
	})
	const onWorkers = () =>
		vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" })

	it("refuses a limited client with 429 before any upstream call", async () => {
		onWorkers()
		cf.env = { DEMO_READ_LIMITER: limiter(false) }
		const calls = stubApi(() => json(reader))
		const { GET } = await freshRoute()
		const response = await GET(
			new Request("http://demo.local/api/demo/v1/wiki?limit=100", {
				headers: { "cf-connecting-ip": "203.0.113.9" },
			}),
		)
		expect(response.status).toBe(429)
		expect(response.headers.get("retry-after")).toBe("60")
		expect(response.headers.get("cache-control")).toBe("no-store")
		expect(await response.json()).toEqual({
			error: {
				code: "RATE_LIMITED",
				message: "Too many reads in a short time. Try again shortly.",
			},
		})
		expect(calls).toEqual([])
	})

	it("keys each read by the client address and serves an allowed client", async () => {
		onWorkers()
		const counter = limiter(true)
		cf.env = { DEMO_READ_LIMITER: counter }
		const calls = stubApi(() => json(reader))
		const { GET } = await freshRoute()
		const response = await GET(
			new Request("http://demo.local/api/demo/v1/wiki?limit=100", {
				headers: { "cf-connecting-ip": "203.0.113.9" },
			}),
		)
		expect(response.status).toBe(200)
		expect(counter.limit).toHaveBeenCalledWith({ key: "203.0.113.9" })
		expect(calls).toEqual(["/v1/principal/self", "/v1/wiki"])
	})

	it("counts a client with no address under unknown", async () => {
		onWorkers()
		const counter = limiter(true)
		cf.env = { DEMO_READ_LIMITER: counter }
		stubApi(() => json(reader))
		const { GET } = await freshRoute()
		await GET(visit())
		expect(counter.limit).toHaveBeenCalledWith({ key: "unknown" })
	})

	it("limits nothing off Workers", async () => {
		const counter = limiter(false)
		cf.env = { DEMO_READ_LIMITER: counter }
		stubApi(() => json(reader))
		const { GET } = await freshRoute()
		expect((await GET(visit())).status).toBe(200)
		expect(counter.limit).not.toHaveBeenCalled()
	})
})
