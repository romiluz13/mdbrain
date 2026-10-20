import { slotAgentId, slotScopeRef } from "./ids.js"

export type SlotState = "free" | "seeding" | "ready" | "used" | "failed"

export type SlotDoc = {
	_id: string
	index: number
	scopeRef: string
	agentId: string
	state: SlotState
	runId?: string
	claimedAt?: string
	readyAt?: string
	usedAt?: string
	failedAt?: string
	failureReason?: string
	resumeCount?: number
}

/** Narrow port over the control-store collection (mongodb driver 7.x
 * semantics: findOneAndUpdate returns the matched doc, or the updated doc
 * with returnDocument: "after"; null when nothing matched). */
export interface SlotStore {
	findOne(filter: Record<string, unknown>): Promise<SlotDoc | null>
	findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: {
			upsert?: boolean
			sort?: Record<string, 1 | -1>
			returnDocument?: "before" | "after"
		},
	): Promise<SlotDoc | null>
}

export class PoolExhaustedError extends Error {
	constructor(attemptedRunId: string) {
		super(
			`run ${attemptedRunId} found no claimable slot: every slot is already seeding, ready, used, or failed`,
		)
		this.name = "PoolExhaustedError"
	}
}

export class RunAlreadyFinishedError extends Error {
	constructor(runId: string, state: SlotState) {
		super(
			`run ${runId} already holds a slot that is ${state}; a finished run id is never re-seeded`,
		)
		this.name = "RunAlreadyFinishedError"
	}
}

/** The run-slot pool in the control store. Lifecycle is strictly one-way:
 * free -> seeding -> ready -> used, with failed as a terminal state. A claim
 * is a guarded findOneAndUpdate, so two concurrent claimers can never take
 * the same slot; a run resumes its own seeding slot but can never re-claim
 * a slot that reached ready, used, or failed. */
export function createRunSlotPool(
	store: SlotStore,
	options: { now?: () => Date } = {},
) {
	const now = () => (options.now?.() ?? new Date()).toISOString()

	async function prepare(count: number): Promise<SlotDoc[]> {
		if (!Number.isInteger(count) || count < 0) {
			throw new RangeError(
				`slot count must be a non-negative integer, got ${count}`,
			)
		}
		const slots: SlotDoc[] = []
		for (let index = 1; index <= count; index++) {
			const slot = await store.findOneAndUpdate(
				{ _id: slotId(index) },
				{
					$setOnInsert: {
						index,
						scopeRef: slotScopeRef(index),
						agentId: slotAgentId(index),
						state: "free" as SlotState,
					},
				},
				{ upsert: true, returnDocument: "after" },
			)
			if (!slot) {
				throw new Error(`prepare failed to upsert slot ${index}`)
			}
			slots.push(slot)
		}
		return slots
	}

	async function claim(
		runId: string,
	): Promise<{ slot: SlotDoc; resumed: boolean }> {
		// Resume first: a run that crashed mid-seed reclaims its own slot.
		const resumed = await store.findOneAndUpdate(
			{ state: "seeding", runId },
			{
				$set: { state: "seeding" as SlotState },
				$inc: { resumeCount: 1 },
			},
			{ returnDocument: "after" },
		)
		if (resumed) return { slot: resumed, resumed: true }
		const finished = await store.findOne({ runId })
		if (finished) throw new RunAlreadyFinishedError(runId, finished.state)

		const fresh = await store.findOneAndUpdate(
			{ state: "free" },
			{
				$set: {
					state: "seeding" as SlotState,
					runId,
					claimedAt: now(),
				},
			},
			{ sort: { index: 1 }, returnDocument: "after" },
		)
		if (!fresh) throw new PoolExhaustedError(runId)
		return { slot: fresh, resumed: false }
	}

	async function markReady(runId: string): Promise<SlotDoc | null> {
		return store.findOneAndUpdate(
			{ state: "seeding", runId },
			{ $set: { state: "ready" as SlotState, readyAt: now() } },
			{ returnDocument: "after" },
		)
	}

	async function markUsed(index: number): Promise<SlotDoc | null> {
		return store.findOneAndUpdate(
			{ _id: slotId(index), state: "ready" },
			{ $set: { state: "used" as SlotState, usedAt: now() } },
			{ returnDocument: "after" },
		)
	}

	async function markFailed(
		runId: string,
		reason: string,
	): Promise<SlotDoc | null> {
		return store.findOneAndUpdate(
			{ state: "seeding", runId },
			{
				$set: {
					state: "failed" as SlotState,
					failedAt: now(),
					failureReason: reason,
				},
			},
			{ returnDocument: "after" },
		)
	}

	async function get(index: number): Promise<SlotDoc | null> {
		return store.findOne({ _id: slotId(index) })
	}

	return { prepare, claim, markReady, markUsed, markFailed, get }
}

export function slotId(index: number): string {
	return `slot:${index}`
}
