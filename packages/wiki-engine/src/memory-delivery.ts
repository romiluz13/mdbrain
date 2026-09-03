import { createHash, randomUUID } from "node:crypto"
import type { ClientSession } from "mongodb"
import { memoryDeliveryIntentsCollection } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

export const MEMORY_DELIVERY_STATES = [
	"recorded",
	"delivering",
	"retryable",
	"outcome-unknown",
	"confirmed",
	"promotion-pending",
	"promoted",
	"dead-letter",
	"conflict",
] as const

/** States the reconciler scans for due work. `recorded` rows are always
 *  due (nextDueAt = createdAt); `delivering` rows become due when their
 *  dispatch lease expires; failed rows back off exponentially. */
export const MEMORY_DELIVERY_DUE_SCAN_STATES: MemoryDeliveryState[] = [
	"recorded",
	"delivering",
	"retryable",
	"outcome-unknown",
	"promotion-pending",
]

/** Default retention for intents in terminal states (confirmed, promoted,
 *  dead-letter, conflict): the TTL index deletes them after this window.
 *  Non-terminal intents never carry expiresAt — pending work is never GC'd. */
export const DEFAULT_MEMORY_LEDGER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Upper bound on the canonical payload stored per intent. The ledger is a
 *  transactional outbox, not a blob store: oversized writes are rejected at
 *  record time (silent truncation would corrupt replay fidelity — the stored
 *  payload must stay byte-identical to what was fingerprinted and
 *  authorized). */
export const MAX_MEMORY_DELIVERY_PAYLOAD_BYTES = 256 * 1024

/** Exponential backoff (1s → 60s, no jitter) between attempts. Exported so
 *  the ledger can stamp nextDueAt at every failure and the runtime can reuse
 *  the same shape. */
export function memoryDeliveryRetryDelayMs(attempts: number): number {
	const exponent = Math.max(0, Math.min(attempts - 1, 6))
	return Math.min(60_000, 1_000 * 2 ** exponent)
}

export type MemoryDeliveryState = (typeof MEMORY_DELIVERY_STATES)[number]
export type MemoryPromotionPolicy = "none" | "wiki"
export type MemoryPromotionApproval = "required" | "approved"
export type MemoryDeliveryReplayConflictField =
	| "payloadFingerprint"
	| "idempotencyKey"
	| "promotionPolicy"
	| "operation"
	| "principalSubjectId"
	| "agentId"
	| "scope"
	| "scopeRef"

export type MemoryDeliveryIntent = {
	operationId: string
	operation: "add" | "write-event"
	idempotencyKey: string
	payloadFingerprint: string
	payload: Record<string, unknown>
	principalSubjectId: string
	agentId: string
	scope: string
	scopeRef: string
	promotionPolicy: MemoryPromotionPolicy
	/** Present only for wiki promotions recorded under approval mode. */
	promotionApproval?: MemoryPromotionApproval
	state: MemoryDeliveryState
	attempts: number
	reconciliationAttempts: number
	promotionAttempts: number
	receipt?: Record<string, unknown>
	promotionKey?: string
	lastErrorCode?: string
	/** Fencing token minted by beginMemoryDelivery when it claims a
	 *  dispatch; confirm/fail predicates require it so a stale worker whose
	 *  lease expired can never settle a claim owned by another worker. */
	leaseToken?: string
	/** When the intent next becomes eligible for a reconciler scan.
	 *  Absent only on intents written before this field existed — the due
	 *  scan treats those as immediately due so they can never be starved. */
	nextDueAt?: Date
	/** Retention deadline stamped when the intent enters a terminal state;
	 *  the TTL index deletes the document once it passes. */
	expiresAt?: Date
	dispatchStartedAt?: Date
	confirmedAt?: Date
	promotedAt?: Date
	replayConflictCount?: number
	replayConflictFields?: MemoryDeliveryReplayConflictField[]
	lastReplayConflictAt?: Date
	createdAt: Date
	updatedAt: Date
}

export type MemoryDeliveryIntentInput = {
	operationId: string
	operation: "add" | "write-event"
	idempotencyKey: string
	payload: Record<string, unknown>
	principalSubjectId: string
	agentId: string
	scope: string
	scopeRef: string
	promotionPolicy: MemoryPromotionPolicy
	promotionApproval?: MemoryPromotionApproval
}

