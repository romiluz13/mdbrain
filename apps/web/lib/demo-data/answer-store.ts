// The answer service's control-store state (ticket 15): the one active
// answer (a durable lease), the per-visitor hourly question count, and the
// shared model budget ledger, all in mdbrain_demo_control beside the run
// manifests. Server-only in practice: run-store owns the driver and the
// connection string, and only the answers route imports this module.

import { createModelBudget, type ModelBudget } from "@mdbrain/lib/budget"
import type { AnswerLimits } from "./answer-types.js"
import { controlDb } from "./run-store.js"

/** A held lease expires on its own well past the answer deadline, so a
 * crashed answer cannot wedge the lane: the next visitor waits out the
 * expiry rather than getting a second concurrent answer. */
export const LEASE_TTL_MS = 120_000

type LeaseDoc = {
	_id: "active"
	/** null is the free slot: no lease held. */
	visitorId: string | null
	acquiredAt: Date
	expiresAt: Date
}

type QuestionDoc = {
	_id: string
	visitorId: string
	hour: string
	count: number
	updatedAt: Date
}

/** A duplicate-key write means another request won the same one-slot race. */
const isDuplicateKey = (error: unknown): boolean =>
	(error as { code?: unknown }).code === 11000

/** The UTC hour a question count belongs to. */
function hourBucket(now: Date): string {
	return now.toISOString().slice(0, 13)
}

export function createAnswerStore(
	uri: string,
	options: {
		timeoutMs?: number
		collectionPrefix?: string
		budgetPrefix?: string
	} = {},
) {
	const prefix = options.collectionPrefix ?? "demo_answer_"
	const db = controlDb(uri, options.timeoutMs)
	const lease = db.collection<LeaseDoc>(`${prefix}lease`)
	const questions = db.collection<QuestionDoc>(`${prefix}questions`)

	const limits: AnswerLimits = {
		acquireLease: async ({ visitorId }) => {
			const now = new Date()
			// Take a free or expired lease; never insert over a live holder.
			const takeover = await lease.updateOne(
				{
					_id: "active",
					$or: [{ visitorId: null }, { expiresAt: { $lt: now } }],
				},
				{
					$set: {
						visitorId,
						acquiredAt: now,
						expiresAt: new Date(now.getTime() + LEASE_TTL_MS),
					},
				},
			)
			if (takeover.modifiedCount === 1) {
				return true
			}
			try {
				// No lease document at all: claim the slot by inserting it.
				const claimed = await lease.insertOne({
					_id: "active",
					visitorId,
					acquiredAt: now,
					expiresAt: new Date(now.getTime() + LEASE_TTL_MS),
				})
				return claimed.acknowledged
			} catch (error) {
				if (isDuplicateKey(error)) {
					return false
				}
				throw error
			}
		},
		// Only the holder releases: a stale release from another visitor
		// cannot drop an active answer's lease.
		releaseLease: async (visitorId) => {
			await lease.deleteOne({ _id: "active", visitorId })
		},
		countQuestion: async ({ visitorId }) => {
			const now = new Date()
			const hour = hourBucket(now)
			const updated = await questions.findOneAndUpdate(
				{ _id: `${visitorId}#${hour}` },
				{
					$inc: { count: 1 },
					$set: { visitorId, hour, updatedAt: now },
				},
				{ upsert: true, returnDocument: "after" },
			)
			return updated?.count ?? 1
		},
	}

	// The same shared ledger family the corpus and agents budgets count in:
	// the daily answers key sits beside theirs in mdbrain_demo_control.
	const budget: ModelBudget = createModelBudget(db, {
		collectionPrefix: options.budgetPrefix,
	})

	return { limits, budget }
}
