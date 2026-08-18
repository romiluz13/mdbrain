import type { MdbrainClient } from "@mdbrain/client"
/**
 * Vercel AI SDK–compatible tool definitions that call the Mdbrain HTTP API
 * (same integration role as @supermemory/tools).
 */
import { tool, type Tool } from "ai"
import { z } from "zod"

/* ------------------------------------------------------------------ */
/*  SDK middleware re-exports                                          */
/* ------------------------------------------------------------------ */

export {
	withMdbrain,
	type MdbrainCoreOptions,
	type MdbrainWriteFailure,
} from "./vercel/index.js"
export { createOpenAIMiddleware } from "./openai/index.js"

const searchSchema = z.object({
	query: z.string(),
	agentId: z.string().optional(),
	limit: z.number().optional(),
	minScore: z.number().optional(),
	scope: z
		.enum(["session", "user", "agent", "workspace", "tenant", "global"])
		.optional(),
	scopeRef: z.string().optional(),
})

const searchKbSchema = z.object({
	query: z.string(),
	agentId: z.string().optional(),
	limit: z.number().optional(),
})

const readFileSchema = z.object({
	relPath: z.string(),
	agentId: z.string().optional(),
	from: z.number().optional(),
	lines: z.number().optional(),
})

const addSchema = z.object({
	content: z.string(),
	idempotencyKey: z.string().min(1),
	requestId: z.string().min(1).optional(),
	agentId: z.string().optional(),
	sessionId: z.string().optional(),
	scope: z
		.enum(["session", "user", "agent", "workspace", "tenant", "global"])
		.optional(),
	scopeRef: z.string().optional(),
})

const writeEventSchema = z.object({
	role: z.enum(["user", "assistant", "system", "tool"]),
	body: z.string(),
	idempotencyKey: z.string().min(1),
	requestId: z.string().min(1).optional(),
	agentId: z.string().optional(),
	sessionId: z.string().optional(),
	scope: z
		.enum(["session", "user", "agent", "workspace", "tenant", "global"])
		.optional(),
	scopeRef: z.string().optional(),
})

const profileSchema = z.object({
	agentId: z.string().optional(),
	scopeRef: z.string().optional(),
})

const contextBundleSchema = z.object({
	query: z.string().optional(),
	agentId: z.string().optional(),
	scope: z
		.enum(["session", "user", "agent", "workspace", "tenant", "global"])
		.optional(),
	scopeRef: z.string().optional(),
	sessionId: z.string().optional(),
	tokenBudget: z.number().optional(),
	maxActiveItems: z.number().optional(),
	maxEvidenceItems: z.number().optional(),
	maxRecentEvents: z.number().optional(),
	includeDiscoveryProjection: z.boolean().optional(),
	discoveryKind: z
		.enum([
			"entity-brief",
			"topic-brief",
			"what-changed",
			"contradiction-report",
		])
		.optional(),
	includeProfile: z.boolean().optional(),
	timeRange: z
		.object({
			preset: z.string().optional(),
			start: z.string().optional(),
			end: z.string().optional(),
		})
		.optional(),
	mode: z.enum(["full", "wake-up"]).optional(),
})

const recallConversationSchema = z.object({
	query: z.string().optional(),
	agentId: z.string().optional(),
	sessionId: z.string().optional(),
	roles: z.array(z.enum(["user", "assistant", "system", "tool"])).optional(),
	startTime: z.string().optional(),
	endTime: z.string().optional(),
	timezone: z.string().optional(),
	includeToolMessages: z.boolean().optional(),
	limit: z.number().int().positive().max(200).optional(),
})

const lifecycleScopeSchema = z.enum([
	"session",
	"user",
	"agent",
	"workspace",
	"tenant",
	"global",
])

const lifecycleStateSchema = z.enum(["active", "invalidated", "conflicted"])

const sourceAgentSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	runId: z.string().optional(),
})

const structuredHandleSchema = z.object({
	family: z.literal("structured"),
	id: z.string().min(1),
	agentId: z.string().min(1),
	scope: lifecycleScopeSchema,
	scopeRef: z.string().min(1),
	revision: z.number().int().positive(),
	state: lifecycleStateSchema,
	validFrom: z.string().optional(),
	validTo: z.string().optional(),
	updatedAt: z.string().optional(),
	structured: z.object({
		type: z.string().min(1),
		key: z.string().min(1),
	}),
})

