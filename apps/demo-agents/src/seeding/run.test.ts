import { MdbrainClientError } from "@mdbrain/client"
import { describe, expect, it } from "vitest"
import { createRunManifests, type RunManifestDoc } from "./manifest.js"
import { createRunSlotPool, type SlotDoc } from "./pool.js"
import { recordTerminalFailure } from "./run.js"
import { FakeCollection } from "./testing/fakes.js"

const clock = () => new Date("2026-10-20T12:00:00.000Z")

async function seedingRun() {
	const slots = new FakeCollection<SlotDoc>([])
	const manifestDocs = new FakeCollection<RunManifestDoc>([])
	const control = {
		pool: createRunSlotPool(slots, { now: clock }),
		manifests: createRunManifests(manifestDocs, { now: clock }),
	}
	await control.pool.prepare(1)
	await control.pool.claim("run-a")
	await control.manifests.createRun({
		runId: "run-a",
		slotIndex: 1,
		scopeRef: "demo-run-1",
		agentId: "demo-run-1",
		corpus: {
			sha256: "abc123",
			records: 1,
			eventsPlanned: 1,
			pagesPlanned: 1,
			replaySourceIds: [],
		},
		limitSources: undefined,
	})
	return { control, slots, manifestDocs }
}

const refusal = new MdbrainClientError(
	403,
	JSON.stringify({
		error: { code: "FORBIDDEN", message: "scope not granted" },
	}),
)

describe("recordTerminalFailure", () => {
	it("marks the slot and the manifest failed on a terminal failure", async () => {
		const { control, slots, manifestDocs } = await seedingRun()

		await recordTerminalFailure(control, "run-a", refusal)

		expect((await slots.findOne({ _id: "slot:1" }))?.state).toBe("failed")
		expect((await manifestDocs.findOne({ _id: "run-a" }))?.state).toBe("failed")
	})

	it("leaves an uncertain failure seeding so the run can resume", async () => {
		const { control, slots, manifestDocs } = await seedingRun()

		await recordTerminalFailure(control, "run-a", new TypeError("fetch failed"))

		expect((await slots.findOne({ _id: "slot:1" }))?.state).toBe("seeding")
		expect((await manifestDocs.findOne({ _id: "run-a" }))?.state).toBe(
			"seeding",
		)
	})
})
