import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { json } from "@/lib/demo-data/test-upstream.js"

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
})
