import { describe, expect, it } from "vitest"
import { handleDemoRead, type DemoProxyEnv } from "./proxy.js"

const env: DemoProxyEnv = {
	apiBaseUrl: "http://internal.example:3857",
	readKey: "test-read-key-123",
	scope: "workspace",
	scopeRef: "demo-run-8",
	agentId: "demo-run-8",
}

// An answer whose headers arrive and whose body then fails, as a dropped
// connection does halfway through.
const brokenBody = (status: number): typeof fetch =>
	(async () =>
		new Response(
			new ReadableStream({
				pull(controller) {
					controller.error(
						new Error("read ECONNRESET 10.0.0.5:3857 test-read-key-123"),
					)
				},
			}),
			{ status, headers: { "content-type": "application/json" } },
		)) as typeof fetch

describe("an upstream answer whose body cannot be read", () => {
	it.each([
		200, 500,
	])("is the fixed unreachable envelope, whatever the status was (%s)", async (status) => {
		const response = await handleDemoRead(
			new Request("http://demo.local/api/demo/v1/wiki?limit=5"),
			env,
			brokenBody(status),
		)
		const text = await response.text()
		expect(response.status).toBe(502)
		expect(JSON.parse(text)).toEqual({
			error: {
				code: "UPSTREAM_UNREACHABLE",
				message: "The demo data service could not be reached.",
			},
		})
		expect(text).not.toContain("ECONNRESET")
		expect(text).not.toContain("test-read-key-123")
	})
})
