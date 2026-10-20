import { describe, expect, it } from "vitest"
import type { PageSpec, RenderedRecord, World } from "../corpus/types.js"
import { readRecords, readWorld } from "../corpus/corpus-files.js"
import { buildLoadPlan } from "./plan.js"

const SCOPE_REF = "demo-run-1"

function record(id: string, body: string): RenderedRecord {
	return {
		id,
		body,
		model: "test-model",
		finishReason: "stop",
		renderedAt: "2026-10-01T00:00:00.000Z",
	}
}

function page(slug: string, overrides: Partial<PageSpec> = {}): PageSpec {
	return {
		slug,
		kind: "entity",
		type: "company",
		title: `Title ${slug}`,
		summary: `Summary ${slug}`,
		body: `Body ${slug}.`,
		tags: ["demo"],
		claims: [],
		relationships: [],
		...overrides,
	}
}

function miniWorld(): World {
	return {
		seed: 1,
		company: { name: "Northstar", summary: "s" },
		products: [],
		people: [],
		accounts: [],
		storylines: [],
		contradiction: {
			targetPageSlug: "a",
			targetClaimId: "c1",
			incoming: page("z"),
		},
		sources: [
			{
				id: "src-b",
				kind: "slack_thread",
				title: "b",
				date: "2026-07-02T00:00:00.000Z",
				authorId: "p1",
				participantIds: ["p1"],
				productIds: [],
				phase: "history",
				brief: "b",
				facts: [],
				length: "short",
			},
			{
				id: "src-a",
				kind: "doc",
				title: "a",
				date: "2026-07-01T00:00:00.000Z",
				authorId: "p1",
				participantIds: ["p1"],
				productIds: [],
				phase: "history",
				brief: "a",
				facts: [],
				length: "short",
			},
			{
				id: "src-c",
				kind: "doc",
				title: "c",
				date: "2026-07-02T00:00:00.000Z",
				authorId: "p1",
				participantIds: ["p1"],
				productIds: [],
				phase: "history",
				brief: "c",
				facts: [],
				length: "short",
			},
			{
				id: "src-r",
				kind: "doc",
				title: "r",
				date: "2026-08-01T00:00:00.000Z",
				authorId: "p1",
				participantIds: ["p1"],
				productIds: [],
				phase: "replay",
				brief: "r",
				facts: [],
				length: "short",
			},
		],
		pages: [
			// beta cites alpha, so alpha must be seeded first
			page("company/beta", {
				relationships: [
					{ targetPageSlug: "company/alpha", kind: "subsidiary-of" },
				],
			}),
			page("company/alpha"),
		],
	}
}

