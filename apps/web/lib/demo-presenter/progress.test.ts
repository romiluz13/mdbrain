import { describe, expect, it } from "vitest"
import { runProgress } from "./progress.js"
import type { RunRequestDoc } from "./run-requests.js"

const NOW = new Date("2026-10-23T12:10:00.000Z")
const request = (over: Partial<RunRequestDoc> = {}): RunRequestDoc => ({
	_id: "run-13",
	slotIndex: 13,
	state: "queued",
	requestedAt: "2026-10-23T12:09:30.000Z",
	requestedBy: "p1",
	...over,
})
const agentRun = (state: "running" | "complete" | "incomplete") => ({
	state,
	startedAt: "2026-10-23T12:09:40.000Z",
})

describe("runProgress", () => {
	it("is idle before a request is made", () => {
		expect(
			runProgress({ request: null, agentRun: undefined, now: NOW }),
		).toMatchObject({
			stage: "idle",
		})
	})

	it("is queued while the runner has not picked the request up, then starting once it has", () => {
		expect(
			runProgress({ request: request(), agentRun: undefined, now: NOW }).stage,
		).toBe("queued")
		const claimed = runProgress({
			request: request({
				state: "claimed",
				claimedAt: "2026-10-23T12:09:35.000Z",
			}),
			agentRun: undefined,
			now: NOW,
		})
		expect(claimed).toMatchObject({ stage: "queued" })
		expect(claimed.label).toContain("starting")
	})

	it("says no runner picked the request up once it waited past the queue age", () => {
		const late = runProgress({
			request: request({ requestedAt: "2026-10-23T12:07:00.000Z" }),
			agentRun: undefined,
			now: NOW,
		})
		expect(late.stage).toBe("no-runner")
		expect(late.label).toContain("runner")
	})

	it("follows the agent run itself once it exists", () => {
		for (const state of ["running", "complete", "incomplete"] as const) {
			expect(
				runProgress({
					request: request({ state: "claimed" }),
					agentRun: agentRun(state),
					now: NOW,
				}).stage,
			).toBe(state)
		}
	})

	it("shows a request the worker failed as failed, with a fixed label and never the stored reason", () => {
		const failed = runProgress({
			request: request({
				state: "failed",
				failureReason: "mongodb+srv://u:p@cluster0.example.net refused",
			}),
			agentRun: undefined,
			now: NOW,
		})
		expect(failed.stage).toBe("failed")
		expect(JSON.stringify(failed)).not.toContain("mongodb")
	})

	it("shows a request that expired in the queue as no runner", () => {
		expect(
			runProgress({
				request: request({
					state: "failed",
					failureReason: "no runner picked the request up in time",
				}),
				agentRun: undefined,
				now: NOW,
			}).stage,
		).toBe("no-runner")
	})

	it("treats a request done with no agent run as failed, not as progress", () => {
		expect(
			runProgress({
				request: request({ state: "done" }),
				agentRun: undefined,
				now: NOW,
			}).stage,
		).toBe("failed")
	})
})