export class MemoryDeliveryConflictError extends Error {
	constructor(readonly operationId: string) {
		super(
			`delivery operation "${operationId}" conflicts with its original payload`,
		)
		this.name = "MemoryDeliveryConflictError"
	}
}

export class MemoryDeliveryStateError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "MemoryDeliveryStateError"
	}
}

/** Raised when confirm/fail no longer match the caller's dispatch claim:
 *  the lease expired and another worker reclaimed the intent. Callers must
 *  surface this as a typed conflict (safe same-key retry), never a generic
 *  500 — the write's real outcome is owned by the new claimant. */
export class MemoryDeliveryLeaseLostError extends Error {
	constructor(readonly operationId: string) {
		super(
			`delivery operation "${operationId}" is claimed by another worker (dispatch lease lost)`,
		)
		this.name = "MemoryDeliveryLeaseLostError"
	}
}

/** Raised at record time when the canonical payload exceeds
 *  MAX_MEMORY_DELIVERY_PAYLOAD_BYTES. */
export class MemoryDeliveryPayloadTooLargeError extends Error {
	constructor(
		readonly bytes: number,
		readonly limit: number,
	) {
		super(
			`memory delivery payload is ${bytes} bytes; the ledger limit is ${limit}`,
		)
		this.name = "MemoryDeliveryPayloadTooLargeError"
	}
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
	const object = value as Record<string, unknown>
	return `{${Object.keys(object)
		.filter((key) => object[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
		.join(",")}}`
}

export function fingerprintMemoryDeliveryPayload(payload: unknown): string {
	return createHash("sha256").update(canonicalJson(payload)).digest("hex")
}

