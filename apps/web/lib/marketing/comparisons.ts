import type { ClaimSource } from "./architecture.js"

export type CapabilityValue = "Yes" | "Partial" | "External" | "Not inherent"

export type ComparisonCapability =
	| "knowledgeModel"
	| "freshness"
	| "contradictions"
	| "governance"
	| "retrieval"
	| "evidence"
	| "portability"

export type CategoryComparison = {
	id: "chunk-rag" | "vector-memory" | "graph-memory" | "file-wiki" | "mdbrain"
	label: string
	description: string
	capabilities: Record<ComparisonCapability, CapabilityValue>
}

export type NamedComparison = {
	id:
		| "modus"
		| "glean"
		| "guru"
		| "dust"
		| "mem0"
		| "zep"
		| "cognee"
		| "openwiki"
		| "graphrag"
	name: string
	category: "Company context" | "Agent memory" | "Open knowledge"
	positioning: string
	strengths: string
	difference: string
	source: ClaimSource
}

export const comparisonRows: Array<{
	id: ComparisonCapability
	label: string
}> = [
	{ id: "knowledgeModel", label: "Maintained knowledge model" },
	{ id: "freshness", label: "Supersession and freshness" },
	{ id: "contradictions", label: "Contradiction workflow" },
	{ id: "governance", label: "Scoped governance" },
	{ id: "retrieval", label: "Hybrid + graph retrieval" },
	{ id: "evidence", label: "Evidence and provenance" },
	{ id: "portability", label: "Portable interchange" },
]

export const categoryComparisons: CategoryComparison[] = [
	{
		id: "chunk-rag",
		label: "Chunk RAG",
		description: "Indexes source fragments and assembles them at query time.",
		capabilities: {
			knowledgeModel: "Not inherent",
			freshness: "External",
			contradictions: "Not inherent",
			governance: "External",
			retrieval: "Partial",
			evidence: "Partial",
			portability: "External",
		},
	},
	{
		id: "vector-memory",
		label: "Vector memory",
		description: "Extracts and retrieves durable user or agent memories.",
		capabilities: {
			knowledgeModel: "Partial",
			freshness: "Partial",
			contradictions: "Partial",
			governance: "External",
			retrieval: "Partial",
			evidence: "Partial",
			portability: "External",
		},
	},
	{
		id: "graph-memory",
		label: "Graph memory",
		description: "Models entities and relationships derived from activity.",
		capabilities: {
			knowledgeModel: "Partial",
			freshness: "Partial",
			contradictions: "Partial",
			governance: "External",
			retrieval: "Yes",
			evidence: "Partial",
			portability: "External",
		},
	},
	{
		id: "file-wiki",
		label: "File LLM wiki",
		description: "Maintains readable synthesized pages in a repository.",
		capabilities: {
			knowledgeModel: "Yes",
			freshness: "Partial",
			contradictions: "Partial",
			governance: "Partial",
			retrieval: "External",
			evidence: "Yes",
			portability: "Yes",
		},
	},
	{
		id: "mdbrain",
		label: "MDBrain",
		description:
			"Combines governed wiki documents with a separate long-term memory service.",
		capabilities: {
			knowledgeModel: "Yes",
			freshness: "Yes",
			contradictions: "Yes",
			governance: "Yes",
			retrieval: "Yes",
			evidence: "Yes",
			portability: "Yes",
		},
	},
]

const verifiedAt = "2026-08-22"