describe("buildLoadPlan (mini world)", () => {
	it("orders events by business date then id and holds replay sources back", () => {
		const world = miniWorld()
		const records = new Map([
			["src-b", record("src-b", "b body")],
			["src-a", record("src-a", "a body")],
			["src-c", record("src-c", "c body")],
			["src-r", record("src-r", "r body")],
		])
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		expect(plan.events.map((e) => e.sourceId)).toEqual([
			"src-a",
			"src-b",
			"src-c",
		])
		expect(plan.heldBackSourceIds).toEqual(["src-r"])
		expect(plan.events[0]).toMatchObject({
			idempotencyKey: `seed:${SCOPE_REF}:event:src-a`,
			timestamp: "2026-07-01T00:00:00.000Z",
			body: "a body",
			role: "user",
		})
	})

	it("orders pages topologically (relationship targets first)", () => {
		const world = miniWorld()
		const records = new Map(
			world.sources.map((s) => [s.id, record(s.id, `${s.id} body`)]),
		)
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		expect(plan.pages.map((p) => p.slug)).toEqual([
			"company/alpha",
			"company/beta",
		])
		expect(plan.pages[1]?.relationships[0]).toMatchObject({
			targetPageSlug: "company/alpha",
			targetTitle: "Title company/alpha",
			kind: "subsidiary-of",
		})
		expect(plan.pages[0]?.idempotencyKey).toBe(
			`seed:${SCOPE_REF}:page:company/alpha`,
		)
	})

	it("breaks relationship cycles deterministically by slug instead of throwing", () => {
		const world = miniWorld()
		world.pages = [
			page("company/beta", {
				relationships: [
					{ targetPageSlug: "company/alpha", kind: "relates-to" },
				],
			}),
			page("company/alpha", {
				relationships: [{ targetPageSlug: "company/beta", kind: "relates-to" }],
			}),
		]
		const records = new Map(
			world.sources.map((s) => [s.id, record(s.id, `${s.id} body`)]),
		)
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		expect(plan.pages.map((p) => p.slug)).toEqual([
			"company/alpha",
			"company/beta",
		])
	})

	it("keeps business facts as event metadata and claim notes as excerpts", () => {
		const world = miniWorld()
		world.pages = [
			page("company/alpha", {
				claims: [
					{
						id: "cl-1",
						text: "Claim one.",
						confidence: 0.9,
						evidence: [{ sourceId: "src-a", anchor: "a body" }],
					},
				],
			}),
		]
		const records = new Map(
			world.sources.map((s) => [
				s.id,
				record(s.id, s.id + " body with detail."),
			]),
		)
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		expect(plan.events[0]?.metadata).toMatchObject({
			seedSourceId: "src-a",
			seedSourceKind: "doc",
		})
		expect(plan.pages[0]?.claims[0]?.evidence[0]).toEqual({
			sourceId: "src-a",
			note: "src-a body with detail.",
		})
		expect(plan.pages[0]?.frontmatter).toEqual({
			type: "company",
			tags: ["demo"],
		})
	})

	it("holds back pages whose evidence cites unavailable sources, and omits their relationships", () => {
		const world = miniWorld()
		world.pages = [
			page("company/alpha", {
				relationships: [{ targetPageSlug: "company/beta", kind: "relates-to" }],
			}),
			page("company/beta", {
				claims: [
					{
						id: "cl-2",
						text: " cites replay.",
						confidence: 0.8,
						evidence: [{ sourceId: "src-r", anchor: "r body" }],
					},
				],
			}),
		]
		const records = new Map(
			world.sources.map((s) => [s.id, record(s.id, `${s.id} body`)]),
		)
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		expect(plan.pages.map((p) => p.slug)).toEqual(["company/alpha"])
		expect(plan.heldBackPageSlugs).toEqual(["company/beta"])
		expect(plan.counts).toMatchObject({
			eventsPlanned: 3,
			pagesPlanned: 1,
			replaySourcesHeldBack: 1,
			pagesHeldBack: 1,
			relationshipsOmitted: 1,
		})
	})

	it("applies limitSources as a deterministic timeline prefix", () => {
		const world = miniWorld()
		const records = new Map(
			world.sources.map((s) => [s.id, record(s.id, `${s.id} body`)]),
		)
		const plan = buildLoadPlan(world, records, {
			scopeRef: SCOPE_REF,
			limitSources: 2,
		})
		expect(plan.events.map((e) => e.sourceId)).toEqual(["src-a", "src-b"])
	})

	it("fails closed when a history source has no rendered record", () => {
		const world = miniWorld()
		const records = new Map([
			["src-a", record("src-a", "a body")],
			["src-c", record("src-c", "c body")],
		])
		expect(() =>
			buildLoadPlan(world, records, { scopeRef: SCOPE_REF }),
		).toThrow(/src-b/)
	})

	it("fails closed when a relationship targets a slug absent from the world", () => {
		const world = miniWorld()
		world.pages = [
			page("company/alpha", {
				relationships: [
					{ targetPageSlug: "company/ghost", kind: "relates-to" },
				],
			}),
		]
		const records = new Map(
			world.sources.map((s) => [s.id, record(s.id, `${s.id} body`)]),
		)
		expect(() =>
			buildLoadPlan(world, records, { scopeRef: SCOPE_REF }),
		).toThrow(/company\/ghost/)
	})

	it("is deterministic across builds", () => {
		const world = miniWorld()
		const records = new Map(
			world.sources.map((s) => [s.id, record(s.id, `${s.id} body`)]),
		)
		const a = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		const b = buildLoadPlan(world, new Map(records), { scopeRef: SCOPE_REF })
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
	})
})

