import { describe, expect, it } from "vitest"
import { demoScenario } from "../../lib/marketing/demo-scenario.js"

describe("retrieval autopsy scenario", () => {
	it("contrasts a plausible stale answer with the governed answer", () => {
		expect(demoScenario.mode).toBe("Guided synthetic simulation")
		expect(demoScenario.question).toContain("Identity Gateway v2")
		expect(demoScenario.baseline.answer).toContain("passport-jwt")
		expect(demoScenario.answer.text).toContain("@northstar/identity-edge")

		const staleCitation = demoScenario.documents.find(
			(document) => document.id === demoScenario.baseline.citationId,
		)
		expect(staleCitation).toMatchObject({
			state: "superseded",
			access: "allowed",
		})
	})

	it("makes every retrieval decision and truth boundary inspectable", () => {
		expect(
			demoScenario.documents.some(
				(document) =>
					document.access === "restricted" &&
					document.disposition === "excluded",
			),
		).toBe(true)
		expect(
			demoScenario.documents.some(
				(document) =>
					document.state === "superseded" &&
					document.disposition === "excluded",
			),
		).toBe(true)
		expect(demoScenario.pipeline.map((step) => step.operator)).toEqual([
			"governance filter",
			"$vectorSearch + $search",
			"$rankFusion",
			"$rerank (optional)",
			"$graphLookup",
			"context bundle",
		])
		expect(demoScenario.answer.signals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: "Freshness", value: "Fresh" }),
				expect.objectContaining({
					label: "Contradiction",
					value: "Potential conflict",
				}),
				expect.objectContaining({ label: "Scope", value: "Workspace match" }),
			]),
		)

		for (const step of demoScenario.pipeline) {
			expect(step.source.href).toMatch(
				/^https:\/\/github\.com\/romiluz13\/mdbrain\/blob\/main\//,
			)
			expect(step.source.verifiedAt).toBe("2026-08-23")
		}
		expect(demoScenario.lifecycleSource.href).toContain("wiki-bridge.ts")
		expect(demoScenario.answer.contextBundle).toMatchObject({
			agentId: "coding-agent",
			scope: "workspace",
			scopeRef: "northstar-engineering",
			sections: expect.arrayContaining([
				expect.objectContaining({ kind: "query-evidence" }),
				expect.objectContaining({ kind: "discovery-projection" }),
			]),
			metadata: {
				tokenBudget: 1200,
				estimatedTokensUsed: 248,
				partial: false,
				truncated: false,
				pathsExecuted: ["wiki-hybrid-search", "wiki-relationship-expansion"],
				trustSummary: expect.objectContaining({ contradictionCount: 1 }),
				sectionsIncluded: ["query-evidence", "discovery-projection"],
			},
			builtAt: "2026-08-23T09:30:00.000Z",
		})
	})
})
