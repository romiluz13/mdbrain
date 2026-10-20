// /v1/admin/wiki-promotions: the review list, approve and reject. The runtime
// is mocked, so these pin the HTTP contract: who may call, the request and
// response shapes, and how runtime outcomes map to status codes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prevEnv = { ...process.env }

const runtimeMocks = vi.hoisted(() => ({
	deliverMemoryWrite: vi.fn(),
	approvePendingWikiPromotion: vi.fn(),
	redriveDeadLetteredMemoryDelivery: vi.fn(),
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
	])
	for (const mock of Object.values(proposalMocks)) mock.mockReset()
	runtimeMocks.approvePendingWikiPromotion.mockReset()
	runtimeMocks.redriveDeadLetteredMemoryDelivery.mockReset()
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
