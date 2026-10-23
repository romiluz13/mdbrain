import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
	handlePresenterRequest,
	PresenterServices,
} from "./presenter-api.js"

const createIndex = vi.fn()
const collectionNames: string[] = []
const driverCollection = (name: string) => {
	collectionNames.push(name)
	return {
		findOne: async () => null,
		find: () => ({ toArray: async () => [] }),
		insertOne: async () => ({}),
		findOneAndUpdate: async () => null,
		deleteOne: async () => ({ deletedCount: 0 }),
		deleteMany: async () => ({ deletedCount: 0 }),
		createIndex: (...args: unknown[]) => createIndex(name, ...args),
	}
}
const opened = vi.fn()

vi.mock("../demo-data/run-store.js", () => ({
	CONTROL_DATABASE: "mdbrain_demo_control",
	controlClient: (uri: string) => {
		opened(uri)
		return { db: () => ({ collection: driverCollection }) }
	},
}))

const TOKEN = "presenter-token-0123456789abcdef"
const ENV = {
	MDBRAIN_DEMO_CONTROL_URI: "mongodb://control.test/",
	MDBRAIN_DEMO_API_BASE_URL: "http://api.test",
	MDBRAIN_DEMO_PRESENTER_TOKEN: TOKEN,
	MDBRAIN_DEMO_PRESENTER_API_KEY: "review-key",
	MDBRAIN_DEMO_READ_KEYS: JSON.stringify(["r1"]),
	MDBRAIN_DEMO_READ_KEY: "baseline",
	MDBRAIN_DEMO_SCOPE: "workspace",
	MDBRAIN_DEMO_SCOPE_REF: "demo-run-12",
	MDBRAIN_DEMO_AGENT_ID: "demo-run-12",
}
const HOLDER = Symbol.for("mdbrain.demo.presenter-runtime")

async function freshServer() {
	vi.resetModules()
	delete (globalThis as Record<symbol, unknown>)[HOLDER]
	return import("./server.js")
}

const signIn = (
	services: PresenterServices | null,
	handle: typeof handlePresenterRequest,
) =>
	handle(
		new Request("http://demo.test/api/demo/presenter/session", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://demo.test",
				"x-forwarded-for": "203.0.113.9",
			},
			body: JSON.stringify({ token: TOKEN }),
		}),
		["session"],
		services,
	)

beforeEach(() => {
	createIndex.mockReset()
	createIndex.mockResolvedValue("ok")
	opened.mockReset()
	collectionNames.length = 0
	vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
		const key = new Headers(init?.headers).get("authorization")
		return new Response(
			JSON.stringify(
				key === "Bearer review-key"
					? {
							capabilities: ["administer"],
							grants: [{ scope: "workspace", scopeRef: "demo-run-13" }],
						}
					: {},
			),
			{ headers: { "content-type": "application/json" } },
		)
	})
})
afterEach(() => {
	vi.unstubAllGlobals()
	delete (globalThis as Record<symbol, unknown>)[HOLDER]
})

describe("the driver-bound presenter runtime", () => {
	it("opens nothing and offers no presenter services without the presenter env", async () => {
		const { presenterRuntime } = await freshServer()
		const runtime = presenterRuntime({ MDBRAIN_DEMO_READ_KEY: "baseline" })
		expect(runtime.services).toBeNull()
		expect(opened).not.toHaveBeenCalled()
	})

	it("builds the runtime once per process", async () => {
		const { presenterRuntime } = await freshServer()
		expect(presenterRuntime(ENV)).toBe(presenterRuntime(ENV))
		expect(opened).toHaveBeenCalledTimes(1)
		expect(opened).toHaveBeenCalledWith("mongodb://control.test/")
	})

	it("waits for the unique presenter index and the session expiry index before presenter mode is on", async () => {
		const { presenterRuntime } = await freshServer()
		const { handlePresenterRequest } = await import("./presenter-api.js")
		const runtime = presenterRuntime(ENV)
		const response = await signIn(runtime.services, handlePresenterRequest)
		expect(response.status).toBe(200)
		expect(createIndex).toHaveBeenCalledWith(
			"demo_presenter_leases",
			{ presenterId: 1 },
			{ unique: true },
		)
		expect(createIndex).toHaveBeenCalledWith(
			"demo_presenter_sessions",
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0 },
		)
	})

	it("keeps presenter mode off while the unique index cannot be created", async () => {
		createIndex.mockImplementation(async (name: string) => {
			if (name === "demo_presenter_leases") {
				throw new Error("E11000 duplicate key error building the index")
			}
			return "ok"
		})
		const { presenterRuntime } = await freshServer()
		const { handlePresenterRequest } = await import("./presenter-api.js")
		const runtime = presenterRuntime(ENV)
		const response = await signIn(runtime.services, handlePresenterRequest)
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({
			error: { code: "PRESENTER_NOT_CONFIGURED" },
		})
	})
})