const procedureHandleSchema = z.object({
	family: z.literal("procedure"),
	id: z.string().min(1),
	agentId: z.string().min(1),
	scope: lifecycleScopeSchema,
	scopeRef: z.string().min(1),
	revision: z.number().int().positive(),
	state: lifecycleStateSchema,
	validFrom: z.string().optional(),
	validTo: z.string().optional(),
	updatedAt: z.string().optional(),
	procedure: z.object({
		procedureId: z.string().min(1),
	}),
})

const lifecycleHandleSchema = z.union([
	structuredHandleSchema,
	procedureHandleSchema,
])

const structuredLifecyclePatchSchema = z
	.object({
		value: z.string().optional(),
		context: z.string().optional(),
		confidence: z.number().optional(),
		source: z.string().optional(),
		sessionId: z.string().optional(),
		tags: z.array(z.string()).optional(),
		salience: z.string().optional(),
		temporalScope: z.string().optional(),
		provenance: z.record(z.string(), z.unknown()).optional(),
		sourceEventIds: z.array(z.string()).optional(),
		validTo: z.string().optional(),
		reviewAt: z.string().optional(),
		lastConfirmedAt: z.string().optional(),
		sourceReliability: z.number().optional(),
		sourceAgent: sourceAgentSchema.optional(),
		artifact: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "patch must contain at least one supported field",
	})

const procedureLifecyclePatchSchema = z
	.object({
		name: z.string().optional(),
		intentTags: z.array(z.string()).optional(),
		triggerQueries: z.array(z.string()).optional(),
		steps: z.array(z.string()).optional(),
		successSignals: z.array(z.string()).optional(),
		confidence: z.number().optional(),
		provenance: z.record(z.string(), z.unknown()).optional(),
		sourceEventIds: z.array(z.string()).optional(),
		sourceAgent: sourceAgentSchema.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "patch must contain at least one supported field",
	})

const lifecycleGetSchema = z.object({
	handle: lifecycleHandleSchema,
})

const lifecycleUpdateSchema = z.union([
	z.object({
		handle: structuredHandleSchema,
		patch: structuredLifecyclePatchSchema,
	}),
	z.object({
		handle: procedureHandleSchema,
		patch: procedureLifecyclePatchSchema,
	}),
])

const lifecycleDeleteSchema = z.object({
	handle: lifecycleHandleSchema,
	invalidatedBy: z.record(z.string(), z.unknown()).optional(),
})

const lifecycleHistorySchema = z.object({
	handle: lifecycleHandleSchema,
	limit: z.number().int().positive().max(200).optional(),
})

const actorRoleSchema = z.enum(["user", "assistant", "system"])

const procedureOutcomeSchema = z.object({
	handle: procedureHandleSchema,
	success: z.boolean(),
	note: z.string().optional(),
	actorRole: actorRoleSchema.optional(),
})

const memoryFeedbackSchema = z.union([
	z.object({
		handle: structuredHandleSchema,
		signal: z.literal("confirm"),
		note: z.string().optional(),
		actorRole: actorRoleSchema.optional(),
	}),
	z.object({
		handle: structuredHandleSchema,
		signal: z.literal("correct"),
		patch: structuredLifecyclePatchSchema,
		note: z.string().optional(),
		actorRole: actorRoleSchema.optional(),
	}),
	z.object({
		handle: structuredHandleSchema,
		signal: z.literal("irrelevant"),
		invalidatedBy: z.record(z.string(), z.unknown()).optional(),
		note: z.string().optional(),
		actorRole: actorRoleSchema.optional(),
	}),
])

const benchmarkIngestSchema = z.object({
	datasetPath: z.string().min(1),
	agentId: z.string().optional(),
	scope: z
		.enum(["session", "user", "agent", "workspace", "tenant", "global"])
		.optional(),
	limitConversations: z.number().int().positive().optional(),
	limitTurnsPerConversation: z.number().int().positive().optional(),
})

const conversationImportSchema = benchmarkIngestSchema

const accessTrendsSchema = z.object({
	agentId: z.string().optional(),
	collection: z
		.enum([
			"events",
			"structured_mem",
			"procedures",
			"episodes",
			"entities",
			"relations",
		])
		.optional(),
	memoryIds: z.array(z.string().min(1)).optional(),
	windowDays: z.number().int().positive().optional(),
	limit: z.number().int().min(1).max(100).optional(),
})

