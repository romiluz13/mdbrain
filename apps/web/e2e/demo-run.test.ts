// The fixture's run is a stand-in for the control record and for governed
// recall, so it gets its own check: through the real proxy handler it must
// serve the shapes the page reads, in every state chapter 4 shows.
import { afterEach, describe, expect, it, vi } from "vitest"
import { arrivalRows, ARRIVALS_PAGE } from "../lib/demo-data/arrivals.js"
import { loadWikiMap } from "../lib/demo-data/loaders.js"
import { handleDemoRead } from "../lib/demo-data/proxy.js"
import { buildSourceIndex } from "../lib/demo-data/views.js"
import type { RunRecord } from "../lib/demo-data/run-record.js"
import {
	createRunFixture,
	FIXTURE_RUN,
	type RunFixtureOptions,
} from "./demo-run.js"
import { createDemoUpstream, FIXTURE_ENV } from "./demo-upstream.js"

afterEach(() => {
	vi.unstubAllGlobals()
})

function served(options: RunFixtureOptions = {}) {
	const upstream = createDemoUpstream()
	const run = createRunFixture(upstream.data, options)
	const read = (path: string) =>
		handleDemoRead(
			new Request(`http://demo.local/api/demo/v1/${path}`),
			FIXTURE_ENV,
			run.withRecall(upstream.fetch),
			run.deps,
		)
	return { read, run, upstream }
}

async function record(options?: RunFixtureOptions): Promise<RunRecord> {
	const response = await served(options).read("run")
	expect(response.status).toBe(200)
	return (await response.json()) as RunRecord
}

describe("the fixture's run record", () => {
	it("lists its arrivals in order, with more planned than written", async () => {
		const body = await record()
		expect(body.arrivals).toHaveLength(36)
		expect(body.eventsPlanned).toBeGreaterThan(body.arrivals.length)
		expect(body.agentRun?.steps).toHaveLength(7)
	})

	it("holds a first page with sources a stored claim cites and sources none does", async () => {
		const { run, upstream } = served()
		vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
			handleDemoRead(
				new Request(String(input), init),
				FIXTURE_ENV,
				upstream.fetch,
			),
		)
		const map = await loadWikiMap({
			apiBaseUrl: "http://demo.local/api/demo",
			readKey: "",
		})
		expect(map.kind).toBe("ready")
		if (map.kind !== "ready") {
			return
		}
		const rows = arrivalRows(
			{ arrivals: run.arrivals } as RunRecord,
			buildSourceIndex(map.data, Number.POSITIVE_INFINITY),
		).slice(0, ARRIVALS_PAGE)
		expect(rows.some((row) => row.citedBy)).toBe(true)
		expect(rows.some((row) => !row.citedBy)).toBe(true)
	})

	it("serves the finished run without steps for a slot that predates them", async () => {
		const body = await record({ variant: "no-steps" })
		expect(body.agentRun?.state).toBe("complete")
		expect(body.agentRun?.steps).toBeUndefined()
	})

	it("serves a seeded run with no agent run", async () => {
		expect((await record({ variant: "none" })).agentRun).toBeUndefined()
	})

	it("serves a running run with no end", async () => {
		const { agentRun } = await record({ variant: "running" })
		expect(agentRun).toMatchObject({ state: "running" })
		expect(agentRun?.endedAt).toBeUndefined()
	})

	it("serves a stopped run with the fixed label and none of its stored reason", async () => {
		const body = await record({ variant: "incomplete" })
		expect(body.agentRun?.incompleteLabel).toBe(
			"The agent run stopped before it finished.",
		)
		const text = JSON.stringify(body)
		for (const private_ of [
			"deadline",
			"mongodb",
			"secret",
			FIXTURE_RUN.runId,
		]) {
			expect(text).not.toContain(private_)
		}
	})

	it("answers not configured when the server has no run env", async () => {
		const response = await served({ variant: "unconfigured" }).read("run")
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({
			error: { code: "RUN_NOT_CONFIGURED" },
		})
	})
})

describe("the fixture's step recall", () => {
	it("confirms a step by its event id and strips the run id from its text", async () => {
		const response = await served().read("run/step?n=2")
		expect(await response.json()).toMatchObject({
			n: 2,
			confirmed: true,
			text: expect.stringMatching(/^Support Lead — write page/),
		})
	})

	it("does not confirm a step whose event recall does not return, though it returns another", async () => {
		const response = await served({ missedSteps: [3] }).read("run/step?n=3")
		expect(await response.json()).toEqual({ n: 3, confirmed: false })
	})

	it("has no such step in a run whose steps were not indexed", async () => {
		const response = await served({ variant: "no-steps" }).read("run/step?n=1")
		expect(response.status).toBe(404)
	})
})
