import { describe, expect, it } from "vitest"
import type { LeaseManifest } from "./lease.js"
import { createPinService, type PinDoc } from "./pin.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const NOW = new Date("2026-10-23T12:00:00.000Z")
const manifest = (runId: string, agentRunState: string): LeaseManifest => ({
	runId,
	slotIndex: 13,
	scopeRef: "demo-run-13",
	agentId: "demo-run-13",
	state: "used",
	eventsPlanned: 1,
	pagesPlanned: 1,
	eventsWritten: 1,
	pagesWritten: 1,
	hasAgentRun: true,
	agentRunState,
})

function rig(runs: LeaseManifest[], readable = (_: LeaseManifest) => true) {
	const pins = new MemoryCollection<PinDoc>()
	return {
		pins,
		service: createPinService({
			pins,
			manifests: {
				get: async (runId) => runs.find((run) => run.runId === runId) ?? null,
			},
			readable,
			now: () => NOW,
		}),
	}
}

describe("pin", () => {
	it("has no pin until a presenter makes one", async () => {
		expect(await rig([]).service.get()).toBeNull()
	})

	it("pins a completed run for public mode and records who and when", async () => {
		const { service } = rig([manifest("run-13", "complete")])
		expect(await service.pin("run-13", "presenter-1")).toEqual({
			_id: "public",
			runId: "run-13",
			pinnedAt: NOW.toISOString(),
			pinnedBy: "presenter-1",
		})
		expect((await service.get())?.runId).toBe("run-13")
	})

	it("replaces the earlier pin", async () => {
		const { service, pins } = rig([
			manifest("run-12", "complete"),
			manifest("run-13", "complete"),
		])
		await service.pin("run-12", "p1")
		await service.pin("run-13", "p1")
		expect(pins.docs.size).toBe(1)
		expect((await service.get())?.runId).toBe("run-13")
	})

	it("never pins a run that is running, incomplete, never started or unknown, and keeps the earlier pin", async () => {
		const { service } = rig([
			manifest("run-12", "complete"),
			manifest("run-13", "running"),
			manifest("run-14", "incomplete"),
			manifest("run-15", ""),
		])
		await service.pin("run-12", "p1")
		for (const runId of ["run-13", "run-14", "run-15", "run-99"]) {
			await expect(service.pin(runId, "p1")).rejects.toMatchObject({
				code: runId === "run-99" ? "RUN_NOT_FOUND" : "RUN_NOT_COMPLETE",
			})
		}
		expect((await service.get())?.runId).toBe("run-12")
	})

	it("never pins a run whose slot the server cannot read, and keeps the earlier pin", async () => {
		const { service } = rig(
			[manifest("run-12", "complete"), manifest("run-13", "complete")],
			(run) => run.runId !== "run-13",
		)
		await service.pin("run-12", "p1")
		await expect(service.pin("run-13", "p1")).rejects.toMatchObject({
			code: "RUN_NOT_READABLE",
		})
		expect((await service.get())?.runId).toBe("run-12")
	})
})