export async function recordMemoryDeliveryIntent(
	handle: WikiDbHandle,
	params: MemoryDeliveryIntentInput,
	session: ClientSession,
): Promise<{
	intent: MemoryDeliveryIntent
	replayed: boolean
	conflict: boolean
}> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const canonicalPayload = canonicalJson(params.payload)
	const payloadBytes = Buffer.byteLength(canonicalPayload, "utf8")
	if (payloadBytes > MAX_MEMORY_DELIVERY_PAYLOAD_BYTES) {
		throw new MemoryDeliveryPayloadTooLargeError(
			payloadBytes,
			MAX_MEMORY_DELIVERY_PAYLOAD_BYTES,
		)
	}
	const payloadFingerprint = fingerprintMemoryDeliveryPayload(params.payload)
	const existing = (await collection.findOne(
		{ operationId: params.operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (existing) {
		const replayConflictFields: MemoryDeliveryReplayConflictField[] = []
		if (existing.payloadFingerprint !== payloadFingerprint) {
			replayConflictFields.push("payloadFingerprint")
		}
		if (existing.idempotencyKey !== params.idempotencyKey) {
			replayConflictFields.push("idempotencyKey")
		}
		if (existing.promotionPolicy !== params.promotionPolicy) {
			replayConflictFields.push("promotionPolicy")
		}
		if (existing.operation !== params.operation) {
			replayConflictFields.push("operation")
		}
		if (existing.principalSubjectId !== params.principalSubjectId) {
			replayConflictFields.push("principalSubjectId")
		}
		if (existing.agentId !== params.agentId) {
			replayConflictFields.push("agentId")
		}
		if (existing.scope !== params.scope) {
			replayConflictFields.push("scope")
		}
		if (existing.scopeRef !== params.scopeRef) {
			replayConflictFields.push("scopeRef")
		}
		if (replayConflictFields.length > 0) {
			const lastReplayConflictAt = new Date()
			await collection.updateOne(
				{ operationId: params.operationId },
				{
					$inc: { replayConflictCount: 1 },
					$addToSet: {
						replayConflictFields: { $each: replayConflictFields },
					},
					$set: { lastReplayConflictAt },
				},
				{ session },
			)
			return {
				intent: {
					...existing,
					replayConflictCount: (existing.replayConflictCount ?? 0) + 1,
					replayConflictFields: [
						...new Set([
							...(existing.replayConflictFields ?? []),
							...replayConflictFields,
						]),
					],
					lastReplayConflictAt,
				},
				replayed: true,
				conflict: true,
			}
		}
		return { intent: existing, replayed: true, conflict: false }
	}
	const now = new Date()
	const intent: MemoryDeliveryIntent = {
		operationId: params.operationId,
		operation: params.operation,
		idempotencyKey: params.idempotencyKey,
		payloadFingerprint,
		payload: params.payload,
		principalSubjectId: params.principalSubjectId,
		agentId: params.agentId,
		scope: params.scope,
		scopeRef: params.scopeRef,
		promotionPolicy: params.promotionPolicy,
		...(params.promotionApproval
			? { promotionApproval: params.promotionApproval }
			: {}),
		state: "recorded",
		attempts: 0,
		reconciliationAttempts: 0,
		promotionAttempts: 0,
		nextDueAt: now,
		createdAt: now,
		updatedAt: now,
	}
	await collection.insertOne(intent, { session })
	return { intent, replayed: false, conflict: false }
}

export async function beginMemoryDelivery(
	handle: WikiDbHandle,
	operationId: string,
	session: ClientSession,
	maxReconciliationAttempts = 3,
	staleDispatchMs = 30_000,
	maxDeliveryAttempts = 5,
	ledgerTtlMs = DEFAULT_MEMORY_LEDGER_TTL_MS,
): Promise<MemoryDeliveryIntent> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	let current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (current.state === "delivering") {
		const dispatchAge = current.dispatchStartedAt
			? Date.now() - current.dispatchStartedAt.getTime()
			: Number.POSITIVE_INFINITY
		if (dispatchAge < staleDispatchMs) {
			throw new MemoryDeliveryStateError("delivery intent is already claimed")
		}
		const recovered = await collection.findOneAndUpdate(
			{ operationId, state: "delivering" },
			{
				$set: {
					state: "outcome-unknown",
					lastErrorCode: "DISPATCH_LEASE_EXPIRED",
					// The recovered row is due for a reconciliation attempt on
					// the same backoff cadence as a failed delivery.
					nextDueAt: new Date(
						Date.now() + memoryDeliveryRetryDelayMs(current.attempts),
					),
					updatedAt: new Date(),
				},
				// A recovered claim is never settled by its original worker.
				$unset: { leaseToken: "" },
			},
			{ session, returnDocument: "after" },
		)
		if (!recovered) {
			throw new MemoryDeliveryStateError("delivery recovery claim was lost")
		}
		current = recovered as unknown as MemoryDeliveryIntent
	}
	if (current.state === "outcome-unknown") {
		if (current.reconciliationAttempts >= maxReconciliationAttempts) {
			const now = new Date()
			const deadLetter = await collection.findOneAndUpdate(
				{ operationId, state: "outcome-unknown" },
				{
					$set: {
						state: "dead-letter",
						expiresAt: new Date(now.getTime() + ledgerTtlMs),
						updatedAt: now,
					},
					$unset: { nextDueAt: "" },
				},
				{ session, returnDocument: "after" },
			)
			if (!deadLetter) {
				throw new MemoryDeliveryStateError(
					"delivery dead-letter claim was lost",
				)
			}
			return deadLetter as unknown as MemoryDeliveryIntent
		}
	}
	if (
		current.state === "retryable" &&
		current.attempts >= maxDeliveryAttempts
	) {
		const now = new Date()
		const deadLetter = await collection.findOneAndUpdate(
			{ operationId, state: "retryable" },
			{
				$set: {
					state: "dead-letter",
					expiresAt: new Date(now.getTime() + ledgerTtlMs),
					updatedAt: now,
				},
				$unset: { nextDueAt: "" },
			},
			{ session, returnDocument: "after" },
		)
		if (!deadLetter) {
			throw new MemoryDeliveryStateError("delivery dead-letter claim was lost")
		}
		return deadLetter as unknown as MemoryDeliveryIntent
	}
	if (
		current.state !== "recorded" &&
		current.state !== "retryable" &&
		current.state !== "outcome-unknown"
	) {
		throw new MemoryDeliveryStateError(
			`delivery cannot start from state ${current.state}`,
		)
	}
	const now = new Date()
	const leaseToken = randomUUID()
	const update = {
		$set: {
			state: "delivering" as const,
			dispatchStartedAt: now,
			// The lease horizon doubles as the due time: once it passes, the
			// reconciler can safely recover the stale claim.
			nextDueAt: new Date(now.getTime() + staleDispatchMs),
			leaseToken,
			updatedAt: now,
		},
		$inc: {
			attempts: 1,
			reconciliationAttempts: current.state === "outcome-unknown" ? 1 : 0,
		},
	}
	const updated = await collection.findOneAndUpdate(
		{ operationId, state: current.state },
		update,
		{ session, returnDocument: "after" },
	)
	if (!updated) {
		throw new MemoryDeliveryStateError("delivery intent is already claimed")
	}
	return updated as unknown as MemoryDeliveryIntent
}

export async function confirmMemoryDelivery(
	handle: WikiDbHandle,
	operationId: string,
	receipt: Record<string, unknown>,
	leaseToken: string,
	session: ClientSession,
	ledgerTtlMs = DEFAULT_MEMORY_LEDGER_TTL_MS,
): Promise<MemoryDeliveryIntent> {
	if (!leaseToken) {
		throw new MemoryDeliveryStateError(
			"delivery confirmation requires a dispatch lease token",
		)
	}
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (current.state === "confirmed" || current.state === "promotion-pending") {
		return current
	}
	if (current.state === "promoted") return current
	if (current.state !== "delivering") {
		throw new MemoryDeliveryStateError(
			`delivery cannot be confirmed from state ${current.state}`,
		)
	}
	const now = new Date()
	const state =
		current.promotionPolicy === "wiki" ? "promotion-pending" : "confirmed"
	const updated = await collection.findOneAndUpdate(
		// The lease token fences stale workers: if our dispatch lease expired
		// and the reconciler recovered the claim, we must not settle it.
		{ operationId, state: "delivering", leaseToken },
		{
			$set: {
				state,
				receipt,
				confirmedAt: now,
				updatedAt: now,
				...(state === "confirmed"
					? { expiresAt: new Date(now.getTime() + ledgerTtlMs) }
					: {
							// Promotion work is due on the same backoff cadence.
							nextDueAt: new Date(
								now.getTime() +
									memoryDeliveryRetryDelayMs(
										(current.promotionAttempts ?? 0) + 1,
									),
							),
						}),
			},
			...(state === "confirmed" ? { $unset: { nextDueAt: "" } } : {}),
		},
		{ session, returnDocument: "after" },
	)
	if (!updated) {
		if (current.state === "delivering" && current.leaseToken !== leaseToken) {
			throw new MemoryDeliveryLeaseLostError(operationId)
		}
		throw new MemoryDeliveryStateError("delivery confirmation lost")
	}
	return updated as unknown as MemoryDeliveryIntent
}

export async function failMemoryDelivery(
	handle: WikiDbHandle,
	operationId: string,
	failure: {
		code: string
		outcome: "not-applied" | "unknown"
		retryable: boolean
	},
	leaseToken: string,
	session: ClientSession,
	ledgerTtlMs = DEFAULT_MEMORY_LEDGER_TTL_MS,
): Promise<MemoryDeliveryIntent> {
	if (!leaseToken) {
		throw new MemoryDeliveryStateError(
			"delivery failure requires a dispatch lease token",
		)
	}
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (current.state !== "delivering") {
		throw new MemoryDeliveryStateError(
			`delivery cannot fail from state ${current.state}`,
		)
	}
	if (current.leaseToken !== leaseToken) {
		throw new MemoryDeliveryLeaseLostError(operationId)
	}
	const now = new Date()
	const state: MemoryDeliveryState =
		failure.code === "IDEMPOTENCY_CONFLICT"
			? "conflict"
			: failure.outcome === "unknown"
				? "outcome-unknown"
				: failure.retryable
					? "retryable"
					: "dead-letter"
	const terminal = state === "conflict" || state === "dead-letter"
	const updated = await collection.findOneAndUpdate(
		// Lease-fenced so a stale worker can never overwrite the live
		// claimant's state with its own failure.
		{ operationId, state: "delivering", leaseToken },
		{
			$set: {
				state,
				lastErrorCode: failure.code,
				updatedAt: now,
				...(terminal
					? { expiresAt: new Date(now.getTime() + ledgerTtlMs) }
					: {
							// Failed rows back off before the next due scan.
							nextDueAt: new Date(
								now.getTime() + memoryDeliveryRetryDelayMs(current.attempts),
							),
						}),
			},
			// The dispatch lease is consumed either way; terminal rows stop
			// being due (their retention is governed by expiresAt).
			$unset: { leaseToken: "", ...(terminal ? { nextDueAt: "" } : {}) },
		},
		{ session, returnDocument: "after" },
	)
	if (!updated) throw new MemoryDeliveryLeaseLostError(operationId)
	return updated as unknown as MemoryDeliveryIntent
}

export async function failMemoryPromotion(
	handle: WikiDbHandle,
	operationId: string,
	errorCode: string,
	session: ClientSession,
	maxPromotionAttempts = 3,
	ledgerTtlMs = DEFAULT_MEMORY_LEDGER_TTL_MS,
): Promise<MemoryDeliveryIntent> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (current.state !== "promotion-pending") {
		throw new MemoryDeliveryStateError(
			`promotion cannot fail from state ${current.state}`,
		)
	}
	const promotionAttempts = (current.promotionAttempts ?? 0) + 1
	const state =
		promotionAttempts >= maxPromotionAttempts
			? ("dead-letter" as const)
			: ("promotion-pending" as const)
	const now = new Date()
	const updated = await collection.findOneAndUpdate(
		{ operationId, state: "promotion-pending" },
		{
			$set: {
				state,
				promotionAttempts,
				lastErrorCode: errorCode,
				updatedAt: now,
				...(state === "dead-letter"
					? { expiresAt: new Date(now.getTime() + ledgerTtlMs) }
					: {
							// Failed promotions back off before the next scan.
							nextDueAt: new Date(
								now.getTime() + memoryDeliveryRetryDelayMs(promotionAttempts),
							),
						}),
			},
			// A dead-lettered promotion stops being due; its retention is
			// governed by expiresAt.
			$unset: { ...(state === "dead-letter" ? { nextDueAt: "" } : {}) },
		},
		{ session, returnDocument: "after" },
	)
	if (!updated)
		throw new MemoryDeliveryStateError("promotion failure state lost")
	return updated as unknown as MemoryDeliveryIntent
}

