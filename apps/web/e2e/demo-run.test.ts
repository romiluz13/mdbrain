// The fixture's run is a stand-in for the control record and for the API's
// cite by id, so it gets its own check: through the real proxy handler it must
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
			run.withStepEvents(upstream.fetch),
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

describe("the fixture's cite by id", () => {
	// The proxy sets the agent; the browser names the marker alone.
	const citeOf = (eventId: string) =>
		`cite?marker=${encodeURIComponent(`[[event:${eventId}]]`)}`

	it("resolves a step's event with no citing claim, and its text names the role and the step", async () => {
		const { read } = served()
		const [first] = (await (await read("run")).json()).agentRun.steps
		const response = await read(citeOf(first.eventId))
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			status: "resolved",
			event: {
				eventId: first.eventId,
				text: expect.stringContaining("Support Lead — read the brain"),
			},
		})
	})

	it("resolves a source file the run wrote with no citing claim", async () => {
		const { read, run } = served()
		const response = await read(citeOf(run.arrivals[0]?.eventId ?? ""))
		expect(response.status).toBe(200)
	})

	it("cannot resolve a step whose event is missed", async () => {
		const { read } = served({ missedSteps: [3] })
		const steps = (await (await read("run")).json()).agentRun.steps
		const response = await read(citeOf(steps[2].eventId))
		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({
			error: { code: "CITATION_UNRESOLVED" },
		})
	})

	it("cannot resolve an event for another agent", async () => {
		const { run } = served()
		const { upstream } = served()
		const eventId = run.arrivals[0]?.eventId ?? ""
		const response = await upstream.fetch(
			`http://upstream.test/v1/cite?marker=${encodeURIComponent(`[[event:${eventId}]]`)}&scope=${FIXTURE_ENV.scope}&scopeRef=${FIXTURE_ENV.scopeRef}&agentId=main`,
			{ headers: { authorization: `Bearer ${FIXTURE_ENV.readKey}` } },
		)
		expect(response.status).toBe(404)
	})
})
