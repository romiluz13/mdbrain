// Approval, rejection and the pending list for proposals, in the mocked style
// of memory-delivery-runtime.test.ts. The pure engine pieces (error classes,
// the fingerprint, the integrity check) are the real ones; the functions that
// touch the database are doubles.

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	withWikiTransaction: vi.fn(),
	getWikiStoreHandle: vi.fn(),
	getMemoryDeliveryIntent: vi.fn(),
	setMemoryDeliveryPromotionApproval: vi.fn(),
	promoteMemoryDelivery: vi.fn(),
	failMemoryPromotion: vi.fn(),
	rejectMemoryDeliveryPromotion: vi.fn(),
	listPendingPromotionIntents: vi.fn(),
	redriveMemoryDeliveryIntent: vi.fn(),
	listDueMemoryDeliveryIntents: vi.fn(),
	recordMemoryDeliveryIntent: vi.fn(),
	beginMemoryDelivery: vi.fn(),
	confirmMemoryDelivery: vi.fn(),
}))

vi.mock("./wiki-store-runtime.js", () => ({
	withWikiTransaction: mocks.withWikiTransaction,
	getWikiStoreHandle: mocks.getWikiStoreHandle,
}))

vi.mock("@mdbrain/wiki-engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("@mdbrain/wiki-engine")>()),
	getMemoryDeliveryIntent: mocks.getMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval: mocks.setMemoryDeliveryPromotionApproval,
	promoteMemoryDelivery: mocks.promoteMemoryDelivery,
	failMemoryPromotion: mocks.failMemoryPromotion,
	rejectMemoryDeliveryPromotion: mocks.rejectMemoryDeliveryPromotion,
	listPendingPromotionIntents: mocks.listPendingPromotionIntents,
	redriveMemoryDeliveryIntent: mocks.redriveMemoryDeliveryIntent,
	listDueMemoryDeliveryIntents: mocks.listDueMemoryDeliveryIntents,
	recordMemoryDeliveryIntent: mocks.recordMemoryDeliveryIntent,
	beginMemoryDelivery: mocks.beginMemoryDelivery,
	confirmMemoryDelivery: mocks.confirmMemoryDelivery,
}))

vi.mock("@mdbrain/memory-bridge", () => ({
	mdbrainBridgeAdd: vi.fn(),
	mdbrainBridgeWriteConversationEvent: vi.fn(),
}))

import { MemoryDeliveryStateError } from "@mdbrain/wiki-engine"
import {
	approvePendingWikiPromotion,
	deliverMemoryWrite,
	MemoryDeliveryDispatchError,
	readMemoryDeliveryOwner,
	reconcileMemoryDeliveriesOnce,
	redriveDeadLetteredMemoryDelivery,
} from "./memory-delivery-runtime.js"
import {
	listPendingWikiProposals,
	rejectPendingWikiPromotion,
} from "./proposals-runtime.js"
import { createAdminPrincipal } from "./principal.js"
import {
	intent,
	page,
	payload,
	proposer,
	rejected,
} from "./__fixtures__/proposal-fixtures.js"

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset()
	mocks.withWikiTransaction.mockImplementation(
		async (operation: (handle: object, session: object) => Promise<unknown>) =>
			operation({}, {}),
	)
	mocks.getWikiStoreHandle.mockResolvedValue({})
	mocks.listDueMemoryDeliveryIntents.mockResolvedValue([])
	mocks.setMemoryDeliveryPromotionApproval.mockResolvedValue(intent())
	mocks.promoteMemoryDelivery.mockResolvedValue(intent({ state: "promoted" }))
})

