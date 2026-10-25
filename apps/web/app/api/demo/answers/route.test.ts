import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { json } from "@/lib/demo-data/test-upstream.js"

const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: () => ({ env: cf.env }),
}))

function stubApi(principal: () => Response | Promise<Response>): string[] {
	const calls: string[] = []
	vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		calls.push(`${url.origin}${url.pathname}`)
		return url.pathname === "/v1/principal/self"
			? principal()
			: json({ results: [] })
	})
	return calls
}

async function freshRoute() {
	vi.resetModules()
	return import("./route.js")
}

const ask = () =>
	new Request("http://demo.local/api/demo/answers", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"sec-fetch-site": "same-origin",
		},
		body: JSON.stringify({ question: "What is the status of the renewal?" }),
	})

beforeEach(() => {
	vi.stubEnv("MDBRAIN_DEMO_API_BASE_URL", "http://upstream.test")
	vi.stubEnv("MDBRAIN_DEMO_READ_KEY", "configured-key")
	vi.stubEnv("MDBRAIN_DEMO_SCOPE", "workspace")
	vi.stubEnv("MDBRAIN_DEMO_SCOPE_REF", "demo-run-2")
	vi.stubEnv("MDBRAIN_DEMO_AGENT_ID", "demo-run-2")
	vi.stubEnv("MDBRAIN_DEMO_ANSWER_TOKENS", "500000")
	vi.stubEnv("MDBRAIN_DEMO_CONTROL_URI", "")
	vi.stubEnv("MDBRAIN_DEMO_RUN_ID", "")
	vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key")
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	cf.env = {}
})

describe("the demo answer route", () => {
	it("answers not-configured, and reads and asks nothing, when the read key can do more than read its one scope", async () => {
		const calls = stubApi(() =>
			json({
				subjectId: "api-key:admin",
				trustTier: "admin",
				capabilities: ["read", "write", "administer"],
				grants: [{ scope: "*", scopeRef: "*" }],
			}),
		)
		const { POST } = await freshRoute()
		const response = await POST(ask())
		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({
			error: {
				code: "ANSWERS_NOT_CONFIGURED",
				message: "the demo answer service is missing its server configuration",
			},
		})
		expect(calls).toEqual(["http://upstream.test/v1/principal/self"])
	})

	it("answers not-configured when the key check cannot reach the API", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("connect ECONNREFUSED upstream.test")
		})
		const { POST } = await freshRoute()
		const response = await POST(ask())
		expect(response.status).toBe(503)
		expect(await response.text()).not.toContain("ECONNREFUSED")
	})

	it("refuses a limited client with 429 before any read, key check or model call", async () => {
		vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" })
		cf.env = {
			DEMO_ANSWER_LIMITER: {
				limit: vi.fn(async () => ({ success: false })),
			},
		}
		const calls = stubApi(() => json({ trustTier: "standard" }))
		const { POST } = await freshRoute()
		const response = await POST(ask())
		expect(response.status).toBe(429)
		expect(response.headers.get("retry-after")).toBe("60")
		expect(response.headers.get("cache-control")).toBe("no-store")
		expect(await response.json()).toEqual({
			error: {
				code: "RATE_LIMITED",
				message: "Too many questions in a short time. Try again shortly.",
			},
		})
		expect(calls).toEqual([])
	})

	it("keys each answer by the client address and lets an allowed client through", async () => {
		vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" })
		const limit = vi.fn(async () => ({ success: true }))
		cf.env = { DEMO_ANSWER_LIMITER: { limit } }
		const calls = stubApi(() =>
			json({
				subjectId: "api-key:admin",
				trustTier: "admin",
				capabilities: ["read", "write", "administer"],
				grants: [{ scope: "*", scopeRef: "*" }],
			}),
		)
		const { POST } = await freshRoute()
		const request = ask()
		request.headers.set("cf-connecting-ip", "203.0.113.9")
		const response = await POST(request)
		expect(limit).toHaveBeenCalledWith({ key: "203.0.113.9" })
		expect(response.status).toBe(503)
		expect(calls).toEqual(["http://upstream.test/v1/principal/self"])
	})
})
