import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { MdbrainClient } from "@mdbrain/client"
import { pathToFileURL } from "node:url"

const mdbrain = new MdbrainClient({
	baseUrl: process.env.MDBRAIN_API_URL,
	apiKey: process.env.MDBRAIN_API_KEY,
})

type MdbrainMcpClient = typeof mdbrain

const RECALL_TOOL_NAMES = new Set([
	"mdbrain_recall_conversation",
	"mdbrain_recall_messages",
])
const LIFECYCLE_GET_TOOL_NAMES = new Set([
	"mdbrain_lifecycle_get",
	"mdbrain_memory_get",
])
const LIFECYCLE_UPDATE_TOOL_NAMES = new Set([
	"mdbrain_lifecycle_update",
	"mdbrain_memory_update",
])
const LIFECYCLE_DELETE_TOOL_NAMES = new Set([
	"mdbrain_lifecycle_delete",
	"mdbrain_memory_delete",
])
const LIFECYCLE_HISTORY_TOOL_NAMES = new Set([
	"mdbrain_lifecycle_history",
	"mdbrain_memory_history",
])
const IMPORT_TOOL_NAMES = new Set([
	"mdbrain_import_conversations",
	"mdbrain_import_conversation_history",
])

function jsonResult(payload: unknown, isError = false) {
	const structuredContent =
		payload !== null && typeof payload === "object"
			? Array.isArray(payload)
				? { items: payload }
				: (payload as Record<string, unknown>)
			: { value: payload }
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload) }],
		structuredContent,
		...(isError ? { isError: true } : {}),
	}
}

