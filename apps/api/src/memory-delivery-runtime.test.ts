import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const events: string[] = []
let stored: Record<string, unknown>

const mocks = vi.hoisted(() => ({
	withWikiTransaction: vi.fn(),
	recordMemoryDeliveryIntent: vi.fn(),
	beginMemoryDelivery: vi.fn(),
	confirmMemoryDelivery: vi.fn(),
	failMemoryDelivery: vi.fn(),
	failMemoryPromotion: vi.fn(),
	promoteMemoryDelivery: vi.fn(),
	listMemoryDeliveryIntents: vi.fn(),
	listDueMemoryDeliveryIntents: vi.fn(),
	getMemoryDeliveryIntent: vi.fn(),
	setMemoryDeliveryPromotionApproval: vi.fn(),
	redriveMemoryDeliveryIntent: vi.fn(),
	getWikiStoreHandle: vi.fn(),
	mdbrainBridgeAdd: vi.fn(),
	mdbrainBridgeWriteConversationEvent: vi.fn(),
	createWikiPage: vi.fn(),
	recordWikiMutationIntent: vi.fn(),
}))

vi.mock("./wiki-store-runtime.js", () => ({
	withWikiTransaction: mocks.withWikiTransaction,
	getWikiStoreHandle: mocks.getWikiStoreHandle,
}))

vi.mock("@mdbrain/wiki-engine", () => ({
	recordMemoryDeliveryIntent: mocks.recordMemoryDeliveryIntent,
	beginMemoryDelivery: mocks.beginMemoryDelivery,
	confirmMemoryDelivery: mocks.confirmMemoryDelivery,
	failMemoryDelivery: mocks.failMemoryDelivery,
	failMemoryPromotion: mocks.failMemoryPromotion,
	promoteMemoryDelivery: mocks.promoteMemoryDelivery,
	listMemoryDeliveryIntents: mocks.listMemoryDeliveryIntents,
	listDueMemoryDeliveryIntents: mocks.listDueMemoryDeliveryIntents,
	getMemoryDeliveryIntent: mocks.getMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval: mocks.setMemoryDeliveryPromotionApproval,
	redriveMemoryDeliveryIntent: mocks.redriveMemoryDeliveryIntent,
	createWikiPage: mocks.createWikiPage,
	recordWikiMutationIntent: mocks.recordWikiMutationIntent,
	DEFAULT_MEMORY_LEDGER_TTL_MS: 30 * 24 * 60 * 60 * 1000,
	MemoryDeliveryConflictError: class MemoryDeliveryConflictError extends Error {},
	MemoryDeliveryStateError: class MemoryDeliveryStateError extends Error {},
	MemoryDeliveryLeaseLostError: class MemoryDeliveryLeaseLostError extends Error {
		constructor(readonly operationId: string) {
			super(`delivery operation "${operationId}" is claimed by another worker`)
			this.name = "MemoryDeliveryLeaseLostError"
		}
	},
	MemoryDeliveryPayloadTooLargeError: class MemoryDeliveryPayloadTooLargeError extends Error {},
}))

vi.mock("@mdbrain/memory-bridge", () => ({
	mdbrainBridgeAdd: mocks.mdbrainBridgeAdd,
	mdbrainBridgeWriteConversationEvent:
		mocks.mdbrainBridgeWriteConversationEvent,
}))

import {
	approvePendingWikiPromotion,
	buildMemoryWikiPromotion,
	deliverMemoryWrite,
	getMemoryDeliveryReconciliationCounters,
	MemoryDeliveryDispatchError,
	reconcileMemoryDeliveriesOnce,
	redriveDeadLetteredMemoryDelivery,
	resetMemoryDeliveryReconciliationCounters,
	wikiPromotionApprovalRequired,
} from "./memory-delivery-runtime.js"
import {
	MemoryDeliveryLeaseLostError,
	MemoryDeliveryStateError,
} from "@mdbrain/wiki-engine"
import type { ApiPrincipal } from "./principal.js"

const params = {
	operation: "write-event" as const,
	idempotencyKey: "key-1",
	payload: { role: "user", body: "remember" },
	principalSubjectId: "subject-1",
	agentId: "agent-1",
	scope: "workspace",
	scopeRef: "workspace-1",
}

