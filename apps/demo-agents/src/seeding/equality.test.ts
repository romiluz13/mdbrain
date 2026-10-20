import { describe, expect, it } from "vitest"
import type { MdbrainWikiPageView } from "@mdbrain/client"
import { compareRunSlots, type RunSlotRef } from "./equality.js"
import type { RunManifestDoc } from "./manifest.js"

function manifest(overrides: Partial<RunManifestDoc> = {}): RunManifestDoc {
	return {
		_id: "run-a",
		runId: "run-a",
		slotIndex: 1,
		scopeRef: "demo-run-1",
		agentId: "demo-run-1",
		state: "ready",
		corpus: {
			sha256: "abc",
			records: 571,
			eventsPlanned: 564,
			pagesPlanned: 109,
			replaySourceIds: ["src-pricing-04"],
		},
		limitSources: null,
		eventsWritten: [
			{ sourceId: "src-a", eventId: "evt-A1" },
			{ sourceId: "src-b", eventId: "evt-A2" },
		],
		pagesWritten: ["company/alpha"],
		createdAt: "2026-10-20T10:00:00.000Z",
		updatedAt: "2026-10-20T10:05:00.000Z",
		...overrides,
	}
}

function pageView(
	overrides: Record<string, unknown> = {},
): MdbrainWikiPageView {
	return {
		_id: "66f0a",
		kind: "entity:company",
		title: "Alpha",
		slug: "company/alpha",
		aliases: [],
		summary: "Alpha summary",
		body: "Alpha body",
		frontmatter: { type: "company", tags: [] },
		claims: [
			{
				id: "claim-1",
				text: "Alpha ships.",
				status: "active",
				confidence: 0.9,
				marker: "[[wiki:company/alpha#claim-1@r1]]",
				evidence: [
					{
						kind: "event",
						sourceId: "evt-A1",
						note: "note a",
						marker: "[[event:evt-A1]]",
					},
				],
				derivedFrom: [],
			},
		],
		contradictions: [],
		questions: [],
		relationships: [{ targetPageSlug: "x", targetTitle: "X", kind: "k" }],
		personCard: null,
		scope: "workspace",
		scopeRef: "demo-run-1",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 1,
		validFrom: "2026-10-20T10:00:01.000Z",
		freshness: "fresh",
		backlinks: [],
		transcludes: [],
		createdAt: "2026-10-20T10:00:01.000Z",
		updatedAt: "2026-10-20T10:00:01.000Z",
		...overrides,
	} as MdbrainWikiPageView
}

function makeReader(pages: Record<string, MdbrainWikiPageView>) {
	return {
		async wikiGet(input: { slug: string; scopeRef: string }) {
			const page = pages[`${input.scopeRef}:${input.slug}`]
			if (!page) throw new Error(`no page ${input.slug} in ${input.scopeRef}`)
			return page
		},
	}
}

