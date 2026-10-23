// /v1/admin/wiki-promotions: the review list, approve and reject, and the
// delivery redrive. The runtime is mocked, so these pin the HTTP contract: who
// may call, the request and response shapes, and how runtime outcomes map to
// status codes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const runtimeMocks = vi.hoisted(() => ({
	deliverMemoryWrite: vi.fn(),
	approvePendingWikiPromotion: vi.fn(),
	redriveDeadLetteredMemoryDelivery: vi.fn(),
	readMemoryDeliveryOwner: vi.fn(),
	wikiPromotionApprovalRequired: vi.fn(() => false),
	buildMemoryDeliveryOperationId: vi.fn(() => `add:${"a".repeat(64)}`),
	buildMemoryWikiPromotion: vi.fn(() => ({})),
	MemoryDeliveryDispatchError: class MemoryDeliveryDispatchError extends Error {
		constructor(
			readonly operationId: string,
			readonly state: string,
			readonly code: string,
		) {
			super(`memory delivery ${operationId} entered ${state}`)
		}
	},
}))
const proposalMocks = vi.hoisted(() => ({
	listPendingWikiProposals: vi.fn(),
	rejectPendingWikiPromotion: vi.fn(),
}))

vi.mock("./memory-delivery-runtime.js", () => ({ ...runtimeMocks }))
vi.mock("./proposals-runtime.js", () => ({ ...proposalMocks }))
vi.mock("./wiki-store-runtime.js", () => ({
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
	checkWikiStoreReadiness: vi.fn(),
	closeWikiStore: vi.fn(),
}))
vi.mock("@mdbrain/memory-bridge", () => ({
	mdbrainBridgeAdd: vi.fn(),
	mdbrainBridgeCheckReadiness: vi.fn(),
	mdbrainBridgeWriteConversationEvent: vi.fn(),
}))

import { createApp } from "./app.js"

type Json = {
	error?: { code: string; message: string }
	[key: string]: unknown
}
const asJson = (res: Response) => res.json() as Promise<Json>

const ADMIN = {
	Authorization: "Bearer admin-secret",
	"Content-Type": "application/json",
}
const PROPOSER = {
	Authorization: "Bearer proposer-secret",
	"Content-Type": "application/json",
}
// A presenter key: administer only, granted exactly three demo slots.
const PRESENTER = {
	Authorization: "Bearer presenter-secret",
	"Content-Type": "application/json",
}
const WRITER = {
	Authorization: "Bearer writer-secret",
	"Content-Type": "application/json",
}
const SLOTS = ["demo-run-13", "demo-run-14", "demo-run-15"]

beforeEach(() => {
	process.env = { ...prevEnv }
	process.env.MDBRAIN_API_KEY = "admin-secret"
	process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
		{
			token: "proposer-secret",
			subjectId: "demo-proposer-1",
			grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
			capabilities: ["read", "propose"],
		},
		{
			token: "presenter-secret",
			subjectId: "demo-presenter",
			grants: SLOTS.map((scopeRef) => ({ scope: "workspace", scopeRef })),
			capabilities: ["administer"],
		},
		{
			token: "agent-admin-secret",
			subjectId: "agent-1-admin",
			agentIds: ["agent-1"],
			capabilities: ["administer"],
		},
		{
			token: "writer-secret",
			subjectId: "demo-writer",
			grants: SLOTS.map((scopeRef) => ({ scope: "workspace", scopeRef })),
			capabilities: ["read", "write", "propose"],
		},
	])
	for (const mock of Object.values(proposalMocks)) mock.mockReset()
	runtimeMocks.approvePendingWikiPromotion.mockReset()
	runtimeMocks.redriveDeadLetteredMemoryDelivery.mockReset()
	runtimeMocks.readMemoryDeliveryOwner.mockReset()
	runtimeMocks.deliverMemoryWrite.mockReset()
})
afterEach(() => {
	process.env = { ...prevEnv }
})

