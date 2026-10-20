// A proposal is a delivery intent that is waiting for a human. These tests run
// the real ledger functions against the fake database, which applies each
// update's filter before it writes, so the transitions below are the ones the
// ledger itself allows and refuses.

import { describe, expect, it } from "vitest"
import {
	listDueMemoryDeliveryIntents,
	MemoryDeliveryStateError,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	redriveMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval,
	failMemoryPromotion,
} from "./memory-delivery.js"
import {
	listPendingPromotionIntents,
	PROPOSAL_REJECTED_CODE,
	rejectMemoryDeliveryPromotion,
	verifyMemoryDeliveryIntegrity,
} from "./memory-delivery-proposals.js"
import {
	admin,
	approve,
	intentInput,
	ledger,
	propose,
	read,
	readsAs,
	session,
} from "./testing/proposal-fixtures.js"

describe("a recorded proposal", () => {
	it("is marked as a proposal only when the caller says so", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		const plain = intentInput("p2", "concepts/p2")
		const { proposalOnly: _omit, ...withoutMarker } = plain
		void _omit
		await recordMemoryDeliveryIntent(handle, withoutMarker, session)

		expect((await read(handle, "p1")).proposalOnly).toBe(true)
		expect(await read(handle, "p2")).not.toHaveProperty("proposalOnly")
	})

	it("refuses the same operation replayed with different content and keeps what was submitted", async () => {
		const { handle } = ledger()
		await propose(handle, "p1", "concepts/silent-eta-drift")

		const replay = await recordMemoryDeliveryIntent(
			handle,
			intentInput("p1", "concepts/silent-eta-drift", "A different body."),
			session,
		)

		expect(replay.conflict).toBe(true)
		const stored = await read(handle, "p1")
		const storedPage = (
			stored.payload.wikiPromotion as { page: { body: string } }
		).page
		expect(storedPage.body).toBe("Body.")
		expect(stored.replayConflictFields).toContain("payloadFingerprint")
		expect(stored.state).toBe("promotion-pending")
	})

	it("refuses the same operation replayed under another scope and keeps the scope it was submitted under", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")

		const replay = await recordMemoryDeliveryIntent(
			handle,
			{ ...intentInput("p1", "concepts/p1"), scopeRef: "demo-run-2" },
			session,
		)

		expect(replay.conflict).toBe(true)
		const stored = await read(handle, "p1")
		expect(stored.scopeRef).toBe("demo-run-1")
		expect(stored.replayConflictFields).toContain("scopeRef")
	})
})

describe("the pending list", () => {
	it("holds only proposals still waiting, oldest first", async () => {
		const { handle } = ledger()
		await propose(handle, "old")
		await propose(handle, "mid")
		await propose(handle, "new")
		await approve(handle, "mid")
		await rejectMemoryDeliveryPromotion(handle, "new", admin, session)
		await propose(handle, "newest")

		const pending = await listPendingPromotionIntents(handle, {})

		expect(pending.map((i) => i.operationId)).toEqual(["old", "newest"])
	})

	it("leaves out writes that carry no promotion and promotions that are not held", async () => {
		const { handle } = ledger()
		const base = intentInput("plain", "concepts/plain")
		await recordMemoryDeliveryIntent(
			handle,
			{
				...base,
				promotionPolicy: "none",
				promotionApproval: undefined,
				proposalOnly: undefined,
			},
			session,
		)
		await propose(handle, "held")

		const pending = await listPendingPromotionIntents(handle, {})

		expect(pending.map((i) => i.operationId)).toEqual(["held"])
	})

	it("filters by scope and honors the limit", async () => {
		const { handle } = ledger()
		await propose(handle, "a")
		await propose(handle, "b")
		await recordMemoryDeliveryIntent(
			handle,
			{ ...intentInput("c", "concepts/c"), scopeRef: "demo-run-2" },
			session,
		)

		expect(
			(
				await listPendingPromotionIntents(handle, {
					scope: "workspace",
					scopeRef: "demo-run-1",
				})
			).map((i) => i.operationId),
		).toEqual(["a", "b"])
		expect(
			await listPendingPromotionIntents(handle, { limit: 1 }),
		).toHaveLength(1)
	})
})

