import { describe, expect, it, vi } from "vitest"
import type { LeaseDoc, LeaseManifest } from "./lease.js"
import { createLeaseService } from "./lease.js"
import { createPinService, type PinDoc } from "./pin.js"
import {
	handlePresenterRequest,
	type PresenterServices,
} from "./presenter-api.js"
import { createProposalService, type ProposalsClient } from "./proposals.js"
import { createRunRequestService, type RunRequestDoc } from "./run-requests.js"
import {
	CSRF_HEADER,
	SESSION_COOKIE,
	createSessionService,
	type SessionDoc,
} from "./session.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const NOW = new Date("2026-10-23T12:00:00.000Z")
const ORIGIN = "http://demo.test"
const TOKEN = "presenter-token-0123456789abcdef"

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

const pendingProposal = (operationId: string) => ({
	operationId,
	state: "pending" as const,
	proposer: {
		subjectId: "demo-proposer-13",
		displayName: "Demo proposer 13",
		agentId: "demo-run-13",
	},
	scope: "workspace",
	scopeRef: "demo-run-13",
	proposedAt: "2026-10-23T12:05:00.000Z",
	page: {
		slug: "syntheses/silent-eta-drift",
		title: "Silent ETA drift",
		kind: "synthesis",
		summary: "ETAs slip with no notice",
		body: "body",
		claims: [{ id: "c1", text: "one" }],
	},
})

function rig(manifests: LeaseManifest[]) {
	let clock = NOW
	const now = () => clock
	const leaseStore = new MemoryCollection<LeaseDoc>(["presenterId"])
	const requestStore = new MemoryCollection<RunRequestDoc>()
	const pinStore = new MemoryCollection<PinDoc>()
	const reader = {
		get: async (runId: string) =>
			manifests.find((m) => m.runId === runId) ?? null,
	}
	const pins = createPinService({ pins: pinStore, manifests: reader, now })
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
	} satisfies ProposalsClient
	const services: PresenterServices = {
		verifyToken: (provided) => provided === TOKEN,
		sessions: createSessionService({
			sessions: new MemoryCollection<SessionDoc>(),
			now,
		}),
		leases: createLeaseService({
			leases: leaseStore,
			manifests: { listReady: async () => manifests },
			pinnedRunId: async () => (await pins.get())?.runId,
			now,
		}),
		manifests: reader,
		runRequests: createRunRequestService({ requests: requestStore, now }),
		pins,
		proposals: createProposalService(client),
		now,
	}
	return {
		services,
		client,
		leaseStore,
		requestStore,
		pinStore,
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

type Call = {
	method?: string
	path: string
	body?: unknown
	session?: { sessionId: string; csrf: string }
	origin?: string | null
	csrf?: string | null
	type?: string
}

async function call(services: PresenterServices | null, input: Call) {
	const method = input.method ?? "POST"
	const headers: Record<string, string> = {}
	if (method !== "GET") {
		headers["content-type"] = input.type ?? "application/json"
		if (input.origin !== null) headers.origin = input.origin ?? ORIGIN
	}
	if (input.session) {
		headers.cookie = `${SESSION_COOKIE}=${input.session.sessionId}`
		if (input.csrf !== null && method !== "GET") {
			headers[CSRF_HEADER] = input.csrf ?? input.session.csrf
		}
	}
	const response = await handlePresenterRequest(
		new Request(`${ORIGIN}/api/demo/presenter/${input.path}`, {
			method,
			headers,
			...(method === "GET" ? {} : { body: JSON.stringify(input.body ?? {}) }),
		}),
		input.path.split("/"),
		services,
	)
	return {
		response,
		status: response.status,
		body: (await response.json()) as Record<string, any>,
	}
}

async function signIn(services: PresenterServices) {
	const result = await call(services, {
		path: "session",
		body: { token: TOKEN },
	})
	const cookie = result.response.headers.get("set-cookie") ?? ""
	const sessionId =
		new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1] ?? ""
	return { sessionId, csrf: result.body.csrf as string }
}

