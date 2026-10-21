import { describe, expect, it } from "vitest"
import { FakeCollection } from "./testing/fakes.js"
import { createRunManifests, type RunManifestDoc } from "./manifest.js"

const NOW = "2026-10-20T12:00:00.000Z"
const clock = () => new Date(NOW)

function makeStore(seed: RunManifestDoc[] = []) {
	const collection = new FakeCollection<RunManifestDoc>(seed)
	const manifests = createRunManifests(collection, { now: clock })
	return { collection, manifests }
}

const init = {
	runId: "run-a",
	slotIndex: 1,
	scopeRef: "demo-run-1",
	agentId: "demo-run-1",
	corpus: {
		sha256: "abc123",
		records: 571,
		eventsPlanned: 564,
		pagesPlanned: 109,
		replaySourceIds: ["src-pricing-04", "src-drift-10"],
	},
	limitSources: undefined as number | undefined,
}

describe("createRunManifests", () => {
	it("creates the manifest once and rejects a second create", async () => {
		const { manifests } = makeStore()
		const doc = await manifests.createRun(init)
		expect(doc?.state).toBe("seeding")
		expect(doc?.eventsWritten).toEqual([])
		expect(doc?.pagesWritten).toEqual([])
		expect(doc?.createdAt).toBe(NOW)
		const again = await manifests.createRun(init)
		expect(again).toBeNull()
	})

	it("records completed writes in order, with the event id map", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		await manifests.recordEvent("run-a", "src-a", "evt-1")
		await manifests.recordEvent("run-a", "src-b", "evt-2")
		await manifests.recordPage("run-a", "company/alpha")
		const doc = await manifests.get("run-a")
		expect(doc?.eventsWritten).toEqual([
			{ sourceId: "src-a", eventId: "evt-1" },
			{ sourceId: "src-b", eventId: "evt-2" },
		])
		expect(doc?.pagesWritten).toEqual(["company/alpha"])
		expect(doc?.eventIdBySourceId).toEqual({
			"src-a": "evt-1",
			"src-b": "evt-2",
		})
	})

	it("records each write exactly once even if reported twice", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		await manifests.recordEvent("run-a", "src-a", "evt-1")
		await manifests.recordEvent("run-a", "src-a", "evt-1")
		await manifests.recordPage("run-a", "company/alpha")
		await manifests.recordPage("run-a", "company/alpha")
		const doc = await manifests.get("run-a")
		expect(doc?.eventsWritten).toHaveLength(1)
		expect(doc?.pagesWritten).toHaveLength(1)
	})

	it("moves seeding -> ready -> used one-way and never un-does", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		const ready = await manifests.markReady("run-a")
		expect(ready?.state).toBe("ready")
		const used = await manifests.markUsed("run-a")
		expect(used?.state).toBe("used")
		expect(await manifests.markUsed("run-a")).toBeNull()
		expect(await manifests.markReady("run-a")).toBeNull()
	})

	it("marks failure with a reason, terminally", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		const failed = await manifests.markFailed("run-a", "429 exhausted")
		expect(failed?.state).toBe("failed")
		expect(failed?.failureReason).toBe("429 exhausted")
		expect(await manifests.markReady("run-a")).toBeNull()
	})

	it("is an index: the stored doc carries no rendered bodies", async () => {
		const { collection, manifests } = makeStore()
		await manifests.createRun(init)
		await manifests.recordEvent("run-a", "src-a", "evt-1")
		const raw = JSON.stringify([...collection.docs.values()])
		expect(raw).not.toMatch(/"body"/)
		expect(raw).not.toMatch(/"markdown"/)
		expect(raw).not.toMatch(/apiKey|token|secret/i)
	})
})

describe("agent runs", () => {
	const summary = {
		usage: { uncachedInput: 10, cacheRead: 2, cacheWrite: 1, output: 3 },
		stepsRecorded: 9,
		reusedPage: {
			slug: "risks/halvorsen-renewal-support-view",
			writtenBy: "support",
			readBy: "account",
		},
		pendingProposal: {
			title: "Silent ETA drift",
			slug: "syntheses/silent-eta-drift",
		},
	}

	it("marks started -> complete with the outcome summary, one-way", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		await manifests.markReady("run-a")
		const started = await manifests.markAgentRunStarted("run-a")
		expect(started?.agentRun).toEqual({
			state: "running",
			startedAt: NOW,
		})
		expect(await manifests.markAgentRunStarted("run-a")).toBeNull()
		const done = await manifests.markAgentRunComplete("run-a", summary)
		expect(done?.agentRun).toEqual({
			state: "complete",
			startedAt: NOW,
			endedAt: NOW,
			...summary,
		})
		expect(await manifests.markAgentRunComplete("run-a", summary)).toBeNull()
		expect(await manifests.markAgentRunIncomplete("run-a", "late")).toBeNull()
		await manifests.markUsed("run-a")
		const doc = await manifests.get("run-a")
		expect(doc?.state).toBe("used")
		expect(doc?.agentRun?.state).toBe("complete")
	})

	it("marks incomplete with a reason and leaves the slot unconsumed", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		await manifests.markReady("run-a")
		await manifests.markAgentRunStarted("run-a")
		const reason =
			"staging: account could not read risks/halvorsen-renewal-support-view within 5000ms"
		const done = await manifests.markAgentRunIncomplete("run-a", reason)
		expect(done?.agentRun).toMatchObject({
			state: "incomplete",
			failureReason: reason,
		})
		expect(await manifests.markAgentRunComplete("run-a", summary)).toBeNull()
		const doc = await manifests.get("run-a")
		expect(doc?.state).toBe("ready")
	})

	it("starts an agent run on a ready run seeded before agent runs existed", async () => {
		const { collection, manifests } = makeStore()
		await manifests.createRun(init)
		await manifests.markReady("run-a")
		const doc = collection.docs.get("run-a") as Record<string, unknown>
		delete doc.agentRunState

		const started = await manifests.markAgentRunStarted("run-a")

		expect(started?.agentRun?.state).toBe("running")
		expect(await manifests.markAgentRunStarted("run-a")).toBeNull()
	})

	it("refuses to start an agent run outside a ready run", async () => {
		const { manifests } = makeStore()
		await manifests.createRun(init)
		expect(await manifests.markAgentRunStarted("run-a")).toBeNull()
		const failedStore = makeStore()
		await failedStore.manifests.createRun({ ...init, runId: "run-b" })
		await failedStore.manifests.markFailed("run-b", "seeding died")
		expect(await failedStore.manifests.markAgentRunStarted("run-b")).toBeNull()
	})
})