describe("approving a proposal", () => {
	it("promotes it without the proposer ever holding write", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(intent())

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toEqual({
			ok: true,
			operationId: "add:op1",
			pageSlug: page.slug,
		})
		expect(mocks.promoteMemoryDelivery).toHaveBeenCalledTimes(1)
	})

	it.each([
		["its key was removed", () => null],
		[
			"its propose capability was dropped",
			() => proposer({ capabilities: ["read"] }),
		],
		["its identity went stale", () => proposer({ identityState: "stale" })],
		[
			"its grant moved to another scope",
			() =>
				proposer({
					allowedScopes: [{ scope: "workspace", scopeRef: "demo-run-2" }],
				}),
		],
	])("refuses with PROPOSER_REVOKED when %s", async (_why, resolvePrincipal) => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(intent())

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal,
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROPOSER_REVOKED",
		})
		expect(mocks.setMemoryDeliveryPromotionApproval).not.toHaveBeenCalled()
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("keeps today's code for a promotion held by the env flag", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(
			intent({ proposalOnly: undefined }),
		)

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => null,
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROMOTION_UNAUTHORIZED",
		})
	})

	it("accepts a proposer that was later given write instead of propose", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(intent())

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer({ capabilities: ["read", "write"] }),
		})

		expect(out.ok).toBe(true)
	})

	it("returns the same result when approved a second time", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(
			intent({ state: "promoted", promotionApproval: "approved" }),
		)

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toEqual({
			ok: true,
			operationId: "add:op1",
			pageSlug: page.slug,
		})
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("refuses a rejected proposal with its own code and promotes nothing", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(rejected())

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROPOSAL_REJECTED",
		})
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("answers PROPOSAL_REJECTED, not a failed attempt, when a reject lands first", async () => {
		mocks.getMemoryDeliveryIntent
			.mockResolvedValueOnce(intent())
			.mockResolvedValueOnce(rejected())
		mocks.setMemoryDeliveryPromotionApproval.mockRejectedValue(
			new MemoryDeliveryStateError(
				"promotion approval requires a pending promotion",
			),
		)

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROPOSAL_REJECTED",
		})
		expect(mocks.failMemoryPromotion).not.toHaveBeenCalled()
	})

	it("answers with the winner's result when another approval lands first", async () => {
		mocks.getMemoryDeliveryIntent
			.mockResolvedValueOnce(intent())
			.mockResolvedValueOnce(
				intent({ state: "promoted", promotionApproval: "approved" }),
			)
		mocks.setMemoryDeliveryPromotionApproval.mockRejectedValue(
			new MemoryDeliveryStateError(
				"promotion approval requires a pending promotion",
			),
		)

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toEqual({
			ok: true,
			operationId: "add:op1",
			pageSlug: page.slug,
		})
		expect(mocks.failMemoryPromotion).not.toHaveBeenCalled()
	})

	it("refuses a stored payload that was altered after it was submitted", async () => {
		const altered = intent()
		;(altered.payload.wikiPromotion as { page: { body: string } }).page = {
			...page,
			body: "Edited after submission.",
		}
		mocks.getMemoryDeliveryIntent.mockResolvedValue(altered)

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROPOSAL_ALTERED",
		})
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("refuses a stored scope that differs from the payload's", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(
			intent({ scopeRef: "demo-run-2" }),
		)

		const out = await approvePendingWikiPromotion({
			operationId: "add:op1",
			resolvePrincipal: () => proposer(),
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROPOSAL_ALTERED",
		})
	})
})

describe("rejecting a proposal", () => {
	it("rejects as the admin and says so", async () => {
		mocks.rejectMemoryDeliveryPromotion.mockResolvedValue(rejected())

		const out = await rejectPendingWikiPromotion({
			operationId: "add:op1",
			rejectedBy: "api-key:admin",
			reason: "duplicate",
		})

		expect(out).toEqual({ ok: true, operationId: "add:op1", state: "rejected" })
		expect(mocks.rejectMemoryDeliveryPromotion).toHaveBeenCalledWith(
			expect.anything(),
			"add:op1",
			{ rejectedBy: "api-key:admin", reason: "duplicate" },
			expect.anything(),
			expect.anything(),
		)
	})

	it("maps a missing proposal to 404 and a decided one to 409", async () => {
		mocks.rejectMemoryDeliveryPromotion.mockRejectedValueOnce(
			new MemoryDeliveryStateError("delivery intent not found"),
		)
		mocks.rejectMemoryDeliveryPromotion.mockRejectedValueOnce(
			new MemoryDeliveryStateError(
				"proposal cannot be rejected from state promoted",
			),
		)

		expect(
			await rejectPendingWikiPromotion({ operationId: "x", rejectedBy: "a" }),
		).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" })
		expect(
			await rejectPendingWikiPromotion({ operationId: "x", rejectedBy: "a" }),
		).toMatchObject({ ok: false, status: 409, code: "INVALID_DELIVERY_STATE" })
	})
})

