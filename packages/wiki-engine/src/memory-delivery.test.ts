import type { ClientSession, Db } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	failMemoryPromotion,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	type MemoryDeliveryIntent,
} from "./memory-delivery.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

function fixture() {
	let stored: MemoryDeliveryIntent | undefined
	const collection = {
		findOne: vi.fn(async () => stored ?? null),
		insertOne: vi.fn(async (intent: MemoryDeliveryIntent) => {
			stored = structuredClone(intent)
			return { acknowledged: true }
		}),
		updateOne: vi.fn(
			async (
				_filter: unknown,
				update: {
					$set?: Partial<MemoryDeliveryIntent>
					$inc?: { replayConflictCount?: number }
					$addToSet?: {
						replayConflictFields?: {
							$each: MemoryDeliveryIntent["replayConflictFields"]
						}
					}
				},
			) => {
				if (stored && update.$set) Object.assign(stored, update.$set)
				if (stored && update.$inc?.replayConflictCount) {
					stored.replayConflictCount =
						(stored.replayConflictCount ?? 0) + update.$inc.replayConflictCount
				}
				if (stored && update.$addToSet?.replayConflictFields) {
					stored.replayConflictFields = [
						...new Set([
							...(stored.replayConflictFields ?? []),
							...update.$addToSet.replayConflictFields.$each,
						]),
					]
				}
				return { matchedCount: stored ? 1 : 0 }
			},
		),
		findOneAndUpdate: vi.fn(
			async (
				filter: { state?: string },
				update: {
					$set?: Partial<MemoryDeliveryIntent>
					$inc?: Partial<Record<"attempts" | "reconciliationAttempts", number>>
				},
			) => {
				if (!stored || (filter.state && stored.state !== filter.state))
					return null
				if (update.$set) Object.assign(stored, update.$set)
				if (update.$inc) {
					stored.attempts += update.$inc.attempts ?? 0
					stored.reconciliationAttempts +=
						update.$inc.reconciliationAttempts ?? 0
				}
				return structuredClone(stored)
			},
		),
	}
	const handle = {
		db: { collection: vi.fn(() => collection) } as unknown as Db,
		prefix: "test_",
	} satisfies WikiDbHandle
	const session = {} as ClientSession
	return {
		handle,
		session,
		collection,
		current: () => stored,
	}
}

const params = {
	operationId: "delivery-1",
	operation: "write-event" as const,
	idempotencyKey: "YOUR_IDEMPOTENCY_KEY_HERE",
	payload: { role: "user", body: "remember this" },
	principalSubjectId: "tenant:t1:user:u1",
	agentId: "agent-1",
	scope: "workspace",
	scopeRef: "tenant:t1:workspace:w1",
	promotionPolicy: "wiki" as const,
}

const conflictingReplays = [
	{
		field: "payloadFingerprint",
		params: { ...params, payload: { role: "user", body: "different" } },
	},
	{
		field: "idempotencyKey",
		params: { ...params, idempotencyKey: "different-key" },
	},
	{
		field: "promotionPolicy",
		params: { ...params, promotionPolicy: "none" as const },
	},
	{
		field: "operation",
		params: { ...params, operation: "add" as const },
	},
	{
		field: "principalSubjectId",
		params: { ...params, principalSubjectId: "tenant:t1:user:u2" },
	},
	{
		field: "agentId",
		params: { ...params, agentId: "agent-2" },
	},
	{
		field: "scope",
		params: { ...params, scope: "tenant" },
	},
	{
		field: "scopeRef",
		params: { ...params, scopeRef: "tenant:t1:workspace:w2" },
	},
] as const

