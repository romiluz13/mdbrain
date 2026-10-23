import { describe, expect, it, vi } from "vitest"
import type { DemoProxyEnv } from "../demo-data/proxy.js"
import type { DemoRunEnv } from "../demo-data/proxy-run.js"
import type { PresenterConfig } from "./config.js"
import {
	createLeaseService,
	type LeaseDoc,
	type LeaseManifest,
} from "./lease.js"
import { createPinService, type PinDoc } from "./pin.js"
import {
	SESSION_COOKIE,
	createSessionService,
	type SessionDoc,
} from "./session.js"
import { createTargetResolver } from "./target.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const NOW = new Date("2026-10-23T12:00:00.000Z")
const CONFIG: PresenterConfig = {
	controlUri: "mongodb://control.test/",
	apiBaseUrl: "http://api.test",
	token: "presenter-token-0123456789abcdef",
	adminKey: "admin-key",
	readKeys: Array.from({ length: 15 }, (_, i) => `read-key-${i + 1}`),
	runDeadlineMs: 335_000,
}
const BASELINE_ENV: DemoProxyEnv = {
	apiBaseUrl: "http://api.test",
	readKey: "baseline-read-key",
	scope: "workspace",
	scopeRef: "demo-run-12",
	agentId: "demo-run-12",
}
const BASELINE_RUN: DemoRunEnv = {
	controlUri: "mongodb://control.test/",
	runId: "run-12",
}

const seeded = (
	slot: number,
	over: Partial<LeaseManifest> = {},
): LeaseManifest => ({
	runId: `run-${slot}`,
	slotIndex: slot,
	scopeRef: `demo-run-${slot}`,
	agentId: `demo-run-${slot}`,
	state: "ready",
	eventsPlanned: 4,
	pagesPlanned: 2,
	eventsWritten: 4,
	pagesWritten: 2,
	hasAgentRun: false,
	agentRunState: "",
	...over,
})

