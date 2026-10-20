import { MdbrainClientError } from "@mdbrain/client"
import { describe, expect, it } from "vitest"
import type { LoadPlan } from "./plan.js"
import { seedSlot } from "./seed.js"
import { FakeCollection, FakeSeedClient } from "./testing/fakes.js"
import { createRunManifests, type RunManifestDoc } from "./manifest.js"

function miniPlan(): LoadPlan {
	return {
		events: [
			{
				sourceId: "src-a",
				idempotencyKey: "seed:demo-run-1:event:src-a",
				timestamp: "2026-09-01T10:00:00.000Z",
				body: "body a",
				role: "user",
				metadata: { seedSourceId: "src-a", seedSourceKind: "doc" },
			},
			{
				sourceId: "src-b",
				idempotencyKey: "seed:demo-run-1:event:src-b",
				timestamp: "2026-09-02T10:00:00.000Z",
				body: "body b",
				role: "user",
				metadata: { seedSourceId: "src-b", seedSourceKind: "doc" },
			},
			{
				sourceId: "src-c",
				idempotencyKey: "seed:demo-run-1:event:src-c",
				timestamp: "2026-09-03T10:00:00.000Z",
				body: "body c",
				role: "user",
				metadata: { seedSourceId: "src-c", seedSourceKind: "doc" },
			},
		],
		pages: [
			{
				slug: "company/alpha",
				idempotencyKey: "seed:demo-run-1:page:company/alpha",
				kind: "entity:company",
				title: "Alpha",
				summary: "Alpha summary",
				body: "Alpha body",
				frontmatter: { type: "company", tags: [] },
				claims: [
					{
						id: "claim-1",
						text: "Alpha ships.",
						confidence: 0.9,
						evidence: [
							{ sourceId: "src-a", note: "note a" },
							{ sourceId: "src-b", note: "note b" },
						],
					},
				],
				relationships: [],
			},
			{
				slug: "concept/model-release",
				idempotencyKey: "seed:demo-run-1:page:concept/model-release",
				kind: "concept:model-release",
				title: "Model release",
				summary: "Release summary",
				body: "Release body",
				frontmatter: { type: "model-release", tags: [] },
				claims: [
					{
						id: "claim-2",
						text: "GA happened.",
						confidence: 0.8,
						evidence: [{ sourceId: "src-c", note: "note c" }],
					},
				],
				relationships: [
					{
						targetPageSlug: "company/alpha",
						targetTitle: "Alpha",
						kind: "released-by",
					},
				],
			},
		],
		heldBackSourceIds: ["src-replay"],
		heldBackPageSlugs: [],
		counts: {
			eventsPlanned: 3,
			pagesPlanned: 2,
			replaySourcesHeldBack: 1,
			pagesHeldBack: 0,
			relationshipsOmitted: 0,
			evidenceRefsPlanned: 3,
		},
	}
}

function makeHarness() {
	const client = new FakeSeedClient()
	const collection = new FakeCollection<RunManifestDoc>()
	const manifests = createRunManifests(collection)
	const pacer = {
		takeCount: 0,
		async take() {
			this.takeCount++
		},
	}
	const seed = (plan: LoadPlan, options: Record<string, unknown> = {}) =>
		seedSlot(plan, {
			client,
			ledger: manifests,
			runId: "run-a",
			agentId: "demo-run-1",
			scopeRef: "demo-run-1",
			manifestInit: {
				slotIndex: 1,
				corpus: {
					sha256: "x",
					records: 0,
					eventsPlanned: plan.counts.eventsPlanned,
					pagesPlanned: plan.counts.pagesPlanned,
					replaySourceIds: plan.heldBackSourceIds,
				},
			},
			pacer,
			sleep: async () => {},
			...options,
		})
	return { client, collection, manifests, pacer, seed }
}

/** One stable label per recorded client call: the page slug, or the event
 * metadata's seed source id. */
function callLabel(call: FakeSeedClient["calls"][number]): string {
	const input = call.input as Record<string, unknown>
	const metadata = input.metadata as Record<string, unknown> | undefined
	return String(input.slug ?? metadata?.seedSourceId ?? "")
}

