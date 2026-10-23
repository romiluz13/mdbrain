import { describe, expect, it } from "vitest"
import type { DemoProxyEnv } from "../demo-data/proxy.js"
import type { PresenterConfig } from "./config.js"
import { handlePresenterRequest } from "./presenter-api.js"
import { createPresenterRuntime, type ControlStores } from "./runtime.js"
import { CSRF_HEADER, SESSION_COOKIE } from "./session.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const ORIGIN = "http://demo.test"
const TOKEN = "presenter-token-0123456789abcdef"
const CONFIG: PresenterConfig = {
	controlUri: "mongodb://control.test/",
	apiBaseUrl: "http://api.test",
	token: TOKEN,
	adminKey: "admin-key",
	readKeys: [
		"r1",
		"r2",
		"r3",
		"r4",
		"r5",
		"r6",
		"r7",
		"r8",
		"r9",
		"r10",
		"r11",
		"r12",
		"r13",
		"r14",
		"r15",
	],
	runDeadlineMs: 335_000,
}
const BASELINE: DemoProxyEnv = {
	apiBaseUrl: "http://api.test",
	readKey: "baseline",
	scope: "workspace",
	scopeRef: "demo-run-12",
	agentId: "demo-run-12",
}
const manifestDoc = (slot: number) => ({
	_id: `run-${slot}`,
	runId: `run-${slot}`,
	slotIndex: slot,
	scopeRef: `demo-run-${slot}`,
	agentId: `demo-run-${slot}`,
	state: "ready",
	corpus: { eventsPlanned: 2, pagesPlanned: 1 },
	eventsWritten: [{}, {}],
	pagesWritten: ["a"],
})

function stores(): ControlStores {
	return {
		manifests: new MemoryCollection<{ _id: string }>([], [manifestDoc(13)]),
		leases: new MemoryCollection(["presenterId"]),
		sessions: new MemoryCollection(),
		runRequests: new MemoryCollection(),
		publicRun: new MemoryCollection(),
	} as ControlStores
}

describe("createPresenterRuntime", () => {
	it("carries a presenter from sign-in to a leased slot's reads, and no one else", async () => {
		const runtime = createPresenterRuntime({
			config: CONFIG,
			baselineEnv: BASELINE,
			baselineRun: null,
			stores: stores(),
			proposalsClient: {
				listProposals: async () => ({ proposals: [] }),
				approveProposal: async () => {
					throw new Error("unused")
				},
				rejectProposal: async () => {
					throw new Error("unused")
				},
			},
		})
		const post = (
			path: string,
			body: unknown,
			cookie?: string,
			csrf?: string,
		) =>
			handlePresenterRequest(
				new Request(`${ORIGIN}/api/demo/presenter/${path}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: ORIGIN,
						...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}),
						...(csrf ? { [CSRF_HEADER]: csrf } : {}),
					},
					body: JSON.stringify(body),
				}),
				path.split("/"),
				runtime.services,
			)
		const login = await post("session", { token: TOKEN })
		const sessionId = /demo_presenter=([^;]+)/.exec(
			login.headers.get("set-cookie") ?? "",
		)![1]!
		const { csrf } = (await login.json()) as { csrf: string }
		expect((await post("lease", {}, sessionId, csrf)).status).toBe(200)

		const readRequest = (cookie?: string) =>
			new Request(`${ORIGIN}/api/demo/v1/wiki`, {
				headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
			})
		const presenter = await runtime.resolver.resolve(readRequest(sessionId))
		expect(presenter).toMatchObject({
			ok: true,
			target: {
				mode: "presenter",
				env: { readKey: "r13", scopeRef: "demo-run-13" },
			},
		})
		const visitor = await runtime.resolver.resolve(readRequest())
		expect(visitor).toMatchObject({
			ok: true,
			target: {
				mode: "public",
				env: { readKey: "baseline", scopeRef: "demo-run-12" },
			},
		})
	})

	it("serves only the env-pinned run, with no presenter routes, when presenter mode is not configured", async () => {
		const runtime = createPresenterRuntime({
			config: null,
			baselineEnv: BASELINE,
			baselineRun: null,
			stores: null,
			proposalsClient: null,
		})
		expect(runtime.services).toBeNull()
		expect(
			await runtime.resolver.resolve(new Request(`${ORIGIN}/api/demo/v1/wiki`)),
		).toMatchObject({
			ok: true,
			target: { mode: "public", env: BASELINE },
		})
	})

	it("never leases a fully seeded slot the server holds no read key for", async () => {
		const unreadable = stores()
		unreadable.manifests = new MemoryCollection<{ _id: string }>(
			[],
			[manifestDoc(16)],
		)
		const runtime = createPresenterRuntime({
			config: CONFIG,
			baselineEnv: BASELINE,
			baselineRun: null,
			stores: unreadable,
			proposalsClient: {
				listProposals: async () => ({ proposals: [] }),
				approveProposal: async () => {
					throw new Error("unused")
				},
				rejectProposal: async () => {
					throw new Error("unused")
				},
			},
		})
		const login = await handlePresenterRequest(
			new Request(`${ORIGIN}/api/demo/presenter/session`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: ORIGIN },
				body: JSON.stringify({ token: TOKEN }),
			}),
			["session"],
			runtime.services,
		)
		const sessionId = /demo_presenter=([^;]+)/.exec(
			login.headers.get("set-cookie") ?? "",
		)![1]!
		const { csrf } = (await login.json()) as { csrf: string }
		const lease = await handlePresenterRequest(
			new Request(`${ORIGIN}/api/demo/presenter/lease`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: ORIGIN,
					cookie: `${SESSION_COOKIE}=${sessionId}`,
					[CSRF_HEADER]: csrf,
				},
				body: "{}",
			}),
			["lease"],
			runtime.services,
		)
		expect(lease.status).toBe(409)
		expect(await lease.json()).toMatchObject({
			error: { code: "NO_SLOT_AVAILABLE" },
		})
	})
})