function resetRuntimeMocks() {
	events.length = 0
	stored = { state: "recorded" }
	resetMemoryDeliveryReconciliationCounters()
	for (const mock of Object.values(mocks)) mock.mockReset()
	mocks.withWikiTransaction.mockImplementation(
		async (operation: (handle: object, session: object) => Promise<unknown>) =>
			operation({}, {}),
	)
	mocks.getWikiStoreHandle.mockResolvedValue({})
	mocks.listMemoryDeliveryIntents.mockResolvedValue([])
	mocks.listDueMemoryDeliveryIntents.mockResolvedValue([])
	mocks.recordMemoryDeliveryIntent.mockImplementation(async () => {
		events.push("recorded")
		return { intent: stored, replayed: false }
	})
	mocks.beginMemoryDelivery.mockImplementation(async () => {
		events.push("delivering")
		stored = { ...stored, state: "delivering", leaseToken: "lease-claim-1" }
		return stored
	})
	mocks.confirmMemoryDelivery.mockImplementation(
		async (_handle, _id, receipt) => {
			events.push("confirmed")
			stored = { ...stored, state: "confirmed", receipt }
			return stored
		},
	)
	mocks.failMemoryDelivery.mockImplementation(async () => {
		events.push("failed")
		return stored
	})
	mocks.redriveMemoryDeliveryIntent.mockImplementation(async () => ({
		...stored,
		state: "recorded",
	}))
	mocks.promoteMemoryDelivery.mockImplementation(
		async (handle, _id, _key, mutateWiki, session) => {
			events.push("promoting")
			await mutateWiki(handle, stored, session)
			stored = { ...stored, state: "promoted" }
			return stored
		},
	)
	mocks.createWikiPage.mockResolvedValue(undefined)
	mocks.recordWikiMutationIntent.mockResolvedValue(undefined)
	mocks.getMemoryDeliveryIntent.mockResolvedValue(null)
	mocks.setMemoryDeliveryPromotionApproval.mockImplementation(
		async (_handle, _id, approval) => ({
			...stored,
			promotionApproval: approval,
		}),
	)
	mocks.mdbrainBridgeAdd.mockResolvedValue({
		eventId: "event-1",
		chunkCreated: true,
	})
	mocks.mdbrainBridgeWriteConversationEvent.mockResolvedValue({
		eventId: "event-1",
		chunkCreated: true,
	})
}

