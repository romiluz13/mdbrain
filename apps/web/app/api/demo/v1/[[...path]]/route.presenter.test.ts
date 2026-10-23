import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const exactReader = {
	subjectId: "demo-reader-13",
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef: "demo-run-13" }],
}

describe("/api/demo/v1 route, target by target", () => {
	beforeEach(() => {
		vi.resetModules()
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
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(JSON.stringify(exactReader), {
					headers: { "content-type": "application/json" },
				}),
		)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
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

	it.each([
		["presenter", "a key that can write", { capabilities: ["read", "write"] }],
		["presenter", "an admin-tier key", { trustTier: "admin" }],
		[
			"public",
			"a key granted another scope",
			{
				grants: [{ scope: "workspace", scopeRef: "demo-run-12" }],
			},
		],
	])("refuses a %s read made with %s and reads nothing", async (mode, _name, bad) => {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(JSON.stringify({ ...exactReader, ...bad }), {
					headers: { "content-type": "application/json" },
				}),
		)
		resolve.mockResolvedValue({
			ok: true,
			target: { mode, env: ENV, run: null },
		})
		const { GET } = await import("./route.js")
		const response = await GET(request())
		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({
			error: {
				code: "PROXY_NOT_CONFIGURED",
				message: "the demo read proxy is missing its server configuration",
			},
		})
		expect(handleDemoRead).not.toHaveBeenCalled()
	})

	it("asks each target's key once, however presenter and public reads alternate", async () => {
		const asked: string[] = []
		vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
			const key = new Headers(init?.headers).get("authorization") ?? ""
			asked.push(key)
			return new Response(
				JSON.stringify({
					...exactReader,
					grants: [
						{
							scope: "workspace",
							scopeRef: key.endsWith("slot") ? "demo-run-13" : "demo-run-12",
						},
					],
				}),
				{ headers: { "content-type": "application/json" } },
			)
		})
		const slot = { ...ENV, readKey: "slot", scopeRef: "demo-run-13" }
		const pinned = { ...ENV, readKey: "pinned", scopeRef: "demo-run-12" }
		const { GET } = await import("./route.js")
		for (const [mode, env] of [
			["presenter", slot],
			["public", pinned],
			["presenter", slot],
			["public", pinned],
		] as const) {
			resolve.mockResolvedValue({ ok: true, target: { mode, env, run: null } })
			expect((await GET(request())).status).toBe(200)
		}
		expect(asked).toEqual(["Bearer slot", "Bearer pinned"])
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