export async function promoteMemoryDelivery(
	handle: WikiDbHandle,
	operationId: string,
	promotionKey: string,
	mutateWiki: (
		handle: WikiDbHandle,
		intent: MemoryDeliveryIntent,
		session: ClientSession,
	) => Promise<void>,
	session: ClientSession,
	ledgerTtlMs = DEFAULT_MEMORY_LEDGER_TTL_MS,
): Promise<MemoryDeliveryIntent> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (current.state === "promoted") {
		if (current.promotionKey !== promotionKey) {
			throw new MemoryDeliveryConflictError(operationId)
		}
		return current
	}
	if (current.state !== "promotion-pending" || !current.receipt) {
		throw new MemoryDeliveryStateError(
			"promotion requires a confirmed delivery receipt",
		)
	}
	await mutateWiki(handle, current, session)
	const now = new Date()
	const updated = await collection.findOneAndUpdate(
		{ operationId, state: "promotion-pending" },
		{
			$set: {
				state: "promoted",
				promotionKey,
				promotedAt: now,
				// Promoted is terminal: retention is governed by expiresAt.
				expiresAt: new Date(now.getTime() + ledgerTtlMs),
				updatedAt: now,
			},
			$unset: { nextDueAt: "" },
		},
		{ session, returnDocument: "after" },
	)
	if (!updated)
		throw new MemoryDeliveryStateError("promotion state update lost")
	return updated as unknown as MemoryDeliveryIntent
}