describe("buildLoadPlan (committed northstar corpus)", () => {
	const world = readWorld()
	const records = readRecords()

	it("plans exactly the history events and holds back the replay phase", () => {
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		expect(plan.counts.eventsPlanned).toBe(564)
		expect(plan.counts.replaySourcesHeldBack).toBe(7)
		// The contradiction's incoming page lives at world.contradiction.incoming
		// (replay phase), not in world.pages, so every world page plans; the one
		// relationship that points at the incoming page is omitted until it exists.
		expect(plan.counts.pagesPlanned).toBe(109)
		expect(plan.heldBackPageSlugs).toEqual([])
		expect(plan.counts.relationshipsOmitted).toBe(0)
	})

	it("places every relationship target earlier, except inside mutual cycles", () => {
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		const position = new Map(plan.pages.map((p, i) => [p.slug, i]))
		const bySlug = new Map(world.pages.map((spec) => [spec.slug, spec]))
		const forward: string[] = []
		for (const page of plan.pages) {
			for (const rel of page.relationships) {
				const at = position.get(rel.targetPageSlug)
				expect(at).toBeDefined()
				if ((at as number) >= (position.get(page.slug) as number)) {
					// Legal only as a mutual cycle: the target relates back to this
					// page, and the wiki recomputes backlinks when it lands.
					const targetRels = bySlug.get(rel.targetPageSlug)?.relationships ?? []
					expect(
						targetRels.some((back) => back.targetPageSlug === page.slug),
					).toBe(true)
					forward.push(page.slug + " -> " + rel.targetPageSlug)
				}
			}
		}
		// The corpus has exactly one such cycle (account <-> champion person).
		expect(forward).toEqual([
			"accounts/halvorsen-freight-group -> people/tobias-brandvold",
		])
	})

	it("gives every claim an evidence note that contains its anchor (case-insensitive)", () => {
		const plan = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		const notes = new Map<string, Map<string, string[]>>()
		for (const page of plan.pages) {
			const claimNotes = new Map<string, string[]>()
			for (const claim of page.claims) {
				claimNotes.set(
					claim.id,
					claim.evidence.map((e) => e.note),
				)
			}
			notes.set(page.slug, claimNotes)
		}
		let checked = 0
		for (const spec of world.pages) {
			if (!notes.has(spec.slug)) continue
			for (const claim of spec.claims) {
				const planned = notes.get(spec.slug)?.get(claim.id) ?? []
				expect(planned).toHaveLength(claim.evidence.length)
				for (const [i, ev] of claim.evidence.entries()) {
					const note = planned[i] ?? ""
					expect(note.toLowerCase()).toContain(ev.anchor.toLowerCase())
					checked++
				}
			}
		}
		expect(checked).toBeGreaterThanOrEqual(420)
	})

	it("stays deterministic and subsets cleanly with limitSources", () => {
		const full = buildLoadPlan(world, records, { scopeRef: SCOPE_REF })
		const again = buildLoadPlan(readWorld(), readRecords(), {
			scopeRef: SCOPE_REF,
		})
		expect(full).toEqual(again)

		const subset = buildLoadPlan(world, records, {
			scopeRef: SCOPE_REF,
			limitSources: 20,
		})
		expect(subset.events).toHaveLength(20)
		expect(subset.events.map((e) => e.sourceId)).toEqual(
			full.events.slice(0, 20).map((e) => e.sourceId),
		)
		const subsetSources = new Set(subset.events.map((e) => e.sourceId))
		for (const page of subset.pages) {
			for (const claim of page.claims) {
				for (const ev of claim.evidence) {
					expect(subsetSources.has(ev.sourceId)).toBe(true)
				}
			}
		}
	})
})