describe("deliverMemoryWrite", () => {
	beforeEach(() => {
		resetRuntimeMocks()
	})

	it("persists intent and dispatch marker before opening the network call", async () => {
		const receipt = await deliverMemoryWrite({
			...params,
			dispatch: async () => {
				events.push("network")
				return { eventId: "event-1", chunkCreated: true }
			},
		})

		expect(receipt).toEqual({ eventId: "event-1", chunkCreated: true })
		expect(events).toEqual(["recorded", "delivering", "network", "confirmed"])
	})

	it("returns the persisted receipt without redispatching an exact replay", async () => {
		stored = {
			state: "confirmed",
			receipt: { eventId: "event-1", chunkCreated: true },
		}
		const dispatch = vi.fn()
		const receipt = await deliverMemoryWrite({ ...params, dispatch })

		expect(receipt).toEqual({ eventId: "event-1", chunkCreated: true })
		expect(dispatch).not.toHaveBeenCalled()
		expect(mocks.beginMemoryDelivery).not.toHaveBeenCalled()
	})

	it("rejects a conflicting replay without preventing a later exact replay", async () => {
		stored = {
			state: "promoted",
			receipt: { eventId: "event-original", chunkCreated: true },
			promotionKey: "promotion-original",
		}
		mocks.recordMemoryDeliveryIntent
			.mockResolvedValueOnce({
				intent: stored,
				replayed: true,
				conflict: true,
			})
			.mockResolvedValueOnce({
				intent: stored,
				replayed: true,
				conflict: false,
			})
		const dispatch = vi.fn()

		const conflictError = await deliverMemoryWrite({
			...params,
			dispatch,
		}).catch((error: unknown) => error)
		expect(conflictError).toBeInstanceOf(MemoryDeliveryDispatchError)
		expect(conflictError).toMatchObject({
			state: "conflict",
			code: "CONFLICT",
		})
		const receipt = await deliverMemoryWrite({ ...params, dispatch })

		expect(receipt).toEqual({
			eventId: "event-original",
			chunkCreated: true,
		})
		expect(mocks.recordMemoryDeliveryIntent).toHaveBeenCalledTimes(2)
		expect(mocks.beginMemoryDelivery).not.toHaveBeenCalled()
		expect(dispatch).not.toHaveBeenCalled()
	})

	it("re-reads an intent after a concurrent duplicate-key insert", async () => {
		stored = {
			state: "confirmed",
			receipt: { eventId: "event-1", chunkCreated: true },
		}
		mocks.recordMemoryDeliveryIntent
			.mockRejectedValueOnce({ code: 11000 })
			.mockResolvedValueOnce({
				intent: stored,
				replayed: true,
				conflict: false,
			})
		const dispatch = vi.fn()

		const receipt = await deliverMemoryWrite({ ...params, dispatch })

		expect(receipt).toEqual({ eventId: "event-1", chunkCreated: true })
		expect(mocks.recordMemoryDeliveryIntent).toHaveBeenCalledTimes(2)
		expect(dispatch).not.toHaveBeenCalled()
	})

	it("persists ambiguous outcomes and never infers a receipt", async () => {
		const dispatch = vi.fn().mockRejectedValue({
			code: "DEADLINE_EXCEEDED",
			outcome: "unknown",
			retryable: false,
		})

		await expect(
			deliverMemoryWrite({ ...params, dispatch }),
		).rejects.toMatchObject({
			state: "outcome-unknown",
			code: "DEADLINE_EXCEEDED",
		})
		expect(events).toEqual(["recorded", "delivering", "failed"])
		expect(mocks.confirmMemoryDelivery).not.toHaveBeenCalled()
	})

	it("promotes wiki content only after persisting the Memongo receipt", async () => {
		mocks.confirmMemoryDelivery.mockImplementation(
			async (_handle, _id, receipt) => {
				events.push("confirmed")
				stored = { ...stored, state: "promotion-pending", receipt }
				return stored
			},
		)
		const mutateWiki = vi.fn(async () => {
			events.push("wiki")
		})

		await deliverMemoryWrite({
			...params,
			promotion: { key: "YOUR_PROMOTION_KEY_HERE:key-1:v1", mutateWiki },
			dispatch: async () => {
				events.push("network")
				return { eventId: "event-1", chunkCreated: true }
			},
		})

		expect(events).toEqual([
			"recorded",
			"delivering",
			"network",
			"confirmed",
			"promoting",
			"wiki",
		])
		expect(mutateWiki).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				state: "promotion-pending",
				receipt: { eventId: "event-1", chunkCreated: true },
			}),
			expect.anything(),
		)
	})

	it("reconciles retryable intents without waiting for caller replay", async () => {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		stored = {
			...params,
			operationId: "write-event:persisted",
			payloadFingerprint: "fingerprint",
			promotionPolicy: "none",
			state: "retryable",
			attempts: 1,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		}
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])
		mocks.recordMemoryDeliveryIntent.mockResolvedValue({
			intent: stored,
			replayed: true,
			conflict: false,
		})
		mocks.mdbrainBridgeWriteConversationEvent.mockResolvedValue({
			eventId: "event-recovered",
			chunkCreated: true,
		})

		const result = await reconcileMemoryDeliveriesOnce({
			now: updatedAt.getTime() + 2_000,
		})

		expect(result).toEqual({ attempted: 1, completed: 1, failed: 0 })
		expect(mocks.mdbrainBridgeWriteConversationEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "key-1",
				body: "remember",
			}),
		)
		expect(events).toEqual(["delivering", "confirmed"])
	})

	it("settles the ledger with the claim's lease token", async () => {
		await deliverMemoryWrite({
			...params,
			dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
		})

		expect(mocks.beginMemoryDelivery).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			3,
			30_000,
			5,
			30 * 24 * 60 * 60 * 1000,
		)
		expect(mocks.confirmMemoryDelivery).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			"lease-claim-1",
			expect.anything(),
			expect.any(Number),
		)
	})

	it("maps a lease lost at confirm to a typed conflict, never a raw 500", async () => {
		mocks.confirmMemoryDelivery.mockRejectedValue(
			new MemoryDeliveryLeaseLostError("write-event:persisted"),
		)

		await expect(
			deliverMemoryWrite({
				...params,
				dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
			}),
		).rejects.toMatchObject({ state: "outcome-unknown", code: "LEASE_LOST" })
	})

	it("maps a lease lost at fail without masking the claimant's state", async () => {
		mocks.failMemoryDelivery.mockRejectedValue(
			new MemoryDeliveryLeaseLostError("write-event:persisted"),
		)

		await expect(
			deliverMemoryWrite({
				...params,
				dispatch: vi.fn().mockRejectedValue({
					code: "WRITE_FAILED",
					outcome: "not-applied",
					retryable: true,
				}),
			}),
		).rejects.toMatchObject({ state: "delivering", code: "LEASE_LOST" })
	})
})