describe("the pending list", () => {
	it("shows the proposed page and the proposer, and nothing else from the ledger", async () => {
		mocks.listPendingPromotionIntents.mockResolvedValue([intent()])

		const out = await listPendingWikiProposals({
			limit: 20,
			resolvePrincipal: () => proposer(),
		})

		expect(out).toEqual([
			{
				operationId: "add:op1",
				state: "pending",
				proposer: {
					subjectId: "demo-proposer-1",
					displayName: "Demo proposer 1",
					agentId: "agent-1",
				},
				scope: "workspace",
				scopeRef: "demo-run-1",
				proposedAt: "2026-10-20T10:00:00.000Z",
				page: {
					slug: page.slug,
					title: page.title,
					kind: "concept",
					summary: page.summary,
					body: page.body,
					claims: [
						{ id: "c1", text: "ETAs drift silently.", confidence: 0.8 },
						{ id: "c2", text: "Nobody is told." },
					],
				},
			},
		])
		const text = JSON.stringify(out)
		for (const secret of [
			"key-1",
			"payloadFingerprint",
			"receipt",
			"event-1",
		]) {
			expect(text).not.toContain(secret)
		}
	})

	it("still lists a proposal whose proposer no longer resolves", async () => {
		mocks.listPendingPromotionIntents.mockResolvedValue([intent()])

		const out = await listPendingWikiProposals({
			limit: 20,
			resolvePrincipal: () => null,
		})

		expect(out[0]?.proposer).toEqual({
			subjectId: "demo-proposer-1",
			agentId: "agent-1",
		})
	})

	it("passes the scope and limit through", async () => {
		mocks.listPendingPromotionIntents.mockResolvedValue([])

		await listPendingWikiProposals({
			scope: "workspace",
			scopeRef: "demo-run-1",
			limit: 5,
		})

		expect(mocks.listPendingPromotionIntents).toHaveBeenCalledWith(
			expect.anything(),
			{
				scope: "workspace",
				scopeRef: "demo-run-1",
				limit: 5,
			},
		)
	})
})

describe("a rejected proposal stays rejected", () => {
	it("is not promoted when its write is replayed, and the caller is told why", async () => {
		mocks.recordMemoryDeliveryIntent.mockResolvedValue({
			intent: rejected(),
			replayed: true,
			conflict: false,
		})
		const dispatch = vi.fn()
		const mutateWiki = vi.fn()

		const replay = deliverMemoryWrite({
			operation: "add",
			idempotencyKey: "key-1",
			payload: payload(),
			principalSubjectId: "demo-proposer-1",
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "demo-run-1",
			promotion: { key: "k", mutateWiki },
			promotionApproval: "required",
			proposalOnly: true,
			dispatch,
		})

		const error = await replay.catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(MemoryDeliveryDispatchError)
		expect(error).toMatchObject({ code: "PROPOSAL_REJECTED" })
		expect(dispatch).not.toHaveBeenCalled()
		expect(mutateWiki).not.toHaveBeenCalled()
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("records the proposal marker on the intent it writes", async () => {
		mocks.recordMemoryDeliveryIntent.mockResolvedValue({
			intent: intent({ state: "recorded", receipt: undefined }),
			replayed: false,
			conflict: false,
		})
		mocks.beginMemoryDelivery.mockResolvedValue(
			intent({ state: "delivering", leaseToken: "l" }),
		)
		mocks.confirmMemoryDelivery.mockResolvedValue(intent())

		await deliverMemoryWrite({
			operation: "add",
			idempotencyKey: "key-1",
			payload: payload(),
			principalSubjectId: "demo-proposer-1",
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "demo-run-1",
			promotion: { key: "k", mutateWiki: vi.fn() },
			promotionApproval: "required",
			proposalOnly: true,
			dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
		})

		expect(mocks.recordMemoryDeliveryIntent).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				promotionApproval: "required",
				proposalOnly: true,
			}),
			expect.anything(),
		)
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("is left alone by a reconciler pass even if the due scan returns it", async () => {
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([
			rejected({ promotionApproval: undefined }),
		])

		const out = await reconcileMemoryDeliveriesOnce({
			resolvePrincipal: () => createAdminPrincipal(),
		})

		expect(out).toEqual({ attempted: 0, completed: 0, failed: 0 })
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("cannot be redriven, and the answer names the rejection", async () => {
		mocks.redriveMemoryDeliveryIntent.mockRejectedValue(
			new MemoryDeliveryStateError(
				"delivery was rejected and cannot be redriven",
			),
		)

		const out = await redriveDeadLetteredMemoryDelivery({
			operationId: "add:op1",
		})

		expect(out).toMatchObject({
			ok: false,
			status: 409,
			code: "PROPOSAL_REJECTED",
		})
	})
})

describe("the scope a decision is checked against", () => {
	it("is the agent and scope the operation was recorded under", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(
			intent({
				agentId: "agent-7",
				scope: "workspace",
				scopeRef: "demo-run-14",
			}),
		)

		await expect(readMemoryDeliveryOwner("add:op1")).resolves.toEqual({
			agentId: "agent-7",
			scope: "workspace",
			scopeRef: "demo-run-14",
		})
		expect(mocks.getMemoryDeliveryIntent).toHaveBeenCalledWith({}, "add:op1")
	})

	it("is null for an operation that does not exist", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(null)

		await expect(readMemoryDeliveryOwner("add:missing")).resolves.toBeNull()
	})
})