describe("seedSlot", () => {
	it("writes events with business timestamps, then pages in plan order", async () => {
		const { client, seed } = makeHarness()
		const summary = await seed(miniPlan())
		expect(summary.eventsWritten).toBe(3)
		expect(summary.pagesWritten).toBe(2)
		expect(client.calls.map((c) => [c.op, callLabel(c)])).toEqual([
			["writeEvent", "src-a"],
			["writeEvent", "src-b"],
			["writeEvent", "src-c"],
			["wikiCreate", "company/alpha"],
			["wikiCreate", "concept/model-release"],
		])
		const first = client.calls[0]?.input
		expect(first?.timestamp).toBe("2026-09-01T10:00:00.000Z")
		expect(first?.agentId).toBe("demo-run-1")
		expect(first?.scope).toBe("workspace")
		expect(first?.scopeRef).toBe("demo-run-1")
		expect(first?.idempotencyKey).toBe("seed:demo-run-1:event:src-a")
	})

	it("maps claim evidence to event ids with kind event", async () => {
		const { client, seed } = makeHarness()
		await seed(miniPlan())
		const page = client.calls.find(
			(c) => c.op === "wikiCreate" && c.input.slug === "company/alpha",
		)?.input as Record<string, unknown>
		expect(page.trustTier).toBe("standard")
		expect(page.claims).toEqual([
			{
				id: "claim-1",
				text: "Alpha ships.",
				confidence: 0.9,
				evidence: [
					{ kind: "event", sourceId: "evt-001", note: "note a" },
					{ kind: "event", sourceId: "evt-002", note: "note b" },
				],
			},
		])
		const release = client.calls.find(
			(c) => c.op === "wikiCreate" && c.input.slug === "concept/model-release",
		)?.input as Record<string, unknown>
		expect(release.relationships).toEqual([
			{
				targetPageSlug: "company/alpha",
				targetTitle: "Alpha",
				kind: "released-by",
			},
		])
	})

	it("records every write in the manifest ledger", async () => {
		const { manifests, seed } = makeHarness()
		await seed(miniPlan())
		const doc = await manifests.get("run-a")
		expect(doc?.eventsWritten).toEqual([
			{ sourceId: "src-a", eventId: "evt-001" },
			{ sourceId: "src-b", eventId: "evt-002" },
			{ sourceId: "src-c", eventId: "evt-003" },
		])
		expect(doc?.pagesWritten).toEqual([
			"company/alpha",
			"concept/model-release",
		])
	})

	it("resumes without re-calling recorded writes", async () => {
		const { client, manifests, seed } = makeHarness()
		await manifests.createRun({
			runId: "run-a",
			slotIndex: 1,
			scopeRef: "demo-run-1",
			agentId: "demo-run-1",
			corpus: {
				sha256: "x",
				records: 0,
				eventsPlanned: 3,
				pagesPlanned: 2,
				replaySourceIds: ["src-replay"],
			},
		})
		await manifests.recordEvent("run-a", "src-a", "evt-001")
		await manifests.recordPage("run-a", "company/alpha")
		const summary = await seed(miniPlan())
		expect(summary.eventsWritten).toBe(2)
		expect(summary.pagesWritten).toBe(1)
		const ops = client.calls.map((c) => [c.op, callLabel(c)])
		expect(ops).not.toContain(["writeEvent", "src-a"])
		expect(ops).not.toContain(["wikiCreate", "company/alpha"])
	})

	it("re-plays an unrecorded event under the same idempotency key", async () => {
		const { client, manifests, seed } = makeHarness()
		// The server already stored src-a (crash between write and ledger).
		await client.writeEvent({
			role: "user",
			body: "body a",
			idempotencyKey: "seed:demo-run-1:event:src-a",
			metadata: { seedSourceId: "src-a" },
		})
		await seed(miniPlan())
		const doc = await manifests.get("run-a")
		expect(doc?.eventsWritten[0]).toEqual({
			sourceId: "src-a",
			eventId: "evt-001",
		})
		const attempts = client.calls.filter(
			(c) => c.op === "writeEvent" && callLabel(c) === "src-a",
		)
		expect(attempts).toHaveLength(2)
	})

	it("runs event writes with bounded concurrency and records plan order", async () => {
		const { client, manifests, seed } = makeHarness()
		const tracking = { inFlight: 0, max: 0 }
		const original = client.writeEvent.bind(client)
		client.writeEvent = async (input, requestOptions) => {
			tracking.inFlight++
			tracking.max = Math.max(tracking.max, tracking.inFlight)
			// src-b is the slow write, so completion order is a, c, b.
			const ticks = input.metadata?.seedSourceId === "src-b" ? 3 : 1
			for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0))
			tracking.inFlight--
			return original(input, requestOptions)
		}
		const summary = await seed(miniPlan(), { concurrency: 3 })
		expect(summary.eventsWritten).toBe(3)
		expect(tracking.max).toBeGreaterThan(1)
		expect(tracking.max).toBeLessThanOrEqual(3)
		const doc = await manifests.get("run-a")
		// Event ids are assigned in call order (a, c, b — src-b is the slow
		// write), but the manifest references land in deterministic plan order.
		expect(doc?.eventsWritten).toEqual([
			{ sourceId: "src-a", eventId: "evt-001" },
			{ sourceId: "src-b", eventId: "evt-003" },
			{ sourceId: "src-c", eventId: "evt-002" },
		])
	})
	it("reconciles an unrecorded page on 409 DUPLICATE_SLUG", async () => {
		const { client, manifests, seed } = makeHarness()
		await client.wikiCreate({ slug: "company/alpha" })
		const summary = await seed(miniPlan())
		expect(summary.pagesWritten).toBe(1)
		const doc = await manifests.get("run-a")
		expect(doc?.pagesWritten).toEqual([
			"company/alpha",
			"concept/model-release",
		])
		expect(
			client.calls.some(
				(c) => c.op === "wikiGet" && c.input.slug === "company/alpha",
			),
		).toBe(true)
	})

	it("retries a retryable 429 and then succeeds", async () => {
		const { client, seed } = makeHarness()
		client.script.push({
			op: "writeEvent",
			error: new MdbrainClientError(
				429,
				JSON.stringify({
					error: {
						code: "RATE_LIMITED",
						message: "slow down",
						retryable: true,
						retryAfterMs: 1,
					},
				}),
			),
		})
		const summary = await seed(miniPlan())
		expect(summary.eventsWritten).toBe(3)
		expect(
			client.calls.filter(
				(c) => c.op === "writeEvent" && callLabel(c) === "src-a",
			),
		).toHaveLength(2)
	})

	it("fails closed on a non-retryable error, keeping ledger progress", async () => {
		const { client, manifests, seed } = makeHarness()
		client.script.push({
			op: "writeEvent",
			error: new MdbrainClientError(
				400,
				JSON.stringify({ error: { code: "VALIDATION", message: "bad body" } }),
			),
		})
		await expect(seed(miniPlan())).rejects.toBeInstanceOf(MdbrainClientError)
		const doc = await manifests.get("run-a")
		// Fail-closed leaves a consistent, resumable ledger: manifest exists,
		// still seeding, no phantom writes recorded.
		expect(doc?.state).toBe("seeding")
		expect(doc?.eventsWritten).toEqual([])
		expect(doc?.pagesWritten).toEqual([])
	})

	it("paces one slot per client attempt", async () => {
		const { client, pacer, seed } = makeHarness()
		client.script.push({
			op: "writeEvent",
			error: new MdbrainClientError(
				429,
				JSON.stringify({
					error: { code: "RATE_LIMITED", message: "x", retryable: true },
				}),
			),
		})
		await seed(miniPlan())
		// 3 events + 1 retry + 2 pages = 6 paced attempts.
		expect(pacer.takeCount).toBe(6)
	})

	it("fails closed when a page cites an event the plan never wrote", async () => {
		const { seed } = makeHarness()
		const plan = miniPlan()
		plan.pages[1]!.claims[0]!.evidence = [{ sourceId: "src-replay", note: "n" }]
		await expect(seed(plan)).rejects.toThrow(/src-replay/)
	})
})
