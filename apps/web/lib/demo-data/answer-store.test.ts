// Ticket 15, test-first for the control-store half of the answer service:
// the one durable lease, the per-visitor hourly question count, and the
// shared budget ledger, all in mdbrain_demo_control. These tests need a
// real Mongo, so they run only when MDBRAIN_DEMO_CONTROL_TEST_URI is set,
// mirroring the budget's own guard; the service-level semantics are covered
// by answer-service.test.ts against in-memory fakes of this seam.
import { randomUUID } from "node:crypto"
import { MongoClient } from "mongodb"
import { BudgetExhaustedError } from "@mdbrain/lib/budget"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { VISITOR_QUESTIONS_PER_HOUR } from "./answer-types.js"
import { createAnswerStore } from "./answer-store.js"

const liveUri = process.env.MDBRAIN_DEMO_CONTROL_TEST_URI

describe.skipIf(!liveUri)("answer store against MongoDB", () => {
	let client: MongoClient
	const prefix = `test_answers_${randomUUID().slice(0, 8)}_`
	const budgetPrefix = `test_budget_${randomUUID().slice(0, 8)}_`
	const uri = liveUri ?? ""

	beforeAll(async () => {
		client = await MongoClient.connect(uri)
	})

	afterAll(async () => {
		const db = client.db("mdbrain_demo_control")
		for (const name of ["lease", "questions"]) {
			await db
				.collection(`${prefix}${name}`)
				.drop()
				.catch(() => undefined)
		}
		for (const name of ["ledger", "reservations"]) {
			await db
				.collection(`${budgetPrefix}${name}`)
				.drop()
				.catch(() => undefined)
		}
		await client.close()
	})

	it("holds one lease at a time and only its holder releases it", async () => {
		const store = createAnswerStore(uri, {
			collectionPrefix: prefix,
			budgetPrefix,
		})
		expect(await store.limits.acquireLease({ visitorId: "v1" })).toBe(true)
		expect(await store.limits.acquireLease({ visitorId: "v2" })).toBe(false)
		// A non-holder's release does nothing.
		await store.limits.releaseLease("v2")
		expect(await store.limits.acquireLease({ visitorId: "v2" })).toBe(false)
		await store.limits.releaseLease("v1")
		expect(await store.limits.acquireLease({ visitorId: "v2" })).toBe(true)
		await store.limits.releaseLease("v2")
	}, 60_000)

	it("keeps one winner across concurrent acquisitions", async () => {
		const store = createAnswerStore(uri, {
			collectionPrefix: prefix,
			budgetPrefix,
		})
		const attempts = await Promise.all([
			store.limits.acquireLease({ visitorId: "a" }),
			store.limits.acquireLease({ visitorId: "b" }),
			store.limits.acquireLease({ visitorId: "c" }),
		])
		expect(attempts.filter((won) => won)).toHaveLength(1)
		await client
			.db("mdbrain_demo_control")
			.collection<{ _id: string }>(`${prefix}lease`)
			.deleteOne({ _id: "active" })
	}, 60_000)

	it("takes over a lease whose holder crashed past the expiry", async () => {
		const store = createAnswerStore(uri, {
			collectionPrefix: prefix,
			budgetPrefix,
		})
		expect(await store.limits.acquireLease({ visitorId: "crashed" })).toBe(true)
		// A crash never releases: the lease only expires on its own.
		await client
			.db("mdbrain_demo_control")
			.collection<{ _id: string; expiresAt: Date }>(`${prefix}lease`)
			.updateOne({ _id: "active" }, { $set: { expiresAt: new Date(0) } })
		expect(await store.limits.acquireLease({ visitorId: "next" })).toBe(true)
		await store.limits.releaseLease("next")
	}, 60_000)

	it("counts questions per visitor, each hour of its own", async () => {
		const store = createAnswerStore(uri, {
			collectionPrefix: prefix,
			budgetPrefix,
		})
		const visitorId = `v-${randomUUID()}`
		for (let i = 1; i <= VISITOR_QUESTIONS_PER_HOUR; i++) {
			expect(await store.limits.countQuestion({ visitorId })).toBe(i)
		}
		expect(await store.limits.countQuestion({ visitorId: "someone" })).toBe(1)
	}, 60_000)

	it("counts the budget against the shared ledger in the control database", async () => {
		const store = createAnswerStore(uri, {
			collectionPrefix: prefix,
			budgetPrefix,
		})
		const key = `answers-test-${randomUUID()}`
		await store.budget.reserve({ key, ceiling: 300, amount: 100 })
		await expect(
			store.budget.reserve({ key, ceiling: 300, amount: 100 }),
		).rejects.toBeInstanceOf(BudgetExhaustedError)
	}, 60_000)
})