describe("memory ledger TTL configuration", () => {
	const original = process.env.MDBRAIN_MEMORY_LEDGER_TTL_DAYS

	beforeEach(() => {
		resetRuntimeMocks()
	})

	afterEach(() => {
		if (original === undefined) {
			delete process.env.MDBRAIN_MEMORY_LEDGER_TTL_DAYS
		} else {
			process.env.MDBRAIN_MEMORY_LEDGER_TTL_DAYS = original
		}
	})

	it("uses the 30-day default when no override is configured", async () => {
		delete process.env.MDBRAIN_MEMORY_LEDGER_TTL_DAYS

		await deliverMemoryWrite({
			...params,
			dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
		})

		expect(mocks.beginMemoryDelivery).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			3,
			30_000,
			5,
			30 * 24 * 60 * 60 * 1000,
		)
	})

	it("honors a positive day override", async () => {
		process.env.MDBRAIN_MEMORY_LEDGER_TTL_DAYS = "7"

		await deliverMemoryWrite({
			...params,
			dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
		})

		expect(mocks.beginMemoryDelivery).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			3,
			30_000,
			5,
			7 * 24 * 60 * 60 * 1000,
		)
	})

	it("fails closed on an invalid override instead of guessing retention", async () => {
		process.env.MDBRAIN_MEMORY_LEDGER_TTL_DAYS = "soon"

		await expect(
			deliverMemoryWrite({
				...params,
				dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
			}),
		).rejects.toThrow(/MDBRAIN_MEMORY_LEDGER_TTL_DAYS/)
	})
})

describe("reconciliation observability", () => {
	beforeEach(() => {
		resetRuntimeMocks()
	})

	/** A due retryable intent whose claim fails: the pass must count it,
	 *  log it per-intent, and leave it attributable in the counters. */
	function dueRetryableIntent() {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		return {
			...params,
			operationId: "write-event:persisted",
			payloadFingerprint: "fingerprint",
			promotionPolicy: "none",
			state: "retryable",
			attempts: 1,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		}
	}

	it("counts and logs per-intent reconciliation failures", async () => {
		stored = dueRetryableIntent()
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])
		mocks.beginMemoryDelivery.mockRejectedValue(new Error("claim exploded"))
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const result = await reconcileMemoryDeliveriesOnce({})

			expect(result).toEqual({ attempted: 1, completed: 0, failed: 1 })
			expect(getMemoryDeliveryReconciliationCounters()).toEqual({
				attempted: 1,
				completed: 0,
				failed: 1,
			})
			const lines = warnSpy.mock.calls.map((call) => String(call[0]))
			const line = lines.find((value) =>
				value.includes("write-event:persisted"),
			)
			expect(line).toContain("memory delivery reconciliation failed")
			expect(line).toContain('"state":"retryable"')
		} finally {
			warnSpy.mockRestore()
		}
	})

	it("accumulates counters across passes and resets on demand", async () => {
		stored = dueRetryableIntent()
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])
		mocks.beginMemoryDelivery.mockRejectedValue(new Error("claim exploded"))

		await reconcileMemoryDeliveriesOnce({})
		await reconcileMemoryDeliveriesOnce({})

		expect(getMemoryDeliveryReconciliationCounters()).toEqual({
			attempted: 2,
			completed: 0,
			failed: 2,
		})
		resetMemoryDeliveryReconciliationCounters()
		expect(getMemoryDeliveryReconciliationCounters()).toEqual({
			attempted: 0,
			completed: 0,
			failed: 0,
		})
	})
})

