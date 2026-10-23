import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const resolve = vi.fn()
const readsFor = vi.fn((env: unknown) => ({ env }))
const createAnswerService = vi.fn((_deps: unknown) => ({
	answer: async () => ({ state: "answered" }),
}))
const createAnswerStore = vi.fn((_uri: string) => ({
	limits: {},
	budget: {},
}))

vi.mock("@/lib/demo-presenter/server.js", () => ({
	presenterRuntime: () => ({ services: null, resolver: { resolve } }),
}))
vi.mock("@/lib/demo-data/reads.js", () => ({
	readsFor: (env: unknown) => readsFor(env),
}))
vi.mock("@/lib/demo-data/answer-service.js", () => ({
	createAnswerService: (deps: unknown) => createAnswerService(deps),
}))
vi.mock("@/lib/demo-data/answer-store.js", () => ({
	createAnswerStore: (uri: string) => createAnswerStore(uri),
}))
vi.mock("@ai-sdk/anthropic", () => ({
	createAnthropic: () => () => ({ model: "haiku" }),
}))

const envOf = (slot: number, readKey: string) => ({
	apiBaseUrl: "http://api.test",
	readKey,
	scope: "workspace",
	scopeRef: `demo-run-${slot}`,
	agentId: `demo-agent-${slot}`,
})
const run = (slot: number) => ({
	controlUri: `mongodb://control-${slot}.test/`,
	runId: `run-${slot}`,
})

const principalOf = (scopeRef: string, extra: object = {}) => ({
	subjectId: "reader",
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef }],
	...extra,
})

function stubPrincipals(bySlotKey: Record<string, object>) {
	const asked: string[] = []
	vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
		const key = (new Headers(init?.headers).get("authorization") ?? "").replace(
			"Bearer ",
			"",
		)
		asked.push(key)
		return new Response(JSON.stringify(bySlotKey[key] ?? {}), {
			headers: { "content-type": "application/json" },
		})
	})
	return asked
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
	vi.resetModules()
	for (const mock of [
		resolve,
		readsFor,
		createAnswerService,
		createAnswerStore,
	]) {
		mock.mockClear()
	}
	resolve.mockReset()
	vi.stubEnv("MDBRAIN_DEMO_ANSWER_TOKENS", "500000")
	vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key")
})
afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe("the demo answer route answers over the run the page shows", () => {
	it("reads the pinned run, not the env pin, once a presenter has pinned another", async () => {
		stubPrincipals({ "pinned-key": principalOf("demo-run-13") })
		resolve.mockResolvedValue({
			ok: true,
			target: { mode: "public", env: envOf(13, "pinned-key"), run: run(13) },
		})
		const { POST } = await import("./route.js")
		const response = await POST(ask())
		expect(response.status).toBe(200)
		expect(readsFor).toHaveBeenCalledWith({
			apiBaseUrl: "http://api.test",
			readKey: "pinned-key",
			scope: "workspace",
			scopeRef: "demo-run-13",
		})
		expect(createAnswerStore).toHaveBeenCalledWith("mongodb://control-13.test/")
		expect(createAnswerService).toHaveBeenCalledWith(
			expect.objectContaining({ agentId: "demo-agent-13" }),
		)
	})

	it("reads a presenter's leased slot while they present", async () => {
		stubPrincipals({ "slot-14-key": principalOf("demo-run-14") })
		resolve.mockResolvedValue({
			ok: true,
			target: {
				mode: "presenter",
				env: envOf(14, "slot-14-key"),
				run: run(14),
			},
		})
		const { POST } = await import("./route.js")
		expect((await POST(ask())).status).toBe(200)
		expect(readsFor).toHaveBeenCalledWith(
			expect.objectContaining({ scopeRef: "demo-run-14" }),
		)
	})

	it.each([
		["a write-capable key", { capabilities: ["read", "write"] }],
		["an admin-tier key", { trustTier: "admin" }],
	])("answers not-configured, and asks no model, for %s on the resolved target", async (_name, bad) => {
		stubPrincipals({ "pinned-key": principalOf("demo-run-13", bad) })
		resolve.mockResolvedValue({
			ok: true,
			target: { mode: "public", env: envOf(13, "pinned-key"), run: run(13) },
		})
		const { POST } = await import("./route.js")
		const response = await POST(ask())
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({
			error: { code: "ANSWERS_NOT_CONFIGURED" },
		})
		expect(createAnswerService).not.toHaveBeenCalled()
	})

	it("answers not-configured when the target cannot be resolved", async () => {
		resolve.mockResolvedValue({
			ok: false,
			status: 503,
			code: "SLOT_NOT_READABLE",
			message: "this slot has no read key on the server",
		})
		const { POST } = await import("./route.js")
		const response = await POST(ask())
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({
			error: { code: "ANSWERS_NOT_CONFIGURED" },
		})
		expect(createAnswerService).not.toHaveBeenCalled()
	})

	it("answers not-configured when the target has no control database to count in", async () => {
		stubPrincipals({ "pinned-key": principalOf("demo-run-13") })
		resolve.mockResolvedValue({
			ok: true,
			target: { mode: "public", env: envOf(13, "pinned-key"), run: null },
		})
		const { POST } = await import("./route.js")
		expect((await POST(ask())).status).toBe(503)
		expect(createAnswerService).not.toHaveBeenCalled()
	})
})
