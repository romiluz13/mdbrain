/** Stable compatibility adapter from the Mdbrain product to Memongo HTTP. */
import type { MemoryScope } from "@mdbrain/lib/types/memory"
import type {
	ConversationRecallResponse,
	MemoryProviderStatus,
	MemoryFeedbackSignal,
	MemoryActorRole,
	MemoryStateFamily,
	MemoryLifecycleHistoryEntry,
	MemoryLifecycleItem,
	MemoryStableHandle,
	ProcedureLifecyclePatch,
	ProcedureEntry,
	StructuredMemoryLifecyclePatch,
	StructuredMemoryEntry,
} from "./memory-contract-types.js"
import type { MemongoReadinessReport } from "./memongo-memory-gateway.js"
import { checkMemongoReadiness, getMemongoGateway } from "./memongo-runtime.js"

export function mdbrainBridgeCheckReadiness(): Promise<
	MemongoReadinessReport & {
		contractVersion: string
		contractSha256: string
	}
> {
	return checkMemongoReadiness()
}

/** Fetch has no persistent MDBrain-owned connection lifecycle to close. */
export async function mdbrainBridgeShutdown(): Promise<void> {
	return Promise.resolve()
}

type MdbrainBridgeActiveSlate = {
	agentId: string
	scope: MemoryScope
	scopeRef: string
	items: Array<{
		kind: string
		source: string
		title: string
		summary: string
		path: string
		canonicalId?: string
		timestamp?: Date
		scope?: MemoryScope
		scopeRef?: string
		state?: string
		salience?: string
		provenance?: Record<string, unknown>
		sourceEventIds?: string[]
	}>
	metadata: {
		maxItems: number
		truncated: boolean
		partial: boolean
		countsByKind: Record<string, number>
		sourceCounts: Record<string, number>
	}
	hydratedAt: Date
}

type MdbrainBridgeDiscoveryProjection = {
	kind: "entity-brief" | "topic-brief" | "what-changed" | "contradiction-report"
	query?: string
	title: string
	summary: string
	scope: MemoryScope
	scopeRef: string
	sections: Array<{
		title: string
		summary: string
		evidence: Array<{
			title: string
			summary: string
			path: string
			source: string
			canonicalId?: string
			timestamp?: Date
			scope?: MemoryScope
			scopeRef?: string
			sourceEventIds?: string[]
		}>
	}>
	metadata: {
		partial: boolean
		evidenceCount: number
		sourceCounts: Record<string, number>
		timeRange?: {
			label: string
			start: Date
			end: Date
		}
	}
	builtAt: Date
}

type MdbrainBridgeContextBundle = {
	agentId: string
	query?: string
	scope: MemoryScope
	scopeRef: string
	sessionId?: string
	rendered: string
	sections: Array<{
		kind:
			| "active-slate"
			| "query-evidence"
			| "summary"
			| "recent-events"
			| "discovery-projection"
			| "profile"
		title: string
		summary?: string
		items: Array<{
			title: string
			summary: string
			path?: string
			source?: string
			canonicalId?: string
			timestamp?: Date
			scope?: MemoryScope
			scopeRef?: string
			sourceEventIds?: string[]
			trust?: {
				score: number
				confidence: "high" | "medium" | "low"
				exactness: "exact-id" | "exact-locator" | "approximate"
				freshness: "fresh" | "aging" | "stale" | "timeless" | "unknown"
				contradiction: "none" | "conflicted" | "invalidated"
				scopeMatch: "exact" | "partial" | "unknown" | "mismatch"
				provenance: "dense" | "partial" | "sparse" | "none"
				sourceDiversity: "single" | "multi"
				factors: string[]
			}
			metadata?: Record<string, unknown>
		}>
		estimatedTokens: number
		truncated: boolean
		partial: boolean
	}>
	metadata: {
		tokenBudget: number
		estimatedTokensUsed: number
		partial: boolean
		truncated: boolean
		pathsExecuted: string[]
		trustSummary?: {
			topScore: number | null
			topConfidence: "high" | "medium" | "low" | null
			averageScore: number | null
			distribution: Record<"high" | "medium" | "low", number>
			contradictionCount: number
			staleCount: number
			exactCount: number
			sourceDiversity: "single" | "multi" | "none"
		}
		sectionsIncluded: Array<
			| "active-slate"
			| "query-evidence"
			| "summary"
			| "recent-events"
			| "discovery-projection"
			| "profile"
		>
	}
	builtAt: Date
}

function resolveAgentId(explicit?: string): string {
	return (explicit ?? process.env.MDBRAIN_AGENT_ID ?? "main").trim() || "main"
}

