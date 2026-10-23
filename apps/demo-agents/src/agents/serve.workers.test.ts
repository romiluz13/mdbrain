import { describe, expect, it } from "vitest"
import {
	createRunManifests,
	type AgentRunSummaryInput,
	type RunManifestDoc,
} from "../seeding/manifest.js"
import { FakeCollection } from "../seeding/testing/fakes.js"
import { createRunRequests, type RunRequestDoc } from "./run-requests.js"
import { RunNotStartableError } from "./runner.js"
import { serveRunRequests, type ServeDeps } from "./serve.js"

const T0 = new Date("2026-10-23T12:00:00.000Z")
const summary: AgentRunSummaryInput = {
	usage: { uncachedInput: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
	stepsRecorded: 0,
	steps: [],
}

describe("two workers on one run", () => {
	it("lets the second worker's lost start fail its request without ending the first worker's live run", async () => {
		const runs = new FakeCollection<RunManifestDoc>()
		const manifests = createRunManifests(runs, { now: () => T0 })
		await manifests.createRun({
			runId: "run-a",
			slotIndex: 13,
			scopeRef: "demo-run-13",
			agentId: "demo-run-13",
			corpus: {
				sha256: "x",
				records: 1,
				eventsPlanned: 1,
				pagesPlanned: 1,
				replaySourceIds: [],
			},
			limitSources: undefined,
		})
		await manifests.markReady("run-a")
		const queue = new FakeCollection<RunRequestDoc>([
			{
				_id: "run-a",
				slotIndex: 13,
				state: "queued",
				requestedAt: T0.toISOString(),
				requestedBy: "presenter-1",
			},
		])
		const requests = createRunRequests(queue, {
			now: () => T0,
			runDeadlineMs: 335_000,
		})
		const depsFor = (
			workerId: string,
			execute: ServeDeps["execute"],
		): ServeDeps => ({
			requests,
			manifests,
			execute,
			workerId,
			pollMs: 1,
			sleep: async () => undefined,
			once: true,
		})
		// Both workers start the run the way executeAgentRun does: the start is
		// guarded, and a lost start is a typed refusal before any state change.
		const startThenWait =
			(release: Promise<void>): ServeDeps["execute"] =>
			async (request, owner) => {
				if (!(await manifests.markAgentRunStarted(request._id, owner))) {
					throw new RunNotStartableError("not ready to start")
				}
				await release
				await manifests.markAgentRunComplete(request._id, summary, owner)
				return { state: "complete" }
			}

		let finishA: () => void = () => undefined
		const aRuns = serveRunRequests(
			depsFor(
				"worker-a",
				startThenWait(new Promise<void>((resolve) => (finishA = resolve))),
			),
		)
		await Promise.resolve()
		while ((await manifests.get("run-a"))?.agentRun?.state !== "running") {
			await new Promise((resolve) => setTimeout(resolve, 1))
		}

		// The presenter pressed Run again: the request is queued once more and
		// worker B claims it while A's run is live.
		const request = queue.docs.get("run-a")
		queue.docs.set("run-a", { ...request!, state: "queued" })
		await serveRunRequests(
			depsFor("worker-b", async (claimed, owner) => {
				if (!(await manifests.markAgentRunStarted(claimed._id, owner))) {
					throw new RunNotStartableError("not ready to start")
				}
				return { state: "complete" }
			}),
		)
		expect((await manifests.get("run-a"))?.agentRun?.state).toBe("running")

		finishA()
		await aRuns
		expect((await manifests.get("run-a"))?.agentRun?.state).toBe("complete")
	})
})
