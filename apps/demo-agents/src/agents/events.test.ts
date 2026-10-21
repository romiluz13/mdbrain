import { describe, expect, it } from "vitest"
import type { MdbrainClient } from "@mdbrain/client"
import { createStepEventRecorder } from "./events.js"
import type { StepEventClient } from "./events.js"
import { delay, fakeAgentClients } from "./testing/fakes.js"

const base = {
	runId: "run-1",
	agentId: "demo-run-1",
	scopeRef: "demo-run-1",
}

function oneClient(
	writeEvent: MdbrainClient["writeEvent"],
): Record<"support" | "account" | "product", StepEventClient> {
	const single = { writeEvent } as unknown as StepEventClient
	return { support: single, account: single, product: single }
}

describe("createStepEventRecorder", () => {
	it("records without blocking and confirms once the writes land", async () => {
		const { clients, writtenEvents } = fakeAgentClients({
			writeEventDelayMs: 60,
		})
		const recorder = createStepEventRecorder({ clients, ...base })
		const before = Date.now()
		recorder.record({
			role: "support",
			name: "step 1",
			detail: "mdbrain_write_event",
		})
		recorder.record({ role: "account", name: "step 2" })
		expect(Date.now() - before).toBeLessThan(30)
		expect(recorder.pendingCount()).toBe(2)
		const outcome = await recorder.confirm(2000)
		expect(outcome).toEqual({ confirmed: 2, failed: [] })
		expect(recorder.pendingCount()).toBe(0)
		const inputs = writtenEvents.map((event) => event.input)
		expect(inputs[0]).toMatchObject({
			role: "assistant",
			agentId: "demo-run-1",
			scope: "workspace",
			scopeRef: "demo-run-1",
			idempotencyKey: "agents:run-1:step:1",
		})
		expect(String(inputs[0]?.body)).toContain("[run-1] Support Lead — step 1")
		expect(inputs[1]?.idempotencyKey).toBe("agents:run-1:step:2")
	})

	it("surfaces a failed write at confirm time, never from record", async () => {
		const failing = oneClient(async () => {
			throw new Error("memongo down")
		})
		const recorder = createStepEventRecorder({ clients: failing, ...base })
		expect(() =>
			recorder.record({ role: "product", name: "step 1" }),
		).not.toThrow()
		const outcome = await recorder.confirm(1000)
		expect(outcome.confirmed).toBe(0)
		expect(outcome.failed).toEqual([{ name: "step 1", error: "memongo down" }])
	})

	it("marks a write that never lands as failed at the deadline", async () => {
		const hanging = oneClient(() => new Promise(() => {}) as never)
		const recorder = createStepEventRecorder({ clients: hanging, ...base })
		recorder.record({ role: "support", name: "step 1" })
		const outcome = await recorder.confirm(25)
		expect(outcome.confirmed).toBe(0)
		expect(outcome.failed[0]).toMatchObject({ name: "step 1" })
		expect(String(outcome.failed[0]?.error)).toMatch(/timeout/)
	})

	it("waits for an in-flight write before confirming", async () => {
		const { clients, writtenEvents } = fakeAgentClients({
			writeEventDelayMs: 80,
		})
		const recorder = createStepEventRecorder({ clients, ...base })
		recorder.record({ role: "support", name: "step 1" })
		await delay(10)
		const outcome = await recorder.confirm(500)
		expect(outcome).toEqual({ confirmed: 1, failed: [] })
		expect(writtenEvents).toHaveLength(1)
	})
})
