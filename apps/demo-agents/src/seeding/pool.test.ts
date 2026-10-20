import { describe, expect, it } from "vitest"
import { FakeCollection } from "./testing/fakes.js"
import { createRunSlotPool, PoolExhaustedError, type SlotDoc } from "./pool.js"

const NOW = "2026-10-20T12:00:00.000Z"
const clock = () => new Date(NOW)

function makePool(seed: SlotDoc[] = []) {
	const collection = new FakeCollection<SlotDoc>(seed)
	const pool = createRunSlotPool(collection, { now: clock })
	return { pool, collection }
}

describe("prepare", () => {
	it("creates free slots with the derived naming, idempotently", async () => {
		const { pool } = makePool()
		const slots = await pool.prepare(3)
		expect(
			slots.map((s) => [s._id, s.index, s.scopeRef, s.agentId, s.state]),
		).toEqual([
			["slot:1", 1, "demo-run-1", "demo-run-1", "free"],
			["slot:2", 2, "demo-run-2", "demo-run-2", "free"],
			["slot:3", 3, "demo-run-3", "demo-run-3", "free"],
		])
		const again = await pool.prepare(3)
		expect(again.map((s) => s.state)).toEqual(["free", "free", "free"])
	})

	it("never touches a slot that is not free", async () => {
		const { pool } = makePool([
			{
				_id: "slot:1",
				index: 1,
				scopeRef: "demo-run-1",
				agentId: "demo-run-1",
				state: "seeding",
				runId: "run-a",
				claimedAt: "2026-10-20T11:00:00.000Z",
			},
		])
		await pool.prepare(2)
		const slot = await pool.get(1)
		expect(slot?.state).toBe("seeding")
		expect(slot?.runId).toBe("run-a")
		expect(slot?.claimedAt).toBe("2026-10-20T11:00:00.000Z")
	})
})

describe("claim", () => {
	it("claims the lowest free slot atomically", async () => {
		const { pool } = makePool()
		await pool.prepare(3)
		const { slot, resumed } = await pool.claim("run-a")
		expect(slot.index).toBe(1)
		expect(slot.state).toBe("seeding")
		expect(slot.runId).toBe("run-a")
		expect(slot.claimedAt).toBe(NOW)
		expect(resumed).toBe(false)
	})

	it("gives the next run a different slot", async () => {
		const { pool } = makePool()
		await pool.prepare(2)
		await pool.claim("run-a")
		const { slot } = await pool.claim("run-b")
		expect(slot.index).toBe(2)
		expect(slot.runId).toBe("run-b")
	})

	it("resumes the same run's slot without resetting its claim", async () => {
		const { pool } = makePool()
		await pool.prepare(2)
		const first = await pool.claim("run-a")
		const { slot, resumed } = await pool.claim("run-a")
		expect(resumed).toBe(true)
		expect(slot._id).toBe(first.slot._id)
		expect(slot.claimedAt).toBe(NOW)
		expect(slot.resumeCount ?? 0).toBe(1)
	})

	it("throws PoolExhaustedError when no slot is free", async () => {
		const { pool } = makePool()
		await pool.prepare(1)
		await pool.claim("run-a")
		await expect(pool.claim("run-b")).rejects.toBeInstanceOf(PoolExhaustedError)
	})

	it("surfaces a lost race as PoolExhaustedError", async () => {
		const { pool, collection } = makePool()
		await pool.prepare(1)
		collection.beforeUpdate = (filter) => {
			if (filter.state === "free") {
				// A concurrent claimer wins between the find and the update.
				collection.docs.set("slot:1", {
					_id: "slot:1",
					index: 1,
					scopeRef: "demo-run-1",
					agentId: "demo-run-1",
					state: "seeding",
					runId: "run-other",
					claimedAt: NOW,
				})
			}
		}
		await expect(pool.claim("run-a")).rejects.toBeInstanceOf(PoolExhaustedError)
	})

	it("never re-claims a used or failed slot", async () => {
		const { pool } = makePool()
		await pool.prepare(2)
		const a = await pool.claim("run-a")
		await pool.markReady("run-a")
		await pool.markUsed(a.slot.index)
		const b = await pool.claim("run-b")
		await pool.markFailed("run-b", "api 500")
		await expect(pool.claim("run-c")).rejects.toBeInstanceOf(PoolExhaustedError)
	})
})

describe("lifecycle transitions", () => {
	it("moves seeding -> ready -> used one-way", async () => {
		const { pool } = makePool()
		await pool.prepare(1)
		const { slot } = await pool.claim("run-a")
		const ready = await pool.markReady("run-a")
		expect(ready?.state).toBe("ready")
		expect(ready?.readyAt).toBe(NOW)
		const used = await pool.markUsed(slot.index)
		expect(used?.state).toBe("used")
		expect(used?.usedAt).toBe(NOW)
		expect(await pool.markUsed(slot.index)).toBeNull()
		expect(await pool.markReady("run-a")).toBeNull()
	})

	it("records a failure reason and leaves the slot terminal", async () => {
		const { pool } = makePool()
		await pool.prepare(1)
		await pool.claim("run-a")
		const failed = await pool.markFailed("run-a", "write-event 500")
		expect(failed?.state).toBe("failed")
		expect(failed?.failureReason).toBe("write-event 500")
		expect(await pool.markReady("run-a")).toBeNull()
	})
})