describe("GET /v1/admin/wiki-promotions", () => {
	it("lists the pending proposals for an admin", async () => {
		const proposal = {
			operationId: "add:op1",
			state: "pending",
			proposer: { subjectId: "demo-proposer-1", agentId: "agent-1" },
			scope: "workspace",
			scopeRef: "demo-run-1",
			proposedAt: "2026-10-20T10:00:00.000Z",
			page: {
				slug: "concepts/x",
				title: "X",
				kind: "concept",
				summary: "s",
				body: "b",
				claims: [{ id: "c1", text: "t" }],
			},
		}
		proposalMocks.listPendingWikiProposals.mockResolvedValue([proposal])

		const res = await createApp().request(
			"/v1/admin/wiki-promotions?limit=10",
			{ headers: ADMIN },
		)

		expect(res.status).toBe(200)
		expect(await asJson(res)).toEqual({ proposals: [proposal] })
		expect(proposalMocks.listPendingWikiProposals).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 10 }),
		)
	})

	it("narrows the list to a scope when the admin asks for one", async () => {
		proposalMocks.listPendingWikiProposals.mockResolvedValue([])

		await createApp().request(
			"/v1/admin/wiki-promotions?scope=workspace&scopeRef=demo-run-1",
			{ headers: ADMIN },
		)

		expect(proposalMocks.listPendingWikiProposals).toHaveBeenCalledWith(
			expect.objectContaining({ scope: "workspace", scopeRef: "demo-run-1" }),
		)
	})

	it("caps the limit at 100 and refuses one that is not a number, as the deliveries list does", async () => {
		proposalMocks.listPendingWikiProposals.mockResolvedValue([])
		const app = createApp()

		const capped = await app.request("/v1/admin/wiki-promotions?limit=500", {
			headers: ADMIN,
		})
		const bad = await app.request("/v1/admin/wiki-promotions?limit=abc", {
			headers: ADMIN,
		})

		expect(capped.status).toBe(200)
		expect(proposalMocks.listPendingWikiProposals).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 100 }),
		)
		expect(bad.status).toBe(400)
		expect((await asJson(bad)).error?.code).toBe("VALIDATION_ERROR")
	})

	it("is closed to a proposer", async () => {
		const res = await createApp().request(
			"/v1/admin/wiki-promotions?scope=workspace&scopeRef=demo-run-1",
			{ headers: PROPOSER },
		)

		expect(res.status).toBe(403)
		expect(proposalMocks.listPendingWikiProposals).not.toHaveBeenCalled()
	})

	it("answers a failure with a coded 500", async () => {
		proposalMocks.listPendingWikiProposals.mockRejectedValue(
			new Error("db down"),
		)

		const res = await createApp().request("/v1/admin/wiki-promotions", {
			headers: ADMIN,
		})

		expect(res.status).toBe(500)
		expect((await asJson(res)).error?.code).toBe("PROPOSAL_LIST_FAILED")
	})
})

describe("POST /v1/admin/wiki-promotions/:operationId/approve", () => {
	it("returns the same body every time it is approved", async () => {
		runtimeMocks.approvePendingWikiPromotion.mockResolvedValue({
			ok: true,
			operationId: "add:op1",
			pageSlug: "concepts/x",
		})
		const app = createApp()

		const first = await app.request(
			"/v1/admin/wiki-promotions/add%3Aop1/approve",
			{ method: "POST", headers: ADMIN },
		)
		const second = await app.request(
			"/v1/admin/wiki-promotions/add%3Aop1/approve",
			{ method: "POST", headers: ADMIN },
		)

		const expected = {
			ok: true,
			operationId: "add:op1",
			state: "promoted",
			pageSlug: "concepts/x",
		}
		expect(await asJson(first)).toEqual(expected)
		expect(await asJson(second)).toEqual(expected)
	})

	it.each([
		["PROPOSER_REVOKED", 409],
		["PROPOSAL_REJECTED", 409],
		["PROPOSAL_ALTERED", 409],
	])("passes %s through", async (code, status) => {
		runtimeMocks.approvePendingWikiPromotion.mockResolvedValue({
			ok: false,
			status,
			code,
			message: "m",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/approve",
			{ method: "POST", headers: ADMIN },
		)

		expect(res.status).toBe(status)
		expect((await asJson(res)).error?.code).toBe(code)
	})

	it("is closed to a proposer, so a proposal cannot approve itself", async () => {
		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/approve?scope=workspace&scopeRef=demo-run-1",
			{ method: "POST", headers: PROPOSER },
		)

		expect(res.status).toBe(403)
		expect(runtimeMocks.approvePendingWikiPromotion).not.toHaveBeenCalled()
	})
})

