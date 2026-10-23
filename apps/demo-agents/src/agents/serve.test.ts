import { describe, expect, it } from "vitest"
import { FakeCollection } from "../seeding/testing/fakes.js"
import { createRunRequests, type RunRequestDoc } from "./run-requests.js"
import { RunNotStartableError } from "./runner.js"
import { serveRunRequests, type ServeDeps } from "./serve.js"

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

function rig(
	docs: RunRequestDoc[],
	execute: ServeDeps["execute"],
	options: { clockMs?: number } = {},
) {
	const store = new FakeCollection<RunRequestDoc>(docs)
	const clock = { ms: options.clockMs ?? 0 }
	const incomplete: Array<{ runId: string; reason: string; owner?: string }> =
		[]
	const sleeps: number[] = []
	const controller = new AbortController()
	const deps: ServeDeps = {
		requests: createRunRequests(store, {
			now: () => new Date(T0.getTime() + clock.ms),
			maxQueueAgeMs: 120_000,
			runDeadlineMs: 335_000,
		}),
		manifests: {
			markAgentRunIncomplete: async (runId, reason, owner) => {
				incomplete.push({ runId, reason, ...(owner ? { owner } : {}) })
				return null
			},
		},
		execute,
		workerId: "worker-1",
		pollMs: 1000,
		sleep: async (ms) => {
			sleeps.push(ms)
			if (sleeps.length >= 2) controller.abort()
		},
		signal: controller.signal,
		log: () => {},
	}
	return { store, deps, incomplete, sleeps, clock, controller }
}

describe("serveRunRequests", () => {
	it("runs each queued request once, oldest first, and finishes it", async () => {
		const ran: string[] = []
		const { store, deps } = rig(
			[
				request("run-b", { requestedAt: at(2000) }),
				request("run-a", { requestedAt: at(1000) }),
			],
			async (req) => {
				ran.push(req._id)
				return { state: "complete" }
			},
			{ clockMs: 3000 },
		)
		await serveRunRequests({ ...deps, once: true })
		expect(ran).toEqual(["run-a", "run-b"])
		expect(store.docs.get("run-a")?.state).toBe("done")
		expect(store.docs.get("run-b")?.state).toBe("done")
	})

	it("records an incomplete run as a failed request with the run's own reason", async () => {
		const { store, deps } = rig([request("run-a")], async () => ({
			state: "incomplete",
			failureReason: "budget: the run ceiling was reached",
		}))
		await serveRunRequests({ ...deps, once: true })
		expect(store.docs.get("run-a")).toMatchObject({
			state: "failed",
			failureReason: "budget: the run ceiling was reached",
		})
	})

	it("fails the request, ends the run and keeps serving when the run throws", async () => {
		const ran: string[] = []
		const { store, deps, incomplete } = rig(
			[
				request("run-a", { requestedAt: at(1) }),
				request("run-b", { requestedAt: at(2) }),
			],
			async (req) => {
				ran.push(req._id)
				if (req._id === "run-a") throw new Error("the control store went away")
				return { state: "complete" }
			},
			{ clockMs: 10 },
		)
		await serveRunRequests({ ...deps, once: true })
		expect(ran).toEqual(["run-a", "run-b"])
		expect(store.docs.get("run-a")).toMatchObject({
			state: "failed",
			failureReason: "the control store went away",
		})
		expect(incomplete).toEqual([
			{
				runId: "run-a",
				reason: "the control store went away",
				owner: `worker-1@${at(10)}`,
			},
		])
		expect(store.docs.get("run-b")?.state).toBe("done")
	})

	it("fails a request nobody picked up in time instead of running it late", async () => {
		const ran: string[] = []
		const { store, deps } = rig(
			[request("run-a")],
			async (req) => {
				ran.push(req._id)
				return { state: "complete" }
			},
			{ clockMs: 120_001 },
		)
		await serveRunRequests({ ...deps, once: true })
		expect(ran).toEqual([])
		expect(store.docs.get("run-a")).toMatchObject({
			state: "failed",
			failureReason: "no runner picked the request up in time",
		})
	})

	it("ends a run that stayed claimed past the run deadline", async () => {
		const { store, deps, incomplete } = rig(
			[
				request("run-a", {
					state: "claimed",
					workerId: "gone",
					claimedAt: at(0),
				}),
			],
			async () => ({ state: "complete" }),
			{ clockMs: 335_001 },
		)
		await serveRunRequests({ ...deps, once: true })
		expect(incomplete).toHaveLength(1)
		expect(incomplete[0]).toMatchObject({ runId: "run-a" })
		expect(incomplete[0]?.reason).toContain("run deadline")
		expect(store.docs.get("run-a")).toMatchObject({ state: "failed" })
	})

	it("waits between polls when the queue is empty and stops when told to", async () => {
		const { deps, sleeps } = rig([], async () => ({ state: "complete" }))
		await serveRunRequests(deps)
		expect(sleeps).toEqual([1000, 1000])
	})
	it("fails a request whose run could not start without touching the run", async () => {
		const { store, deps, incomplete } = rig(
			[request("run-a")],
			async () => {
				throw new RunNotStartableError(
					"run run-a's agent run is already running",
				)
			},
			{ clockMs: 10 },
		)
		await serveRunRequests({ ...deps, once: true })
		expect(incomplete).toEqual([])
		expect(store.docs.get("run-a")).toMatchObject({
			state: "failed",
			failureReason: "run run-a's agent run is already running",
		})
	})

	it("hands execute the owner it must start the run with", async () => {
		const owners: Array<string | undefined> = []
		const { deps } = rig(
			[request("run-a")],
			async (_request, owner) => {
				owners.push(owner)
				return { state: "complete" }
			},
			{ clockMs: 10 },
		)
		await serveRunRequests({ ...deps, once: true })
		expect(owners).toEqual([`worker-1@${at(10)}`])
	})
})