export const namedComparisons: NamedComparison[] = [
	{
		id: "modus",
		name: "Modus",
		category: "Company context",
		positioning: "A managed Context Warehouse for enterprise AI.",
		strengths:
			"Broad integrations, governed scopes, context composition, and agent workflows.",
		difference:
			"MDBrain is an open-source MongoDB reference architecture centered on governed wiki artifacts and long-term memory, not a managed enterprise workflow platform.",
		source: {
			label: "Modus product",
			href: "https://www.getmodus.com/product/",
			verifiedAt,
		},
	},
	{
		id: "glean",
		name: "Glean",
		category: "Company context",
		positioning: "Enterprise search, assistant, and agent infrastructure.",
		strengths:
			"Mature permission-aware search, connector coverage, enterprise deployment, and administration.",
		difference:
			"MDBrain exposes a smaller open architecture for building governed context directly on MongoDB rather than delivering a complete enterprise search suite.",
		source: {
			label: "Glean platform",
			href: "https://www.glean.com/product/overview",
			verifiedAt,
		},
	},
	{
		id: "guru",
		name: "Guru",
		category: "Company context",
		positioning: "A governed knowledge layer for people and enterprise AI.",
		strengths:
			"Human verification workflows, knowledge management, and cited answers across company sources.",
		difference:
			"MDBrain focuses on a programmable agent-facing wiki and memory substrate with MongoDB-native retrieval and portable OKF interchange.",
		source: {
			label: "Guru product",
			href: "https://www.getguru.com/",
			verifiedAt,
		},
	},
	{
		id: "dust",
		name: "Dust",
		category: "Company context",
		positioning: "A platform for building agents on company knowledge.",
		strengths:
			"Agent creation, tools, model choice, connectors, and collaborative deployment.",
		difference:
			"MDBrain is the underlying governed knowledge and memory layer rather than a full agent application platform.",
		source: {
			label: "Dust documentation",
			href: "https://docs.dust.tt/",
			verifiedAt,
		},
	},
	{
		id: "mem0",
		name: "Mem0",
		category: "Agent memory",
		positioning: "A managed and open-source memory layer for AI applications.",
		strengths:
			"Simple developer integration, user and agent memory, broad ecosystem support, and a managed API.",
		difference:
			"MDBrain adds governed, revisioned, human-readable wiki pages with claims, evidence, contradictions, and OKF portability.",
		source: {
			label: "Mem0 overview",
			href: "https://docs.mem0.ai/overview",
			verifiedAt,
		},
	},
	{
		id: "zep",
		name: "Zep / Graphiti",
		category: "Agent memory",
		positioning: "Temporal knowledge-graph memory for agents.",
		strengths:
			"Explicit temporal validity, provenance, entity extraction, and graph-native retrieval.",
		difference:
			"MDBrain combines a separately deployed memory service with a governed document wiki rather than treating an inferred temporal graph as the complete knowledge product.",
		source: {
			label: "Graphiti platform",
			href: "https://www.getzep.com/platform/graphiti/",
			verifiedAt,
		},
	},
	{
		id: "cognee",
		name: "Cognee",
		category: "Agent memory",
		positioning: "Open-source graph and vector memory pipelines.",
		strengths:
			"Portable shared memory, graph construction, framework integrations, and self-hosting.",
		difference:
			"MDBrain centers governed wiki documents and MongoDB-native operational queries instead of a pipeline-first graph abstraction.",
		source: {
			label: "Cognee documentation",
			href: "https://docs.cognee.ai/",
			verifiedAt,
		},
	},
	{
		id: "openwiki",
		name: "OpenWiki",
		category: "Open knowledge",
		positioning: "An open-source agent that builds and maintains an LLM wiki.",
		strengths:
			"Fast local wiki generation, source connectors, maintenance workflows, and OKF output.",
		difference:
			"MDBrain uses transactional MongoDB collections, governed API reads, hybrid and graph retrieval, and a separate long-term memory boundary.",
		source: {
			label: "OpenWiki repository",
			href: "https://github.com/langchain-ai/openwiki",
			verifiedAt,
		},
	},
	{
		id: "graphrag",
		name: "Microsoft GraphRAG",
		category: "Open knowledge",
		positioning:
			"A graph-based indexing pipeline with synthesized community reports.",
		strengths:
			"Entity and relationship extraction, hierarchical communities, and global or local graph-assisted search.",
		difference:
			"MDBrain is an operational governed wiki with revisions, permissions, contradictions, and ongoing agent memory rather than a batch indexing methodology.",
		source: {
			label: "GraphRAG repository",
			href: "https://github.com/microsoft/graphrag",
			verifiedAt,
		},
	},
]
