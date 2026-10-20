import type { ClientSession } from "mongodb"
import {
	DEFAULT_MEMORY_LEDGER_TTL_MS,
	fingerprintMemoryDeliveryPayload,
	MemoryDeliveryStateError,
	type MemoryDeliveryIntent,
} from "./memory-delivery.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import { omitUndefined } from "./omit-undefined.js"
import { memoryDeliveryIntentsCollection } from "./wiki-schema.js"

/** A rejected proposal is a dead letter with this code. It reuses the
 *  existing terminal state, so the ledger validator and the due scan need no
 *  change: dead letters are never due, and approval only matches
 *  promotion-pending. Redrive is the one path that would revive a dead letter
 *  with a receipt, so it refuses a row that carries `rejectedAt`. */
export const PROPOSAL_REJECTED_CODE = "PROPOSAL_REJECTED"

export type ProposalRejection = {
	rejectedBy: string
	reason?: string
}

export function isRejectedMemoryDelivery(
	intent: Pick<MemoryDeliveryIntent, "rejectedAt">,
): boolean {
	return intent.rejectedAt !== undefined
}

/** Proposals waiting for a decision, oldest first: wiki promotions held for
 *  approval whose delivery is confirmed. */
export async function listPendingPromotionIntents(
	handle: WikiDbHandle,
	options: { scope?: string; scopeRef?: string; limit?: number } = {},
): Promise<MemoryDeliveryIntent[]> {
	const filter: Record<string, unknown> = {
		state: "promotion-pending",
		promotionPolicy: "wiki",
		promotionApproval: "required",
	}
	if (options.scope) filter.scope = options.scope
	if (options.scopeRef) filter.scopeRef = options.scopeRef
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
	return (await memoryDeliveryIntentsCollection(handle.db, handle.prefix)
		.find(filter)
		.sort({ createdAt: 1 })
		.limit(limit)
		.toArray()) as unknown as MemoryDeliveryIntent[]
}

/** Rejects a held proposal. The transition is one conditional update on the
 *  same precondition approval uses ((promotion-pending, required)), so an
 *  approve and a reject racing on one proposal cannot both match: the database
 *  applies one and the other finds the precondition gone. Rejecting a rejected
 *  proposal returns it unchanged. */
export async function rejectMemoryDeliveryPromotion(
	handle: WikiDbHandle,
	operationId: string,
	rejection: ProposalRejection,
	session: ClientSession,
	ledgerTtlMs = DEFAULT_MEMORY_LEDGER_TTL_MS,
): Promise<MemoryDeliveryIntent> {
	const collection = memoryDeliveryIntentsCollection(handle.db, handle.prefix)
	const now = new Date()
	const updated = await collection.findOneAndUpdate(
		{
			operationId,
			state: "promotion-pending",
			promotionApproval: "required",
		},
		{
			$set: omitUndefined({
				state: "dead-letter",
				lastErrorCode: PROPOSAL_REJECTED_CODE,
				rejectedAt: now,
				rejectedBy: rejection.rejectedBy,
				rejectionReason: rejection.reason || undefined,
				expiresAt: new Date(now.getTime() + ledgerTtlMs),
				updatedAt: now,
			}),
			$unset: { nextDueAt: "" },
		},
		{ session, returnDocument: "after" },
	)
	if (updated) return updated as unknown as MemoryDeliveryIntent
	const current = (await collection.findOne(
		{ operationId },
		{ session },
	)) as unknown as MemoryDeliveryIntent | null
	if (!current) throw new MemoryDeliveryStateError("delivery intent not found")
	if (isRejectedMemoryDelivery(current)) return current
	throw new MemoryDeliveryStateError(
		`proposal cannot be rejected from state ${current.state}` +
			(current.promotionApproval
				? ` (approval ${current.promotionApproval})`
				: ""),
	)
}

/** Checks that what approval would run is what was submitted: the payload
 *  still carries the scope the intent was recorded under, and still hashes to
 *  the fingerprint stored when it was recorded. Returns the problem, or null. */
export function verifyMemoryDeliveryIntegrity(
	intent: Pick<
		MemoryDeliveryIntent,
		"payload" | "payloadFingerprint" | "scope" | "scopeRef"
	>,
): string | null {
	const { scope, scopeRef } = intent.payload
	if (
		(typeof scope === "string" && scope !== intent.scope) ||
		(typeof scopeRef === "string" && scopeRef !== intent.scopeRef)
	) {
		return "the stored payload scope differs from the scope the proposal was recorded under"
	}
	if (
		fingerprintMemoryDeliveryPayload(intent.payload) !==
		intent.payloadFingerprint
	) {
		return "the stored payload no longer matches the fingerprint recorded with it"
	}
	return null
}