export async function getMemoryDeliveryIntent(
	handle: WikiDbHandle,
	operationId: string,
): Promise<MemoryDeliveryIntent | null> {
	return (await memoryDeliveryIntentsCollection(
		handle.db,
		handle.prefix,
	).findOne({ operationId })) as unknown as MemoryDeliveryIntent | null
}

/**
 * Marks a promotion-pending intent that was recorded under approval mode
 * ("required") as human-approved ("approved"). The state predicate makes the
 * transition safe to race with the reconciler: an intent that is not exactly
 * in (promotion-pending, required) is left untouched.
 */
export async function setMemoryDeliveryPromotionApproval(
	handle: WikiDbHandle,
	operationId: string,
	approval: MemoryPromotionApproval,
	session: ClientSession,
): Promise<MemoryDeliveryIntent> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const updated = await collection.findOneAndUpdate(
		{
			operationId,
			state: "promotion-pending",
			promotionApproval: "required",
		},
		{
			$set: {
				promotionApproval: approval,
				updatedAt: new Date(),
			},
		},
		{ session, returnDocument: "after" },
	)
	if (!updated) {
		throw new MemoryDeliveryStateError(
			"promotion approval requires a pending promotion recorded under approval mode",
		)
	}
	return updated as unknown as MemoryDeliveryIntent
}

