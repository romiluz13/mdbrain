export type ClaimSource = {
	label: string
	href: string
	verifiedAt: string
}

export type ArchitectureStage = {
	id: "sources" | "api" | "wiki" | "memory" | "mongodb" | "context"
	label: string
	title: string
	description: string
	capability: string
	source: ClaimSource
}

export type ProofScenario = {
	id:
		| "supersession"
		| "contradiction"
		| "governance"
		| "hybrid-search"
		| "graph-context"
	label: string
	title: string
	summary: string
	steps: readonly [string, string, string, ...string[]]
	mongodb: string
	source: ClaimSource
}

const repository = "https://github.com/romiluz13/mdbrain/blob/main/" as const
const verifiedAt = "2026-08-22"

export const architectureStages: ArchitectureStage[] = [
	{
		id: "sources",
		label: "01 / Observe",
		title: "Source material arrives with identity.",
		description:
			"Documents, conversations, tool results, and application events enter with scope, provenance, and timestamps intact.",
		capability: "Flexible document model",
		source: {
			label: "Connector contract",
			href: `${repository}packages/wiki-engine/src/wiki-connectors.ts`,
			verifiedAt,
		},
	},
	{
		id: "api",
		label: "02 / Authorize",
		title: "Every operation carries an explicit principal.",
		description:
			"The API constrains agents, scopes, capabilities, trust tiers, roles, and departments before knowledge is read or changed.",
		capability: "Scoped application queries",
		source: {
			label: "API principal model",
			href: `${repository}apps/api/src/principal.ts`,
			verifiedAt,
		},
	},
	{
		id: "wiki",
		label: "03 / Govern",
		title: "Claims become reviewable knowledge.",
		description:
			"Wiki pages retain evidence, relationships, contradictions, revisions, permissions, and lifecycle state instead of flattening everything into chunks.",
		capability: "Documents + transactions + validation",
		source: {
			label: "Governed wiki write path",
			href: `${repository}packages/wiki-engine/src/wiki-bridge.ts`,
			verifiedAt,
		},
	},
	{
		id: "memory",
		label: "04 / Remember",
		title: "Long-term memory stays behind a hard service boundary.",
		description:
			"MDBrain calls a pinned Memongo HTTP contract for tenant memory rather than coupling application code to a memory engine implementation.",
		capability: "Versioned HTTP boundary",
		source: {
			label: "Memongo HTTP client",
			href: `${repository}packages/memory-bridge/src/memongo-http-client.ts`,
			verifiedAt,
		},
	},
	{
		id: "mongodb",
		label: "05 / Retrieve",
		title: "Meaning, exact terms, and relationships meet in one pipeline.",
		description:
			"Atlas Vector Search, Search, ranking, reranking, and graph traversal retrieve evidence without synchronizing several specialized databases.",
		capability:
			"$vectorSearch + $search + $rankFusion + $rerank + $graphLookup",
		source: {
			label: "MongoDB aggregation stages",
			href: "https://www.mongodb.com/docs/atlas/atlas-vector-search/hybrid-search/",
			verifiedAt,
		},
	},
	{
		id: "context",
		label: "06 / Explain",
		title: "Agents receive context that shows its work.",
		description:
			"Context bundles keep paths, source event IDs, scope, timestamps, and trust signals such as freshness and contradiction so a selection can be inspected.",
		capability: "Evidence-preserving delivery",
		source: {
			label: "Memory delivery contract",
			href: `${repository}packages/memory-bridge/src/mdbrain-bridge.ts`,
			verifiedAt,
		},
	},
]

export const proofScenarios: ProofScenario[] = [
	{
		id: "supersession",
		label: "Change over time",
		title: "The current answer keeps its history.",
		summary:
			"A changed fact produces a new revision while the previous version remains available for audit.",
		steps: [
			"Friday: release window is recorded as Thursday.",
			"Monday: the source changes the window to Friday.",
			"Recall returns Friday and preserves the earlier revision.",
		],
		mongodb: "Transactions + revision documents",
		source: {
			label: "Wiki revision tests",
			href: `${repository}packages/wiki-engine/src/wiki-revisions.test.ts`,
			verifiedAt,
		},
	},
	{
		id: "contradiction",
		label: "Conflicting truth",
		title: "Disagreement remains visible.",
		summary:
			"A contradictory claim is recorded before near-duplicate filtering can hide it, then waits for an explicit resolution.",
		steps: [
			"One page says customer exports are enabled.",
			"A related page says customer exports are not enabled.",
			"Both claims remain visible with an unresolved contradiction.",
		],
		mongodb: "Atomic write pipeline + embedded claims",
		source: {
			label: "Contradiction pipeline tests",
			href: `${repository}packages/wiki-engine/src/wiki-contradictions.test.ts`,
			verifiedAt,
		},
	},
	{
		id: "governance",
		label: "Permission boundary",
		title: "Relevant does not mean authorized.",
		summary:
			"Scope, trust tier, roles, departments, and privacy rules constrain retrieval before results reach an agent.",
		steps: [
			"A restricted finance page is semantically relevant.",
			"The requesting principal lacks the required scope.",
			"The page is filtered before context assembly.",
		],
		mongodb: "Pre-filtered search and aggregation",
		source: {
			label: "Governance isolation tests",
			href: `${repository}packages/wiki-engine/src/wiki-governance.test.ts`,
			verifiedAt,
		},
	},
	{
		id: "hybrid-search",
		label: "Hybrid retrieval",
		title: "Meaning and exact identifiers both survive.",
		summary:
			"Semantic search finds concepts while lexical search protects names, codes, and dates; server-side fusion combines both.",
		steps: [
			"A question describes an account concept in natural language.",
			"Vector and lexical pipelines retrieve complementary evidence.",
			"Fusion and optional reranking return one ordered result set.",
		],
		mongodb: "$vectorSearch + $search + $rankFusion",
		source: {
			label: "Hybrid search pipeline tests",
			href: `${repository}packages/wiki-engine/src/wiki-search.test.ts`,
			verifiedAt,
		},
	},
	{
		id: "graph-context",
		label: "Connected knowledge",
		title: "A result becomes a map, not a dead end.",
		summary:
			"Relevant wiki pages can expand through typed relationships to recover the surrounding business context.",
		steps: [
			"Hybrid search finds the Accounts page.",
			"Relationships connect it to Billing and Revenue Recognition.",
			"Graph expansion returns the related context with depth metadata.",
		],
		mongodb: "$graphLookup",
		source: {
			label: "Graph expansion tests",
			href: `${repository}packages/wiki-engine/src/wiki-search.test.ts`,
			verifiedAt,
		},
	},
]