describe("redriveDeadLetteredMemoryDelivery", () => {
	beforeEach(() => {
		resetRuntimeMocks()
	})

	it("requeues through the engine and reports the requeued state", async () => {
		mocks.redriveMemoryDeliveryIntent.mockResolvedValue({
			...stored,
			state: "recorded",
		})

		const result = await redriveDeadLetteredMemoryDelivery({
			operationId: "write-event:dead",
		})

		expect(result).toEqual({
			ok: true,
			operationId: "write-event:dead",
			state: "recorded",
		})
		expect(mocks.redriveMemoryDeliveryIntent).toHaveBeenCalledWith(
			expect.anything(),
			"write-event:dead",
			expect.anything(),
		)
	})

	it("maps a missing intent to 404", async () => {
		mocks.redriveMemoryDeliveryIntent.mockRejectedValue(
			new MemoryDeliveryStateError("delivery intent not found"),
		)

		const result = await redriveDeadLetteredMemoryDelivery({
			operationId: "write-event:missing",
		})

		expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" })
	})

	it("maps a non-dead-letter state to 409", async () => {
		mocks.redriveMemoryDeliveryIntent.mockRejectedValue(
			new MemoryDeliveryStateError(
				"delivery cannot be redriven from state recorded",
			),
		)

		const result = await redriveDeadLetteredMemoryDelivery({
			operationId: "write-event:alive",
		})

		expect(result).toMatchObject({
			ok: false,
			status: 409,
			code: "INVALID_DELIVERY_STATE",
		})
	})

	it("maps unexpected engine failures to 500", async () => {
		mocks.redriveMemoryDeliveryIntent.mockRejectedValue(
			new Error("transaction aborted"),
		)

		const result = await redriveDeadLetteredMemoryDelivery({
			operationId: "write-event:dead",
		})

		expect(result).toMatchObject({
			ok: false,
			status: 500,
			code: "REDRIVE_FAILED",
		})
	})
})

describe("reconcileMemoryDeliveriesOnce wiki promotion replay", () => {
	/** A caller-controlled promotion payload. The trust tier inside it is
	 *  request data, not authority: replay must re-check it against the
	 *  CURRENT principal (the security fix these tests pin). */
	const wikiPromotionPayload = (trustTier: string) => ({
		role: "user",
		body: "remember",
		promotionPolicy: "wiki",
		wikiPromotion: {
			page: {
				kind: "concept",
				title: "Promoted",
				slug: "promoted-page",
				summary: "Promoted summary",
				body: "Promoted body",
				scope: "workspace",
				scopeRef: "workspace-1",
				trustTier,
				frontmatter: { type: "concept" },
				claims: [{ id: "claim-1", text: "Promoted claim" }],
			},
		},
	})

	const standardPrincipal: ApiPrincipal = {
		subjectId: "subject-1",
		groups: [],
		roles: [],
		departments: [],
		trustTier: "standard",
		allowedAgentIds: ["*"],
		allowedScopes: [{ scope: "*", scopeRef: "*" }],
		capabilities: [],
		identityState: "active",
	}

	/** A retryable intent whose dispatch already failed once but whose wiki
	 *  promotion was recorded and is now due for reconciliation. */
	const retryablePromotionIntent = (trustTier: string) => {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		return {
			...params,
			payload: wikiPromotionPayload(trustTier),
			operationId: "write-event:persisted",
			payloadFingerprint: "fingerprint",
			promotionPolicy: "wiki",
			state: "retryable",
			attempts: 1,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		}
	}

	beforeEach(() => {
		resetRuntimeMocks()
	})

	it("re-authorizes the replay principal and promotes with the live trust tier", async () => {
		const intent = retryablePromotionIntent("standard")
		stored = intent
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])
		mocks.recordMemoryDeliveryIntent.mockResolvedValue({
			intent: stored,
			replayed: true,
			conflict: false,
		})
		mocks.confirmMemoryDelivery.mockImplementation(
			async (_handle, _id, receipt) => {
				events.push("confirmed")
				stored = { ...stored, state: "promotion-pending", receipt }
				return stored
			},
		)
		mocks.mdbrainBridgeWriteConversationEvent.mockResolvedValue({
			eventId: "event-recovered",
			chunkCreated: true,
		})

		const result = await reconcileMemoryDeliveriesOnce({
			now: intent.updatedAt.getTime() + 2_000,
			resolvePrincipal: () => standardPrincipal,
		})

		expect(result).toEqual({ attempted: 1, completed: 1, failed: 0 })
		expect(events).toEqual(["delivering", "confirmed", "promoting"])
		expect(mocks.createWikiPage).toHaveBeenCalledTimes(1)
		expect(mocks.createWikiPage).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				slug: "promoted-page",
				trustTier: "standard",
				claims: [
					expect.objectContaining({
						id: "claim-1",
						evidence: [{ kind: "event", sourceId: "event-recovered" }],
						derivedFrom: ["event-recovered"],
					}),
				],
			}),
			expect.anything(),
		)
		expect(mocks.recordWikiMutationIntent).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				operationId: "write-event:persisted:wiki-promotion",
				pageSlug: "promoted-page",
				principalSubjectId: "subject-1",
			}),
			expect.anything(),
		)
	})

	it("refuses to replay a promotion when the principal no longer resolves", async () => {
		const intent = retryablePromotionIntent("standard")
		stored = intent
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])

		const result = await reconcileMemoryDeliveriesOnce({
			now: intent.updatedAt.getTime() + 2_000,
			resolvePrincipal: () => null,
		})

		// The revoked credential fails the intent before any ledger or wiki
		// mutation is attempted.
		expect(result).toEqual({ attempted: 1, completed: 0, failed: 1 })
		expect(mocks.recordMemoryDeliveryIntent).not.toHaveBeenCalled()
		expect(mocks.mdbrainBridgeWriteConversationEvent).not.toHaveBeenCalled()
		expect(mocks.createWikiPage).not.toHaveBeenCalled()
		expect(mocks.recordWikiMutationIntent).not.toHaveBeenCalled()
	})

	it("refuses to replay a promotion whose page trust tier exceeds the live principal", async () => {
		// The recorded payload claims an admin tier page; the live principal
		// has since been downgraded to restricted. The caller-controlled
		// payload tier must NOT authorize the replay.
		const intent = retryablePromotionIntent("admin")
		stored = intent
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])
		const restrictedPrincipal: ApiPrincipal = {
			...standardPrincipal,
			trustTier: "restricted",
		}

		const result = await reconcileMemoryDeliveriesOnce({
			now: intent.updatedAt.getTime() + 2_000,
			resolvePrincipal: () => restrictedPrincipal,
		})

		expect(result).toEqual({ attempted: 1, completed: 0, failed: 1 })
		expect(mocks.createWikiPage).not.toHaveBeenCalled()
		expect(mocks.mdbrainBridgeWriteConversationEvent).not.toHaveBeenCalled()
	})

	it("refuses to replay when the principal no longer covers the recorded agent", async () => {
		const intent = retryablePromotionIntent("standard")
		stored = intent
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([stored])
		const agentRevokedPrincipal: ApiPrincipal = {
			...standardPrincipal,
			allowedAgentIds: ["some-other-agent"],
		}

		const result = await reconcileMemoryDeliveriesOnce({
			now: intent.updatedAt.getTime() + 2_000,
			resolvePrincipal: () => agentRevokedPrincipal,
		})

		expect(result).toEqual({ attempted: 1, completed: 0, failed: 1 })
		expect(mocks.createWikiPage).not.toHaveBeenCalled()
		expect(mocks.mdbrainBridgeWriteConversationEvent).not.toHaveBeenCalled()
	})
})