export const toolList = [
	{
		name: "mdbrain_search",
		description: "Search Mdbrain memory",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				agentId: { type: "string" },
				limit: { type: "number" },
				minScore: { type: "number" },
			},
			required: ["query"],
		},
	},
	{
		name: "mdbrain_search_kb",
		description: "Search Mdbrain knowledge base",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				agentId: { type: "string" },
				limit: { type: "number" },
			},
			required: ["query"],
		},
	},
	{
		name: "mdbrain_read_file",
		description: "Read memory file by path (memory_get parity)",
		inputSchema: {
			type: "object",
			properties: {
				relPath: { type: "string" },
				agentId: { type: "string" },
				from: { type: "number" },
				lines: { type: "number" },
			},
			required: ["relPath"],
		},
	},
	{
		name: "mdbrain_add",
		description: "Add user message to memory",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string" },
				agentId: { type: "string" },
				sessionId: { type: "string" },
			},
			required: ["content"],
		},
	},
	{
		name: "mdbrain_write_event",
		description: "Write conversation event (any role)",
		inputSchema: {
			type: "object",
			properties: {
				role: { type: "string", enum: ["user", "assistant", "system", "tool"] },
				body: { type: "string" },
				agentId: { type: "string" },
				sessionId: { type: "string" },
			},
			required: ["role", "body"],
		},
	},
	{
		name: "mdbrain_profile",
		description: "Synthesize profile from Mdbrain memory",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				scopeRef: { type: "string" },
			},
		},
	},
	{
		name: "mdbrain_build_context_bundle",
		description: "Build a prompt-ready context bundle from Mdbrain memory",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				agentId: { type: "string" },
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				scopeRef: { type: "string" },
				sessionId: { type: "string" },
				tokenBudget: { type: "number" },
				maxActiveItems: { type: "number" },
				maxEvidenceItems: { type: "number" },
				maxRecentEvents: { type: "number" },
				includeDiscoveryProjection: { type: "boolean" },
				discoveryKind: {
					type: "string",
					enum: [
						"entity-brief",
						"topic-brief",
						"what-changed",
						"contradiction-report",
					],
				},
				includeProfile: { type: "boolean" },
				mode: {
					type: "string",
					enum: ["full", "wake-up"],
					description:
						"wake-up returns a compact 250-token projection for session start",
				},
				timeRange: {
					type: "object",
					properties: {
						preset: { type: "string" },
						start: { type: "string" },
						end: { type: "string" },
					},
				},
			},
		},
	},
	{
		name: "mdbrain_recall_conversation",
		description:
			"Search and retrieve past conversation messages with canonical citations. Use exact ISO 8601 timestamps (for example `2026-04-08T14:30:00Z`); for date-only input (`2026-04-08`), include timezone to resolve local day boundaries correctly. Tool messages are excluded by default unless includeToolMessages is true.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Semantic search query for conversation content. Omit for filter-only recall.",
				},
				agentId: { type: "string" },
				sessionId: {
					type: "string",
					description: "Filter to a specific conversation session.",
				},
				roles: {
					type: "array",
					items: {
						type: "string",
						enum: ["user", "assistant", "system", "tool"],
					},
					description: "Filter to specific message roles.",
				},
				startTime: {
					type: "string",
					description:
						"Inclusive start of time range. ISO 8601: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`.",
				},
				endTime: {
					type: "string",
					description:
						"Inclusive end of time range. ISO 8601: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`.",
				},
				timezone: {
					type: "string",
					description:
						"IANA timezone such as `America/New_York` for date-only boundaries.",
				},
				includeToolMessages: {
					type: "boolean",
					description: "Include tool messages in results. Default false.",
				},
				limit: {
					type: "number",
					description: "Maximum results to return. Default 50, max 200.",
				},
			},
		},
	},
	{
		name: "mdbrain_recall_messages",
		description:
			"Semantic alias for mdbrain_recall_conversation. Recall past messages with exact time/session/role filters and canonical citations from the same runtime truth.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Semantic search query for conversation content. Omit for filter-only recall.",
				},
				agentId: { type: "string" },
				sessionId: {
					type: "string",
					description: "Filter to a specific conversation session.",
				},
				roles: {
					type: "array",
					items: {
						type: "string",
						enum: ["user", "assistant", "system", "tool"],
					},
					description: "Filter to specific message roles.",
				},
				startTime: {
					type: "string",
					description:
						"Inclusive start of time range. ISO 8601: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`.",
				},
				endTime: {
					type: "string",
					description:
						"Inclusive end of time range. ISO 8601: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SSZ`.",
				},
				timezone: {
					type: "string",
					description:
						"IANA timezone such as `America/New_York` for date-only boundaries.",
				},
				includeToolMessages: {
					type: "boolean",
					description: "Include tool messages in results. Default false.",
				},
				limit: {
					type: "number",
					description: "Maximum results to return. Default 50, max 200.",
				},
			},
		},
	},
	{
		name: "mdbrain_lifecycle_get",
		description:
			"Get the current structured memory or procedure referenced by a stable lifecycle handle.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable lifecycle handle. Include family, id, agentId, scope, scopeRef, revision, state, and either structured.{type,key} or procedure.{procedureId}.",
				},
			},
			required: ["handle"],
		},
	},
	{
		name: "mdbrain_memory_get",
		description:
			"Semantic alias for mdbrain_lifecycle_get. Fetch the current structured memory or procedure for a stable memory handle.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable memory handle. Include family, id, agentId, scope, scopeRef, revision, state, and either structured.{type,key} or procedure.{procedureId}.",
				},
			},
			required: ["handle"],
		},
	},
	{
		name: "mdbrain_lifecycle_update",
		description:
			"Update a structured memory or procedure via its stable lifecycle handle. Creates a new current revision and preserves history.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable lifecycle handle. Use the handle returned by lifecycle get/history responses.",
				},
				patch: {
					type: "object",
					description:
						"Family-specific patch. Structured supports value/context/confidence/source/sessionId/tags/salience/temporalScope/provenance/sourceEventIds/validTo/reviewAt/lastConfirmedAt/sourceReliability/sourceAgent/artifact. Procedures support name/intentTags/triggerQueries/steps/successSignals/confidence/provenance/sourceEventIds/sourceAgent.",
				},
			},
			required: ["handle", "patch"],
		},
	},
	{
		name: "mdbrain_memory_update",
		description:
			"Semantic alias for mdbrain_lifecycle_update. Update a memory item by stable handle while preserving revision history.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable memory handle. Use the handle returned by memory get/history responses.",
				},
				patch: {
					type: "object",
					description:
						"Family-specific patch. Structured supports value/context/confidence/source/sessionId/tags/salience/temporalScope/provenance/sourceEventIds/validTo/reviewAt/lastConfirmedAt/sourceReliability/sourceAgent/artifact. Procedures support name/intentTags/triggerQueries/steps/successSignals/confidence/provenance/sourceEventIds/sourceAgent.",
				},
			},
			required: ["handle", "patch"],
		},
	},
	{
		name: "mdbrain_lifecycle_delete",
		description:
			"Delete a memory item using Mdbrain lifecycle semantics. This invalidates the current version and preserves history instead of hard-deleting it.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable lifecycle handle. Use the handle returned by lifecycle get/history responses.",
				},
				invalidatedBy: {
					type: "object",
					description:
						"Optional metadata about why the current version was invalidated.",
				},
			},
			required: ["handle"],
		},
	},
	{
		name: "mdbrain_memory_delete",
		description:
			"Semantic alias for mdbrain_lifecycle_delete. Delete a memory item using invalidate-with-history semantics rather than hard delete.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable memory handle. Use the handle returned by memory get/history responses.",
				},
				invalidatedBy: {
					type: "object",
					description:
						"Optional metadata about why the current version was invalidated.",
				},
			},
			required: ["handle"],
		},
	},
	{
		name: "mdbrain_lifecycle_history",
		description:
			"Fetch ordered revision history for a structured memory or procedure from its stable lifecycle handle.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable lifecycle handle. Use the handle returned by lifecycle get/history responses.",
				},
				limit: {
					type: "number",
					description:
						"Maximum history entries to return. Default 50, max 200.",
				},
			},
			required: ["handle"],
		},
	},
	{
		name: "mdbrain_memory_history",
		description:
			"Semantic alias for mdbrain_lifecycle_history. Fetch ordered memory revision history from a stable handle.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable memory handle. Use the handle returned by memory get/history responses.",
				},
				limit: {
					type: "number",
					description:
						"Maximum history entries to return. Default 50, max 200.",
				},
			},
			required: ["handle"],
		},
	},
	{
		name: "mdbrain_procedure_outcome",
		description:
			"Record whether a procedure succeeded or failed using its stable handle. Updates outcome counters without bypassing the canonical procedure record.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable procedure handle. Use the handle returned by lifecycle get/history responses.",
				},
				success: {
					type: "boolean",
					description: "True for success, false for failure.",
				},
				note: {
					type: "string",
					description: "Optional free-text note explaining the outcome.",
				},
				actorRole: {
					type: "string",
					enum: ["user", "assistant", "system"],
					description:
						"Optional role for the actor providing the outcome signal.",
				},
			},
			required: ["handle", "success"],
		},
	},
	{
		name: "mdbrain_memory_feedback",
		description:
			"Apply confirm/correct/irrelevant feedback to a structured memory using its stable handle. Confirm reinforces, correct routes through revision-aware updates, and irrelevant invalidates with history.",
		inputSchema: {
			type: "object",
			properties: {
				handle: {
					type: "object",
					description:
						"Stable structured memory handle. Use the handle returned by lifecycle get/history responses.",
				},
				signal: {
					type: "string",
					enum: ["confirm", "correct", "irrelevant"],
					description:
						"Feedback signal. confirm reinforces; correct requires patch; irrelevant invalidates the current memory.",
				},
				patch: {
					type: "object",
					description:
						"Structured lifecycle patch required for signal=correct. Supports the same fields as lifecycle update for structured memories.",
				},
				invalidatedBy: {
					type: "object",
					description: "Optional provenance metadata when signal=irrelevant.",
				},
				note: {
					type: "string",
					description: "Optional free-text note explaining the feedback.",
				},
				actorRole: {
					type: "string",
					enum: ["user", "assistant", "system"],
					description:
						"Optional role for the actor providing the feedback signal.",
				},
			},
			required: ["handle", "signal"],
		},
	},
	{
		name: "mdbrain_status",
		description: "Memory provider status",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
			},
		},
	},
	{
		name: "mdbrain_chain_trace",
		description:
			"Trace the provenance chain of a derived fact back to its source events",
		inputSchema: {
			type: "object",
			properties: {
				factId: { type: "string" },
				collection: {
					type: "string",
					enum: [
						"structured_mem",
						"entities",
						"relations",
						"procedures",
						"entity_links",
					],
				},
				agentId: { type: "string" },
				maxDepth: { type: "number" },
			},
			required: ["factId", "collection"],
		},
	},
	{
		name: "mdbrain_novelty_scan",
		description:
			"Scan for the most novel/surprising events using vector distance scoring",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				limit: { type: "number" },
				scope: { type: "string" },
			},
		},
	},
	{
		name: "mdbrain_consolidate",
		description:
			"Run the consolidation pipeline to promote high-value events to structured facts",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				maxEvents: { type: "number" },
				minCombinedScore: { type: "number" },
				scope: { type: "string" },
			},
		},
	},
	{
		name: "mdbrain_self_edit",
		description:
			"Edit your own core memory blocks directly. Use 'user' for user preferences/profile, 'persona' for your identity/behavior, 'instructions' for task instructions. Changes persist across sessions.",
		inputSchema: {
			type: "object",
			required: ["block", "action", "content"],
			properties: {
				block: {
					type: "string",
					enum: ["user", "persona", "instructions"],
					description: "Which core memory block to edit",
				},
				action: {
					type: "string",
					enum: ["append", "replace", "prepend"],
					description: "How to modify the block",
				},
				content: {
					type: "string",
					description: "The content to write",
				},
				agentId: { type: "string" },
			},
		},
	},
	{
		name: "mdbrain_state_unified",
		description:
			"Get all three state surfaces (profile, blocks, bundle) in one call",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				scope: { type: "string" },
				scopeRef: { type: "string" },
			},
		},
	},
	{
		name: "mdbrain_benchmark_ingest",
		description:
			"Replay a benchmark conversation dataset through the canonical writeConversationEvent() pipeline",
		inputSchema: {
			type: "object",
			properties: {
				datasetPath: { type: "string", minLength: 1 },
				agentId: { type: "string" },
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				limitConversations: { type: "integer", minimum: 1 },
				limitTurnsPerConversation: { type: "integer", minimum: 1 },
			},
			required: ["datasetPath"],
		},
	},
	{
		name: "mdbrain_import_conversations",
		description:
			"Import conversation history through the canonical writeConversationEvent() pipeline",
		inputSchema: {
			type: "object",
			properties: {
				datasetPath: { type: "string", minLength: 1 },
				agentId: { type: "string" },
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				limitConversations: { type: "integer", minimum: 1 },
				limitTurnsPerConversation: { type: "integer", minimum: 1 },
			},
			required: ["datasetPath"],
		},
	},
	{
		name: "mdbrain_import_conversation_history",
		description:
			"Semantic alias for mdbrain_import_conversations. Import conversation history through the same canonical writeConversationEvent() runtime path.",
		inputSchema: {
			type: "object",
			properties: {
				datasetPath: { type: "string", minLength: 1 },
				agentId: { type: "string" },
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				limitConversations: { type: "integer", minimum: 1 },
				limitTurnsPerConversation: { type: "integer", minimum: 1 },
			},
			required: ["datasetPath"],
		},
	},
	{
		name: "mdbrain_admin_access_trends",
		description:
			"Inspect rolling 7-day access trends from the access_events time series collection",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				collection: {
					type: "string",
					enum: [
						"events",
						"structured_mem",
						"procedures",
						"episodes",
						"entities",
						"relations",
					],
				},
				memoryIds: {
					type: "array",
					items: { type: "string", minLength: 1 },
				},
				windowDays: { type: "integer", minimum: 1 },
				limit: { type: "integer", minimum: 1, maximum: 100 },
			},
		},
	},
	{
		name: "mdbrain_admin_access_summaries",
		description:
			"Inspect aggregate access counts and last-access timestamps from the access_events time series collection",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				collection: {
					type: "string",
					enum: [
						"events",
						"structured_mem",
						"procedures",
						"episodes",
						"entities",
						"relations",
					],
				},
				memoryIds: {
					type: "array",
					items: { type: "string", minLength: 1 },
				},
				windowDays: { type: "integer", minimum: 1 },
			},
			required: ["collection", "memoryIds"],
		},
	},
	{
		name: "mdbrain_admin_list_traces",
		description: "List recent recall traces for operator debugging",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				limit: { type: "integer", minimum: 1, maximum: 100 },
			},
		},
	},
	{
		name: "mdbrain_admin_get_trace",
		description: "Fetch one recall trace by traceId",
		inputSchema: {
			type: "object",
			properties: {
				traceId: { type: "string", minLength: 1 },
				agentId: { type: "string" },
			},
			required: ["traceId"],
		},
	},
	{
		name: "mdbrain_list_jobs",
		description: "List memory jobs for an agent",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				status: {
					type: "string",
					enum: ["pending", "running", "completed", "failed", "cancelled"],
				},
				limit: { type: "integer", minimum: 1, maximum: 100 },
				jobType: {
					type: "string",
					enum: [
						"consolidation",
						"extraction",
						"import",
						"materialization",
						"enrichment",
					],
				},
			},
		},
	},
	{
		name: "mdbrain_get_job",
		description: "Fetch one memory job by jobId",
		inputSchema: {
			type: "object",
			properties: {
				jobId: { type: "string", minLength: 1 },
				agentId: { type: "string" },
			},
			required: ["jobId"],
		},
	},
	{
		name: "mdbrain_search_detailed",
		description:
			"Full CRAG search pipeline with scored results, trust annotations, and source provenance",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				agentId: { type: "string" },
				limit: { type: "number" },
				maxResults: { type: "number" },
				minScore: { type: "number" },
				searchMode: { type: "string", enum: ["auto", "direct", "agentic"] },
				maxPasses: { type: "number" },
				returnPlan: { type: "boolean" },
				searchConfig: {
					type: "object",
					properties: {
						recipe: {
							type: "string",
							enum: ["fast", "hybrid", "deep", "temporal", "chain-of-thought"],
						},
						maxResults: { type: "number" },
						searchMode: {
							type: "string",
							enum: ["auto", "direct", "agentic"],
						},
						maxPasses: { type: "number" },
						sourcePreference: {
							type: "array",
							items: { type: "string" },
						},
						timeRange: {
							type: "object",
							properties: {
								preset: { type: "string" },
								start: { type: "string" },
								end: { type: "string" },
							},
						},
						needExactEvidence: { type: "boolean" },
						recallProfile: {
							type: "string",
							enum: ["latency", "balanced", "proof"],
						},
						numCandidates: { type: "number" },
						fusionMethod: {
							type: "string",
							enum: ["scoreFusion", "rankFusion", "js-merge"],
						},
						hybridMode: {
							type: "string",
							enum: ["hybrid", "vector-only"],
						},
						allowHybridBackstop: { type: "boolean" },
						lexicalPrefilter: {
							type: "string",
							enum: ["disabled", "experimental"],
						},
					},
				},
			},
			required: ["query"],
		},
	},
	{
		name: "mdbrain_hydrate_active_slate",
		description:
			"Load the highest-salience active memories (hot context for current session)",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				scope: { type: "string" },
				scopeRef: { type: "string" },
				maxItems: { type: "number" },
			},
		},
	},
	{
		name: "mdbrain_discovery_projection",
		description:
			"Build a discovery projection (entity-brief, topic-brief, what-changed, contradiction-report)",
		inputSchema: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [
						"entity-brief",
						"topic-brief",
						"what-changed",
						"contradiction-report",
					],
				},
				query: { type: "string" },
				agentId: { type: "string" },
				scope: { type: "string" },
				scopeRef: { type: "string" },
				maxItems: { type: "number" },
			},
			required: ["kind"],
		},
	},
	{
		name: "mdbrain_write_structured",
		description: "Write a structured memory entry directly",
		inputSchema: {
			type: "object",
			properties: {
				entry: { type: "object" },
				agentId: { type: "string" },
			},
			required: ["entry"],
		},
	},
	{
		name: "mdbrain_write_procedure",
		description: "Write a step-by-step procedure",
		inputSchema: {
			type: "object",
			properties: {
				entry: { type: "object" },
				agentId: { type: "string" },
			},
			required: ["entry"],
		},
	},
	{
		name: "mdbrain_status_detailed",
		description:
			"Detailed health status: events, entities, projection lag, lane coverage, diagnostics",
		inputSchema: {
			type: "object",
			properties: { agentId: { type: "string" } },
		},
	},
	{
		name: "mdbrain_stats",
		description:
			"Memory statistics: source counts, embedding coverage, index stats",
		inputSchema: {
			type: "object",
			properties: { agentId: { type: "string" } },
		},
	},
	{
		name: "mdbrain_sync",
		description: "Trigger a memory sync operation",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				reason: { type: "string" },
				force: { type: "boolean" },
			},
		},
	},
	{
		name: "mdbrain_probe_embedding",
		description: "Probe embedding model availability",
		inputSchema: {
			type: "object",
			properties: { agentId: { type: "string" } },
		},
	},
	{
		name: "mdbrain_probe_vector",
		description: "Probe vector search availability",
		inputSchema: {
			type: "object",
			properties: { agentId: { type: "string" } },
		},
	},
	{
		name: "mdbrain_relevance_explain",
		description:
			"Detailed relevance diagnostics for a query: artifacts, health, scores",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				agentId: { type: "string" },
				sourceScope: {
					type: "string",
					enum: ["all", "memory", "kb", "structured"],
				},
				maxResults: { type: "number" },
				minScore: { type: "number" },
				deep: { type: "boolean" },
			},
			required: ["query"],
		},
	},
	{
		name: "mdbrain_relevance_benchmark",
		description: "Run relevance benchmark suite",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				datasetPath: { type: "string" },
				maxResults: { type: "number" },
				minScore: { type: "number" },
			},
		},
	},
	{
		name: "mdbrain_relevance_report",
		description: "Relevance health report: hit rate, empty rate, fallback rate",
		inputSchema: {
			type: "object",
			properties: {
				agentId: { type: "string" },
				windowMs: { type: "number" },
			},
		},
	},
	{
		name: "mdbrain_relevance_sample_rate",
		description: "Current relevance sampling rate and degraded signal count",
		inputSchema: {
			type: "object",
			properties: { agentId: { type: "string" } },
		},
	},
	{
		name: "mdbrain_wiki_search",
		description:
			"Hybrid search over the MDBrain wiki (vector + full-text + RRF fusion). Returns ranked wiki pages with scoped retrieval + governance filters.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query." },
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				scopeRef: {
					type: "string",
					description: "Concrete namespace for the scope.",
				},
				kind: {
					type: "string",
					enum: [
						"entity",
						"concept",
						"synthesis",
						"source",
						"report",
						"procedure",
					],
				},
				trustTier: {
					type: "string",
					enum: ["restricted", "standard", "admin"],
				},
				recipe: { type: "string", enum: ["fast", "hybrid", "deep"] },
				maxResults: { type: "number" },
				agentId: { type: "string" },
			},
			required: ["query"],
		},
	},
	{
		name: "mdbrain_wiki_get",
		description:
			"Get a wiki page by slug (OKF concept ID, may contain slashes). Returns JSON by default, or markdown/HTML via format.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "Page slug (OKF concept ID, e.g. tables/users).",
				},
				scope: { type: "string" },
				scopeRef: { type: "string" },
				format: { type: "string", enum: ["json", "markdown", "html"] },
				agentId: { type: "string" },
			},
			required: ["slug", "scope", "scopeRef"],
		},
	},
	{
		name: "mdbrain_wiki_apply",
		description:
			"Create or update a wiki page. When the slug+scope+scopeRef matches an existing page, it updates (bumps revision); otherwise it creates a new page.",
		inputSchema: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [
						"entity",
						"concept",
						"synthesis",
						"source",
						"report",
						"procedure",
					],
				},
				title: { type: "string" },
				slug: {
					type: "string",
					description:
						"URL-safe ID = OKF concept ID (may contain slashes, e.g. tables/users).",
				},
				summary: {
					type: "string",
					description: "One-paragraph dense summary.",
				},
				body: { type: "string", description: "Full markdown body." },
				frontmatter: {
					type: "object",
					properties: {
						type: {
							type: "string",
							description:
								"OKF required field (free-form, e.g. table, concept, person).",
						},
						title: { type: "string" },
						description: { type: "string" },
						resource: { type: "string" },
						tags: { type: "array", items: { type: "string" } },
					},
					required: ["type"],
				},
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				scopeRef: { type: "string" },
				trustTier: {
					type: "string",
					enum: ["restricted", "standard", "admin"],
				},
				agentId: { type: "string" },
			},
			required: [
				"kind",
				"title",
				"slug",
				"summary",
				"body",
				"frontmatter",
				"scope",
				"scopeRef",
				"trustTier",
			],
		},
	},
	{
		name: "mdbrain_wiki_export_okf",
		description:
			"Export wiki pages to an OKF (Open Knowledge Format) bundle on disk. Portable, vendor-neutral interchange with Google Knowledge Catalog + OKF consumers.",
		inputSchema: {
			type: "object",
			properties: {
				scope: { type: "string" },
				scopeRef: { type: "string" },
				outDir: {
					type: "string",
					description: "Directory to write the bundle.",
				},
				okfBundleId: { type: "string" },
				trustTier: {
					type: "string",
					description:
						"Caller's trust tier (restricted|standard|admin) — export is governance-filtered exactly like a governed read, never an unfiltered dump.",
				},
				agentId: { type: "string" },
				returnContent: {
					type: "boolean",
					description:
						"When true, includes each exported file's content in the response, for callers without filesystem access to the API server.",
				},
			},
			required: ["scope", "scopeRef", "outDir"],
		},
	},
	{
		name: "mdbrain_wiki_import_okf",
		description:
			"Import an OKF (Open Knowledge Format) bundle directory into the wiki. Portable, vendor-neutral interchange with Google Knowledge Catalog + OKF consumers.",
		inputSchema: {
			type: "object",
			properties: {
				bundleDir: {
					type: "string",
					description: "Directory containing the OKF bundle to import.",
				},
				scope: {
					type: "string",
					enum: ["session", "user", "agent", "workspace", "tenant", "global"],
				},
				scopeRef: { type: "string" },
				trustTier: {
					type: "string",
					enum: ["restricted", "standard", "admin"],
				},
				okfBundleId: { type: "string" },
				agentId: { type: "string" },
			},
			required: ["bundleDir", "scope", "scopeRef", "trustTier", "okfBundleId"],
		},
	},
	{
		name: "mdbrain_wiki_maintain",
		description:
			"Trigger wiki self-maintenance (git-diff + Dreamer analysis) for a scope. The API route is a thin trigger — full execution runs via the CLI or webhook.",
		inputSchema: {
			type: "object",
			properties: {
				scope: { type: "string" },
				scopeRef: { type: "string" },
				agentId: { type: "string" },
			},
			required: ["scope", "scopeRef"],
		},
	},
	{
		name: "mdbrain_wiki_lint",
		description:
			"List wiki pages (optionally by kind) for lint review — spot stale/superseded entries needing attention. Contradiction surfacing lands with the T12 contradiction detector.",
		inputSchema: {
			type: "object",
			properties: {
				scope: { type: "string" },
				scopeRef: { type: "string" },
				kind: {
					type: "string",
					enum: [
						"entity",
						"concept",
						"synthesis",
						"source",
						"report",
						"procedure",
					],
				},
				limit: { type: "number" },
				agentId: { type: "string" },
			},
			required: ["scope", "scopeRef"],
		},
	},
] as const

