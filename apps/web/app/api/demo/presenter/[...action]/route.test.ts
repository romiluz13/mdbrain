// The presenter journey through the real Next route modules: the presenter
// route, the public read route behind it, and the runtime wiring between
// them, over memory control stores and a fake upstream API. Only the driver
// (run-store) and the clock-free edges are faked.
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PresenterConfig } from "@/lib/demo-presenter/config.js"
import { createPresenterRuntime } from "@/lib/demo-presenter/runtime.js"
import { MemoryCollection } from "@/lib/demo-presenter/testing/memory-collection.js"
import { pendingProposal } from "@/lib/demo-presenter/testing/presenter-rig.js"

const ORIGIN = "http://demo.test"
const TOKEN = "k3J9xQ2mP7vR1tY6uI0oL4aS8dF5gH_zXcVbN-wEqMe"
const REVIEW_KEY = "review-key"
const CONFIG: PresenterConfig = {
	controlUri: "mongodb://control.test/",
	apiBaseUrl: "http://api.test",
	token: TOKEN,
	adminKey: REVIEW_KEY,
	readKeys: Array.from({ length: 15 }, (_, index) => `r${index + 1}`),
	runDeadlineMs: 335_000,
}
const BASELINE = {
	apiBaseUrl: "http://api.test",
	readKey: "baseline",
	scope: "workspace",
	scopeRef: "demo-run-12",
	agentId: "demo-run-12",
}

const runtimeHolder: { current: ReturnType<typeof createPresenterRuntime> } = {
	current: undefined as never,
}
vi.mock("@/lib/demo-presenter/server.js", () => ({
	presenterRuntime: () => runtimeHolder.current,
}))
vi.mock("@/lib/demo-data/run-store.js", () => ({
	createRunManifestSource: () => async () => null,
}))

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

type Asked = { path: string; scopeRef: string | null; key: string }

