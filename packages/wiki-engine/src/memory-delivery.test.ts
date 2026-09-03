import type { ClientSession, Db } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	DEFAULT_MEMORY_LEDGER_TTL_MS,
	failMemoryDelivery,
	failMemoryPromotion,
	listDueMemoryDeliveryIntents,
	MAX_MEMORY_DELIVERY_PAYLOAD_BYTES,
	MemoryDeliveryLeaseLostError,
	MemoryDeliveryPayloadTooLargeError,
	MemoryDeliveryStateError,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	redriveMemoryDeliveryIntent,
	type MemoryDeliveryIntent,
} from "./memory-delivery.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

function fixture() {
	let stored: MemoryDeliveryIntent | undefined
	// Independent list backing listDueMemoryDeliveryIntents tests.
	let storedList: MemoryDeliveryIntent[] = []
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
				filter: { state?: string; leaseToken?: string },
				update: {
					$set?: Partial<MemoryDeliveryIntent>
					$inc?: Partial<Record<"attempts" | "reconciliationAttempts", number>>
					$unset?: Record<string, string>
				},
			) => {
				if (!stored || (filter.state && stored.state !== filter.state))
					return null
				// Lease-fenced predicates must not match a foreign claim.
				if (
					filter.leaseToken !== undefined &&
					stored.leaseToken !== filter.leaseToken
				)
					return null
				if (update.$set) Object.assign(stored, update.$set)
				if (update.$inc) {
					stored.attempts += update.$inc.attempts ?? 0
					stored.reconciliationAttempts +=
						update.$inc.reconciliationAttempts ?? 0
				}
				if (update.$unset) {
					for (const key of Object.keys(update.$unset)) {
						delete stored[key as keyof MemoryDeliveryIntent]
					}
				}
				return structuredClone(stored)
			},
		),
		find: vi.fn((filter: Record<string, unknown>) => {
			const calls = { sortSpec: {} as Record<string, 1 | -1>, limit: 0 }
			const cursor = {
				sort: (spec: Record<string, 1 | -1>) => {
					calls.sortSpec = spec
					return cursor
				},
				limit: (value: number) => {
					calls.limit = value
					return cursor
				},
				toArray: async () => {
					const states = (filter.state as { $in?: string[] })?.$in ?? []
					const now = Date.now()
					const due = storedList.filter((intent) => {
						const stateMatched =
							states.length === 0 || states.includes(intent.state)
						const dueMatched =
							intent.nextDueAt === undefined ||
							intent.nextDueAt.getTime() <= now
						return stateMatched && dueMatched
					})
					return due
						.sort((a, b) => {
							const aDue = a.nextDueAt?.getTime() ?? Number.NEGATIVE_INFINITY
							const bDue = b.nextDueAt?.getTime() ?? Number.NEGATIVE_INFINITY
							if (aDue !== bDue) return aDue - bDue
							return a.updatedAt.getTime() - b.updatedAt.getTime()
						})
						.slice(0, calls.limit || undefined)
				},
			}
			return cursor
		}),
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
		setStoredList: (intents: MemoryDeliveryIntent[]) => {
			storedList = intents
		},
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
		const begun = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
		)
		if (!begun.leaseToken) throw new Error("claim did not mint a lease token")
		await confirmMemoryDelivery(
			f.handle,
			params.operationId,
			{ eventId: "event-1", chunkCreated: true },
			begun.leaseToken,
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
		const begun = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
		)
		if (!begun.leaseToken) throw new Error("claim did not mint a lease token")
		await confirmMemoryDelivery(
			f.handle,
			params.operationId,
			{ eventId: "event-1", chunkCreated: true },
			begun.leaseToken,
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

describe("memory delivery lease fencing", () => {
	async function claimToDelivering() {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const begun = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
		)
		if (!begun.leaseToken) throw new Error("claim did not mint a lease token")
		return { f, begun }
	}

	it("stamps a lease token and lease-horizon due time on claim", async () => {
		const { f, begun } = await claimToDelivering()

		expect(begun.leaseToken).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		)
		expect(begun.state).toBe("delivering")
		expect(begun.nextDueAt).toBeInstanceOf(Date)
		expect(begun.nextDueAt?.getTime()).toBeGreaterThan(Date.now())
		// The row is due exactly when the dispatch lease lapses.
		expect(
			(begun.nextDueAt?.getTime() ?? 0) -
				(begun.dispatchStartedAt?.getTime() ?? 0),
		).toBe(30_000)
		expect(f.current()?.leaseToken).toBe(begun.leaseToken)
	})

	it("rejects confirmation holding a foreign lease and preserves the live claim", async () => {
		const { f, begun } = await claimToDelivering()
		// The dispatch lease lapses; a reconciler reclaims the intent.
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		current.dispatchStartedAt = new Date(0)
		await beginMemoryDelivery(f.handle, params.operationId, f.session, 3, 0)

		await expect(
			confirmMemoryDelivery(
				f.handle,
				params.operationId,
				{ eventId: "event-1" },
				begun.leaseToken,
				f.session,
			),
		).rejects.toThrow(MemoryDeliveryLeaseLostError)

		// The stale worker must not have settled anything.
		const after = f.current()
		if (!after) throw new Error("missing fixture intent")
		expect(after.receipt).toBeUndefined()
		expect(after.state).toBe("delivering")
		expect(after.leaseToken).not.toBe(begun.leaseToken)
	})

	it("rejects failure holding a foreign lease without clobbering the claimant", async () => {
		const { f, begun } = await claimToDelivering()
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		current.dispatchStartedAt = new Date(0)
		const reclaimed = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
			3,
			0,
		)

		await expect(
			failMemoryDelivery(
				f.handle,
				params.operationId,
				{ code: "WRITE_FAILED", outcome: "not-applied", retryable: true },
				begun.leaseToken,
				f.session,
			),
		).rejects.toThrow(MemoryDeliveryLeaseLostError)

		const after = f.current()
		if (!after) throw new Error("missing fixture intent")
		// The stale worker's failure was not applied: the claimant still owns
		// the dispatch, with no failure state and no error code.
		expect(after.state).toBe("delivering")
		expect(after.leaseToken).toBe(reclaimed.leaseToken)
		expect(after.lastErrorCode).not.toBe("WRITE_FAILED")
	})

	it("confirms with the matching lease and stamps retention on terminal states", async () => {
		const f = fixture()
		const local = { ...params, promotionPolicy: "none" as const }
		await recordMemoryDeliveryIntent(f.handle, local, f.session)
		const begun = await beginMemoryDelivery(
			f.handle,
			local.operationId,
			f.session,
		)
		if (!begun.leaseToken) throw new Error("claim did not mint a lease token")

		const confirmed = await confirmMemoryDelivery(
			f.handle,
			local.operationId,
			{ eventId: "event-1" },
			begun.leaseToken,
			f.session,
		)

		expect(confirmed.state).toBe("confirmed")
		expect(confirmed.expiresAt).toBeInstanceOf(Date)
		expect(confirmed.expiresAt?.getTime()).toBeGreaterThan(Date.now())
		expect(confirmed.expiresAt?.getTime()).toBeLessThanOrEqual(
			Date.now() + DEFAULT_MEMORY_LEDGER_TTL_MS,
		)
		expect(confirmed.nextDueAt).toBeUndefined()
	})

	it("queues promotion-pending work with a due time instead of retention", async () => {
		const { f, begun } = await claimToDelivering()

		const pending = await confirmMemoryDelivery(
			f.handle,
			params.operationId,
			{ eventId: "event-1" },
			begun.leaseToken,
			f.session,
		)

		expect(pending.state).toBe("promotion-pending")
		expect(pending.nextDueAt).toBeInstanceOf(Date)
		expect(pending.nextDueAt?.getTime()).toBeGreaterThan(Date.now())
		expect(pending.expiresAt).toBeUndefined()
	})

	it("backs off failed deliveries via nextDueAt and consumes the lease", async () => {
		const { f, begun } = await claimToDelivering()

		const retryable = await failMemoryDelivery(
			f.handle,
			params.operationId,
			{ code: "WRITE_FAILED", outcome: "not-applied", retryable: true },
			begun.leaseToken,
			f.session,
		)

		expect(retryable.state).toBe("retryable")
		expect(retryable.leaseToken).toBeUndefined()
		expect(retryable.nextDueAt?.getTime()).toBeGreaterThan(Date.now())
		expect(retryable.expiresAt).toBeUndefined()
	})

	it("stamps retention on dead-lettered and conflicted deliveries", async () => {
		const { f: fRetry, begun: begunRetry } = await claimToDelivering()
		const dead = await failMemoryDelivery(
			fRetry.handle,
			params.operationId,
			{ code: "WRITE_FAILED", outcome: "not-applied", retryable: false },
			begunRetry.leaseToken,
			fRetry.session,
		)
		expect(dead.state).toBe("dead-letter")
		expect(dead.expiresAt).toBeInstanceOf(Date)
		expect(dead.nextDueAt).toBeUndefined()

		const { f: fConflict, begun: begunConflict } = await claimToDelivering()
		const conflict = await failMemoryDelivery(
			fConflict.handle,
			params.operationId,
			{
				code: "IDEMPOTENCY_CONFLICT",
				outcome: "not-applied",
				retryable: false,
			},
			begunConflict.leaseToken,
			fConflict.session,
		)
		expect(conflict.state).toBe("conflict")
		expect(conflict.expiresAt).toBeInstanceOf(Date)
		expect(conflict.nextDueAt).toBeUndefined()
	})

	it("stamps retention when a promotion dead-letters or succeeds", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const begun = await beginMemoryDelivery(
			f.handle,
			params.operationId,
			f.session,
		)
		if (!begun.leaseToken) throw new Error("claim did not mint a lease token")
		await confirmMemoryDelivery(
			f.handle,
			params.operationId,
			{ eventId: "event-1" },
			begun.leaseToken,
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
		const dead = await failMemoryPromotion(
			f.handle,
			params.operationId,
			"PROMOTION_FAILED",
			f.session,
		)
		expect(dead.state).toBe("dead-letter")
		expect(dead.expiresAt).toBeInstanceOf(Date)
		expect(dead.nextDueAt).toBeUndefined()
	})

	it("rejects oversized payloads at record time without inserting", async () => {
		const f = fixture()
		const oversized = {
			...params,
			payload: {
				role: "user",
				body: "x".repeat(MAX_MEMORY_DELIVERY_PAYLOAD_BYTES),
			},
		}

		await expect(
			recordMemoryDeliveryIntent(f.handle, oversized, f.session),
		).rejects.toThrow(MemoryDeliveryPayloadTooLargeError)
		expect(f.collection.insertOne).not.toHaveBeenCalled()
		expect(f.current()).toBeUndefined()
	})
})

