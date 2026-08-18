import { beforeEach, describe, expect, it, vi } from "vitest"

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
	getWikiStoreHandle: vi.fn(),
	mdbrainBridgeAdd: vi.fn(),
	mdbrainBridgeWriteConversationEvent: vi.fn(),
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
	MemoryDeliveryConflictError: class MemoryDeliveryConflictError extends Error {},
	MemoryDeliveryStateError: class MemoryDeliveryStateError extends Error {},
}))

vi.mock("@mdbrain/memory-bridge", () => ({
	mdbrainBridgeAdd: mocks.mdbrainBridgeAdd,
	mdbrainBridgeWriteConversationEvent:
		mocks.mdbrainBridgeWriteConversationEvent,
}))

import {
	deliverMemoryWrite,
	MemoryDeliveryDispatchError,
	reconcileMemoryDeliveriesOnce,
} from "./memory-delivery-runtime.js"

const params = {
	operation: "write-event" as const,
	idempotencyKey: "key-1",
	payload: { role: "user", body: "remember" },
	principalSubjectId: "subject-1",
	agentId: "agent-1",
	scope: "workspace",
	scopeRef: "workspace-1",
}

describe("deliverMemoryWrite", () => {
	beforeEach(() => {
		events.length = 0
		stored = { state: "recorded" }
		for (const mock of Object.values(mocks)) mock.mockReset()
		mocks.withWikiTransaction.mockImplementation(
			async (
				operation: (handle: object, session: object) => Promise<unknown>,
			) => operation({}, {}),
		)
		mocks.getWikiStoreHandle.mockResolvedValue({})
		mocks.listMemoryDeliveryIntents.mockResolvedValue([])
		mocks.recordMemoryDeliveryIntent.mockImplementation(async () => {
			events.push("recorded")
			return { intent: stored, replayed: false }
		})
		mocks.beginMemoryDelivery.mockImplementation(async () => {
			events.push("delivering")
			stored = { ...stored, state: "delivering" }
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
		mocks.promoteMemoryDelivery.mockImplementation(
			async (handle, _id, _key, mutateWiki, session) => {
				events.push("promoting")
				await mutateWiki(handle, stored, session)
				stored = { ...stored, state: "promoted" }
				return stored
			},
		)
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
		mocks.listMemoryDeliveryIntents.mockImplementation(
			async (_handle, options: { state: string }) =>
				options.state === "retryable" ? [stored] : [],
		)
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
})