describe("wiki promotion trust tier floor", () => {
	const validBody = {
		promotionPolicy: "wiki",
		wikiPromotion: {
			page: {
				kind: "concept",
				title: "Promoted",
				slug: "promoted-page",
				summary: "Promoted summary",
				body: "Promoted body",
				scope: "workspace",
				scopeRef: "workspace-1",
				trustTier: "restricted",
				frontmatter: { type: "concept" },
				claims: [{ id: "claim-1", text: "Promoted claim" }],
			},
		},
	}

	it("rejects promotions from restricted-tier principals regardless of page tier", () => {
		const result = buildMemoryWikiPromotion({
			body: validBody,
			operationId: "write-event:op",
			scope: "workspace",
			scopeRef: "workspace-1",
			principal: {
				subjectId: "subject-1",
				trustTier: "restricted",
				capabilities: ["read", "write", "change-permissions"],
			},
		})
		// Even a change-permissions capability cannot lift a restricted-tier
		// principal over the promotion floor.
		expect(result.error).toBe(
			"wiki promotion requires a principal trust tier of standard or admin",
		)
		expect(result.promotion).toBeUndefined()
	})

	it("allows the full-capability development principal", () => {
		const result = buildMemoryWikiPromotion({
			body: validBody,
			operationId: "write-event:op",
			scope: "workspace",
			scopeRef: "workspace-1",
			principal: {
				subjectId: "subject-1",
				trustTier: "development",
				// The real development principal holds every capability.
				capabilities: ["change-permissions"],
			},
		})
		// The development principal is admin-equivalent (trusted local
		// development only) and passes the tier floor.
		expect(result.error).toBeUndefined()
		expect(result.promotion).toBeDefined()
	})

	it("allows promotions from standard-tier principals", () => {
		const result = buildMemoryWikiPromotion({
			body: {
				...validBody,
				wikiPromotion: {
					page: {
						...validBody.wikiPromotion.page,
						trustTier: "standard",
					},
				},
			},
			operationId: "write-event:op",
			scope: "workspace",
			scopeRef: "workspace-1",
			principal: {
				subjectId: "subject-1",
				trustTier: "standard",
				capabilities: [],
			},
		})
		expect(result.error).toBeUndefined()
		expect(result.promotion).toBeDefined()
	})
})

