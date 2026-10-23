import { beforeEach, describe, expect, it, vi } from "vitest"

const resolve = vi.fn()
const handleDemoRead = vi.fn()

vi.mock("@/lib/demo-presenter/server.js", () => ({
	presenterRuntime: () => ({ services: null, resolver: { resolve } }),
}))
vi.mock("@/lib/demo-data/proxy.js", () => ({
	handleDemoRead: (...args: unknown[]) => handleDemoRead(...args),
}))
vi.mock("@/lib/demo-data/run-store.js", () => ({
	createRunManifestSource: () => async () => null,
}))

const ENV = {
	apiBaseUrl: "http://api.test",
	readKey: "k",
	scope: "workspace",
	scopeRef: "demo-run-13",
	agentId: "demo-run-13",
}
const request = () => new Request("http://demo.test/api/demo/v1/wiki")

describe("/api/demo/v1 route", () => {
	beforeEach(() => {
		resolve.mockReset()
		handleDemoRead.mockReset()
		handleDemoRead.mockImplementation(
			async () =>
				new Response('{"pages":[]}', {
					status: 200,
					headers: {
						"content-type": "application/json",
						"cache-control": "public, max-age=60",
					},
				}),
		)
	})

	it("keeps a presenter's slot out of every shared cache", async () => {
		resolve.mockResolvedValue({
			ok: true,
			target: { mode: "presenter", env: ENV, run: null },
		})
		const { GET } = await import("./route.js")
		const response = await GET(request())
		expect(response.status).toBe(200)
		expect(response.headers.get("cache-control")).toBe("private, no-store")
		expect(response.headers.get("vary")).toBe("cookie")
		expect(await response.json()).toEqual({ pages: [] })
	})

	it("leaves the public run's response as the proxy made it", async () => {
		resolve.mockResolvedValue({
			ok: true,
			target: { mode: "public", env: ENV, run: null },
		})
		const { GET } = await import("./route.js")
		const response = await GET(request())
		expect(response.headers.get("cache-control")).toBe("public, max-age=60")
		expect(response.headers.get("vary")).toBeNull()
	})

	it("answers the resolver's refusal and reads nothing", async () => {
		resolve.mockResolvedValue({
			ok: false,
			status: 503,
			code: "SLOT_NOT_READABLE",
			message: "this slot has no read key on the server",
		})
		const { GET } = await import("./route.js")
		const response = await GET(request())
		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({
			error: {
				code: "SLOT_NOT_READABLE",
				message: "this slot has no read key on the server",
			},
		})
		expect(handleDemoRead).not.toHaveBeenCalled()
	})
})