export async function listMemoryDeliveryIntents(
	handle: WikiDbHandle,
	options: {
		state?: MemoryDeliveryState
		scope?: string
		scopeRef?: string
		limit?: number
	} = {},
): Promise<MemoryDeliveryIntent[]> {
	const filter: Record<string, unknown> = {}
	if (options.state) filter.state = options.state
	if (options.scope) filter.scope = options.scope
	if (options.scopeRef) filter.scopeRef = options.scopeRef
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
	return (await memoryDeliveryIntentsCollection(handle.db, handle.prefix)
		.find(filter)
		.sort({ updatedAt: -1 })
		.limit(limit)
		.toArray()) as unknown as MemoryDeliveryIntent[]
}

/**
 * Oldest-first scan for intents that are due for reconciler work.
 *
 * Returns states from MEMORY_DELIVERY_DUE_SCAN_STATES whose nextDueAt has
 * passed (or is absent — pre-nextDueAt rows are always due so they can
 * never be starved by the migration), ordered by nextDueAt ascending so
 * the oldest, most-at-risk work is always drained first. This closes the
 * newest-first starvation gap: the previous `updatedAt: -1` admin ordering
 * kept young rows in front of old ones.
 */
export async function listDueMemoryDeliveryIntents(
	handle: WikiDbHandle,
	options: {
		now?: number
		limit?: number
		states?: MemoryDeliveryState[]
	} = {},
): Promise<MemoryDeliveryIntent[]> {
	const now = new Date(options.now ?? Date.now())
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
	const filter = {
		state: { $in: options.states ?? MEMORY_DELIVERY_DUE_SCAN_STATES },
		$or: [{ nextDueAt: { $lte: now } }, { nextDueAt: { $exists: false } }],
	}
	return (await memoryDeliveryIntentsCollection(handle.db, handle.prefix)
		.find(filter)
		.sort({ nextDueAt: 1, updatedAt: 1 })
		.limit(limit)
		.toArray()) as unknown as MemoryDeliveryIntent[]
}

/**
 * Requeues a dead-lettered intent for a fresh delivery lifecycle.
 *
 * The transition is fenced on (dead-letter) so it cannot race the TTL
 * monitor or the reconciler. Counters reset and the dispatch lease,
 * failure code, and retention deadline are cleared. A dead letter that
 * carries a confirmed receipt (promotion exhausted) is requeued as
 * promotion-pending so the promotion is retried rather than redispatched;
 * delivery dead letters restart as recorded.
 */
export async function redriveMemoryDeliveryIntent(
	handle: WikiDbHandle,
	operationId: string,
	session: ClientSession,
): Promise<MemoryDeliveryIntent> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (current.state !== "dead-letter") {
		throw new MemoryDeliveryStateError(
			`delivery cannot be redriven from state ${current.state}`,
		)
	}
	const now = new Date()
	const target: MemoryDeliveryState =
		current.receipt && current.promotionPolicy === "wiki"
			? "promotion-pending"
			: "recorded"
	const updated = await collection.findOneAndUpdate(
		{ operationId, state: "dead-letter" },
		{
			$set: {
				state: target,
				attempts: 0,
				reconciliationAttempts: 0,
				promotionAttempts: 0,
				nextDueAt: now,
				updatedAt: now,
			},
			$unset: {
				leaseToken: "",
				lastErrorCode: "",
				expiresAt: "",
			},
		},
		{ session, returnDocument: "after" },
	)
	if (!updated) {
		throw new MemoryDeliveryStateError("delivery redrive claim was lost")
	}
	return updated as unknown as MemoryDeliveryIntent
}