export async function mdbrainBridgeSearch(params: {
	query: string
	agentId?: string
	maxResults?: number
	minScore?: number
	sessionKey?: string
	scope?: MemoryScope
	scopeRef?: string
}) {
	return getMemongoGateway().execute("search", {
		query: params.query,
		agentId: resolveAgentId(params.agentId),
		limit: params.maxResults,
		minScore: params.minScore,
		sessionKey: params.sessionKey,
		scope: params.scope,
		scopeRef: params.scopeRef,
	})
}

export async function mdbrainBridgeWaitForBenchmarkSearchReadiness(params: {
	agentId?: string
	retrievalLane?: "native" | "raw-session"
	scope?: MemoryScope
	scopeRef?: string
	sessionId?: string
}) {
	const ready = await getMemongoGateway().execute("vectorProbe", {
		agentId: resolveAgentId(params.agentId),
	})
	if (!ready) throw new Error("Memongo vector search is not ready")
}

export async function mdbrainBridgeSearchKB(params: {
	query: string
	agentId?: string
	maxResults?: number
	minScore?: number
	filter?: { tags?: string[]; category?: string; source?: string }
	scope?: MemoryScope
	scopeRef?: string
}) {
	return getMemongoGateway().execute("searchKb", {
		query: params.query,
		agentId: resolveAgentId(params.agentId),
		limit: params.maxResults,
		minScore: params.minScore,
		filter: params.filter,
		scope: params.scope,
		scopeRef: params.scopeRef,
	})
}

/** Legacy: append a user message (same as `writeConversationEvent` with role user). */
export async function mdbrainBridgeAdd(params: {
	content: string
	agentId?: string
	sessionId?: string
	metadata?: Record<string, unknown>
	scope?: MemoryScope
	scopeRef?: string
	idempotencyKey?: string
	requestId?: string
}) {
	return getMemongoGateway().execute(
		"add",
		{
			content: params.content,
			agentId: resolveAgentId(params.agentId),
			sessionId: params.sessionId,
			metadata: params.metadata,
			scope: params.scope,
			scopeRef: params.scopeRef,
		},
		{
			idempotencyKey: params.idempotencyKey,
			requestId: params.requestId,
		},
	)
}

export async function mdbrainBridgeWriteConversationEvent(params: {
	agentId?: string
	role: "user" | "assistant" | "system" | "tool"
	body: string
	sessionId?: string
	timestamp?: string
	metadata?: Record<string, unknown>
	scope?: MemoryScope
	scopeRef?: string
	idempotencyKey?: string
	requestId?: string
}) {
	return getMemongoGateway().execute(
		"writeEvent",
		{
			agentId: resolveAgentId(params.agentId),
			role: params.role,
			body: params.body,
			sessionId: params.sessionId,
			timestamp: params.timestamp,
			metadata: params.metadata,
			scope: params.scope,
			scopeRef: params.scopeRef,
		},
		{
			idempotencyKey: params.idempotencyKey,
			requestId: params.requestId,
		},
	)
}

export async function mdbrainBridgeExtractEvent(params: {
	agentId?: string
	eventId: string
}): Promise<{ jobId: string; scheduled: boolean }> {
	return getMemongoGateway().execute("extract", {
		eventId: params.eventId,
		agentId: resolveAgentId(params.agentId),
	})
}

export async function mdbrainBridgeWriteStructuredMemory(params: {
	agentId?: string
	entry: StructuredMemoryEntry
}) {
	const id = resolveAgentId(params.agentId)
	return getMemongoGateway().execute("writeStructured", {
		entry: { ...params.entry },
		agentId: params.entry.agentId ?? id,
		scope: params.entry.scope,
		scopeRef: params.entry.scopeRef,
	})
}

export async function mdbrainBridgeWriteProcedure(params: {
	agentId?: string
	entry: ProcedureEntry
}) {
	const id = resolveAgentId(params.agentId)
	return getMemongoGateway().execute("writeProcedure", {
		entry: { ...params.entry },
		agentId: params.entry.agentId ?? id,
		scope: params.entry.scope,
		scopeRef: params.entry.scopeRef,
	})
}

export async function mdbrainBridgeProfile(params: {
	agentId?: string
	scope?: MemoryScope
	scopeRef?: string
	maxEntities?: number
	maxEpisodes?: number
	maxPerType?: number
	activityWindowMs?: number
}) {
	return getMemongoGateway().execute("profile", {
		agentId: resolveAgentId(params.agentId),
		scope: params.scope,
		scopeRef: params.scopeRef,
		maxEntities: params.maxEntities,
		maxEpisodes: params.maxEpisodes,
		maxPerType: params.maxPerType,
		activityWindowMs: params.activityWindowMs,
	})
}