describe("presenter API: public stays public", () => {
	it("tells a visitor with no session that it is public mode and nothing else", async () => {
		const { services } = rig([seeded(13)])
		const result = await call(services, { method: "GET", path: "state" })
		expect(result.status).toBe(200)
		expect(result.body).toEqual({ mode: "public" })
	})

	it("refuses every presenter action without a session", async () => {
		const { services, client } = rig([seeded(13)])
		for (const path of [
			"lease",
			"lease/release",
			"lease/name",
			"run",
			"pin",
			"proposals/decide",
			"session/end",
		]) {
			const result = await call(services, {
				path,
				body: { name: "x", operationId: "op-1", decision: "approve" },
			})
			expect(result.status, path).toBe(401)
			expect(result.body.error.code).toBe("NOT_PRESENTER")
		}
		expect(
			(await call(services, { method: "GET", path: "proposals" })).status,
		).toBe(401)
		expect(client.approveProposal).not.toHaveBeenCalled()
	})

	it("is off, with a plain message, when presenter mode is not configured", async () => {
		const state = await call(null, { method: "GET", path: "state" })
		expect(state.body).toEqual({ mode: "public" })
		const login = await call(null, { path: "session", body: { token: TOKEN } })
		expect(login.status).toBe(503)
		expect(login.body.error.code).toBe("PRESENTER_NOT_CONFIGURED")
	})
})

describe("presenter API: sign in", () => {
	it("opens a session for the right token and sets an HttpOnly SameSite=Strict cookie", async () => {
		const { services } = rig([seeded(13)])
		const result = await call(services, {
			path: "session",
			body: { token: TOKEN },
		})
		expect(result.status).toBe(200)
		expect(result.body.csrf).toEqual(expect.any(String))
		const cookie = result.response.headers.get("set-cookie") ?? ""
		expect(cookie).toContain("HttpOnly")
		expect(cookie).toContain("SameSite=Strict")
		expect(JSON.stringify(result.body)).not.toContain(TOKEN)
	})

	it("refuses a wrong token with no cookie", async () => {
		const { services } = rig([seeded(13)])
		const result = await call(services, {
			path: "session",
			body: { token: "nope" },
		})
		expect(result.status).toBe(401)
		expect(result.body.error.code).toBe("INVALID_TOKEN")
		expect(result.response.headers.get("set-cookie")).toBeNull()
	})

	it("refuses a sign-in from another origin or as a form post", async () => {
		const { services } = rig([seeded(13)])
		const cross = await call(services, {
			path: "session",
			body: { token: TOKEN },
			origin: "http://evil.test",
		})
		expect(cross.status).toBe(403)
		const form = await call(services, {
			path: "session",
			body: { token: TOKEN },
			type: "text/plain",
		})
		expect(form.status).toBe(415)
	})

	it("shows a signed-in presenter their mode, csrf token and no lease yet", async () => {
		const { services } = rig([seeded(13)])
		const session = await signIn(services)
		const state = await call(services, {
			method: "GET",
			path: "state",
			session,
		})
		expect(state.body).toMatchObject({
			mode: "presenter",
			csrf: session.csrf,
			lease: null,
			request: null,
		})
	})

	it("ends a session", async () => {
		const { services } = rig([seeded(13)])
		const session = await signIn(services)
		const ended = await call(services, { path: "session/end", session })
		expect(ended.status).toBe(200)
		expect(ended.response.headers.get("set-cookie")).toContain("Max-Age=0")
		const state = await call(services, {
			method: "GET",
			path: "state",
			session,
		})
		expect(state.body).toEqual({ mode: "public" })
	})
})

describe("presenter API: CSRF on every action", () => {
	it("refuses a missing or wrong csrf token, another origin, and a non-JSON body, for each action", async () => {
		const { services, client } = rig([seeded(13)])
		const session = await signIn(services)
		await call(services, { path: "lease", session })
		for (const path of [
			"lease",
			"lease/release",
			"lease/name",
			"run",
			"pin",
			"proposals/decide",
		]) {
			const body = { name: "x", operationId: "op-1", decision: "approve" }
			expect(
				(await call(services, { path, session, csrf: null, body })).status,
				`${path} no csrf`,
			).toBe(403)
			expect(
				(await call(services, { path, session, csrf: "wrong", body })).status,
				`${path} wrong csrf`,
			).toBe(403)
			expect(
				(
					await call(services, {
						path,
						session,
						origin: "http://evil.test",
						body,
					})
				).status,
				`${path} origin`,
			).toBe(403)
			expect(
				(await call(services, { path, session, origin: null, body })).status,
				`${path} no origin`,
			).toBe(403)
			expect(
				(await call(services, { path, session, type: "text/plain", body }))
					.status,
				`${path} form`,
			).toBe(415)
		}
		expect(client.approveProposal).not.toHaveBeenCalled()
	})

	it("refuses GET on an action and POST on a read", async () => {
		const { services } = rig([seeded(13)])
		const session = await signIn(services)
		expect(
			(await call(services, { method: "GET", path: "lease", session })).status,
		).toBe(405)
		expect(
			(await call(services, { method: "POST", path: "state", session })).status,
		).toBe(405)
		expect(
			(await call(services, { method: "GET", path: "nothing" })).status,
		).toBe(404)
	})
})

