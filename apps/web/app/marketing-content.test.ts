import { describe, expect, it } from "vitest"
import {
	architectureStages,
	proofScenarios,
} from "../lib/marketing/architecture.js"
import {
	categoryComparisons,
	namedComparisons,
} from "../lib/marketing/comparisons.js"

describe("marketing architecture content", () => {
	it("covers the complete source-to-context system path", () => {
		expect(architectureStages.map((stage) => stage.id)).toEqual([
			"sources",
			"api",
			"wiki",
			"memory",
			"mongodb",
			"context",
		])

		for (const stage of architectureStages) {
			expect(stage.title.length).toBeGreaterThan(0)
			expect(stage.description.length).toBeGreaterThan(0)
			expect(stage.capability.length).toBeGreaterThan(0)
			expect(stage.source.href).toMatch(
				/^(https:\/\/www\.mongodb\.com\/docs\/|https:\/\/github\.com\/romiluz13\/mdbrain\/blob\/main\/)/,
			)
		}
	})

	it("defines the five approved proof scenarios with code evidence", () => {
		expect(proofScenarios.map((scenario) => scenario.id)).toEqual([
			"supersession",
			"contradiction",
			"governance",
			"hybrid-search",
			"graph-context",
		])

		for (const scenario of proofScenarios) {
			expect(scenario.steps.length).toBeGreaterThanOrEqual(3)
			expect(scenario.source.href).toMatch(
				/^https:\/\/github\.com\/romiluz13\/mdbrain\/blob\/main\//,
			)
		}
	})
})

describe("marketing comparison content", () => {
	it("compares the approved architecture categories without binary hype", () => {
		expect(categoryComparisons.map((category) => category.id)).toEqual([
			"chunk-rag",
			"vector-memory",
			"graph-memory",
			"file-wiki",
			"mdbrain",
		])

		for (const category of categoryComparisons) {
			for (const value of Object.values(category.capabilities)) {
				expect(["Yes", "Partial", "External", "Not inherent"]).toContain(value)
			}
		}
	})

	it("requires every named comparison to be dated and sourced", () => {
		expect(namedComparisons.map((comparison) => comparison.id)).toEqual([
			"modus",
			"glean",
			"guru",
			"dust",
			"mem0",
			"zep",
			"cognee",
			"openwiki",
			"graphrag",
		])

		for (const comparison of namedComparisons) {
			expect(comparison.strengths.length).toBeGreaterThan(0)
			expect(comparison.difference.length).toBeGreaterThan(0)
			expect(comparison.source.href).toMatch(/^https:\/\//)
			expect(comparison.source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		}
	})
})
