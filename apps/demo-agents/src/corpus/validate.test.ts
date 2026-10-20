import { areContradictory } from "@mdbrain/wiki-engine"
import { describe, expect, it } from "vitest"
import type { RenderedRecord, World } from "./types.js"
import { validateRendered, validateWorld } from "./validate.js"
import { buildWorld } from "./world.js"

const SEED = 20261020
const world = buildWorld(SEED)
const clone = (): World => structuredClone(world)

function renderAll(w: World): Map<string, RenderedRecord> {
	return new Map(
		w.sources.map((s) => [
			s.id,
			{
				id: s.id,
				body: `${s.title}\n\n${s.facts.join(". ")}.`,
				model: "claude-haiku-5-5",
				renderedAt: "2026-10-20T00:00:00.000Z",
			},
		]),
	)
}

describe("buildWorld", () => {
	it("is deterministic for a seed", () => {
		expect(JSON.stringify(buildWorld(SEED))).toBe(JSON.stringify(world))
	})

	it("has the planned size", () => {
		expect(world.accounts).toHaveLength(60)
		expect(world.products).toHaveLength(3)
		expect(world.people.length).toBeGreaterThanOrEqual(380)
		expect(world.people.length).toBeLessThanOrEqual(420)
		expect(world.sources.length).toBeGreaterThanOrEqual(570)
		expect(world.sources.length).toBeLessThanOrEqual(630)
		expect(new Set(world.sources.map((s) => s.kind)).size).toBe(6)
	})

	it("anchors the story on Halvorsen with four storylines", () => {
		expect(world.accounts[0]?.name).toBe("Halvorsen Freight Group")
		expect(world.storylines.map((s) => s.id)).toEqual([
			"renewal-risk",
			"eta-drift",
			"pricing-change",
			"champion-leaving",
		])
	})

	it("holds back only a small set of late-September sources for replay", () => {
		const replay = world.sources.filter((s) => s.phase === "replay")
		const lastHistory = world.sources
			.filter((s) => s.phase === "history")
			.map((s) => s.date)
			.sort()
			.at(-1) as string
		expect(replay.length).toBeGreaterThanOrEqual(5)
		expect(replay.length).toBeLessThanOrEqual(12)
		for (const s of replay) expect(s.date > lastHistory).toBe(true)
	})

	it("passes its own validator", () => {
		expect(validateWorld(world)).toEqual([])
	})

	it("plans a contradiction the shipped detector records", () => {
		const { targetPageSlug, targetClaimId, incoming } = world.contradiction
		const target = world.pages.find((p) => p.slug === targetPageSlug)
		const existing = target?.claims.find((c) => c.id === targetClaimId)
		const claim = incoming.claims[0]
		expect(existing && claim).toBeTruthy()
		expect(
			areContradictory(
				{ id: claim?.id ?? "", text: claim?.text ?? "" },
				{ id: existing?.id ?? "", text: existing?.text ?? "" },
			),
		).toBe(true)
		expect(incoming.relationships.map((r) => r.targetPageSlug)).toContain(
			targetPageSlug,
		)
	})
})

describe("validateWorld", () => {
	it("reports a dangling reference", () => {
		const w = clone()
		;(w.sources[0] as World["sources"][number]).authorId = "per-nobody"
		expect(validateWorld(w).join("\n")).toMatch(/per-nobody/)
	})

	it("reports a claim whose anchor is not a fact of its source", () => {
		const w = clone()
		const claim = w.pages.find((p) => p.claims.length)?.claims[0]
		if (!claim?.evidence[0]) throw new Error("fixture")
		claim.evidence[0].anchor = "a fact nobody recorded"
		expect(validateWorld(w).join("\n")).toMatch(/a fact nobody recorded/)
	})

	it("reports a claim that cites a replay source", () => {
		const w = clone()
		const claim = w.pages.find((p) => p.claims.length)?.claims[0]
		const replay = w.sources.find((s) => s.phase === "replay")
		if (!claim?.evidence[0] || !replay) throw new Error("fixture")
		claim.evidence[0] = { sourceId: replay.id, anchor: replay.facts[0] ?? "" }
		expect(validateWorld(w).join("\n")).toMatch(/replay/)
	})

	it("reports an unplanned contradiction between related pages", () => {
		const w = clone()
		const target = w.pages.find(
			(p) => p.slug === w.contradiction.targetPageSlug,
		)
		const related = w.pages.find((p) =>
			p.relationships.some((r) => r.targetPageSlug === target?.slug),
		)
		const claim = related?.claims[0]
		const existing = target?.claims[0]
		if (!claim || !existing) throw new Error("fixture")
		claim.text = `It is not true that ${existing.text}`
		expect(validateWorld(w).join("\n")).toMatch(/contradict/)
	})

	it("reports a well-known company name", () => {
		const w = clone()
		;(w.accounts[5] as World["accounts"][number]).name = "Maersk Freight"
		expect(validateWorld(w).join("\n")).toMatch(/Maersk Freight/)
	})
})

describe("validateRendered", () => {
	it("accepts bodies that carry every fact", () => {
		expect(validateRendered(world, renderAll(world))).toEqual([])
	})

	it("reports a missing record and a missing fact", () => {
		const records = renderAll(world)
		const [first, second] = world.sources
		if (!first || !second) throw new Error("fixture")
		records.delete(first.id)
		records.set(second.id, {
			...(records.get(second.id) as RenderedRecord),
			body: "nothing here",
		})
		const errors = validateRendered(world, records).join("\n")
		expect(errors).toMatch(new RegExp(first.id))
		expect(errors).toMatch(new RegExp(`${second.id}.*${second.facts[0]}`))
	})

	it("reports a real company named in a body", () => {
		const records = renderAll(world)
		const first = world.sources[0]
		if (!first) throw new Error("fixture")
		const record = records.get(first.id) as RenderedRecord
		records.set(first.id, {
			...record,
			body: `${record.body} We compared with FedEx.`,
		})
		expect(validateRendered(world, records).join("\n")).toMatch(/fedex/i)
	})
})