describe("compareRunSlots", () => {
	it("equal slots: only unstable fields differ", async () => {
		const slots: [RunSlotRef, RunSlotRef] = [
			{ scopeRef: "demo-run-1", manifest: manifest() },
			{
				scopeRef: "demo-run-2",
				manifest: manifest({
					_id: "run-b",
					runId: "run-b",
					slotIndex: 2,
					scopeRef: "demo-run-2",
					eventsWritten: [
						{ sourceId: "src-a", eventId: "evt-B1" },
						{ sourceId: "src-b", eventId: "evt-B2" },
					],
				}),
			},
		]
		const reader = makeReader({
			"demo-run-1:company/alpha": pageView(),
			"demo-run-2:company/alpha": pageView({
				_id: "66f0b",
				createdAt: "2026-10-21T10:00:01.000Z",
				updatedAt: "2026-10-21T10:00:01.000Z",
				validFrom: "2026-10-21T10:00:01.000Z",
				claims: [
					{
						id: "claim-1",
						text: "Alpha ships.",
						status: "active",
						confidence: 0.9,
						marker: "[[wiki:company/alpha#claim-1@r1]]",
						evidence: [
							{
								kind: "event",
								sourceId: "evt-B1",
								note: "note a",
								marker: "[[event:evt-B1]]",
							},
						],
						derivedFrom: [],
					},
				],
			}),
		})
		const report = await compareRunSlots({ reader, slots })
		expect(report.equal).toBe(true)
		expect(report.differences).toEqual([])
		expect(report.pagesCompared).toBe(1)
	})

	it("flags a stable difference with its path", async () => {
		const slots: [RunSlotRef, RunSlotRef] = [
			{ scopeRef: "demo-run-1", manifest: manifest() },
			{
				scopeRef: "demo-run-2",
				manifest: manifest({ _id: "run-b", runId: "run-b" }),
			},
		]
		const reader = makeReader({
			"demo-run-1:company/alpha": pageView(),
			"demo-run-2:company/alpha": pageView({ summary: "Different summary" }),
		})
		const report = await compareRunSlots({ reader, slots })
		expect(report.equal).toBe(false)
		expect(report.differences.map((d) => d.path)).toContain(
			"company/alpha.summary",
		)
	})

	it("flags divergent manifest boundaries and page lists", async () => {
		const slots: [RunSlotRef, RunSlotRef] = [
			{ scopeRef: "demo-run-1", manifest: manifest() },
			{
				scopeRef: "demo-run-2",
				manifest: manifest({
					_id: "run-b",
					runId: "run-b",
					pagesWritten: ["company/alpha", "concept/extra"],
					eventsWritten: [{ sourceId: "src-a", eventId: "evt-B1" }],
				}),
			},
		]
		const report = await compareRunSlots({ reader: makeReader({}), slots })
		expect(report.equal).toBe(false)
		expect(report.differences.map((d) => d.path)).toEqual(
			expect.arrayContaining([
				"manifest.eventsWritten",
				"manifest.pagesWritten",
			]),
		)
	})

	it("flags evidence whose event id neither manifest maps", async () => {
		const slots: [RunSlotRef, RunSlotRef] = [
			{ scopeRef: "demo-run-1", manifest: manifest() },
			{
				scopeRef: "demo-run-2",
				manifest: manifest({ _id: "run-b", runId: "run-b" }),
			},
		]
		const reader = makeReader({
			"demo-run-1:company/alpha": pageView(),
			"demo-run-2:company/alpha": pageView({
				claims: [
					{
						id: "claim-1",
						text: "Alpha ships.",
						status: "active",
						confidence: 0.9,
						evidence: [
							{ kind: "event", sourceId: "evt-UNMAPPED", note: "note a" },
						],
						derivedFrom: [],
					},
				],
			}),
		})
		const report = await compareRunSlots({ reader, slots })
		expect(report.equal).toBe(false)
		expect(report.differences.map((d) => d.path)).toContain(
			"company/alpha.claims[0].evidence[0].sourceId",
		)
	})

	it("compares every page in both slots, paced per read", async () => {
		const slots: [RunSlotRef, RunSlotRef] = [
			{
				scopeRef: "demo-run-1",
				manifest: manifest({ pagesWritten: ["company/alpha", "concept/beta"] }),
			},
			{
				scopeRef: "demo-run-2",
				manifest: manifest({
					_id: "run-b",
					runId: "run-b",
					pagesWritten: ["company/alpha", "concept/beta"],
				}),
			},
		]
		const beta = pageView({ slug: "concept/beta", kind: "concept:concepts" })
		const reader = makeReader({
			"demo-run-1:company/alpha": pageView(),
			"demo-run-2:company/alpha": pageView(),
			"demo-run-1:concept/beta": beta,
			"demo-run-2:concept/beta": pageView({
				slug: "concept/beta",
				kind: "concept:concepts",
			}),
		})
		const pacer = {
			takeCount: 0,
			async take() {
				this.takeCount++
			},
		}
		const report = await compareRunSlots({ reader, slots, retry: { pacer } })
		expect(report.equal).toBe(true)
		expect(report.pagesCompared).toBe(2)
		expect(pacer.takeCount).toBe(4)
	})
})