function boot() {
	const manifests = new MemoryCollection<{ _id: string }>(
		[],
		[manifestDoc(13), manifestDoc(14)],
	)
	const stores = {
		manifests,
		leases: new MemoryCollection(["presenterId"]),
		sessions: new MemoryCollection(),
		runRequests: new MemoryCollection(),
		publicRun: new MemoryCollection(),
	}
	const client = {
		listProposals: vi.fn(async (input: { scopeRef?: string }) => ({
			proposals:
				input.scopeRef === "demo-run-13" ? [pendingProposal("op-1")] : [],
		})),
		approveProposal: vi.fn(
			async ({ operationId }: { operationId: string }) => ({
				ok: true as const,
				operationId,
				state: "promoted" as const,
				pageSlug: "syntheses/silent-eta-drift",
			}),
		),
		rejectProposal: vi.fn(async ({ operationId }: { operationId: string }) => ({
			ok: true as const,
			operationId,
			state: "rejected" as const,
		})),
	}
	const asked: Asked[] = []
	const upstream = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		const key = (new Headers(init?.headers).get("authorization") ?? "").slice(7)
		if (url.pathname === "/v1/principal/self") {
			const slot = Number(/^r(\d+)$/.exec(key)?.[1])
			const principal =
				key === REVIEW_KEY
					? {
							capabilities: ["administer"],
							trustTier: "admin",
							grants: [{ scope: "workspace", scopeRef: "demo-run-13" }],
						}
					: key === "baseline"
						? readerOf(12)
						: slot
							? readerOf(slot)
							: {}
			return Response.json({ subjectId: key, ...principal })
		}
		asked.push({
			path: url.pathname,
			scopeRef: url.searchParams.get("scopeRef"),
			key,
		})
		return Response.json({ pages: [], total: 0 })
	}) as typeof fetch
	let clock = new Date()
	runtimeHolder.current = createPresenterRuntime({
		config: CONFIG,
		baselineEnv: BASELINE,
		baselineRun: null,
		stores: stores as never,
		proposalsClient: client,
		fetchImpl: upstream,
		now: () => clock,
	})
	vi.stubGlobal("fetch", upstream)
	return {
		stores,
		client,
		asked,
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

const readerOf = (slot: number) => ({
	trustTier: "standard",
	capabilities: ["read"],
	grants: [{ scope: "workspace", scopeRef: `demo-run-${slot}` }],
})

type Session = { cookie: string; csrf: string }

async function presenter(
	method: "GET" | "POST",
	action: string,
	options: { body?: unknown; session?: Session; address?: string | null } = {},
) {
	const { GET, POST } = await import("./route.js")
	const headers: Record<string, string> = {}
	if (options.address !== null) {
		headers["x-forwarded-for"] = options.address ?? "203.0.113.9"
	}
	if (method === "POST") {
		headers["content-type"] = "application/json"
		headers.origin = ORIGIN
	}
	if (options.session) {
		headers.cookie = options.session.cookie
		if (method === "POST") headers["x-demo-csrf"] = options.session.csrf
	}
	const request = new Request(`${ORIGIN}/api/demo/presenter/${action}`, {
		method,
		headers,
		...(method === "POST" ? { body: JSON.stringify(options.body ?? {}) } : {}),
	})
	const context = { params: Promise.resolve({ action: action.split("/") }) }
	return (method === "GET" ? GET : POST)(request, context)
}

async function signIn(token = TOKEN): Promise<Session> {
	const response = await presenter("POST", "session", { body: { token } })
	expect(response.status).toBe(200)
	const setCookie = response.headers.get("set-cookie") ?? ""
	const cookie = /demo_presenter=[^;]+/.exec(setCookie)![0]
	return { cookie, csrf: ((await response.json()) as { csrf: string }).csrf }
}

async function visit(cookie?: string) {
	const { GET } = await import("../../v1/[[...path]]/route.js")
	return GET(
		new Request(`${ORIGIN}/api/demo/v1/wiki?limit=100`, {
			headers: cookie ? { cookie } : {},
		}),
	)
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("the presenter routes", () => {
	it("sets a session cookie that is HttpOnly and SameSite=Strict, and answers a wrong token 401", async () => {
		boot()
		const wrong = await presenter("POST", "session", {
			body: { token: "nope" },
		})
		expect(wrong.status).toBe(401)
		const ok = await presenter("POST", "session", { body: { token: TOKEN } })
		const cookie = ok.headers.get("set-cookie") ?? ""
		expect(cookie).toContain("HttpOnly")
		expect(cookie).toContain("SameSite=Strict")
		expect(cookie).toContain("Path=/api/demo")
	})

	it("refuses an action without a session, and a mutation without the session's CSRF token", async () => {
		boot()
		expect((await presenter("POST", "lease")).status).toBe(401)
		const session = await signIn()
		const noCsrf = await presenter("POST", "lease", {
			session: { ...session, csrf: "wrong" },
		})
		expect(noCsrf.status).toBe(403)
	})

	it("leases a fully seeded slot and a second presenter is not given the same one", async () => {
		boot()
		const first = await signIn()
		const lease = await presenter("POST", "lease", { session: first })
		expect(await lease.json()).toMatchObject({ lease: { slotIndex: 13 } })
		const second = await signIn()
		const other = await presenter("POST", "lease", { session: second })
		expect(await other.json()).toMatchObject({ lease: { slotIndex: 14 } })
		const taken = await presenter("POST", "lease", {
			session: await signIn(),
			body: { slotIndex: 13 },
		})
		expect(taken.status).toBe(409)
	})

	it("queues the run for the leased slot only, once", async () => {
		const { stores } = boot()
		const session = await signIn()
		await presenter("POST", "lease", { session })
		const queued = await presenter("POST", "run", { session })
		expect(queued.status).toBe(200)
		expect([...stores.runRequests.docs.keys()]).toEqual(["run-13"])
		expect(stores.runRequests.docs.get("run-13")).toMatchObject({
			state: "queued",
			slotIndex: 13,
		})
	})

	it("approves and rejects only what is pending in the leased scope", async () => {
		const { client } = boot()
		const session = await signIn()
		await presenter("POST", "lease", { session })
		const listed = await presenter("GET", "proposals", { session })
		expect(await listed.json()).toMatchObject({
			proposals: [{ operationId: "op-1" }],
		})
		const approved = await presenter("POST", "proposals/decide", {
			session,
			body: { operationId: "op-1", decision: "approve" },
		})
		expect(await approved.json()).toMatchObject({ state: "promoted" })
		const rejected = await presenter("POST", "proposals/decide", {
			session,
			body: { operationId: "op-1", decision: "reject", reason: "not yet" },
		})
		expect(await rejected.json()).toEqual({ state: "rejected" })
		const foreign = await presenter("POST", "proposals/decide", {
			session,
			body: { operationId: "op-from-another-slot", decision: "approve" },
		})
		expect(foreign.status).toBe(409)
		expect(client.approveProposal).toHaveBeenCalledTimes(1)
	})

	it("pins a completed run, and a visitor then reads that run with its own key", async () => {
		const { stores, asked, tick } = boot()
		const session = await signIn()
		await presenter("POST", "lease", { session })

		expect((await visit()).status).toBe(200)
		expect(asked.at(-1)).toMatchObject({
			key: "baseline",
			scopeRef: "demo-run-12",
		})

		const early = await presenter("POST", "pin", { session })
		expect(early.status).toBe(409)

		const doc = stores.manifests.docs.get("run-13") as Record<string, unknown>
		stores.manifests.docs.set("run-13", {
			...doc,
			state: "used",
			agentRunState: "complete",
			agentRun: { state: "complete" },
		} as never)
		expect((await presenter("POST", "pin", { session })).status).toBe(200)

		// The public target is remembered for a few seconds before the pin is read.
		tick(6_000)
		const visitor = await visit()
		expect(visitor.status).toBe(200)
		expect(visitor.headers.get("cache-control")).not.toBe("private, no-store")
		expect(asked.at(-1)).toMatchObject({ key: "r13", scopeRef: "demo-run-13" })
	})

	it("serves a presenter their leased slot, privately, and a visitor the public run", async () => {
		const { asked } = boot()
		const session = await signIn()
		await presenter("POST", "lease", { session })
		const mine = await visit(session.cookie)
		expect(mine.headers.get("cache-control")).toBe("private, no-store")
		expect(mine.headers.get("vary")).toBe("cookie")
		expect(asked.at(-1)).toMatchObject({ key: "r13", scopeRef: "demo-run-13" })
		await visit()
		expect(asked.at(-1)).toMatchObject({ key: "baseline" })
	})

	it("answers the fixed not-configured message everywhere, and public on state, when the review key can write", async () => {
		boot()
		const write = {
			...CONFIG,
			adminKey: "wide-key",
		}
		runtimeHolder.current = createPresenterRuntime({
			config: write,
			baselineEnv: BASELINE,
			baselineRun: null,
			stores: {
				manifests: new MemoryCollection<{ _id: string }>([], []),
				leases: new MemoryCollection(["presenterId"]),
				sessions: new MemoryCollection(),
				runRequests: new MemoryCollection(),
				publicRun: new MemoryCollection(),
			} as never,
			proposalsClient: {
				listProposals: async () => ({ proposals: [] }),
				approveProposal: async () => {
					throw new Error("unused")
				},
				rejectProposal: async () => {
					throw new Error("unused")
				},
			},
			fetchImpl: (async () =>
				Response.json({
					capabilities: ["read", "write", "administer"],
					grants: [],
				})) as typeof fetch,
		})
		const refused = await presenter("POST", "session", {
			body: { token: TOKEN },
		})
		expect(refused.status).toBe(503)
		expect(await refused.json()).toEqual({
			error: {
				code: "PRESENTER_NOT_CONFIGURED",
				message: "Presenter mode is not configured on this server.",
			},
		})
		expect(await (await presenter("GET", "state")).json()).toEqual({
			mode: "public",
		})
	})

	it("refuses a sign-in with no client address, and an oversized body", async () => {
		boot()
		const noAddress = await presenter("POST", "session", {
			body: { token: TOKEN },
			address: null,
		})
		expect(noAddress.status).toBe(403)
		const { POST } = await import("./route.js")
		const big = await POST(
			new Request(`${ORIGIN}/api/demo/presenter/session`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: ORIGIN,
					"x-forwarded-for": "203.0.113.9",
				},
				body: JSON.stringify({ token: "x".repeat(5_000) }),
			}),
			{ params: Promise.resolve({ action: ["session"] }) },
		)
		expect(big.status).toBe(413)
	})
})
