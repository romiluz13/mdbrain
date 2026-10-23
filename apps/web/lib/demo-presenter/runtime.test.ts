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

type Principal = {
	trustTier: string
	capabilities: string[]
	grants: Array<{ scope: string; scopeRef: string }>
}
const reviewer: Principal = {
	trustTier: "admin",
	capabilities: ["administer"],
	grants: [
		{ scope: "workspace", scopeRef: "demo-run-13" },
		{ scope: "workspace", scopeRef: "demo-run-14" },
		{ scope: "workspace", scopeRef: "demo-run-15" },
	],
}
const readerOf = (slot: number): Principal => ({
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef: `demo-run-${slot}` }],
})

/** The API's /v1/principal/self over the ring: each key r<n> is slot n's
 * exact reader unless the test says what that key can really do. */
function principals(overrides: Record<string, Principal> = {}): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		const key = new Headers(init?.headers).get("authorization")?.slice(7) ?? ""
		const slot = Number(/^r(\d+)$/.exec(key)?.[1])
		const principal =
			overrides[key] ??
			(key === CONFIG.adminKey ? reviewer : slot ? readerOf(slot) : undefined)
		return url.pathname === "/v1/principal/self" && principal
			? new Response(JSON.stringify({ subjectId: key, ...principal }), {
					headers: { "content-type": "application/json" },
				})
			: new Response("{}", { status: 401 })
	}) as typeof fetch
}

