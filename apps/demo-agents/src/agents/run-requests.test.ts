import { describe, expect, it } from "vitest"
import { FakeCollection } from "../seeding/testing/fakes.js"
import { createRunRequests, type RunRequestDoc } from "./run-requests.js"

const T0 = new Date("2026-10-23T12:00:00.000Z")
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString()

function request(
	runId: string,
	over: Partial<RunRequestDoc> = {},
): RunRequestDoc {
	return {
		_id: runId,
		slotIndex: 13,
		state: "queued",
		requestedAt: at(0),
		requestedBy: "presenter-1",
		...over,
	}
}

function rig(docs: RunRequestDoc[] = [], clockMs = 0) {
	const store = new FakeCollection<RunRequestDoc>(docs)
	let clock = clockMs
	const requests = createRunRequests(store, {
		now: () => new Date(T0.getTime() + clock),
		maxQueueAgeMs: 120_000,
		runDeadlineMs: 335_000,
	})
	return {
		store,
		requests,
		tick: (ms: number) => {
			clock += ms
		},
	}
}

describe("run requests: claim", () => {
	it("claims the oldest queued request for one worker", async () => {
		const { requests, store } = rig([
			request("run-b", { requestedAt: at(2000) }),
			request("run-a", { requestedAt: at(1000) }),
		])
		const claimed = await requests.claimNext("worker-1")
		expect(claimed).toMatchObject({
			_id: "run-a",
			state: "claimed",
			workerId: "worker-1",
		})
		expect(claimed?.claimedAt).toBe(at(0))
		expect(store.docs.get("run-b")?.state).toBe("queued")
	})

	it("lets exactly one of two workers claim a request", async () => {
		const { requests } = rig([request("run-a")])
		const results = await Promise.all([
			requests.claimNext("worker-1"),
			requests.claimNext("worker-2"),
		])
		expect(results.filter((claimed) => claimed !== null)).toHaveLength(1)
	})

	it("returns null when nothing is queued and never re-claims a claimed, done or failed request", async () => {
		const { requests } = rig([
			request("run-a", { state: "claimed", workerId: "w" }),
			request("run-b", { state: "done" }),
			request("run-c", { state: "failed", failureReason: "x" }),
		])
		expect(await requests.claimNext("worker-1")).toBeNull()
	})

	it("does not claim a request that waited longer than the queue allows", async () => {
		const { requests, tick } = rig([request("run-a")])
		tick(120_001)
		expect(await requests.claimNext("worker-1")).toBeNull()
	})
})

describe("run requests: expire, finish, overdue", () => {
	it("marks a request nobody picked up in time failed, with a plain reason", async () => {
		const { requests, store, tick } = rig([request("run-a"), request("run-b")])
		tick(120_001)
		const expired = await requests.expireStale()
		expect(expired.map((doc) => doc._id).sort()).toEqual(["run-a", "run-b"])
		expect(store.docs.get("run-a")).toMatchObject({
			state: "failed",
			failureReason: "no runner picked the request up in time",
		})
	})

	it("leaves a fresh queued request alone when it expires the stale ones", async () => {
		const { requests, store, tick } = rig([request("run-a")])
		tick(60_000)
		expect(await requests.expireStale()).toEqual([])
		expect(store.docs.get("run-a")?.state).toBe("queued")
	})

	it("finishes a claimed request as done or failed and ignores one that is not claimed", async () => {
		const { requests, store } = rig([
			request("run-a", { state: "claimed", workerId: "w", claimedAt: at(0) }),
			request("run-b"),
		])
		expect(await requests.finish("run-a", { state: "done" })).toBe(true)
		expect(store.docs.get("run-a")).toMatchObject({
			state: "done",
			finishedAt: at(0),
		})
		expect(await requests.finish("run-b", { state: "done" })).toBe(false)
		expect(store.docs.get("run-b")?.state).toBe("queued")
		const failing = rig([
			request("run-c", { state: "claimed", workerId: "w", claimedAt: at(0) }),
		])
		await failing.requests.finish("run-c", { state: "failed", reason: "boom" })
		expect(failing.store.docs.get("run-c")).toMatchObject({
			state: "failed",
			failureReason: "boom",
		})
	})

	it("lists claimed requests that passed the run deadline", async () => {
		const { requests, tick } = rig([
			request("run-a", { state: "claimed", workerId: "w", claimedAt: at(0) }),
			request("run-b", {
				state: "claimed",
				workerId: "w",
				claimedAt: at(300_000),
			}),
		])
		tick(335_001)
		expect((await requests.overdue()).map((doc) => doc._id)).toEqual(["run-a"])
	})
})