export async function mdbrainBridgeHydrateActiveSlate(params: {
	agentId?: string
	scope?: MemoryScope
	scopeRef?: string
	maxItems?: number
}): Promise<MdbrainBridgeActiveSlate> {
	return getMemongoGateway().execute("hydrateActiveSlate", {
		agentId: resolveAgentId(params.agentId),
		scope: params.scope,
		scopeRef: params.scopeRef,
		maxItems: params.maxItems,
	}) as Promise<MdbrainBridgeActiveSlate>
}

export async function mdbrainBridgeBuildDiscoveryProjection(params: {
	agentId?: string
	kind: "entity-brief" | "topic-brief" | "what-changed" | "contradiction-report"
	query?: string
	scope?: MemoryScope
	scopeRef?: string
	maxItems?: number
	timeRange?: {
		preset?: string
		start?: string
		end?: string
	}
}): Promise<MdbrainBridgeDiscoveryProjection> {
	return getMemongoGateway().execute("discoveryProjection", {
		agentId: resolveAgentId(params.agentId),
		kind: params.kind,
		query: params.query,
		scope: params.scope,
		scopeRef: params.scopeRef,
		maxItems: params.maxItems,
		timeRange: params.timeRange,
	}) as Promise<MdbrainBridgeDiscoveryProjection>
}

export async function mdbrainBridgeBuildContextBundle(params: {
	agentId?: string
	query?: string
	scope?: MemoryScope
	scopeRef?: string
	sessionId?: string
	tokenBudget?: number
	maxActiveItems?: number
	maxEvidenceItems?: number
	maxRecentEvents?: number
	includeDiscoveryProjection?: boolean
	discoveryKind?:
		| "entity-brief"
		| "topic-brief"
		| "what-changed"
		| "contradiction-report"
	includeProfile?: boolean
	timeRange?: {
		preset?: string
		start?: string
		end?: string
	}
	mode?: "full" | "wake-up"
}): Promise<MdbrainBridgeContextBundle> {
	return getMemongoGateway().execute("contextBundle", {
		agentId: resolveAgentId(params.agentId),
		query: params.query,
		scope: params.scope,
		scopeRef: params.scopeRef,
		sessionId: params.sessionId,
		tokenBudget: params.tokenBudget,
		maxActiveItems: params.maxActiveItems,
		maxEvidenceItems: params.maxEvidenceItems,
		maxRecentEvents: params.maxRecentEvents,
		includeDiscoveryProjection: params.includeDiscoveryProjection,
		discoveryKind: params.discoveryKind,
		includeProfile: params.includeProfile,
		timeRange: params.timeRange,
		mode: params.mode,
	}) as Promise<MdbrainBridgeContextBundle>
}

export async function mdbrainBridgeRecallConversation(params: {
	agentId?: string
	query?: string
	scope?: MemoryScope
	scopeRef?: string
	sessionId?: string
	roles?: Array<"user" | "assistant" | "system" | "tool">
	startTime?: string
	endTime?: string
	timezone?: string
	includeToolMessages?: boolean
	limit?: number
}): Promise<ConversationRecallResponse> {
	return getMemongoGateway().execute("recallConversation", {
		agentId: resolveAgentId(params.agentId),
		query: params.query,
		scope: params.scope,
		scopeRef: params.scopeRef,
		sessionId: params.sessionId,
		roles: params.roles,
		startTime: params.startTime,
		endTime: params.endTime,
		timezone: params.timezone,
		includeToolMessages: params.includeToolMessages,
		limit: params.limit,
	}) as Promise<ConversationRecallResponse>
}

export async function mdbrainBridgeGetLifecycleItem(params: {
	handle: MemoryStableHandle
}): Promise<MemoryLifecycleItem | null> {
	return getMemongoGateway().execute("lifecycleGet", {
		handle: params.handle,
	}) as Promise<MemoryLifecycleItem>
}

export async function mdbrainBridgeUpdateLifecycleItem(params: {
	handle: MemoryStableHandle
	patch: StructuredMemoryLifecyclePatch | ProcedureLifecyclePatch
}): Promise<MemoryLifecycleItem | null> {
	return getMemongoGateway().execute("lifecycleUpdate", {
		handle: params.handle,
		patch: params.patch,
	}) as Promise<MemoryLifecycleItem>
}

export async function mdbrainBridgeDeleteLifecycleItem(params: {
	handle: MemoryStableHandle
	invalidatedBy?: Record<string, unknown>
}): Promise<MemoryLifecycleItem | null> {
	return getMemongoGateway().execute("lifecycleDelete", {
		handle: params.handle,
		invalidatedBy: params.invalidatedBy,
	}) as Promise<MemoryLifecycleItem>
}

