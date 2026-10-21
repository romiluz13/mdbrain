/** Minimal world fixture shaped like the committed corpus: the seven replay
 * sources, and the Halvorsen contradiction with the incoming risk page.
 * Shared by story.test.ts and runner.test.ts. */
import type { RenderedRecord, SourceSpec, World } from "../../corpus/types.js"

export const RISK_SLUG = "risks/halvorsen-renewal-support-view"
export const ACCOUNT_SLUG = "accounts/halvorsen-freight-group"

function source(
	id: string,
	kind: SourceSpec["kind"],
	storyline: SourceSpec["storyline"],
	phase: SourceSpec["phase"] = "replay",
): SourceSpec {
	return {
		id,
		kind,
		title: `title ${id}`,
		date: "2026-10-01",
		authorId: "person-1",
		participantIds: [],
		productIds: [],
		storyline,
		phase,
		brief: "",
		facts: [],
		length: "short",
	}
}

export const REPLAY_SOURCE_IDS = [
	"src-renewal-05",
	"src-drift-10",
	"src-drift-11",
	"src-pricing-04",
	"src-pricing-05",
	"src-champion-02",
	"src-champion-03",
] as const

export function makeDemoWorld(): World {
	return {
		seed: 1,
		company: { name: "Northstar", summary: "fleet telemetry" },
		products: [],
		people: [],
		accounts: [],
		sources: [
			source("src-renewal-05", "slack_thread", "renewal-risk"),
			source("src-drift-10", "support_ticket", "eta-drift"),
			source("src-drift-11", "slack_thread", "eta-drift"),
			source("src-pricing-04", "doc", "pricing-change"),
			source("src-pricing-05", "slack_thread", "pricing-change"),
			source("src-champion-02", "crm_note", "champion-leaving"),
			source("src-champion-03", "call_transcript", "champion-leaving"),
			source("src-history-01", "doc", "pricing-change", "history"),
		],
		pages: [],
		storylines: [],
		contradiction: {
			targetPageSlug: ACCOUNT_SLUG,
			targetClaimId: "halvorsen-freight-group-renewal-health",
			incoming: {
				slug: RISK_SLUG,
				kind: "synthesis",
				type: "risk-assessment",
				title: "Halvorsen renewal support view",
				summary: "The support-side view of the Halvorsen renewal.",
				body: "Open ETA drift escalations remain unresolved, so the renewal is not on track for November signature.",
				tags: ["renewal"],
				claims: [
					{
						id: "halvorsen-renewal-support-risk",
						text: "The Halvorsen Freight Group renewal is not on track for November signature.",
						confidence: 0.8,
						evidence: [
							{ sourceId: "src-renewal-05", anchor: "renewal at risk" },
						],
					},
				],
				relationships: [{ targetPageSlug: ACCOUNT_SLUG, kind: "assesses" }],
			},
		},
	}
}

export function makeDemoRecords(): Map<string, RenderedRecord> {
	return new Map(
		REPLAY_SOURCE_IDS.map((id) => [
			id,
			{
				id,
				body: `body of ${id}`,
				model: "claude-haiku-5-5",
				finishReason: "stop",
				renderedAt: "2026-10-20T12:00:00.000Z",
			},
		]),
	)
}