const accessSummariesSchema = z.object({
	agentId: z.string().optional(),
	collection: z.enum([
		"events",
		"structured_mem",
		"procedures",
		"episodes",
		"entities",
		"relations",
	]),
	memoryIds: z.array(z.string().min(1)).min(1),
	windowDays: z.number().int().positive().optional(),
})

export type MdbrainToolSet = Record<string, Tool>

export function createMdbrainTools(client: MdbrainClient): MdbrainToolSet {
	return {
		mdbrain_search: tool({
			description: "Search Mdbrain memory (MongoDB-backed hybrid retrieval).",
			inputSchema: searchSchema,
			execute: async (input) => {
				const { results } = await client.search(input)
				return { results }
			},
		}),
		mdbrain_search_kb: tool({
			description: "Search Mdbrain knowledge base chunks only.",
			inputSchema: searchKbSchema,
			execute: async (input) => {
				const { results } = await client.searchKB({
					query: input.query,
					agentId: input.agentId,
					limit: input.limit,
				})
				return { results }
			},
		}),
		mdbrain_add: tool({
			description: "Append a user message to conversational memory.",
			inputSchema: addSchema,
			execute: async (input) => client.add(input),
		}),
		mdbrain_write_event: tool({
			description: "Write a full conversation event (any role).",
			inputSchema: writeEventSchema,
			execute: async (input) => client.writeEvent(input),
		}),
		mdbrain_profile: tool({
			description: "Synthesize a profile from Mdbrain memory.",
			inputSchema: profileSchema,
			execute: async (input) => client.profile(input),
		}),
		mdbrain_build_context_bundle: tool({
			description:
				"Build a prompt-ready Mdbrain context bundle from durable memory and recent events.",
			inputSchema: contextBundleSchema,
			execute: async (input) => client.buildContextBundle(input),
		}),
		mdbrain_recall_conversation: tool({
			description:
				"Search past conversation messages by content, session, role, and exact time range. Use ISO 8601 timestamps; date-only values should include timezone when local day boundaries matter.",
			inputSchema: recallConversationSchema,
			execute: async (input) => client.recallConversation(input),
		}),
		mdbrain_lifecycle_get: tool({
			description:
				"Get the current structured memory or procedure referenced by a stable lifecycle handle.",
			inputSchema: lifecycleGetSchema,
			execute: async (input) => client.getLifecycleItem(input),
		}),
		mdbrain_lifecycle_update: tool({
			description:
				"Update a structured memory or procedure via its stable lifecycle handle. Reuses revision history instead of overwriting in place.",
			inputSchema: lifecycleUpdateSchema,
			execute: async (input) => client.updateLifecycleItem(input),
		}),
		mdbrain_lifecycle_delete: tool({
			description:
				"Delete a memory item using Mdbrain lifecycle semantics. This invalidates the current version and preserves history instead of hard-deleting it.",
			inputSchema: lifecycleDeleteSchema,
			execute: async (input) => client.deleteLifecycleItem(input),
		}),
		mdbrain_lifecycle_history: tool({
			description:
				"Fetch ordered revision history for a structured memory or procedure from its stable lifecycle handle.",
			inputSchema: lifecycleHistorySchema,
			execute: async (input) => client.getLifecycleHistory(input),
		}),
		mdbrain_procedure_outcome: tool({
			description:
				"Record whether a procedure succeeded or failed using its stable handle. Updates success/failure counters without bypassing the canonical procedure record.",
			inputSchema: procedureOutcomeSchema,
			execute: async (input) => client.reportProcedureOutcome(input),
		}),
		mdbrain_memory_feedback: tool({
			description:
				"Apply confirm/correct/irrelevant feedback to a structured memory using its stable handle. Confirm reinforces, correct routes through revision-aware updates, and irrelevant invalidates with history.",
			inputSchema: memoryFeedbackSchema,
			execute: async (input) => client.applyMemoryFeedback(input),
		}),
		mdbrain_state_unified: tool({
			description:
				"Get all three state surfaces (profile, blocks, bundle) in one call.",
			inputSchema: z.object({
				agentId: z.string().optional(),
				scope: z
					.enum(["session", "user", "agent", "workspace", "tenant", "global"])
					.optional(),
				scopeRef: z.string().optional(),
			}),
			execute: async (input) => client.state(input),
		}),
	}
}