export async function mdbrainBridgeGetLifecycleHistory(params: {
	handle: MemoryStableHandle
	limit?: number
}): Promise<MemoryLifecycleHistoryEntry[]> {
	return getMemongoGateway().execute("lifecycleHistory", {
		handle: params.handle,
		limit: params.limit,
	}) as Promise<MemoryLifecycleHistoryEntry[]>
}

export async function mdbrainBridgeReportProcedureOutcome(params: {
	handle: Extract<MemoryStableHandle, { family: "procedure" }>
	success: boolean
	note?: string
	actorRole?: MemoryActorRole
}): Promise<Extract<MemoryLifecycleItem, { family: "procedure" }> | null> {
	return getMemongoGateway().execute("procedureOutcome", {
		...params,
	}) as Promise<Extract<MemoryLifecycleItem, { family: "procedure" }>>
}

export async function mdbrainBridgeApplyMemoryFeedback(params: {
	handle: Extract<MemoryStableHandle, { family: "structured" }>
	signal: MemoryFeedbackSignal
	patch?: StructuredMemoryLifecyclePatch
	invalidatedBy?: Record<string, unknown>
	note?: string
	actorRole?: MemoryActorRole
}): Promise<Extract<MemoryLifecycleItem, { family: "structured" }> | null> {
	return getMemongoGateway().execute("memoryFeedback", {
		...params,
	}) as Promise<Extract<MemoryLifecycleItem, { family: "structured" }>>
}

export async function mdbrainBridgeSearchDetailed(params: {
	agentId?: string
	query: string
	scope?: MemoryScope
	scopeRef?: string
	maxResults?: number
	minScore?: number
	searchMode?: "auto" | "direct" | "agentic"
	sourcePreference?: string[]
	timeRange?: {
		preset?: string
		start?: string
		end?: string
	}
	needExactEvidence?: boolean
	maxPasses?: number
	returnPlan?: boolean
	conversationScope?: { sessionKey?: string }
	structuredScope?: {
		type?: string
		state?: string | string[]
		salience?: string[]
	}
	referenceScope?: {
		source?: string
		category?: string
		tags?: string[]
	}
	proceduralScope?: { state?: string; intentTags?: string[] }
	searchConfig?: {
		recipe?: "fast" | "hybrid" | "deep" | "temporal" | "chain-of-thought"
		recallProfile?: "latency" | "balanced" | "proof"
		maxResults?: number
		searchMode?: "auto" | "direct" | "agentic"
		maxPasses?: number
		sourcePreference?: string[]
		timeRange?: {
			preset?: string
			start?: string
			end?: string
		}
		needExactEvidence?: boolean
		numCandidates?: number
		fusionMethod?: "scoreFusion" | "rankFusion" | "js-merge"
		hybridMode?: "hybrid" | "vector-only"
		allowHybridBackstop?: boolean
		lexicalPrefilter?: "disabled" | "experimental"
	}
}) {
	return getMemongoGateway().execute("searchDetailed", {
		...params,
		agentId: resolveAgentId(params.agentId),
		limit: params.maxResults,
	})
}

export async function mdbrainBridgeStatus(params: {
	agentId?: string
}): Promise<MemoryProviderStatus> {
	return getMemongoGateway().execute("status", {
		agentId: resolveAgentId(params.agentId),
	}) as Promise<MemoryProviderStatus>
}

export async function mdbrainBridgeProbeEmbedding(params: {
	agentId?: string
}) {
	return getMemongoGateway().execute("embeddingProbe", {
		agentId: resolveAgentId(params.agentId),
	})
}

export async function mdbrainBridgeProbeVector(params: { agentId?: string }) {
	return getMemongoGateway().execute("vectorProbe", {
		agentId: resolveAgentId(params.agentId),
	})
}

export async function mdbrainBridgeGetState(params: {
	agentId?: string
	scope?: MemoryScope
	scopeRef?: string
}): Promise<MemoryStateFamily & { partial?: boolean }> {
	return getMemongoGateway().execute("state", {
		agentId: resolveAgentId(params.agentId),
		scope: params.scope,
		scopeRef: params.scopeRef,
	}) as Promise<MemoryStateFamily & { partial?: boolean }>
}

export type {
	MemoryLifecycleHistoryEntry,
	MemoryLifecycleItem,
	MemoryStableHandle,
	ProcedureEntry,
	StructuredMemoryEntry,
} from "./memory-contract-types.js"
