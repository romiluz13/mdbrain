import { createHash } from "node:crypto"
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

export type MemoryDeliveryState = (typeof MEMORY_DELIVERY_STATES)[number]
export type MemoryPromotionPolicy = "none" | "wiki"
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
	state: MemoryDeliveryState
	attempts: number
	reconciliationAttempts: number
	promotionAttempts: number
	receipt?: Record<string, unknown>
	promotionKey?: string
	lastErrorCode?: string
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
		state: "recorded",
		attempts: 0,
		reconciliationAttempts: 0,
		promotionAttempts: 0,
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
					updatedAt: new Date(),
				},
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
			const deadLetter = await collection.findOneAndUpdate(
				{ operationId, state: "outcome-unknown" },
				{ $set: { state: "dead-letter", updatedAt: new Date() } },
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
		const deadLetter = await collection.findOneAndUpdate(
			{ operationId, state: "retryable" },
			{ $set: { state: "dead-letter", updatedAt: new Date() } },
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
	const update = {
		$set: {
			state: "delivering" as const,
			dispatchStartedAt: now,
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
	session: ClientSession,
): Promise<MemoryDeliveryIntent> {
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
		{ operationId, state: "delivering" },
		{
			$set: {
				state,
				receipt,
				confirmedAt: now,
				updatedAt: now,
			},
		},
		{ session, returnDocument: "after" },
	)
	if (!updated) throw new MemoryDeliveryStateError("delivery confirmation lost")
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
	session: ClientSession,
): Promise<MemoryDeliveryIntent> {
	const state: MemoryDeliveryState =
		failure.code === "IDEMPOTENCY_CONFLICT"
			? "conflict"
			: failure.outcome === "unknown"
				? "outcome-unknown"
				: failure.retryable
					? "retryable"
					: "dead-letter"
	const updated = await memoryDeliveryIntentsCollection(
		handle.db,
		handle.prefix,
	).findOneAndUpdate(
		{ operationId, state: "delivering" },
		{
			$set: {
				state,
				lastErrorCode: failure.code,
				updatedAt: new Date(),
			},
		},
		{ session, returnDocument: "after" },
	)
	if (!updated)
		throw new MemoryDeliveryStateError("delivery failure state lost")
	return updated as unknown as MemoryDeliveryIntent
}

export async function failMemoryPromotion(
	handle: WikiDbHandle,
	operationId: string,
	errorCode: string,
	session: ClientSession,
	maxPromotionAttempts = 3,
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
	const updated = await collection.findOneAndUpdate(
		{ operationId, state: "promotion-pending" },
		{
			$set: {
				state,
				promotionAttempts,
				lastErrorCode: errorCode,
				updatedAt: new Date(),
			},
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
				updatedAt: now,
			},
		},
		{ session, returnDocument: "after" },
	)
	if (!updated)
		throw new MemoryDeliveryStateError("promotion state update lost")
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