describe("memory delivery state", () => {
	it("records before dispatch and returns an exact replay", async () => {
		const f = fixture()
		const first = await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const replay = await recordMemoryDeliveryIntent(f.handle, params, f.session)

		expect(first.replayed).toBe(false)
		expect(first.intent.state).toBe("recorded")
		expect(first.intent.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/)
		expect(replay).toEqual({
			intent: f.current(),
			replayed: true,
			conflict: false,
		})
		expect(f.collection.insertOne).toHaveBeenCalledTimes(1)
	})

	it("inserts only caller-supplied intent fields", async () => {
		const f = fixture()
		const inputWithServerFields = {
			...params,
			receipt: undefined,
			promotionKey: undefined,
			lastErrorCode: undefined,
			replayConflictCount: undefined,
		}

		const result = await recordMemoryDeliveryIntent(
			f.handle,
			inputWithServerFields,
			f.session,
		)

		expect(result.intent).not.toHaveProperty("receipt")
		expect(result.intent).not.toHaveProperty("promotionKey")
		expect(result.intent).not.toHaveProperty("lastErrorCode")
		expect(result.intent).not.toHaveProperty("replayConflictCount")
	})

	it.each([
		"confirmed",
		"promoted",
		"dead-letter",
		"conflict",
	] as const)("preserves terminal %s evidence while recording conflicting replays", async (state) => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const terminal = f.current()
		if (!terminal) throw new Error("missing fixture intent")
		Object.assign(terminal, {
			state,
			receipt: { eventId: "event-original", chunkCreated: true },
			promotionKey: "promotion-original",
			confirmedAt: new Date("2026-08-18T00:00:00.000Z"),
			promotedAt: new Date("2026-08-18T00:01:00.000Z"),
			updatedAt: new Date("2026-08-18T00:02:00.000Z"),
		})
		const authoritativeEvidence = {
			state: terminal.state,
			receipt: terminal.receipt,
			promotionKey: terminal.promotionKey,
			confirmedAt: terminal.confirmedAt,
			promotedAt: terminal.promotedAt,
			updatedAt: terminal.updatedAt,
		}

		const conflicts = []
		for (const replay of conflictingReplays) {
			conflicts.push(
				await recordMemoryDeliveryIntent(f.handle, replay.params, f.session),
			)
		}
		const exactReplay = await recordMemoryDeliveryIntent(
			f.handle,
			params,
			f.session,
		)

		expect(conflicts.every((result) => result.conflict)).toBe(true)
		expect(exactReplay).toMatchObject({
			replayed: true,
			conflict: false,
			intent: {
				...authoritativeEvidence,
				replayConflictCount: conflictingReplays.length,
				replayConflictFields: conflictingReplays.map((replay) => replay.field),
			},
		})
		expect(exactReplay.intent.lastReplayConflictAt).toBeInstanceOf(Date)
	})

	it("records a changed promotion policy without replacing the intent", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)

		const conflict = await recordMemoryDeliveryIntent(
			f.handle,
			{ ...params, promotionPolicy: "none" },
			f.session,
		)

		expect(conflict.conflict).toBe(true)
		expect(f.current()).toMatchObject({
			state: "recorded",
			replayConflictCount: 1,
			replayConflictFields: ["promotionPolicy"],
			lastReplayConflictAt: expect.any(Date),
		})
	})

	it("gates promotion on a confirmed receipt and makes replay a no-op", async () => {
		const f = fixture()
		const mutateWiki = vi.fn(async () => {})
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		await beginMemoryDelivery(f.handle, params.operationId, f.session)
		await confirmMemoryDelivery(
			f.handle,
			params.operationId,
			{ eventId: "event-1", chunkCreated: true },
			f.session,
		)
		const promoted = await promoteMemoryDelivery(
			f.handle,
			params.operationId,
			"promotion-1",
			mutateWiki,
			f.session,
		)
		const replay = await promoteMemoryDelivery(
			f.handle,
			params.operationId,
			"promotion-1",
			mutateWiki,
			f.session,
		)

		expect(promoted.state).toBe("promoted")
		expect(promoted.receipt).toEqual({
			eventId: "event-1",
			chunkCreated: true,
		})
		expect(replay.state).toBe("promoted")
		expect(mutateWiki).toHaveBeenCalledTimes(1)
	})

	it("dead-letters promotion after bounded transactional failures", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		await beginMemoryDelivery(f.handle, params.operationId, f.session)
		await confirmMemoryDelivery(
			f.handle,
			params.operationId,
			{ eventId: "event-1", chunkCreated: true },
			f.session,
		)

		await failMemoryPromotion(
			f.handle,
			params.operationId,
			"PROMOTION_FAILED",
			f.session,
		)
		await failMemoryPromotion(
			f.handle,
			params.operationId,
			"PROMOTION_FAILED",
			f.session,
		)
		const failed = await failMemoryPromotion(
			f.handle,
			params.operationId,
			"PROMOTION_FAILED",
			f.session,
		)

		expect(failed.state).toBe("dead-letter")
		expect(failed.promotionAttempts).toBe(3)
	})

	it("recovers an expired dispatch only through bounded same-key reconciliation", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		await beginMemoryDelivery(f.handle, params.operationId, f.session)
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		current.dispatchStartedAt = new Date(0)

		const reconciled = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
			3,
			0,
		)

		expect(reconciled.state).toBe("delivering")
		expect(reconciled.attempts).toBe(2)
		expect(reconciled.reconciliationAttempts).toBe(1)
	})

	it("dead-letters an unknown outcome after reconciliation is exhausted", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		current.state = "outcome-unknown"
		current.reconciliationAttempts = 3

		const exhausted = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
		)

		expect(exhausted.state).toBe("dead-letter")
	})

	it("dead-letters retryable delivery after bounded dispatch attempts", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		current.state = "retryable"
		current.attempts = 5

		const exhausted = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
		)

		expect(exhausted.state).toBe("dead-letter")
	})
})