function rig(
	manifests: LeaseManifest[],
	options: {
		config?: PresenterConfig | null
		baseline?: boolean
		ready?: () => Promise<boolean>
	} = {},
) {
	let clock = NOW
	const sessionStore = new MemoryCollection<SessionDoc>()
	const leaseStore = new MemoryCollection<LeaseDoc>(["presenterId"])
	const pinStore = new MemoryCollection<PinDoc>()
	const sessions = createSessionService({
		sessions: sessionStore,
		now: () => clock,
	})
	const reader = {
		get: async (runId: string) =>
			manifests.find((m) => m.runId === runId) ?? null,
	}
	const pins = createPinService({
		pins: pinStore,
		manifests: reader,
		readable: () => true,
		now: () => clock,
	})
	const pinGet = vi.spyOn(pins, "get")
	const leases = createLeaseService({
		leases: leaseStore,
		manifests: { listReady: async () => manifests },
		pinnedRunId: async () => (await pins.get())?.runId,
		now: () => clock,
	})
	const resolver = createTargetResolver({
		config: options.config === undefined ? CONFIG : options.config,
		baselineEnv: options.baseline === false ? null : BASELINE_ENV,
		baselineRun: options.baseline === false ? null : BASELINE_RUN,
		sessions,
		leases,
		manifests: reader,
		pins,
		now: () => clock,
		pinTtlMs: 5000,
		...(options.ready ? { ready: options.ready } : {}),
	})
	const request = (sessionId?: string) =>
		new Request("http://demo.test/api/demo/v1/wiki", {
			headers: sessionId ? { cookie: `${SESSION_COOKIE}=${sessionId}` } : {},
		})
	return {
		sessions,
		leases,
		pins,
		pinGet,
		resolver,
		request,
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

describe("public target", () => {
	it("is today's env-pinned run with no cookie and no pin", async () => {
		const { resolver, request } = rig([])
		const result = await resolver.resolve(request())
		expect(result).toEqual({
			ok: true,
			target: { mode: "public", env: BASELINE_ENV, run: BASELINE_RUN },
		})
	})

	it("follows the run a presenter pinned, with that slot's read key and the run's own scope", async () => {
		const done = seeded(13, {
			state: "used",
			hasAgentRun: true,
			agentRunState: "complete",
		})
		const { resolver, request, pins } = rig([done])
		await pins.pin("run-13", "p1")
		const result = await resolver.resolve(request())
		expect(result).toMatchObject({
			ok: true,
			target: {
				mode: "public",
				env: {
					apiBaseUrl: "http://api.test",
					readKey: "read-key-13",
					scope: "workspace",
					scopeRef: "demo-run-13",
					agentId: "demo-run-13",
				},
				run: { controlUri: "mongodb://control.test/", runId: "run-13" },
			},
		})
	})

	it("falls back to the env-pinned run when the pinned run is no longer complete", async () => {
		const manifests = [
			seeded(13, {
				state: "used",
				hasAgentRun: true,
				agentRunState: "complete",
			}),
		]
		const { resolver, request, pins, tick } = rig(manifests)
		await pins.pin("run-13", "p1")
		manifests[0] = seeded(13, {
			agentRunState: "incomplete",
			hasAgentRun: true,
		})
		tick(6000)
		const result = await resolver.resolve(request())
		expect(result).toMatchObject({ ok: true, target: { env: BASELINE_ENV } })
	})

	it("says the proxy is not configured when there is no pin and no env run", async () => {
		const { resolver, request } = rig([], { baseline: false })
		expect(await resolver.resolve(request())).toMatchObject({
			ok: false,
			status: 503,
			code: "PROXY_NOT_CONFIGURED",
		})
	})

	it("reads the pin once inside its cache window and again after it", async () => {
		const { resolver, request, pinGet, tick } = rig([])
		await resolver.resolve(request())
		await resolver.resolve(request())
		expect(pinGet).toHaveBeenCalledTimes(1)
		tick(5001)
		await resolver.resolve(request())
		expect(pinGet).toHaveBeenCalledTimes(2)
	})
})

describe("presenter target", () => {
	it("is the leased slot, with its own read key, scope and agent, and the lease's run record", async () => {
		const { resolver, request, sessions, leases } = rig([
			seeded(13),
			seeded(14),
		])
		const opened = await sessions.open()
		await leases.acquire({ presenterId: opened.presenterId })
		const result = await resolver.resolve(request(opened.sessionId))
		expect(result).toEqual({
			ok: true,
			target: {
				mode: "presenter",
				env: {
					apiBaseUrl: "http://api.test",
					readKey: "read-key-13",
					scope: "workspace",
					scopeRef: "demo-run-13",
					agentId: "demo-run-13",
				},
				run: { controlUri: "mongodb://control.test/", runId: "run-13" },
			},
		})
	})

	it("keeps two presenters on their own slots", async () => {
		const { resolver, request, sessions, leases } = rig([
			seeded(13),
			seeded(14),
		])
		const a = await sessions.open()
		const b = await sessions.open()
		await leases.acquire({ presenterId: a.presenterId })
		await leases.acquire({ presenterId: b.presenterId })
		const ra = await resolver.resolve(request(a.sessionId))
		const rb = await resolver.resolve(request(b.sessionId))
		expect(ra.ok && ra.target.env.scopeRef).toBe("demo-run-13")
		expect(rb.ok && rb.target.env.scopeRef).toBe("demo-run-14")
	})

	it("is the public run for a signed-in presenter who holds no lease", async () => {
		const { resolver, request, sessions } = rig([seeded(13)])
		const opened = await sessions.open()
		const result = await resolver.resolve(request(opened.sessionId))
		expect(result).toMatchObject({ ok: true, target: { mode: "public" } })
	})

	it("is the public run for an unknown or expired session, and when presenter mode is not configured", async () => {
		const { resolver, request } = rig([seeded(13)])
		expect(await resolver.resolve(request("forged"))).toMatchObject({
			ok: true,
			target: { mode: "public" },
		})
		const off = rig([seeded(13)], { config: null })
		const opened = await off.sessions.open()
		await off.leases.acquire({ presenterId: opened.presenterId })
		expect(
			await off.resolver.resolve(off.request(opened.sessionId)),
		).toMatchObject({
			ok: true,
			target: { mode: "public" },
		})
	})

	it("asks whether presenter mode is ready only for a cookie shaped like a session, so a forged one costs nothing", async () => {
		const ready = vi.fn(async () => true)
		const { resolver, request, sessions } = rig([seeded(13)], { ready })
		for (const forged of ["junk", "x".repeat(44), "x".repeat(10_000)]) {
			expect(await resolver.resolve(request(forged))).toMatchObject({
				target: { mode: "public" },
			})
		}
		expect(ready).not.toHaveBeenCalled()
		const opened = await sessions.open()
		await resolver.resolve(request(opened.sessionId))
		expect(ready).toHaveBeenCalledTimes(1)
	})

	it("refuses a leased slot that has no read key rather than reading with another", async () => {
		const short = { ...CONFIG, readKeys: ["read-key-1"] }
		const { resolver, request, sessions, leases } = rig([seeded(13)], {
			config: short,
		})
		const opened = await sessions.open()
		await leases.acquire({ presenterId: opened.presenterId })
		expect(await resolver.resolve(request(opened.sessionId))).toMatchObject({
			ok: false,
			status: 503,
			code: "SLOT_NOT_READABLE",
		})
	})

	it.each([
		["scope reference", { scopeRef: "demo-run-13&scope=other" }],
		["scope reference", { scopeRef: "" }],
		["agent id", { agentId: "demo run 13" }],
		["agent id", { agentId: "a".repeat(129) }],
	])("refuses a leased slot whose stored %s is not the shape the proxy accepts (%j)", async (_name, bad) => {
		const manifests = [seeded(13)]
		const { resolver, request, sessions, leases } = rig(manifests)
		const opened = await sessions.open()
		await leases.acquire({ presenterId: opened.presenterId })
		manifests[0] = seeded(13, bad)
		expect(await resolver.resolve(request(opened.sessionId))).toMatchObject({
			ok: false,
			status: 503,
			code: "SLOT_NOT_READABLE",
		})
	})

	it("refuses a leased slot whose run record cannot be read rather than showing the public run as the slot", async () => {
		const manifests = [seeded(13)]
		const { resolver, request, sessions, leases } = rig(manifests)
		const opened = await sessions.open()
		await leases.acquire({ presenterId: opened.presenterId })
		manifests.length = 0
		expect(await resolver.resolve(request(opened.sessionId))).toMatchObject({
			ok: false,
			status: 503,
			code: "SLOT_NOT_READABLE",
		})
	})
})