describe("presenter API: lease", () => {
	it("leases the lowest fully seeded slot and names it", async () => {
		const { services } = rig([seeded(14), seeded(13)])
		const session = await signIn(services)
		const leased = await call(services, {
			path: "lease",
			session,
			body: { name: "Acme renewal" },
		})
		expect(leased.status).toBe(200)
		expect(leased.body.lease).toMatchObject({
			slotIndex: 13,
			name: "Acme renewal",
		})
		const renamed = await call(services, {
			path: "lease/name",
			session,
			body: { name: "Globex QBR" },
		})
		expect(renamed.body.lease.name).toBe("Globex QBR")
	})

	it("gives one of two presenters the only slot and tells the other plainly", async () => {
		const { services } = rig([seeded(13)])
		const a = await signIn(services)
		const b = await signIn(services)
		expect((await call(services, { path: "lease", session: a })).status).toBe(
			200,
		)
		const refused = await call(services, { path: "lease", session: b })
		expect(refused.status).toBe(409)
		expect(refused.body.error.code).toBe("NO_SLOT_AVAILABLE")
	})

	it("never leases a slot that is not fully seeded, even when the browser asks for it by number", async () => {
		const { services, leaseStore } = rig([
			seeded(1, { eventsWritten: 2 }),
			seeded(13),
		])
		const session = await signIn(services)
		const refused = await call(services, {
			path: "lease",
			session,
			body: { slotIndex: 1 },
		})
		expect(refused.status).toBe(409)
		expect(refused.body.error.code).toBe("SLOT_NOT_LEASABLE")
		expect(leaseStore.docs.size).toBe(0)
	})

	it("releases the lease so another presenter can take the slot", async () => {
		const { services } = rig([seeded(13)])
		const a = await signIn(services)
		const b = await signIn(services)
		await call(services, { path: "lease", session: a })
		await call(services, { path: "lease/release", session: a })
		expect((await call(services, { path: "lease", session: b })).status).toBe(
			200,
		)
	})

	it("rejects a body field it does not know instead of acting on it", async () => {
		const { services } = rig([seeded(13)])
		const session = await signIn(services)
		const refused = await call(services, {
			path: "lease",
			session,
			body: { scopeRef: "demo-run-1" },
		})
		expect(refused.status).toBe(400)
		expect(refused.body.error.code).toBe("UNKNOWN_FIELD")
	})

	it("keeps the lease alive while the presenter keeps asking for the state", async () => {
		const { services, leaseStore, tick } = rig([seeded(13)])
		const session = await signIn(services)
		await call(services, { path: "lease", session })
		const first = leaseStore.docs.get("slot:13")!.expiresAt.getTime()
		tick(60_000)
		await call(services, { method: "GET", path: "state", session })
		expect(leaseStore.docs.get("slot:13")!.expiresAt.getTime()).toBe(
			first + 60_000,
		)
	})
})

describe("presenter API: run the agents", () => {
	it("needs a lease", async () => {
		const { services, requestStore } = rig([seeded(13)])
		const session = await signIn(services)
		const refused = await call(services, { path: "run", session })
		expect(refused.status).toBe(409)
		expect(refused.body.error.code).toBe("NO_LEASE")
		expect(requestStore.docs.size).toBe(0)
	})

	it("queues the leased run once, however often it is asked, and shows the request in the state", async () => {
		const { services, requestStore } = rig([seeded(13)])
		const session = await signIn(services)
		await call(services, { path: "lease", session })
		const first = await call(services, { path: "run", session })
		const second = await call(services, { path: "run", session })
		expect(first.status).toBe(200)
		expect(second.status).toBe(200)
		expect(requestStore.docs.size).toBe(1)
		expect(requestStore.docs.get("run-13")).toMatchObject({
			state: "queued",
			slotIndex: 13,
		})
		const state = await call(services, {
			method: "GET",
			path: "state",
			session,
		})
		expect(state.body.request).toMatchObject({ state: "queued" })
		expect(JSON.stringify(state.body)).not.toContain("run-13")
		expect(JSON.stringify(state.body)).not.toContain("demo-run-13")
	})

	it("never lets the browser name the run", async () => {
		const { services, requestStore } = rig([seeded(13), seeded(14)])
		const session = await signIn(services)
		await call(services, { path: "lease", session })
		const refused = await call(services, {
			path: "run",
			session,
			body: { runId: "run-14", slotIndex: 14 },
		})
		expect(refused.status).toBe(400)
		expect(requestStore.docs.size).toBe(0)
	})
})