describe("rejecting a proposal", () => {
	it("ends it: dead-lettered, never due, with who rejected it and why", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")

		const rejected = await rejectMemoryDeliveryPromotion(
			handle,
			"p1",
			admin,
			session,
		)

		expect(rejected).toMatchObject({
			state: "dead-letter",
			lastErrorCode: PROPOSAL_REJECTED_CODE,
			rejectedBy: "api-key:admin",
			rejectionReason: "duplicates an existing page",
		})
		expect(rejected.rejectedAt).toBeInstanceOf(Date)
		expect(rejected.expiresAt).toBeInstanceOf(Date)
		expect(rejected).not.toHaveProperty("nextDueAt")
		const due = await listDueMemoryDeliveryIntents(handle, {
			now: Date.now() + 365 * 86_400_000,
		})
		expect(due).toEqual([])
	})

	it("cannot be approved afterwards, and nothing is promoted", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		await rejectMemoryDeliveryPromotion(handle, "p1", admin, session)
		let promoted = false

		await expect(
			setMemoryDeliveryPromotionApproval(handle, "p1", "approved", session),
		).rejects.toBeInstanceOf(MemoryDeliveryStateError)
		await expect(
			promoteMemoryDelivery(
				handle,
				"p1",
				"k",
				async () => {
					promoted = true
				},
				session,
			),
		).rejects.toBeInstanceOf(MemoryDeliveryStateError)

		expect(promoted).toBe(false)
		expect((await read(handle, "p1")).state).toBe("dead-letter")
	})

	it("cannot be redriven back into the queue", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		await rejectMemoryDeliveryPromotion(handle, "p1", admin, session)

		await expect(
			redriveMemoryDeliveryIntent(handle, "p1", session),
		).rejects.toThrow(/rejected/)

		const stored = await read(handle, "p1")
		expect(stored.state).toBe("dead-letter")
		expect(stored.lastErrorCode).toBe(PROPOSAL_REJECTED_CODE)
	})

	it("cannot be redriven by a redrive that read the row before it was rejected", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		await rejectMemoryDeliveryPromotion(handle, "p1", admin, session)
		const { rejectedAt: _decided, ...beforeTheRejection } = await read(
			handle,
			"p1",
		)

		await expect(
			redriveMemoryDeliveryIntent(
				readsAs(handle, beforeTheRejection),
				"p1",
				session,
			),
		).rejects.toThrow(/claim was lost/)

		const stored = await read(handle, "p1")
		expect(stored.state).toBe("dead-letter")
		expect(stored.rejectedAt).toBeInstanceOf(Date)
	})

	it("cannot be failed back into retry by a promotion attempt", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		await rejectMemoryDeliveryPromotion(handle, "p1", admin, session)

		await expect(
			failMemoryPromotion(handle, "p1", "X", session),
		).rejects.toBeInstanceOf(MemoryDeliveryStateError)
	})

	it("is idempotent: rejecting again returns the same record", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		const first = await rejectMemoryDeliveryPromotion(
			handle,
			"p1",
			admin,
			session,
		)

		const again = await rejectMemoryDeliveryPromotion(
			handle,
			"p1",
			{ rejectedBy: "someone-else", reason: "later" },
			session,
		)

		expect(again.rejectedAt).toEqual(first.rejectedAt)
		expect(again.rejectedBy).toBe("api-key:admin")
	})

	it("refuses a proposal that was already approved or promoted, and one that does not exist", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		await propose(handle, "p2")
		await approve(handle, "p1")
		await setMemoryDeliveryPromotionApproval(handle, "p2", "approved", session)

		await expect(
			rejectMemoryDeliveryPromotion(handle, "p1", admin, session),
		).rejects.toThrow(/promoted/)
		await expect(
			rejectMemoryDeliveryPromotion(handle, "p2", admin, session),
		).rejects.toBeInstanceOf(MemoryDeliveryStateError)
		await expect(
			rejectMemoryDeliveryPromotion(handle, "nope", admin, session),
		).rejects.toThrow(/not found/)
	})

	it("does not reject a delivery that is not a held promotion", async () => {
		const { handle } = ledger()
		await recordMemoryDeliveryIntent(
			handle,
			intentInput("early", "concepts/early"),
			session,
		)

		await expect(
			rejectMemoryDeliveryPromotion(handle, "early", admin, session),
		).rejects.toBeInstanceOf(MemoryDeliveryStateError)
		expect((await read(handle, "early")).state).toBe("recorded")
	})
})

