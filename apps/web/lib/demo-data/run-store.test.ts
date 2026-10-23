import { afterEach, describe, expect, it, vi } from "vitest"
import { handleDemoRead, type DemoProxyEnv } from "./proxy.js"
import { controlClient, createRunManifestSource } from "./run-store.js"

// A closed local port: the real driver, a real refusal, no database touched.
const URI = "mongodb://127.0.0.1:1/"
const FAST = 300

const CLIENT_KEY = Symbol.for("mdbrain.demo.control-client")

afterEach(async () => {
	const held = (globalThis as Record<symbol, { close(): Promise<void> }>)[
		CLIENT_KEY
	]
	await held?.close()
	delete (globalThis as Record<symbol, unknown>)[CLIENT_KEY]
	vi.resetModules()
})

describe("controlClient", () => {
	it("is one client per process, reused by every read", () => {
		expect(controlClient(URI)).toBe(controlClient(URI))
	})

	it("is found again by a module evaluated afresh, as after a dev reload", async () => {
		const first = controlClient(URI)
		vi.resetModules()
		const again = await import("./run-store.js")
		expect(again.controlClient(URI)).toBe(first)
	})
})

// On Cloudflare Workers a socket made in one request cannot serve another,
// so a pooled client shared across requests hangs the next request that
// reuses its connection (measured under workerd: every other back-to-back
// read was canceled as hung).
describe("controlClient on the Workers runtime", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})
	const onWorkers = () =>
		vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" })

	it("gives each request scope its own client, reused within the scope and closed when it ends", async () => {
		onWorkers()
		const { controlClient, withControlScope } = await import("./run-store.js")
		const seen: Array<{ close(): Promise<void> }> = []
		const closes: Array<ReturnType<typeof vi.fn>> = []
		for (const _ of [1, 2]) {
			await withControlScope(async () => {
				const client = controlClient(URI)
				expect(controlClient(URI)).toBe(client)
				const close = vi.fn(async () => undefined)
				client.close = close
				closes.push(close)
				seen.push(client)
			})
		}
		expect(seen[0]).not.toBe(seen[1])
		for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
	})

	it("closes the scope's client when the work throws, and rethrows", async () => {
		onWorkers()
		const { controlClient, withControlScope } = await import("./run-store.js")
		const close = vi.fn(async () => undefined)
		await expect(
			withControlScope(async () => {
				controlClient(URI).close = close
				throw new Error("route failed")
			}),
		).rejects.toThrow("route failed")
		expect(close).toHaveBeenCalledTimes(1)
	})

	it("refuses to open the control database outside a request scope", async () => {
		onWorkers()
		const { controlClient } = await import("./run-store.js")
		expect(() => controlClient(URI)).toThrow(/request scope/)
	})

	it("keeps the one process client on Node, open across scopes", async () => {
		const { controlClient, withControlScope } = await import("./run-store.js")
		const clients = []
		for (const _ of [1, 2]) {
			clients.push(await withControlScope(async () => controlClient(URI)))
		}
		expect(clients[0]).toBe(clients[1])
		expect(clients[0]).toBe(controlClient(URI))
	})
})

describe("createRunManifestSource", () => {
	const source = () =>
		createRunManifestSource({ controlUri: URI, runId: "demo-run-9" }, FAST)

	it("rejects when the database cannot be reached, and can be asked again", async () => {
		const read = source()
		await expect(read("demo-run-9")).rejects.toBeTruthy()
		await expect(read("demo-run-9")).rejects.toBeTruthy()
		expect(controlClient(URI)).toBe(controlClient(URI))
	})

	it("answers the proxy's fixed envelope with no host, URI or driver text", async () => {
		const env: DemoProxyEnv = {
			apiBaseUrl: "http://upstream.test",
			readKey: "read-key-xyz-123",
			scope: "workspace",
			scopeRef: "demo-run-9",
			agentId: "demo-run-9",
		}
		const response = await handleDemoRead(
			new Request("http://demo.test/api/demo/v1/run"),
			env,
			vi.fn(),
			{ run: { controlUri: URI, runId: "demo-run-9" }, manifest: source() },
		)
		expect(response.status).toBe(502)
		const text = await response.text()
		expect(JSON.parse(text).error.code).toBe("RUN_UNREACHABLE")
		for (const leaked of [
			"127.0.0.1",
			"ECONNREFUSED",
			"mongodb",
			"Server selection",
		]) {
			expect(text).not.toContain(leaked)
		}
	})
})
