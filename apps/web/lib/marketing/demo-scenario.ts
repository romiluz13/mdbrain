import type { MdbrainContextBundleResponse } from "@mdbrain/client"

export type DemoSource = {
	label: string
	href: string
	verifiedAt: string
}

export type DemoDocument = {
	id: string
	title: string
	kind: "runbook" | "decision" | "note" | "ownership" | "finance"
	excerpt: string
	state: "active" | "superseded"
	freshness: "fresh" | "aging" | "stale"
	access: "allowed" | "restricted"
	disposition: "accepted" | "flagged" | "excluded" | "expanded"
	matchedBy: readonly string[]
	score?: number
	reason: string
}

export type DemoPipelineStep = {
	id: string
	label: string
	operator: string
	description: string
	result: string
	source: DemoSource
}

export type DemoSignal = {
	label: string
	value: string
	tone: "positive" | "warning" | "neutral"
	detail: string
}

const repository = "https://github.com/romiluz13/mdbrain/blob/main/"
const verifiedAt = "2026-08-23"

export const demoScenario = {
	mode: "Guided synthetic simulation",
	company: "Northstar Systems",
	question:
		"After the Identity Gateway v2 migration, which authentication middleware should the billing API use, and who owns rollout approval?",
	baseline: {
		label: "Illustrative vector-only retrieval",
		answer:
			"Use passport-jwt with the legacy gateway adapter. Rollout approval belongs to the Security Architecture Council.",
		citationId: "auth-v1-runbook",
		diagnosis:
			"The top semantic match is a retired runbook. Without lifecycle and scope signals, the answer looks useful and remains wrong.",
	},
	documents: [
		{
			id: "auth-v1-runbook",
			title: "Billing API authentication runbook",
			kind: "runbook",
			excerpt:
				"Billing services authenticate through passport-jwt and the legacy gateway adapter.",
			state: "superseded",
			freshness: "stale",
			access: "allowed",
			disposition: "excluded",
			matchedBy: ["semantic"],
			score: 0.93,
			reason:
				"Strong wording match, but the page was superseded by the Identity Gateway v2 decision.",
		},
		{
			id: "identity-v2-adr",
			title: "ADR-042 · Identity Gateway v2",
			kind: "decision",
			excerpt:
				"Node services must use @northstar/identity-edge. Platform Identity owns rollout approval.",
			state: "active",
			freshness: "fresh",
			access: "allowed",
			disposition: "accepted",
			matchedBy: ["semantic", "lexical"],
			score: 0.88,
			reason:
				"The active decision matches the migration name exactly and answers the middleware requirement.",
		},
		{
			id: "migration-note",
			title: "Identity migration working notes",
			kind: "note",
			excerpt:
				"Billing may keep passport-jwt until the gateway migration is complete.",
			state: "active",
			freshness: "aging",
			access: "allowed",
			disposition: "flagged",
			matchedBy: ["semantic"],
			score: 0.71,
			reason:
				"A pipeline gate flags this potential conflict for review instead of silently dropping it.",
		},
		{
			id: "platform-ownership",
			title: "Platform Identity · service ownership",
			kind: "ownership",
			excerpt:
				"Platform Identity owns gateway rollouts. Maya Chen is the approval contact.",
			state: "active",
			freshness: "fresh",
			access: "allowed",
			disposition: "expanded",
			matchedBy: ["relationship"],
			reason:
				"A typed relationship from ADR-042 expands to the current ownership record.",
		},
		{
			id: "finance-plan",
			title: "FY27 identity platform budget",
			kind: "finance",
			excerpt:
				"Restricted forecast for gateway staffing, vendor costs, and executive approvals.",
			state: "active",
			freshness: "fresh",
			access: "restricted",
			disposition: "excluded",
			matchedBy: ["semantic"],
			score: 0.76,
			reason:
				"The document is relevant, but the requesting developer does not have Finance scope.",
		},
	] satisfies DemoDocument[],
	lifecycleSource: {
		label: "Governed soft-delete lifecycle",
		href: `${repository}packages/wiki-engine/src/wiki-bridge.ts#L666-L718`,
		verifiedAt,
	} satisfies DemoSource,
	pipeline: [
		{
			id: "govern",
			label: "01 · Govern",
			operator: "governance filter",
			description:
				"Apply workspace, role, department, privacy, and lifecycle constraints before evidence reaches the agent.",
			result: "Superseded runbook and restricted finance plan excluded.",
			source: {
				label: "Search prefilter",
				href: `${repository}packages/wiki-engine/src/wiki-search.ts#L117-L134`,
				verifiedAt,
			},
		},
		{
			id: "recall",
			label: "02 · Recall",
			operator: "$vectorSearch + $search",
			description:
				"Retrieve conceptual matches and protect exact identifiers such as Identity Gateway v2 and ADR-042.",
			result: "The active decision survives both semantic and lexical recall.",
			source: {
				label: "Hybrid search stages",
				href: `${repository}packages/wiki-engine/src/wiki-search.ts#L221-L270`,
				verifiedAt,
			},
		},
		{
			id: "fuse",
			label: "03 · Fuse",
			operator: "$rankFusion",
			description:
				"Fuse both result sets with reciprocal rank fusion and retain score details for inspection.",
			result: "ADR-042 becomes the top eligible answer.",
			source: {
				label: "Rank fusion pipeline",
				href: `${repository}packages/wiki-engine/src/wiki-search.ts#L251-L270`,
				verifiedAt,
			},
		},
		{
			id: "rerank",
			label: "04 · Refine",
			operator: "$rerank (optional)",
			description:
				"When a compatible MongoDB runtime is configured, a server-side cross-encoder can refine the fused candidates.",
			result: "Runtime-gated; this walkthrough does not require it.",
			source: {
				label: "Optional rerank stage",
				href: `${repository}packages/wiki-engine/src/wiki-search.ts#L272-L299`,
				verifiedAt,
			},
		},
		{
			id: "connect",
			label: "05 · Connect",
			operator: "$graphLookup",
			description:
				"Traverse typed page relationships from the migration decision to the current service owner.",
			result:
				"Platform Identity and its approval contact join the evidence set.",
			source: {
				label: "Graph expansion engine",
				href: `${repository}packages/wiki-engine/src/wiki-search.ts#L341-L402`,
				verifiedAt,
			},
		},
		{
			id: "explain",
			label: "06 · Explain",
			operator: "context bundle",
			description:
				"Package prompt-ready context with source paths, scope, timestamps, and explicit trust signals.",
			result:
				"The coding agent receives an answer it can cite, inspect, or decline.",
			source: {
				label: "Context bundle contract",
				href: `${repository}packages/memory-bridge/src/mdbrain-bridge.ts#L98-L162`,
				verifiedAt,
			},
		},
	] satisfies DemoPipelineStep[],
	answer: {
		text: "Use @northstar/identity-edge for the billing API. Platform Identity owns the rollout, and Maya Chen is the current approval contact.",
		citations: ["identity-v2-adr", "platform-ownership"],
		signals: [
			{
				label: "Freshness",
				value: "Fresh",
				tone: "positive",
				detail: "Both answer-bearing records are marked fresh.",
			},
			{
				label: "Contradiction",
				value: "Potential conflict",
				tone: "warning",
				detail: "An aging migration note remains visible for review.",
			},
			{
				label: "Scope",
				value: "Workspace match",
				tone: "positive",
				detail: "Every delivered record is authorized for this developer.",
			},
			{
				label: "Evidence",
				value: "2 sources",
				tone: "neutral",
				detail: "The decision and ownership record support separate claims.",
			},
		] satisfies DemoSignal[],
		contextBundle: {
			agentId: "coding-agent",
			query: "Identity Gateway v2 billing middleware rollout approval",
			scope: "workspace",
			scopeRef: "northstar-engineering",
			rendered:
				"Use @northstar/identity-edge for the billing API. Platform Identity owns rollout approval; Maya Chen is the current approval contact.",
			sections: [
				{
					kind: "query-evidence",
					title: "Current implementation evidence",
					items: [
						{
							title: "ADR-042 · Identity Gateway v2",
							summary: "Node services must use @northstar/identity-edge.",
							path: "wiki/decisions/adr-042-identity-gateway-v2",
							scope: "workspace",
							scopeRef: "northstar-engineering",
							sourceEventIds: ["evt_migration_042"],
							trust: {
								score: 0.92,
								confidence: "high",
								exactness: "exact-id",
								freshness: "fresh",
								contradiction: "none",
								scopeMatch: "exact",
								provenance: "dense",
								sourceDiversity: "multi",
								factors: ["active decision", "exact migration identifier"],
							},
						},
						{
							title: "Platform Identity · service ownership",
							summary:
								"Platform Identity owns gateway rollouts; Maya Chen is the approval contact.",
							path: "wiki/teams/platform-identity",
							scope: "workspace",
							scopeRef: "northstar-engineering",
							sourceEventIds: ["evt_owner_117"],
							trust: {
								score: 0.84,
								confidence: "high",
								exactness: "exact-locator",
								freshness: "fresh",
								contradiction: "none",
								scopeMatch: "exact",
								provenance: "dense",
								sourceDiversity: "single",
								factors: ["typed relationship", "current owner record"],
							},
						},
					],
					estimatedTokens: 172,
					truncated: false,
					partial: false,
				},
				{
					kind: "discovery-projection",
					title: "Knowledge requiring review",
					summary: "One potential conflict remains visible.",
					items: [
						{
							title: "Identity migration working notes",
							summary:
								"Billing may keep passport-jwt until migration completes.",
							path: "wiki/notes/identity-migration",
							scope: "workspace",
							scopeRef: "northstar-engineering",
							sourceEventIds: ["evt_note_204"],
							trust: {
								score: 0.58,
								confidence: "low",
								exactness: "approximate",
								freshness: "aging",
								contradiction: "conflicted",
								scopeMatch: "exact",
								provenance: "partial",
								sourceDiversity: "single",
								factors: ["potential contradiction", "aging note"],
							},
						},
					],
					estimatedTokens: 76,
					truncated: false,
					partial: false,
				},
			],
			metadata: {
				tokenBudget: 1200,
				estimatedTokensUsed: 248,
				partial: false,
				truncated: false,
				pathsExecuted: ["wiki-hybrid-search", "wiki-relationship-expansion"],
				trustSummary: {
					topScore: 0.92,
					topConfidence: "high",
					averageScore: 0.78,
					distribution: { high: 2, medium: 0, low: 1 },
					contradictionCount: 1,
					staleCount: 0,
					exactCount: 2,
					sourceDiversity: "multi",
				},
				sectionsIncluded: ["query-evidence", "discovery-projection"],
			},
			builtAt: "2026-08-23T09:30:00.000Z",
		} satisfies MdbrainContextBundleResponse,
	},
	disclosure:
		"This deterministic walkthrough uses synthetic company records. It represents implemented MDBrain contracts; it is not a live benchmark or customer-data demo.",
} as const