describe("presenter API: approve, reject, pin", () => {
	async function leased() {
		const context = rig([seeded(13)])
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		return { ...context, session }
	}

	it("lists the proposal pending in the leased scope, and only that scope", async () => {
		const { services, client, session } = await leased()
		const listed = await call(services, {
			method: "GET",
			path: "proposals",
			session,
		})
		expect(listed.status).toBe(200)
		expect(listed.body.proposals).toEqual([
			expect.objectContaining({
				operationId: "op-1",
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
			}),
		])
		expect(client.listProposals).toHaveBeenCalledWith({
			scope: "workspace",
			scopeRef: "demo-run-13",
		})
	})

	it("refuses a caller-supplied scope on the review queue", async () => {
		const { services, session } = await leased()
		const response = await handlePresenterRequest(
			new Request(
				`${ORIGIN}/api/demo/presenter/proposals?scopeRef=demo-run-14`,
				{
					headers: { cookie: `${SESSION_COOKIE}=${session.sessionId}` },
				},
			),
			["proposals"],
			services,
		)
		expect(response.status).toBe(400)
	})

	it("approves the pending proposal", async () => {
		const { services, client, session } = await leased()
		const done = await call(services, {
			path: "proposals/decide",
			session,
			body: { operationId: "op-1", decision: "approve" },
		})
		expect(done.status).toBe(200)
		expect(done.body).toEqual({
			state: "promoted",
			pageSlug: "syntheses/silent-eta-drift",
		})
		expect(client.approveProposal).toHaveBeenCalledWith({ operationId: "op-1" })
	})

	it("rejects the pending proposal with a reason", async () => {
		const { services, client, session } = await leased()
		const done = await call(services, {
			path: "proposals/decide",
			session,
			body: {
				operationId: "op-1",
				decision: "reject",
				reason: "not this quarter",
			},
		})
		expect(done.body).toEqual({ state: "rejected" })
		expect(client.rejectProposal).toHaveBeenCalledWith({
			operationId: "op-1",
			reason: "not this quarter",
		})
	})

	it("never decides a proposal outside the leased scope", async () => {
		const { services, client, session } = await leased()
		const refused = await call(services, {
			path: "proposals/decide",
			session,
			body: { operationId: "op-from-another-slot", decision: "approve" },
		})
		expect(refused.status).toBe(409)
		expect(refused.body.error.code).toBe("PROPOSAL_NOT_PENDING")
		expect(client.approveProposal).not.toHaveBeenCalled()
	})

	it("needs a lease to see or decide anything", async () => {
		const { services, session: _ } = await leased()
		const other = await signIn(services)
		const listed = await call(services, {
			method: "GET",
			path: "proposals",
			session: other,
		})
		expect(listed.status).toBe(409)
		expect(listed.body.error.code).toBe("NO_LEASE")
	})

	it("pins the leased run only once its agents finished", async () => {
		const context = rig([seeded(13)])
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		const early = await call(context.services, { path: "pin", session })
		expect(early.status).toBe(409)
		expect(early.body.error.code).toBe("RUN_NOT_COMPLETE")
		expect(context.pinStore.docs.size).toBe(0)
	})

	it("pins a completed leased run and records the presenter", async () => {
		const manifests = [seeded(13)]
		const context = rig(manifests)
		const session = await signIn(context.services)
		await call(context.services, { path: "lease", session })
		manifests[0] = seeded(13, {
			state: "used",
			hasAgentRun: true,
			agentRunState: "complete",
		})
		const done = await call(context.services, { path: "pin", session })
		expect(done.status).toBe(200)
		expect(context.pinStore.docs.get("public")).toMatchObject({
			runId: "run-13",
		})
	})
})