describe("POST /v1/admin/wiki-promotions/:operationId/reject", () => {
	it("rejects as the calling admin and records the reason", async () => {
		proposalMocks.rejectPendingWikiPromotion.mockResolvedValue({
			ok: true,
			operationId: "add:op1",
			state: "rejected",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/reject",
			{
				method: "POST",
				headers: ADMIN,
				body: JSON.stringify({ reason: "duplicates an existing page" }),
			},
		)

		expect(res.status).toBe(200)
		expect(await asJson(res)).toEqual({
			ok: true,
			operationId: "add:op1",
			state: "rejected",
		})
		expect(proposalMocks.rejectPendingWikiPromotion).toHaveBeenCalledWith({
			operationId: "add:op1",
			rejectedBy: "api-key:admin",
			reason: "duplicates an existing page",
		})
	})

	it("needs no body", async () => {
		proposalMocks.rejectPendingWikiPromotion.mockResolvedValue({
			ok: true,
			operationId: "add:op1",
			state: "rejected",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/reject",
			{ method: "POST", headers: ADMIN },
		)

		expect(res.status).toBe(200)
	})

	it.each([
		[42],
		["x".repeat(501)],
	])("refuses a reason that is not a short string (%#)", async (reason) => {
		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/reject",
			{
				method: "POST",
				headers: ADMIN,
				body: JSON.stringify({ reason }),
			},
		)

		expect(res.status).toBe(400)
		expect(proposalMocks.rejectPendingWikiPromotion).not.toHaveBeenCalled()
	})

	it("maps a runtime refusal to its status", async () => {
		proposalMocks.rejectPendingWikiPromotion.mockResolvedValue({
			ok: false,
			status: 409,
			code: "INVALID_DELIVERY_STATE",
			message: "proposal cannot be rejected from state promoted",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/reject",
			{ method: "POST", headers: ADMIN },
		)

		expect(res.status).toBe(409)
		expect((await asJson(res)).error?.code).toBe("INVALID_DELIVERY_STATE")
	})

	it("is closed to a proposer", async () => {
		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/reject?scope=workspace&scopeRef=demo-run-1",
			{ method: "POST", headers: PROPOSER },
		)

		expect(res.status).toBe(403)
		expect(proposalMocks.rejectPendingWikiPromotion).not.toHaveBeenCalled()
	})
})

describe("a decision is bound to the operation's own scope", () => {
	it("lets a scoped administer key approve an operation in one of its slots", async () => {
		runtimeMocks.readMemoryDeliveryOwner.mockResolvedValue({
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "demo-run-14",
		})
		runtimeMocks.approvePendingWikiPromotion.mockResolvedValue({
			ok: true,
			operationId: "add:op1",
			pageSlug: "concepts/x",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/approve",
			{ method: "POST", headers: PRESENTER },
		)

		expect(res.status).toBe(200)
		expect(runtimeMocks.readMemoryDeliveryOwner).toHaveBeenCalledWith("add:op1")
		expect(runtimeMocks.approvePendingWikiPromotion).toHaveBeenCalledWith({
			operationId: "add:op1",
		})
	})
})

const DECISIONS = [
	{
		name: "approve",
		path: "/v1/admin/wiki-promotions/add%3Aop1/approve",
		runtime: runtimeMocks.approvePendingWikiPromotion,
		ok: { ok: true, operationId: "add:op1", pageSlug: "concepts/x" },
	},
	{
		name: "reject",
		path: "/v1/admin/wiki-promotions/add%3Aop1/reject",
		runtime: proposalMocks.rejectPendingWikiPromotion,
		ok: { ok: true, operationId: "add:op1", state: "rejected" },
	},
	{
		name: "redrive",
		path: "/v1/admin/deliveries/add%3Aop1/redrive",
		runtime: runtimeMocks.redriveDeadLetteredMemoryDelivery,
		ok: { ok: true, operationId: "add:op1", state: "recorded" },
	},
]
const OUTSIDE = {
	error: {
		code: "FORBIDDEN",
		message: "operation is not in a scope this API key may administer",
	},
}
const owner = (scope: string, scopeRef: string) => ({
	agentId: "agent-1",
	scope,
	scopeRef,
})

describe.each(DECISIONS)("$name is bound to the operation's own scope", (d) => {
	const decide = (headers: Record<string, string>, query = "") =>
		createApp().request(`${d.path}${query}`, { method: "POST", headers })

	it("is allowed for a scoped administer key when the operation is in its slots", async () => {
		runtimeMocks.readMemoryDeliveryOwner.mockResolvedValue(
			owner("workspace", "demo-run-15"),
		)
		d.runtime.mockResolvedValue(d.ok)

		const res = await decide(PRESENTER)

		expect(res.status).toBe(200)
		expect(d.runtime).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "add:op1" }),
		)
	})

	it.each([
		["another slot", owner("workspace", "demo-run-12")],
		["another scope type with a granted ref", owner("user", "demo-run-13")],
	])("is refused for an operation in %s, even when the request names a granted scope", async (_label, stored) => {
		runtimeMocks.readMemoryDeliveryOwner.mockResolvedValue(stored)
		d.runtime.mockResolvedValue(d.ok)

		const res = await decide(PRESENTER, "?scope=workspace&scopeRef=demo-run-13")

		expect(res.status).toBe(403)
		expect(await asJson(res)).toEqual(OUTSIDE)
		expect(d.runtime).not.toHaveBeenCalled()
	})

	it("answers an unknown operation exactly as one outside the key's grants", async () => {
		runtimeMocks.readMemoryDeliveryOwner.mockResolvedValue(null)

		const res = await decide(PRESENTER)

		expect(res.status).toBe(403)
		expect(await asJson(res)).toEqual(OUTSIDE)
		expect(d.runtime).not.toHaveBeenCalled()
	})

	it("answers a failed scope lookup with a coded 500 and decides nothing", async () => {
		runtimeMocks.readMemoryDeliveryOwner.mockRejectedValue(new Error("db down"))

		const res = await decide(PRESENTER)

		expect(res.status).toBe(500)
		expect((await asJson(res)).error?.code).toBe("OPERATION_LOOKUP_FAILED")
		expect(d.runtime).not.toHaveBeenCalled()
	})

	it("is unchanged for the full admin key: no scope lookup, any operation", async () => {
		d.runtime.mockResolvedValue(d.ok)

		const res = await decide(ADMIN, "?scope=workspace&scopeRef=anything")

		expect(res.status).toBe(200)
		expect(runtimeMocks.readMemoryDeliveryOwner).not.toHaveBeenCalled()
		expect(d.runtime).toHaveBeenCalled()
	})

	it("is refused for a key in the same slots without administer", async () => {
		runtimeMocks.readMemoryDeliveryOwner.mockResolvedValue(
			owner("workspace", "demo-run-13"),
		)

		const res = await decide(WRITER, "?scope=workspace&scopeRef=demo-run-13")

		expect(res.status).toBe(403)
		expect(await asJson(res)).toEqual({
			error: {
				code: "FORBIDDEN",
				message: "capability is not allowed for this API key",
			},
		})
		expect(runtimeMocks.readMemoryDeliveryOwner).not.toHaveBeenCalled()
		expect(d.runtime).not.toHaveBeenCalled()
	})
})