describe("approve and reject racing on one proposal", () => {
	const settle = async <T>(work: Promise<T>) =>
		work.then(
			(value) => ({ ok: true as const, value }),
			(error: unknown) => ({ ok: false as const, error }),
		)

	it.each([
		["approve first", ["approve", "reject"]],
		["reject first", ["reject", "approve"]],
	] as const)("leaves exactly one winner (%s)", async (_name, order) => {
		const { handle } = ledger()
		await propose(handle, "p1")
		const run = {
			approve: () => approve(handle, "p1"),
			reject: () => rejectMemoryDeliveryPromotion(handle, "p1", admin, session),
		}

		const results = await Promise.all(order.map((who) => settle(run[who]())))

		expect(results.filter((r) => r.ok)).toHaveLength(1)
		const winner = order[results.findIndex((r) => r.ok)]
		const stored = await read(handle, "p1")
		if (winner === "approve") {
			expect(stored).toMatchObject({
				state: "promoted",
				promotionApproval: "approved",
			})
			expect(stored).not.toHaveProperty("rejectedAt")
		} else {
			expect(stored).toMatchObject({
				state: "dead-letter",
				lastErrorCode: PROPOSAL_REJECTED_CODE,
			})
			expect(stored.promotionApproval).toBe("required")
		}
	})

	it("lets the second of two approvals see the first one's result and promote nothing twice", async () => {
		const { handle } = ledger()
		await propose(handle, "p1")
		let promotions = 0
		const approveOnce = async () => {
			await setMemoryDeliveryPromotionApproval(
				handle,
				"p1",
				"approved",
				session,
			)
			return promoteMemoryDelivery(
				handle,
				"p1",
				"k",
				async () => {
					promotions += 1
				},
				session,
			)
		}

		const results = await Promise.all([
			settle(approveOnce()),
			settle(approveOnce()),
		])

		expect(results.filter((r) => r.ok)).toHaveLength(1)
		expect(promotions).toBe(1)
	})
})

describe("what approval checks against the stored proposal", () => {
	it("accepts a proposal as it was submitted", async () => {
		const { handle } = ledger()
		const intent = await propose(handle, "p1")

		expect(verifyMemoryDeliveryIntegrity(intent)).toBeNull()
	})

	it("refuses a stored payload that no longer matches its fingerprint", async () => {
		const { handle } = ledger()
		const intent = await propose(handle, "p1")
		const altered = structuredClone(intent)
		;(altered.payload.wikiPromotion as { page: { body: string } }).page.body =
			"Edited after submission."

		expect(verifyMemoryDeliveryIntegrity(altered)).toMatch(/payload/)
	})

	it("refuses a payload whose scope differs from the scope the intent was recorded under", async () => {
		const { handle } = ledger()
		const intent = await propose(handle, "p1")
		const moved = {
			...intent,
			payload: { ...intent.payload, scopeRef: "demo-run-2" },
		}

		expect(verifyMemoryDeliveryIntegrity(moved)).toMatch(/scope/)
	})
})

describe("proposals waiting for a decision and the reconciler", () => {
	it("do not take up the reconciler's due-scan slots, so a proposer cannot starve other work", async () => {
		const { handle } = ledger()
		for (const id of ["w1", "w2", "w3"]) await propose(handle, id)
		const plain = {
			...intentInput("retry-me", "concepts/retry-me"),
			promotionPolicy: "none" as const,
		}
		await recordMemoryDeliveryIntent(
			handle,
			{ ...plain, promotionApproval: undefined, proposalOnly: undefined },
			session,
		)

		// The proposals have waited since they were confirmed; the retry became
		// due later, so oldest-first ordering puts every proposal ahead of it.
		await handle.db
			.collection(`${handle.prefix}memory_delivery_intents`)
			.updateOne(
				{ operationId: "retry-me" },
				{ $set: { nextDueAt: new Date(Date.now() + 5_000) } },
			)

		const due = await listDueMemoryDeliveryIntents(handle, {
			now: Date.now() + 60_000,
			limit: 1,
		})

		expect(due.map((i) => i.operationId)).toEqual(["retry-me"])
	})

	it("are not returned by the due scan once rejected, so the reconciler never sees them", async () => {
		const { handle } = ledger()
		await propose(handle, "w1")
		await rejectMemoryDeliveryPromotion(handle, "w1", admin, session)

		const due = await listDueMemoryDeliveryIntents(handle, {
			now: Date.now() + 60_000,
		})

		expect(due.map((i) => i.operationId)).toEqual([])
	})

	it("come back into the scan once approved, so an approved promotion that failed is retried", async () => {
		const { handle } = ledger()
		await propose(handle, "w1")
		await setMemoryDeliveryPromotionApproval(handle, "w1", "approved", session)

		const due = await listDueMemoryDeliveryIntents(handle, {
			now: Date.now() + 60_000,
		})

		expect(due.map((i) => i.operationId)).toEqual(["w1"])
	})
})