describe("memory delivery due scan and redrive", () => {
	function storedIntent(
		operationId: string,
		overrides: Partial<MemoryDeliveryIntent>,
	): MemoryDeliveryIntent {
		const now = new Date()
		return {
			operationId,
			operation: "write-event",
			idempotencyKey: "key",
			payloadFingerprint: "a".repeat(64),
			payload: {},
			principalSubjectId: params.principalSubjectId,
			agentId: params.agentId,
			scope: "workspace",
			scopeRef: params.scopeRef,
			promotionPolicy: "none",
			state: "retryable",
			attempts: 1,
			reconciliationAttempts: 0,
			promotionAttempts: 0,
			createdAt: now,
			updatedAt: now,
			...overrides,
		}
	}

	it("returns due intents oldest-first and skips future-dated work", async () => {
		const f = fixture()
		const overdue = new Date(Date.now() - 60_000)
		const future = new Date(Date.now() + 60_000)
		f.setStoredList([
			storedIntent("op-young", {
				state: "retryable",
				nextDueAt: new Date(Date.now() - 10_000),
				updatedAt: new Date(Date.now() - 10_000),
			}),
			storedIntent("op-old", {
				state: "retryable",
				nextDueAt: overdue,
				updatedAt: overdue,
			}),
			storedIntent("op-legacy", {
				state: "recorded",
				// Pre-migration row without nextDueAt: always due.
			}),
			storedIntent("op-future", { state: "retryable", nextDueAt: future }),
			storedIntent("op-terminal", {
				state: "confirmed",
				nextDueAt: overdue,
				expiresAt: future,
			}),
		])

		const due = await listDueMemoryDeliveryIntents(f.handle, { limit: 10 })

		// Oldest first, legacy rows included, future and terminal excluded.
		expect(due.map((intent) => intent.operationId)).toEqual([
			"op-legacy",
			"op-old",
			"op-young",
		])
		const filter = f.collection.find.mock.calls[0]?.[0] as {
			state: { $in: string[] }
		}
		expect(filter.state.$in).not.toContain("confirmed")
		expect(filter.state.$in).not.toContain("dead-letter")
	})

	it("respects the limit after ordering", async () => {
		const f = fixture()
		const overdue = new Date(Date.now() - 60_000)
		f.setStoredList([
			storedIntent("op-1", { nextDueAt: overdue }),
			storedIntent("op-2", { nextDueAt: new Date(Date.now() - 50_000) }),
			storedIntent("op-3", { nextDueAt: new Date(Date.now() - 40_000) }),
		])

		const due = await listDueMemoryDeliveryIntents(f.handle, { limit: 2 })

		expect(due.map((intent) => intent.operationId)).toEqual(["op-1", "op-2"])
	})

	it("redrives a delivery dead letter as a fresh recorded intent", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		Object.assign(current, {
			state: "dead-letter",
			attempts: 5,
			reconciliationAttempts: 3,
			promotionAttempts: 3,
			leaseToken: "stale-lease",
			lastErrorCode: "WRITE_FAILED",
			expiresAt: new Date(Date.now() + 1000),
		})

		const redriven = await redriveMemoryDeliveryIntent(
			f.handle,
			params.operationId,
			f.session,
		)

		expect(redriven.state).toBe("recorded")
		expect(redriven.attempts).toBe(0)
		expect(redriven.reconciliationAttempts).toBe(0)
		expect(redriven.promotionAttempts).toBe(0)
		expect(redriven.leaseToken).toBeUndefined()
		expect(redriven.lastErrorCode).toBeUndefined()
		expect(redriven.expiresAt).toBeUndefined()
		expect(redriven.nextDueAt).toBeInstanceOf(Date)
		expect(redriven.nextDueAt?.getTime()).toBeLessThanOrEqual(Date.now())
	})

	it("redrives a promotion dead letter with a receipt as promotion-pending", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)
		const current = f.current()
		if (!current) throw new Error("missing fixture intent")
		Object.assign(current, {
			state: "dead-letter",
			receipt: { eventId: "event-1", chunkCreated: true },
			promotionAttempts: 3,
			lastErrorCode: "PROMOTION_FAILED",
			expiresAt: new Date(Date.now() + 1000),
		})

		const redriven = await redriveMemoryDeliveryIntent(
			f.handle,
			params.operationId,
			f.session,
		)

		expect(redriven.state).toBe("promotion-pending")
		expect(redriven.receipt).toEqual({ eventId: "event-1", chunkCreated: true })
		expect(redriven.promotionAttempts).toBe(0)
		expect(redriven.expiresAt).toBeUndefined()
	})

	it("refuses to redrive non-dead-letter states or missing intents", async () => {
		const f = fixture()
		await recordMemoryDeliveryIntent(f.handle, params, f.session)

		await expect(
			redriveMemoryDeliveryIntent(f.handle, params.operationId, f.session),
		).rejects.toThrow("delivery cannot be redriven from state recorded")

		await expect(
			redriveMemoryDeliveryIntent(f.handle, "missing-op", f.session),
		).rejects.toThrow(MemoryDeliveryStateError)
	})
})