describe("wiki promotion approval queue", () => {
	beforeEach(() => {
		resetRuntimeMocks()
	})

	it("holds the promotion when deliverMemoryWrite records approval-required", async () => {
		mocks.confirmMemoryDelivery.mockImplementation(
			async (_handle, _id, receipt) => {
				events.push("confirmed")
				stored = { ...stored, state: "promotion-pending", receipt }
				return stored
			},
		)
		const mutateWiki = vi.fn(async () => {
			events.push("wiki")
		})

		const receipt = await deliverMemoryWrite({
			...params,
			promotion: { key: "promotion-key", mutateWiki },
			promotionApproval: "required",
			dispatch: async () => {
				events.push("network")
				return { eventId: "event-1", chunkCreated: true }
			},
		})

		expect(receipt).toEqual({ eventId: "event-1", chunkCreated: true })
		// The write dispatched and confirmed, but the promotion is held: no
		// promote, no wiki mutation.
		expect(events).toEqual(["recorded", "delivering", "network", "confirmed"])
		expect(mutateWiki).not.toHaveBeenCalled()
		expect(mocks.recordMemoryDeliveryIntent).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ promotionApproval: "required" }),
			expect.anything(),
		)
	})

	it("does not record an approval marker when approval mode is off", async () => {
		mocks.confirmMemoryDelivery.mockImplementation(
			async (_handle, _id, receipt) => {
				events.push("confirmed")
				stored = { ...stored, state: "promotion-pending", receipt }
				return stored
			},
		)
		const mutateWiki = vi.fn(async () => {})

		await deliverMemoryWrite({
			...params,
			promotion: { key: "promotion-key", mutateWiki },
			dispatch: async () => ({ eventId: "event-1", chunkCreated: true }),
		})

		expect(events).toContain("promoting")
		expect(mocks.recordMemoryDeliveryIntent).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ promotionPolicy: "wiki" }),
			expect.anything(),
		)
		const recordedInput = mocks.recordMemoryDeliveryIntent.mock.calls[0][1]
		expect("promotionApproval" in recordedInput).toBe(false)
	})

	it("skips approval-queued intents during reconciliation", async () => {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		const queuedIntent = {
			...params,
			operationId: "write-event:queued",
			payloadFingerprint: "fingerprint",
			promotionPolicy: "wiki",
			promotionApproval: "required",
			state: "promotion-pending",
			attempts: 1,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		}
		mocks.listDueMemoryDeliveryIntents.mockResolvedValue([queuedIntent])

		const result = await reconcileMemoryDeliveriesOnce({
			now: updatedAt.getTime() + 2_000,
		})

		expect(result).toEqual({ attempted: 0, completed: 0, failed: 0 })
		expect(mocks.mdbrainBridgeWriteConversationEvent).not.toHaveBeenCalled()
		expect(mocks.createWikiPage).not.toHaveBeenCalled()
	})

	it("approves and promotes a queued promotion in one transaction", async () => {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		const queuedIntent = {
			...params,
			operationId: "write-event:queued",
			payload: {
				role: "user",
				body: "remember",
				promotionPolicy: "wiki",
				wikiPromotion: {
					page: {
						kind: "concept",
						title: "Promoted",
						slug: "promoted-page",
						summary: "Promoted summary",
						body: "Promoted body",
						scope: "workspace",
						scopeRef: "workspace-1",
						trustTier: "standard",
						frontmatter: { type: "concept" },
						claims: [{ id: "claim-1", text: "Promoted claim" }],
					},
				},
			},
			payloadFingerprint: "fingerprint",
			promotionPolicy: "wiki",
			promotionApproval: "required",
			state: "promotion-pending",
			receipt: { eventId: "event-1", chunkCreated: true },
			attempts: 1,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		}
		mocks.getMemoryDeliveryIntent.mockResolvedValue(queuedIntent)
		mocks.promoteMemoryDelivery.mockImplementation(
			async (handle, _id, _key, mutateWiki, session) => {
				events.push("promoting")
				await mutateWiki(handle, queuedIntent, session)
				return { ...queuedIntent, state: "promoted" }
			},
		)
		const standardPrincipal: ApiPrincipal = {
			subjectId: "subject-1",
			groups: [],
			roles: [],
			departments: [],
			trustTier: "standard",
			allowedAgentIds: ["*"],
			allowedScopes: [{ scope: "*", scopeRef: "*" }],
			capabilities: [],
			identityState: "active",
		}

		const result = await approvePendingWikiPromotion({
			operationId: "write-event:queued",
			resolvePrincipal: () => standardPrincipal,
		})

		expect(result).toEqual({
			ok: true,
			operationId: "write-event:queued",
			pageSlug: "promoted-page",
		})
		expect(mocks.setMemoryDeliveryPromotionApproval).toHaveBeenCalledWith(
			expect.anything(),
			"write-event:queued",
			"approved",
			expect.anything(),
		)
		expect(mocks.createWikiPage).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ slug: "promoted-page" }),
			expect.anything(),
		)
	})

	it("refuses approval when the intent is not queued for approval", async () => {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		mocks.getMemoryDeliveryIntent.mockResolvedValue({
			...params,
			operationId: "write-event:queued",
			promotionPolicy: "wiki",
			state: "promotion-pending",
			attempts: 0,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		})

		const result = await approvePendingWikiPromotion({
			operationId: "write-event:queued",
		})

		expect(result).toMatchObject({
			ok: false,
			status: 409,
			code: "INVALID_DELIVERY_STATE",
		})
		expect(mocks.promoteMemoryDelivery).not.toHaveBeenCalled()
	})

	it("refuses approval when the original principal was downgraded", async () => {
		const updatedAt = new Date("2026-08-17T00:00:00.000Z")
		const queuedIntent = {
			...params,
			operationId: "write-event:queued",
			payload: {
				role: "user",
				body: "remember",
				promotionPolicy: "wiki",
				wikiPromotion: {
					page: {
						kind: "concept",
						title: "Promoted",
						slug: "promoted-page",
						summary: "Promoted summary",
						body: "Promoted body",
						scope: "workspace",
						scopeRef: "workspace-1",
						trustTier: "standard",
						frontmatter: { type: "concept" },
						claims: [{ id: "claim-1", text: "Promoted claim" }],
					},
				},
			},
			payloadFingerprint: "fingerprint",
			promotionPolicy: "wiki",
			promotionApproval: "required",
			state: "promotion-pending",
			receipt: { eventId: "event-1", chunkCreated: true },
			attempts: 0,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: updatedAt,
			updatedAt,
		}
		mocks.getMemoryDeliveryIntent.mockResolvedValue(queuedIntent)
		const restrictedPrincipal: ApiPrincipal = {
			subjectId: "subject-1",
			groups: [],
			roles: [],
			departments: [],
			trustTier: "restricted",
			allowedAgentIds: ["*"],
			allowedScopes: [{ scope: "*", scopeRef: "*" }],
			capabilities: [],
			identityState: "active",
		}

		const result = await approvePendingWikiPromotion({
			operationId: "write-event:queued",
			resolvePrincipal: () => restrictedPrincipal,
		})

		expect(result).toMatchObject({
			ok: false,
			status: 409,
			code: "PROMOTION_UNAUTHORIZED",
		})
		expect(mocks.setMemoryDeliveryPromotionApproval).not.toHaveBeenCalled()
		expect(mocks.createWikiPage).not.toHaveBeenCalled()
	})

	it("returns 404 for an unknown operation", async () => {
		mocks.getMemoryDeliveryIntent.mockResolvedValue(null)

		const result = await approvePendingWikiPromotion({
			operationId: "write-event:missing",
		})

		expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" })
	})
})

describe("wikiPromotionApprovalRequired", () => {
	const original = process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL

	afterEach(() => {
		if (original === undefined) {
			delete process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL
		} else {
			process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL = original
		}
	})

	it("defaults to direct promotion when unset", () => {
		delete process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL
		expect(wikiPromotionApprovalRequired()).toBe(false)
	})

	it("enables the approval queue for 1/true (case-insensitive)", () => {
		process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL = "1"
		expect(wikiPromotionApprovalRequired()).toBe(true)
		process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL = "TRUE"
		expect(wikiPromotionApprovalRequired()).toBe(true)
	})

	it("treats any other value as disabled", () => {
		process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL = "0"
		expect(wikiPromotionApprovalRequired()).toBe(false)
		process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL = "yes"
		expect(wikiPromotionApprovalRequired()).toBe(false)
	})
})
