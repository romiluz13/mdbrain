import { afterEach, describe, expect, it, vi } from "vitest"
import { handleDemoRead, type DemoProxyEnv } from "./proxy.js"
import { controlClient, createRunManifestSource } from "./run-store.js"

// A closed local port: the real driver, a real refusal, no database touched.
const URI = "mongodb://127.0.0.1:1/"
const FAST = 300

const CLIENT_KEY = Symbol.for("mdbrain.demo.control-client")

afterEach(async () => {
	const held = (
		globalThis as Record<symbol, { client: { close(): Promise<void> } }>
	)[CLIENT_KEY]
	await held?.client.close()
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