describe("an administer key limited to one agent", () => {
	const AGENT_ADMIN = {
		Authorization: "Bearer agent-admin-secret",
		"Content-Type": "application/json",
	}

	it.each([
		["agent-1", 200],
		["agent-2", 403],
	])("decides an operation recorded by %s with %i", async (agentId, status) => {
		runtimeMocks.readMemoryDeliveryOwner.mockResolvedValue({
			agentId,
			scope: "workspace",
			scopeRef: "demo-run-1",
		})
		runtimeMocks.approvePendingWikiPromotion.mockResolvedValue({
			ok: true,
			operationId: "add:op1",
			pageSlug: "concepts/x",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/add%3Aop1/approve?agentId=agent-1",
			{ method: "POST", headers: AGENT_ADMIN },
		)

		expect(res.status).toBe(status)
	})
})

describe("a scoped administer key and the review list", () => {
	it("lists only the slot it names", async () => {
		proposalMocks.listPendingWikiProposals.mockResolvedValue([])

		const res = await createApp().request(
			"/v1/admin/wiki-promotions?scope=workspace&scopeRef=demo-run-13",
			{ headers: PRESENTER },
		)

		expect(res.status).toBe(200)
		expect(proposalMocks.listPendingWikiProposals).toHaveBeenCalledWith(
			expect.objectContaining({ scope: "workspace", scopeRef: "demo-run-13" }),
		)
	})

	it.each([
		["no scope", ""],
		["a slot it was not granted", "?scope=workspace&scopeRef=demo-run-12"],
	])("is refused for %s", async (_label, query) => {
		const res = await createApp().request(`/v1/admin/wiki-promotions${query}`, {
			headers: PRESENTER,
		})

		expect(res.status).toBe(403)
		expect(proposalMocks.listPendingWikiProposals).not.toHaveBeenCalled()
	})
})

describe("a write replayed after its proposal was rejected", () => {
	it.each([
		"/v1/add",
		"/v1/write-event",
	])("%s answers 409 PROPOSAL_REJECTED, not a retryable 503", async (path) => {
		runtimeMocks.deliverMemoryWrite.mockRejectedValue(
			new runtimeMocks.MemoryDeliveryDispatchError(
				"add:op1",
				"dead-letter",
				"PROPOSAL_REJECTED",
			),
		)

		const res = await createApp().request(
			`${path}?scope=workspace&scopeRef=demo-run-1`,
			{
				method: "POST",
				headers: { ...PROPOSER, "Idempotency-Key": "k1" },
				body: JSON.stringify({
					content: "c",
					role: "user",
					body: "b",
					scope: "workspace",
					scopeRef: "demo-run-1",
				}),
			},
		)

		expect(res.status).toBe(409)
		expect((await asJson(res)).error?.code).toBe("PROPOSAL_REJECTED")
	})
})