const server = new Server(
	{
		name: "mdbrain",
		version: "0.1.0",
	},
	{
		capabilities: { tools: {} },
	},
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [...toolList],
}))

export async function handleToolCall(
	name: string,
	args: Record<string, unknown>,
	client: MdbrainMcpClient = mdbrain,
) {
	try {
		const mdbrain = client
		if (name === "mdbrain_search") {
			const out = await mdbrain.search({
				query: typeof args.query === "string" ? args.query : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				limit: typeof args.limit === "number" ? args.limit : undefined,
				minScore: typeof args.minScore === "number" ? args.minScore : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_search_kb") {
			const out = await mdbrain.searchKB({
				query: typeof args.query === "string" ? args.query : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				limit: typeof args.limit === "number" ? args.limit : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_read_file") {
			const out = await mdbrain.readFile({
				relPath: typeof args.relPath === "string" ? args.relPath : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				from: typeof args.from === "number" ? args.from : undefined,
				lines: typeof args.lines === "number" ? args.lines : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_add") {
			const out = await mdbrain.add({
				content: typeof args.content === "string" ? args.content : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				sessionId:
					typeof args.sessionId === "string" ? args.sessionId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_write_event") {
			const role = args.role
			if (
				role !== "user" &&
				role !== "assistant" &&
				role !== "system" &&
				role !== "tool"
			) {
				throw new Error("invalid role")
			}
			const out = await mdbrain.writeEvent({
				role,
				body: typeof args.body === "string" ? args.body : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				sessionId:
					typeof args.sessionId === "string" ? args.sessionId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_profile") {
			const out = await mdbrain.profile({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_build_context_bundle") {
			const scope = args.scope
			if (
				scope !== undefined &&
				scope !== "session" &&
				scope !== "user" &&
				scope !== "agent" &&
				scope !== "workspace" &&
				scope !== "tenant" &&
				scope !== "global"
			) {
				throw new Error("invalid scope")
			}
			const discoveryKind = args.discoveryKind
			if (
				discoveryKind !== undefined &&
				discoveryKind !== "entity-brief" &&
				discoveryKind !== "topic-brief" &&
				discoveryKind !== "what-changed" &&
				discoveryKind !== "contradiction-report"
			) {
				throw new Error("invalid discoveryKind")
			}
			const validatedScope =
				scope === "session" ||
				scope === "user" ||
				scope === "agent" ||
				scope === "workspace" ||
				scope === "tenant" ||
				scope === "global"
					? scope
					: undefined
			const validatedDiscoveryKind =
				discoveryKind === "entity-brief" ||
				discoveryKind === "topic-brief" ||
				discoveryKind === "what-changed" ||
				discoveryKind === "contradiction-report"
					? discoveryKind
					: undefined
			const timeRange =
				typeof args.timeRange === "object" &&
				args.timeRange !== null &&
				!Array.isArray(args.timeRange)
					? (args.timeRange as Record<string, unknown>)
					: undefined
			const out = await mdbrain.buildContextBundle({
				query: typeof args.query === "string" ? args.query : undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scope: validatedScope,
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : undefined,
				sessionId:
					typeof args.sessionId === "string" ? args.sessionId : undefined,
				tokenBudget:
					typeof args.tokenBudget === "number" ? args.tokenBudget : undefined,
				maxActiveItems:
					typeof args.maxActiveItems === "number"
						? args.maxActiveItems
						: undefined,
				maxEvidenceItems:
					typeof args.maxEvidenceItems === "number"
						? args.maxEvidenceItems
						: undefined,
				maxRecentEvents:
					typeof args.maxRecentEvents === "number"
						? args.maxRecentEvents
						: undefined,
				includeDiscoveryProjection:
					typeof args.includeDiscoveryProjection === "boolean"
						? args.includeDiscoveryProjection
						: undefined,
				discoveryKind: validatedDiscoveryKind,
				includeProfile:
					typeof args.includeProfile === "boolean"
						? args.includeProfile
						: undefined,
				timeRange: timeRange
					? {
							preset:
								typeof timeRange.preset === "string"
									? timeRange.preset
									: undefined,
							start:
								typeof timeRange.start === "string"
									? timeRange.start
									: undefined,
							end:
								typeof timeRange.end === "string" ? timeRange.end : undefined,
						}
					: undefined,
				mode:
					args.mode === "wake-up" || args.mode === "full"
						? args.mode
						: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_status") {
			const out = await mdbrain.status(
				typeof args.agentId === "string" ? args.agentId : undefined,
			)
			const guidance = {
				quickStart:
					"Call mdbrain_profile first. Then mdbrain_search_detailed for queries. Use mdbrain_write_event to save insights.",
				bestPractices: [
					"Call mdbrain_profile or mdbrain_state_unified at session start",
					"Save decisions with mdbrain_write_structured",
					"Use mdbrain_search_detailed before answering knowledge questions",
					"Use mdbrain_build_context_bundle with mode: wake-up for fast session start",
				],
				capabilities: [
					"semantic search",
					"knowledge base search",
					"graph traversal",
					"memory consolidation",
					"profile loading",
					"novelty detection",
					"reasoning chain tracing",
					"active slate hydration",
					"discovery projections",
					"context bundle assembly",
				],
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ ...out, guidance }) }],
			}
		}
		if (RECALL_TOOL_NAMES.has(name)) {
			const roles = Array.isArray(args.roles)
				? args.roles.filter(
						(role): role is "user" | "assistant" | "system" | "tool" =>
							role === "user" ||
							role === "assistant" ||
							role === "system" ||
							role === "tool",
					)
				: undefined
			if (Array.isArray(args.roles) && roles?.length !== args.roles.length) {
				throw new Error("roles must contain only user|assistant|system|tool")
			}
			const out = await mdbrain.recallConversation({
				query: typeof args.query === "string" ? args.query : undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				sessionId:
					typeof args.sessionId === "string" ? args.sessionId : undefined,
				roles,
				startTime:
					typeof args.startTime === "string" ? args.startTime : undefined,
				endTime: typeof args.endTime === "string" ? args.endTime : undefined,
				timezone: typeof args.timezone === "string" ? args.timezone : undefined,
				includeToolMessages:
					typeof args.includeToolMessages === "boolean"
						? args.includeToolMessages
						: undefined,
				limit:
					typeof args.limit === "number"
						? Math.max(1, Math.min(200, Math.floor(args.limit)))
						: undefined,
			})
			return jsonResult(out)
		}
		if (LIFECYCLE_GET_TOOL_NAMES.has(name)) {
			const out = await mdbrain.getLifecycleItem({
				handle:
					typeof args.handle === "object" && args.handle !== null
						? (args.handle as any)
						: ({} as any),
			})
			return jsonResult(out)
		}
		if (LIFECYCLE_UPDATE_TOOL_NAMES.has(name)) {
			const out = await mdbrain.updateLifecycleItem({
				handle:
					typeof args.handle === "object" && args.handle !== null
						? (args.handle as any)
						: ({} as any),
				patch:
					typeof args.patch === "object" && args.patch !== null
						? (args.patch as any)
						: ({} as any),
			})
			return jsonResult(out)
		}
		if (LIFECYCLE_DELETE_TOOL_NAMES.has(name)) {
			const out = await mdbrain.deleteLifecycleItem({
				handle:
					typeof args.handle === "object" && args.handle !== null
						? (args.handle as any)
						: ({} as any),
				...(typeof args.invalidatedBy === "object" &&
				args.invalidatedBy !== null
					? { invalidatedBy: args.invalidatedBy as Record<string, unknown> }
					: {}),
			})
			return jsonResult(out)
		}
		if (LIFECYCLE_HISTORY_TOOL_NAMES.has(name)) {
			const out = await mdbrain.getLifecycleHistory({
				handle:
					typeof args.handle === "object" && args.handle !== null
						? (args.handle as any)
						: ({} as any),
				limit:
					typeof args.limit === "number"
						? Math.max(1, Math.min(200, Math.floor(args.limit)))
						: undefined,
			})
			return jsonResult(out)
		}
		if (name === "mdbrain_procedure_outcome") {
			if (typeof args.success !== "boolean") {
				throw new Error("success must be a boolean")
			}
			if (
				args.actorRole !== undefined &&
				args.actorRole !== "user" &&
				args.actorRole !== "assistant" &&
				args.actorRole !== "system"
			) {
				throw new Error("actorRole must be user|assistant|system")
			}
			const actorRole: "user" | "assistant" | "system" | undefined =
				args.actorRole === "user" ||
				args.actorRole === "assistant" ||
				args.actorRole === "system"
					? args.actorRole
					: undefined
			const out = await mdbrain.reportProcedureOutcome({
				handle:
					typeof args.handle === "object" && args.handle !== null
						? (args.handle as any)
						: ({} as any),
				success: args.success,
				...(typeof args.note === "string" ? { note: args.note } : {}),
				...(actorRole ? { actorRole } : {}),
			})
			return jsonResult(out)
		}
		if (name === "mdbrain_memory_feedback") {
			const signal =
				args.signal === "confirm" ||
				args.signal === "correct" ||
				args.signal === "irrelevant"
					? args.signal
					: null
			if (!signal) {
				throw new Error("signal must be confirm|correct|irrelevant")
			}
			if (
				args.actorRole !== undefined &&
				args.actorRole !== "user" &&
				args.actorRole !== "assistant" &&
				args.actorRole !== "system"
			) {
				throw new Error("actorRole must be user|assistant|system")
			}
			const actorRole: "user" | "assistant" | "system" | undefined =
				args.actorRole === "user" ||
				args.actorRole === "assistant" ||
				args.actorRole === "system"
					? args.actorRole
					: undefined
			const handle =
				typeof args.handle === "object" && args.handle !== null
					? (args.handle as any)
					: ({} as any)
			const common = {
				handle,
				...(typeof args.note === "string" ? { note: args.note } : {}),
				...(actorRole ? { actorRole } : {}),
			}
			const out =
				signal === "correct"
					? await mdbrain.applyMemoryFeedback({
							...common,
							signal,
							patch:
								typeof args.patch === "object" && args.patch !== null
									? (args.patch as any)
									: ({} as any),
						})
					: signal === "irrelevant"
						? await mdbrain.applyMemoryFeedback({
								...common,
								signal,
								...(typeof args.invalidatedBy === "object" &&
								args.invalidatedBy !== null
									? {
											invalidatedBy: args.invalidatedBy as Record<
												string,
												unknown
											>,
										}
									: {}),
							})
						: await mdbrain.applyMemoryFeedback({
								...common,
								signal,
							})
			return jsonResult(out)
		}
		if (name === "mdbrain_chain_trace") {
			const out = await mdbrain.traceChain({
				factId: typeof args.factId === "string" ? args.factId : "",
				collection: typeof args.collection === "string" ? args.collection : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_novelty_scan") {
			const out = await mdbrain.scanNovelty({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				limit: typeof args.limit === "number" ? args.limit : undefined,
				scope: typeof args.scope === "string" ? args.scope : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_consolidate") {
			const out = await mdbrain.consolidate({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				maxEvents:
					typeof args.maxEvents === "number" ? args.maxEvents : undefined,
				minCombinedScore:
					typeof args.minCombinedScore === "number"
						? args.minCombinedScore
						: undefined,
				scope: typeof args.scope === "string" ? args.scope : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_self_edit") {
			const block = typeof args.block === "string" ? args.block : ""
			const action = typeof args.action === "string" ? args.action : "replace"
			const validBlocks = ["user", "persona", "instructions"]
			const validActions = ["append", "replace", "prepend"]
			if (!validBlocks.includes(block)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "block must be user|persona|instructions",
							}),
						},
					],
					isError: true,
				}
			}
			if (!validActions.includes(action)) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: "action must be append|replace|prepend",
							}),
						},
					],
					isError: true,
				}
			}
			const out = await mdbrain.selfEdit({
				block: block as "user" | "persona" | "instructions",
				action: action as "append" | "replace" | "prepend",
				content: typeof args.content === "string" ? args.content : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_search_detailed") {
			const searchConfig =
				typeof args.searchConfig === "object" &&
				args.searchConfig !== null &&
				!Array.isArray(args.searchConfig)
					? (args.searchConfig as Record<string, unknown>)
					: undefined
			const searchConfigTimeRange =
				typeof searchConfig?.timeRange === "object" &&
				searchConfig.timeRange !== null &&
				!Array.isArray(searchConfig.timeRange)
					? (searchConfig.timeRange as Record<string, unknown>)
					: undefined
			const searchConfigSourcePreference = Array.isArray(
				searchConfig?.sourcePreference,
			)
				? searchConfig.sourcePreference.filter(
						(
							value,
						): value is
							| "reference"
							| "conversation"
							| "structured"
							| "procedural"
							| "episodic"
							| "graph" =>
							value === "reference" ||
							value === "conversation" ||
							value === "structured" ||
							value === "procedural" ||
							value === "episodic" ||
							value === "graph",
					)
				: undefined
			const out = await mdbrain.searchDetailed({
				query: typeof args.query === "string" ? args.query : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				limit: typeof args.limit === "number" ? args.limit : undefined,
				maxResults:
					typeof args.maxResults === "number" ? args.maxResults : undefined,
				minScore: typeof args.minScore === "number" ? args.minScore : undefined,
				searchMode:
					args.searchMode === "auto" ||
					args.searchMode === "direct" ||
					args.searchMode === "agentic"
						? args.searchMode
						: undefined,
				maxPasses:
					typeof args.maxPasses === "number" ? args.maxPasses : undefined,
				returnPlan:
					typeof args.returnPlan === "boolean" ? args.returnPlan : undefined,
				searchConfig: searchConfig
					? {
							recipe:
								searchConfig.recipe === "fast" ||
								searchConfig.recipe === "hybrid" ||
								searchConfig.recipe === "deep" ||
								searchConfig.recipe === "temporal" ||
								searchConfig.recipe === "chain-of-thought"
									? searchConfig.recipe
									: undefined,
							maxResults:
								typeof searchConfig.maxResults === "number"
									? searchConfig.maxResults
									: undefined,
							searchMode:
								searchConfig.searchMode === "auto" ||
								searchConfig.searchMode === "direct" ||
								searchConfig.searchMode === "agentic"
									? searchConfig.searchMode
									: undefined,
							maxPasses:
								typeof searchConfig.maxPasses === "number"
									? searchConfig.maxPasses
									: undefined,
							sourcePreference: searchConfigSourcePreference,
							timeRange: searchConfigTimeRange
								? {
										preset:
											typeof searchConfigTimeRange.preset === "string"
												? searchConfigTimeRange.preset
												: undefined,
										start:
											typeof searchConfigTimeRange.start === "string"
												? searchConfigTimeRange.start
												: undefined,
										end:
											typeof searchConfigTimeRange.end === "string"
												? searchConfigTimeRange.end
												: undefined,
									}
								: undefined,
							needExactEvidence:
								typeof searchConfig.needExactEvidence === "boolean"
									? searchConfig.needExactEvidence
									: undefined,
							recallProfile:
								searchConfig.recallProfile === "latency" ||
								searchConfig.recallProfile === "balanced" ||
								searchConfig.recallProfile === "proof"
									? searchConfig.recallProfile
									: undefined,
							numCandidates:
								typeof searchConfig.numCandidates === "number"
									? searchConfig.numCandidates
									: undefined,
							fusionMethod:
								searchConfig.fusionMethod === "scoreFusion" ||
								searchConfig.fusionMethod === "rankFusion" ||
								searchConfig.fusionMethod === "js-merge"
									? searchConfig.fusionMethod
									: undefined,
							hybridMode:
								searchConfig.hybridMode === "hybrid" ||
								searchConfig.hybridMode === "vector-only"
									? searchConfig.hybridMode
									: undefined,
							allowHybridBackstop:
								typeof searchConfig.allowHybridBackstop === "boolean"
									? searchConfig.allowHybridBackstop
									: undefined,
							lexicalPrefilter:
								searchConfig.lexicalPrefilter === "disabled" ||
								searchConfig.lexicalPrefilter === "experimental"
									? searchConfig.lexicalPrefilter
									: undefined,
						}
					: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_hydrate_active_slate") {
			const out = await mdbrain.hydrateActiveSlate({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scope:
					typeof args.scope === "string" ? (args.scope as "user") : undefined,
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : undefined,
				maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_discovery_projection") {
			const kind = args.kind
			if (
				kind !== "entity-brief" &&
				kind !== "topic-brief" &&
				kind !== "what-changed" &&
				kind !== "contradiction-report"
			) {
				throw new Error(
					"kind is required and must be entity-brief|topic-brief|what-changed|contradiction-report",
				)
			}
			const out = await mdbrain.buildDiscoveryProjection({
				kind,
				query: typeof args.query === "string" ? args.query : undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scope:
					typeof args.scope === "string" ? (args.scope as "user") : undefined,
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : undefined,
				maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_write_structured") {
			const entry =
				typeof args.entry === "object" && args.entry !== null
					? (args.entry as Record<string, unknown>)
					: {}
			const out = await mdbrain.writeStructured({
				entry,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_write_procedure") {
			const entry =
				typeof args.entry === "object" && args.entry !== null
					? (args.entry as Record<string, unknown>)
					: {}
			const out = await mdbrain.writeProcedure({
				entry,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_status_detailed") {
			const out = await mdbrain.getDetailedStatus(
				typeof args.agentId === "string" ? args.agentId : undefined,
			)
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_stats") {
			const out = await mdbrain.stats(
				typeof args.agentId === "string" ? args.agentId : undefined,
			)
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_sync") {
			const out = await mdbrain.sync({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				reason: typeof args.reason === "string" ? args.reason : undefined,
				force: typeof args.force === "boolean" ? args.force : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_probe_embedding") {
			const out = await mdbrain.probeEmbedding(
				typeof args.agentId === "string" ? args.agentId : undefined,
			)
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_probe_vector") {
			const out = await mdbrain.probeVector(
				typeof args.agentId === "string" ? args.agentId : undefined,
			)
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_relevance_explain") {
			const out = await mdbrain.relevanceExplain({
				query: typeof args.query === "string" ? args.query : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				sourceScope:
					args.sourceScope === "all" ||
					args.sourceScope === "memory" ||
					args.sourceScope === "kb" ||
					args.sourceScope === "structured"
						? args.sourceScope
						: undefined,
				maxResults:
					typeof args.maxResults === "number" ? args.maxResults : undefined,
				minScore: typeof args.minScore === "number" ? args.minScore : undefined,
				deep: typeof args.deep === "boolean" ? args.deep : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_relevance_benchmark") {
			const out = await mdbrain.relevanceBenchmark({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				datasetPath:
					typeof args.datasetPath === "string" ? args.datasetPath : undefined,
				maxResults:
					typeof args.maxResults === "number" ? args.maxResults : undefined,
				minScore: typeof args.minScore === "number" ? args.minScore : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_relevance_report") {
			const out = await mdbrain.relevanceReport(
				typeof args.agentId === "string" ? args.agentId : undefined,
				typeof args.windowMs === "number" ? args.windowMs : undefined,
			)
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_relevance_sample_rate") {
			const out = await mdbrain.relevanceSampleRate(
				typeof args.agentId === "string" ? args.agentId : undefined,
			)
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_state_unified") {
			const out = await mdbrain.state({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scope:
					typeof args.scope === "string"
						? (args.scope as
								| "session"
								| "user"
								| "agent"
								| "workspace"
								| "tenant"
								| "global")
						: undefined,
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : undefined,
			})
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(out),
					},
				],
			}
		}
		if (name === "mdbrain_benchmark_ingest") {
			if (
				typeof args.datasetPath !== "string" ||
				args.datasetPath.length === 0
			) {
				throw new Error("datasetPath is required")
			}
			const out = await mdbrain.benchmarkIngest({
				datasetPath: args.datasetPath,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scope:
					args.scope === "session" ||
					args.scope === "user" ||
					args.scope === "agent" ||
					args.scope === "workspace" ||
					args.scope === "tenant" ||
					args.scope === "global"
						? args.scope
						: undefined,
				limitConversations:
					typeof args.limitConversations === "number"
						? args.limitConversations
						: undefined,
				limitTurnsPerConversation:
					typeof args.limitTurnsPerConversation === "number"
						? args.limitTurnsPerConversation
						: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (IMPORT_TOOL_NAMES.has(name)) {
			if (
				typeof args.datasetPath !== "string" ||
				args.datasetPath.length === 0
			) {
				throw new Error("datasetPath is required")
			}
			const out = await mdbrain.importConversations({
				datasetPath: args.datasetPath,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				scope:
					args.scope === "session" ||
					args.scope === "user" ||
					args.scope === "agent" ||
					args.scope === "workspace" ||
					args.scope === "tenant" ||
					args.scope === "global"
						? args.scope
						: undefined,
				limitConversations:
					typeof args.limitConversations === "number"
						? args.limitConversations
						: undefined,
				limitTurnsPerConversation:
					typeof args.limitTurnsPerConversation === "number"
						? args.limitTurnsPerConversation
						: undefined,
			})
			return jsonResult(out)
		}
		if (name === "mdbrain_admin_access_trends") {
			const out = await mdbrain.accessTrends({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				collection:
					args.collection === "events" ||
					args.collection === "structured_mem" ||
					args.collection === "procedures" ||
					args.collection === "episodes" ||
					args.collection === "entities" ||
					args.collection === "relations"
						? args.collection
						: undefined,
				memoryIds: Array.isArray(args.memoryIds)
					? args.memoryIds.filter(
							(memoryId): memoryId is string =>
								typeof memoryId === "string" && memoryId.trim().length > 0,
						)
					: undefined,
				windowDays:
					typeof args.windowDays === "number" ? args.windowDays : undefined,
				limit:
					typeof args.limit === "number"
						? Math.max(1, Math.min(100, Math.floor(args.limit)))
						: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_admin_access_summaries") {
			const memoryIds = Array.isArray(args.memoryIds)
				? args.memoryIds.filter(
						(memoryId): memoryId is string =>
							typeof memoryId === "string" && memoryId.trim().length > 0,
					)
				: []
			if (memoryIds.length === 0) {
				throw new Error("memoryIds is required")
			}
			if (
				args.collection !== "events" &&
				args.collection !== "structured_mem" &&
				args.collection !== "procedures" &&
				args.collection !== "episodes" &&
				args.collection !== "entities" &&
				args.collection !== "relations"
			) {
				throw new Error("collection is required")
			}
			const out = await mdbrain.accessSummaries({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				collection: args.collection,
				memoryIds,
				windowDays:
					typeof args.windowDays === "number" ? args.windowDays : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_admin_list_traces") {
			const out = await mdbrain.listRecallTraces({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				limit:
					typeof args.limit === "number"
						? Math.max(1, Math.min(100, Math.floor(args.limit)))
						: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_admin_get_trace") {
			if (typeof args.traceId !== "string" || !args.traceId.trim()) {
				throw new Error("traceId is required")
			}
			const out = await mdbrain.getRecallTrace({
				traceId: args.traceId,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_list_jobs") {
			const out = await mdbrain.listJobs({
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				status:
					args.status === "pending" ||
					args.status === "running" ||
					args.status === "completed" ||
					args.status === "failed" ||
					args.status === "cancelled"
						? args.status
						: undefined,
				limit:
					typeof args.limit === "number"
						? Math.max(1, Math.min(100, Math.floor(args.limit)))
						: undefined,
				jobType:
					args.jobType === "consolidation" ||
					args.jobType === "extraction" ||
					args.jobType === "import" ||
					args.jobType === "materialization" ||
					args.jobType === "enrichment"
						? args.jobType
						: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_get_job") {
			if (typeof args.jobId !== "string" || !args.jobId.trim()) {
				throw new Error("jobId is required")
			}
			const out = await mdbrain.getJob({
				jobId: args.jobId,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_search") {
			const out = await mdbrain.wikiSearch({
				query: typeof args.query === "string" ? args.query : "",
				scope: typeof args.scope === "string" ? args.scope : undefined,
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : undefined,
				kind: typeof args.kind === "string" ? args.kind : undefined,
				trustTier:
					typeof args.trustTier === "string" ? args.trustTier : undefined,
				recipe:
					args.recipe === "fast" ||
					args.recipe === "hybrid" ||
					args.recipe === "deep"
						? args.recipe
						: undefined,
				maxResults:
					typeof args.maxResults === "number" ? args.maxResults : undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_get") {
			const out = await mdbrain.wikiGet({
				slug: typeof args.slug === "string" ? args.slug : "",
				scope: typeof args.scope === "string" ? args.scope : "",
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : "",
				format:
					args.format === "markdown" ||
					args.format === "html" ||
					args.format === "json"
						? args.format
						: undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_apply") {
			const out = await mdbrain.wikiApply({
				kind: typeof args.kind === "string" ? args.kind : "",
				title: typeof args.title === "string" ? args.title : "",
				slug: typeof args.slug === "string" ? args.slug : "",
				summary: typeof args.summary === "string" ? args.summary : "",
				body: typeof args.body === "string" ? args.body : "",
				frontmatter: (args.frontmatter ?? {}) as {
					type: string
					title?: string
					description?: string
					resource?: string
					tags?: string[]
					entityTypes?: string[]
					privacyTier?: string
				},
				scope: typeof args.scope === "string" ? args.scope : "",
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : "",
				trustTier: typeof args.trustTier === "string" ? args.trustTier : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_export_okf") {
			const out = await mdbrain.wikiExportOkf({
				scope: typeof args.scope === "string" ? args.scope : "",
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : "",
				outDir: typeof args.outDir === "string" ? args.outDir : "",
				okfBundleId:
					typeof args.okfBundleId === "string" ? args.okfBundleId : undefined,
				trustTier:
					typeof args.trustTier === "string" ? args.trustTier : undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
				returnContent:
					typeof args.returnContent === "boolean"
						? args.returnContent
						: undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_import_okf") {
			const trustTier = args.trustTier
			if (
				trustTier !== "restricted" &&
				trustTier !== "standard" &&
				trustTier !== "admin"
			) {
				throw new Error("trustTier must be restricted|standard|admin")
			}
			const out = await mdbrain.wikiImportOkf({
				bundleDir: typeof args.bundleDir === "string" ? args.bundleDir : "",
				scope: typeof args.scope === "string" ? args.scope : "",
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : "",
				trustTier,
				okfBundleId:
					typeof args.okfBundleId === "string" ? args.okfBundleId : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_maintain") {
			const out = await mdbrain.wikiMaintain({
				scope: typeof args.scope === "string" ? args.scope : "",
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : "",
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		if (name === "mdbrain_wiki_lint") {
			const out = await mdbrain.wikiLint({
				scope: typeof args.scope === "string" ? args.scope : "",
				scopeRef: typeof args.scopeRef === "string" ? args.scopeRef : "",
				kind: typeof args.kind === "string" ? args.kind : undefined,
				limit: typeof args.limit === "number" ? args.limit : undefined,
				agentId: typeof args.agentId === "string" ? args.agentId : undefined,
			})
			return { content: [{ type: "text", text: JSON.stringify(out) }] }
		}
		throw new Error(`unknown tool: ${name}`)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return jsonResult({ error: message }, true)
	}
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	return handleToolCall(
		request.params.name,
		(request.params.arguments ?? {}) as Record<string, unknown>,
	)
})

async function main(): Promise<void> {
	const transport = new StdioServerTransport()
	await server.connect(transport)
}

const entrypointHref = process.argv[1]
	? pathToFileURL(process.argv[1]).href
	: undefined

if (import.meta.url === entrypointHref) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