const noProposals = {
	listProposals: async () => ({ proposals: [] }),
	approveProposal: async () => {
		throw new Error("unused")
	},
	rejectProposal: async () => {
		throw new Error("unused")
	},
}

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
			fetchImpl: principals(),
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
						"x-forwarded-for": "203.0.113.9",
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
			fetchImpl: principals(),
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
				headers: {
					"content-type": "application/json",
					origin: ORIGIN,
					"x-forwarded-for": "203.0.113.9",
				},
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
	describe("a slot whose key is not an exact reader of its own scope", () => {
		const slotDoc = (slot: number, agentRunState?: string) => ({
			...manifestDoc(slot),
			...(agentRunState
				? { agentRun: { state: agentRunState }, agentRunState }
				: {}),
		})
		const runtimeFor = (manifests: object[], fetchImpl: typeof fetch) =>
			createPresenterRuntime({
				config: CONFIG,
				baselineEnv: BASELINE,
				baselineRun: null,
				stores: {
					...stores(),
					manifests: new MemoryCollection<{ _id: string }>(
						[],
						manifests as Array<{ _id: string }>,
					),
				},
				proposalsClient: noProposals,
				fetchImpl,
			})
		const leaseFrom = async (
			runtime: ReturnType<typeof runtimeFor>,
			body: object = {},
		) => {
			const login = await handlePresenterRequest(
				new Request(`${ORIGIN}/api/demo/presenter/session`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: ORIGIN,
						"x-forwarded-for": "203.0.113.9",
					},
					body: JSON.stringify({ token: TOKEN }),
				}),
				["session"],
				runtime.services,
			)
			const sessionId = /demo_presenter=([^;]+)/.exec(
				login.headers.get("set-cookie") ?? "",
			)![1]!
			const { csrf } = (await login.json()) as { csrf: string }
			return handlePresenterRequest(
				new Request(`${ORIGIN}/api/demo/presenter/lease`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: ORIGIN,
						cookie: `${SESSION_COOKIE}=${sessionId}`,
						[CSRF_HEADER]: csrf,
					},
					body: JSON.stringify(body),
				}),
				["lease"],
				runtime.services,
			)
		}

		it.each([
			["write-capable", { ...readerOf(13), capabilities: ["read", "write"] }],
			["admin-tier", { ...readerOf(13), trustTier: "admin" }],
			["granted another scope", readerOf(12)],
		])("is never leased when its key is %s, and the next good slot is", async (_name, bad) => {
			const runtime = runtimeFor(
				[slotDoc(13), slotDoc(14)],
				principals({ r13: bad }),
			)
			const taken = await leaseFrom(runtime)
			expect(taken.status).toBe(200)
			expect(await taken.json()).toMatchObject({ lease: { slotIndex: 14 } })
		})

		it.each([
			["write-capable", { ...readerOf(13), capabilities: ["read", "write"] }],
			["admin-tier", { ...readerOf(13), trustTier: "admin" }],
			["granted another scope", readerOf(12)],
		])("is refused by name when its key is %s", async (_name, bad) => {
			const runtime = runtimeFor([slotDoc(13)], principals({ r13: bad }))
			const refused = await leaseFrom(runtime, { slotIndex: 13 })
			expect(refused.status).toBe(409)
			expect(await refused.json()).toMatchObject({
				error: { code: "SLOT_NOT_LEASABLE" },
			})
		})

		it.each([
			["write-capable", { ...readerOf(13), capabilities: ["read", "write"] }],
			["admin-tier", { ...readerOf(13), trustTier: "admin" }],
			["granted another scope", readerOf(12)],
		])("cannot be pinned when its key is %s", async (_name, bad) => {
			const runtime = runtimeFor(
				[slotDoc(13, "complete")],
				principals({ r13: bad }),
			)
			await expect(
				runtime.services?.pins.pin("run-13", "p1"),
			).rejects.toMatchObject({ code: "RUN_NOT_READABLE" })
		})

		it("is pinned and leased when its key is an exact reader", async () => {
			const runtime = runtimeFor([slotDoc(13, "complete")], principals())
			await expect(
				runtime.services?.pins.pin("run-13", "p1"),
			).resolves.toMatchObject({ runId: "run-13" })
		})

		it("is not leased while the API cannot say what its key can do", async () => {
			const runtime = runtimeFor([slotDoc(13)], (async (
				input: RequestInfo | URL,
				init?: RequestInit,
			) => {
				if (new Headers(init?.headers).get("authorization") === "Bearer r13") {
					throw new Error("socket hang up")
				}
				return principals()(input, init)
			}) as typeof fetch)
			const refused = await leaseFrom(runtime)
			expect(refused.status).toBe(409)
		})
	})
	describe("presenter mode readiness", () => {
		const boot = (over: {
			fetchImpl?: typeof fetch
			ensureIndexes?: () => Promise<void>
			stores?: ReturnType<typeof stores>
		}) =>
			createPresenterRuntime({
				config: CONFIG,
				baselineEnv: BASELINE,
				baselineRun: null,
				stores: over.stores ?? stores(),
				proposalsClient: noProposals,
				fetchImpl: over.fetchImpl ?? principals(),
				...(over.ensureIndexes ? { ensureIndexes: over.ensureIndexes } : {}),
			})
		const signInOnce = (runtime: ReturnType<typeof boot>) =>
			handlePresenterRequest(
				new Request(`${ORIGIN}/api/demo/presenter/session`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: ORIGIN,
						"x-forwarded-for": "203.0.113.9",
					},
					body: JSON.stringify({ token: TOKEN }),
				}),
				["session"],
				runtime.services,
			)

		it.each([
			["the API's own admin key", ["read", "write", "administer"]],
			["a key that can also read", ["read", "administer"]],
		])("is off when the review key is %s", async (_name, capabilities) => {
			const runtime = boot({
				fetchImpl: principals({
					[CONFIG.adminKey]: { ...reviewer, capabilities },
				}),
			})
			const refused = await signInOnce(runtime)
			expect(refused.status).toBe(503)
			expect(await refused.json()).toEqual({
				error: {
					code: "PRESENTER_NOT_CONFIGURED",
					message: "Presenter mode is not configured on this server.",
				},
			})
		})

		it("is on when the review key is administer-only", async () => {
			expect((await signInOnce(boot({}))).status).toBe(200)
		})

		it("stays off while an index cannot be created, tries again, and never leases meanwhile", async () => {
			let failing = true
			let attempts = 0
			const runtime = boot({
				ensureIndexes: async () => {
					attempts += 1
					if (failing) throw new Error("index build failed")
				},
			})
			expect((await signInOnce(runtime)).status).toBe(503)
			failing = false
			expect((await signInOnce(runtime)).status).toBe(200)
			expect((await signInOnce(runtime)).status).toBe(200)
			expect(attempts).toBe(2)
		})

		it("serves a signed-in presenter the public run while presenter mode is off", async () => {
			const shared = stores()
			const runtime = boot({ stores: shared })
			const login = await signInOnce(runtime)
			const sessionId = /demo_presenter=([^;]+)/.exec(
				login.headers.get("set-cookie") ?? "",
			)![1]!
			const { csrf } = (await login.json()) as { csrf: string }
			await handlePresenterRequest(
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
			const read = () =>
				runtime.resolver.resolve(
					new Request(`${ORIGIN}/api/demo/v1/wiki`, {
						headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
					}),
				)
			expect(await read()).toMatchObject({ target: { mode: "presenter" } })
			// A fresh process over the same control database, whose index can no
			// longer be made: the session and the lease are still there.
			const off = boot({
				stores: shared,
				ensureIndexes: async () => {
					throw new Error("index build failed")
				},
			})
			expect(
				await off.resolver.resolve(
					new Request(`${ORIGIN}/api/demo/v1/wiki`, {
						headers: { cookie: `${SESSION_COOKIE}=${sessionId}` },
					}),
				),
			).toMatchObject({ target: { mode: "public" } })
		})
	})
})
