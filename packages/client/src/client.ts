import type {
	MdbrainAddInput,
	MdbrainAccessSummaryResponse,
	MdbrainAccessTrendResponse,
	MdbrainActiveSlateInput,
	MdbrainBenchmarkIngestResponse,
	MdbrainConsolidateInput,
	MdbrainConsolidateResponse,
	MdbrainConversationImportInput,
	MdbrainConversationImportResponse,
	MdbrainConversationRecallInput,
	MdbrainConversationRecallResponse,
	MdbrainMemoryJob,
	MdbrainMemoryJobStatus,
	MdbrainMemoryJobType,
	MdbrainContextBundleInput,
	MdbrainDetailedStatusResponse,
	MdbrainDiscoveryProjectionInput,
	MdbrainExtractInput,
	MdbrainExtractResponse,
	MdbrainLifecycleDeleteInput,
	MdbrainMemoryFeedbackInput,
	MdbrainLifecycleGetInput,
	MdbrainLifecycleHistoryEntry,
	MdbrainLifecycleHistoryInput,
	MdbrainLifecycleItem,
	MdbrainLifecycleUpdateInput,
	MdbrainNoveltyResponse,
	MdbrainProbeEmbeddingResponse,
	MdbrainProfileInput,
	MdbrainProfileResponse,
	MdbrainReadFileResponse,
	MdbrainRelevanceBenchmarkResponse,
	MdbrainRelevanceExplainResponse,
	MdbrainRelevanceReportResponse,
	MdbrainRelevanceSampleRateResponse,
	MdbrainProcedureOutcomeInput,
	MdbrainRecallTrace,
	MdbrainScanNoveltyInput,
	MdbrainSearchInput,
	MdbrainSearchKBResponse,
	MdbrainSearchResponse,
	SearchConfig,
	MdbrainStatsResponse,
	MdbrainStatusResponse,
	MdbrainTraceChainInput,
	MdbrainTraceChainResponse,
	MdbrainSelfEditInput,
	MdbrainSelfEditResponse,
} from "./types.js"

export type MdbrainClientOptions = {
	/** Mdbrain API base URL (e.g. http://127.0.0.1:3847). */
	baseUrl?: string
	/** Optional Bearer token; also reads `MDBRAIN_API_KEY` when unset. */
	apiKey?: string
	/** Max retries for 429/503 (default 2). */
	maxRetries?: number
}

/** Thrown when the Mdbrain HTTP API returns a non-OK status. */
export class MdbrainClientError extends Error {
	readonly status: number
	readonly body: string

	constructor(status: number, body: string, message?: string) {
		super(message ?? `Mdbrain API ${status}: ${body || "(empty)"}`)
		this.name = "MdbrainClientError"
		this.status = status
		this.body = body
	}
}

function resolveBaseUrl(opts: MdbrainClientOptions): string {
	const raw =
		opts.baseUrl ?? process.env.MDBRAIN_API_URL ?? "http://127.0.0.1:3847"
	return raw.replace(/\/$/, "")
}

function resolveApiKey(opts: MdbrainClientOptions): string | undefined {
	return opts.apiKey ?? process.env.MDBRAIN_API_KEY ?? undefined
}

function shouldRetryStatus(status: number): boolean {
	return status === 429 || status === 503
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

function buildHeaders(
	opts: MdbrainClientOptions,
	method: string,
): Record<string, string> {
	const key = resolveApiKey(opts)
	const headers: Record<string, string> = {}
	if (key) {
		headers.Authorization = `Bearer ${key}`
	}
	if (method !== "GET" && method !== "HEAD") {
		headers["Content-Type"] = "application/json"
	}
	return headers
}

async function apiFetch<T>(
	opts: MdbrainClientOptions,
	path: string,
	init: RequestInit,
): Promise<T> {
	const url = `${resolveBaseUrl(opts)}${path}`
	const method = (init.method ?? "GET").toUpperCase()
	const maxRetries = opts.maxRetries ?? 2
	let attempt = 0
	for (;;) {
		const res = await fetch(url, {
			...init,
			headers: { ...buildHeaders(opts, method), ...init.headers },
		})
		if (res.ok) {
			return (await res.json()) as T
		}
		const text = await res.text()
		if (shouldRetryStatus(res.status) && attempt < maxRetries) {
			attempt += 1
			await sleep(200 * attempt)
			continue
		}
		throw new MdbrainClientError(res.status, text)
	}
}

async function apiPost<T>(
	opts: MdbrainClientOptions,
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	return apiFetch<T>(opts, path, {
		method: "POST",
		body: JSON.stringify(body),
	})
}

async function apiGet<T>(opts: MdbrainClientOptions, path: string): Promise<T> {
	return apiFetch<T>(opts, path, { method: "GET" })
}

async function apiPatch<T>(
	opts: MdbrainClientOptions,
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	return apiFetch<T>(opts, path, {
		method: "PATCH",
		body: JSON.stringify(body),
	})
}

async function apiDelete<T>(
	opts: MdbrainClientOptions,
	path: string,
): Promise<T> {
	return apiFetch<T>(opts, path, { method: "DELETE" })
}

function q(
	agentId?: string,
	extra?: Record<string, string | number | undefined>,
): string {
	const p = new URLSearchParams()
	if (agentId) {
		p.set("agentId", agentId)
	}
	if (extra) {
		for (const [k, v] of Object.entries(extra)) {
			if (v !== undefined && v !== "") {
				p.set(k, String(v))
			}
		}
	}
	const s = p.toString()
	return s ? `?${s}` : ""
}

/** A single result from `searchDetailed`. */
export type MdbrainSearchDetailedResult = {
	path: string
	startLine: number
	endLine: number
	score: number
	snippet: string
	source: string
	canonicalId?: string
	sessionId?: string
	timestamp?: string
	scope?: string
	scopeRef?: string
	state?: string
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	sourceReliability?: number
	reinforcementCount?: number
	validFrom?: string
	validTo?: string
	reviewAt?: string
	lastConfirmedAt?: string
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
}

/** A single retrieval pass executed during search. */
export type MdbrainSearchPass = {
	pass: number
	query: string
	reason: string
	pathsExecuted: string[]
	resultCount: number
	queryRewritten: boolean
	reranked: boolean
	correctionApplied?: string
}

/** Metadata returned by `searchDetailed`. */
export type MdbrainSearchDetailedMetadata = {
	mode: string
	classification: string
	sourceOrder: string[]
	resolvedSearchConfig?: SearchConfig & {
		recipe:
			| "fast"
			| "hybrid"
			| "deep"
			| "temporal"
			| "chain-of-thought"
			| "custom"
		recallProfile: "latency" | "balanced" | "proof"
		maxResults: number
		searchMode: "auto" | "direct" | "agentic"
		maxPasses: number
		sourcePreference: string[]
		needExactEvidence: boolean
		numCandidates: number
		fusionMethod: "scoreFusion" | "rankFusion" | "js-merge"
		hybridMode: "hybrid" | "vector-only"
		allowHybridBackstop: boolean
		lexicalPrefilter: "disabled" | "experimental"
	}
	passes: MdbrainSearchPass[]
	queriesTried: string[]
	constraintsApplied: string[]
	resultsRejected: Array<{
		canonicalId?: string
		path?: string
		source?: string
		reason: string
	}>
	evidenceCoverage: string
	pathsExecuted: string[]
	resultsByPath: Record<string, number>
	queryRewritten: boolean
	reranked: boolean
	noDirectEvidenceReason?: string
	constraintRelaxations?: Array<{ constraint: string; action: string }>
	mmrApplied?: boolean
	mmrLambda?: number
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
	plan?: { paths: string[]; confidence: string; reasoning: string }
}

/** Full response from `searchDetailed`. */
export type MdbrainSearchDetailedResponse = {
	results: MdbrainSearchDetailedResult[]
	metadata: MdbrainSearchDetailedMetadata
}

export type MdbrainActiveSlateItem = {
	kind: string
	source: string
	title: string
	summary: string
	path: string
	canonicalId?: string
	timestamp?: string
	scope?: string
	scopeRef?: string
	state?: string
	salience?: string
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
}

export type MdbrainActiveSlateResponse = {
	agentId: string
	scope: string
	scopeRef: string
	items: MdbrainActiveSlateItem[]
	metadata: {
		maxItems: number
		truncated: boolean
		partial: boolean
		countsByKind: Record<string, number>
		sourceCounts: Record<string, number>
	}
	hydratedAt: string
}

export type MdbrainMemoryBlockLabel =
	| "working-memory"
	| "decisions"
	| "preferences"
	| "todos"
	| "procedures"

export type MdbrainMemoryBlock = {
	label: MdbrainMemoryBlockLabel
	title: string
	content: string
	tokenBudget: number
	actualTokens: number
	sourcePaths: string[]
}

export type MdbrainMemoryBlocksResponse = {
	blocks: MdbrainMemoryBlock[]
	totalTokenBudget: number
	totalActualTokens: number
}

export type MdbrainDiscoveryProjectionResponse = {
	kind: string
	query?: string
	title: string
	summary: string
	scope: string
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
			timestamp?: string
			scope?: string
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
			start: string
			end: string
		}
	}
	builtAt: string
}

export type MdbrainContextBundleSectionItem = {
	title: string
	summary: string
	path?: string
	source?: string
	canonicalId?: string
	timestamp?: string
	scope?: string
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
}

export type MdbrainContextBundleResponse = {
	agentId: string
	query?: string
	scope: string
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
		items: MdbrainContextBundleSectionItem[]
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
	builtAt: string
}

export type MdbrainStateResponse = {
	profile: MdbrainProfileResponse
	blocks: MdbrainMemoryBlocksResponse
	bundle: MdbrainContextBundleResponse
	partial?: boolean
}

/** HTTP client for the supported Mdbrain API surface. */
export class MdbrainClient {
	constructor(private readonly _opts: MdbrainClientOptions = {}) {}

	async add(
		input: MdbrainAddInput,
	): Promise<{ ok: true; eventId: string; chunkCreated: boolean }> {
		return apiPost(this._opts, "/v1/add", {
			content: input.content,
			agentId: input.agentId,
			containerTag: input.containerTag,
			sessionId: input.sessionId ?? input.containerTag,
			metadata: normalizeMetadata(input.metadata),
		})
	}

	async search(
		input: MdbrainSearchInput & {
			agentId?: string
			minScore?: number
			sessionKey?: string
		},
	): Promise<MdbrainSearchResponse> {
		return apiPost(this._opts, "/v1/search", {
			query: input.query,
			agentId: input.agentId,
			limit: input.limit,
			minScore: input.minScore,
			containerTag: input.containerTag,
			sessionKey: input.sessionKey ?? input.containerTag,
		})
	}

	async searchDetailed(input: {
		query: string
		agentId?: string
		limit?: number
		maxResults?: number
		minScore?: number
		searchMode?: "auto" | "direct" | "agentic"
		sourcePreference?: string[]
		timeRange?: { preset?: string; start?: string; end?: string }
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
		searchConfig?: SearchConfig
		/** @deprecated This legacy alias is ignored by the canonical detailed search path. */
		containerTag?: string
	}): Promise<MdbrainSearchDetailedResponse> {
		return apiPost(this._opts, "/v1/search-detailed", {
			query: input.query,
			agentId: input.agentId,
			limit: input.limit,
			maxResults: input.maxResults,
			minScore: input.minScore,
			searchMode: input.searchMode,
			sourcePreference: input.sourcePreference,
			timeRange: input.timeRange,
			needExactEvidence: input.needExactEvidence,
			maxPasses: input.maxPasses,
			returnPlan: input.returnPlan,
			conversationScope: input.conversationScope,
			structuredScope: input.structuredScope,
			referenceScope: input.referenceScope,
			proceduralScope: input.proceduralScope,
			searchConfig: input.searchConfig,
		})
	}

	async searchKB(input: {
		query: string
		agentId?: string
		limit?: number
		minScore?: number
		filter?: { tags?: string[]; category?: string; source?: string }
	}): Promise<MdbrainSearchKBResponse> {
		return apiPost(this._opts, "/v1/search-kb", {
			query: input.query,
			agentId: input.agentId,
			limit: input.limit,
			minScore: input.minScore,
			filter: input.filter,
		})
	}

	async recallConversation(
		input: MdbrainConversationRecallInput = {},
	): Promise<MdbrainConversationRecallResponse> {
		return apiPost(this._opts, "/v1/recall-conversation", {
			query: input.query,
			sessionId: input.sessionId,
			roles: input.roles,
			startTime: input.startTime,
			endTime: input.endTime,
			timezone: input.timezone,
			includeToolMessages: input.includeToolMessages,
			limit: input.limit,
			agentId: input.agentId,
		})
	}

	async getLifecycleItem(
		input: MdbrainLifecycleGetInput,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(this._opts, "/v1/lifecycle/get", {
			handle: input.handle,
		})
	}

	async updateLifecycleItem(
		input: MdbrainLifecycleUpdateInput,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(this._opts, "/v1/lifecycle/update", {
			handle: input.handle,
			patch: input.patch,
		})
	}

	async deleteLifecycleItem(
		input: MdbrainLifecycleDeleteInput,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(this._opts, "/v1/lifecycle/delete", {
			handle: input.handle,
			invalidatedBy: input.invalidatedBy,
		})
	}

	async getLifecycleHistory(
		input: MdbrainLifecycleHistoryInput,
	): Promise<MdbrainLifecycleHistoryEntry[]> {
		return apiPost(this._opts, "/v1/lifecycle/history", {
			handle: input.handle,
			limit: input.limit,
		})
	}

	async reportProcedureOutcome(
		input: MdbrainProcedureOutcomeInput,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(this._opts, "/v1/procedures/outcome", {
			handle: input.handle,
			success: input.success,
			note: input.note,
			actorRole: input.actorRole,
		})
	}

	async applyMemoryFeedback(
		input: MdbrainMemoryFeedbackInput,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(this._opts, "/v1/memory/feedback", {
			handle: input.handle,
			signal: input.signal,
			...(input.signal === "correct" ? { patch: input.patch } : {}),
			...(input.signal === "irrelevant" && input.invalidatedBy
				? { invalidatedBy: input.invalidatedBy }
				: {}),
			note: input.note,
			actorRole: input.actorRole,
		})
	}

	async readFile(input: {
		relPath: string
		from?: number
		lines?: number
		agentId?: string
	}): Promise<MdbrainReadFileResponse> {
		return apiPost(this._opts, "/v1/read-file", {
			relPath: input.relPath,
			from: input.from,
			lines: input.lines,
			agentId: input.agentId,
		})
	}

	async writeEvent(input: {
		role: "user" | "assistant" | "system" | "tool"
		body: string
		agentId?: string
		sessionId?: string
		timestamp?: string
		metadata?: Record<string, unknown>
		scope?: string
	}): Promise<{ ok: true; eventId: string; chunkCreated: boolean }> {
		return apiPost(this._opts, "/v1/write-event", {
			role: input.role,
			body: input.body,
			agentId: input.agentId,
			sessionId: input.sessionId,
			timestamp: input.timestamp,
			metadata: input.metadata,
			scope: input.scope,
		})
	}

	async writeStructured(input: {
		entry: Record<string, unknown>
		agentId?: string
	}): Promise<{ upserted: boolean; id: string }> {
		return apiPost(this._opts, "/v1/write-structured", {
			entry: input.entry,
			agentId: input.agentId,
		})
	}

	async writeProcedure(input: {
		entry: Record<string, unknown>
		agentId?: string
	}): Promise<{ upserted: boolean; id: string }> {
		return apiPost(this._opts, "/v1/write-procedure", {
			entry: input.entry,
			agentId: input.agentId,
		})
	}

	async extract(input: MdbrainExtractInput): Promise<MdbrainExtractResponse> {
		return apiPost(this._opts, "/v1/extract", {
			eventId: input.eventId,
			agentId: input.agentId,
		})
	}

	async profile(
		input: MdbrainProfileInput & {
			agentId?: string
			scopeRef?: string
			maxEntities?: number
			maxEpisodes?: number
			maxPerType?: number
			activityWindowMs?: number
		} = {},
	): Promise<MdbrainProfileResponse> {
		return apiPost(this._opts, "/v1/profile", {
			agentId: input.agentId,
			containerTag: input.containerTag,
			scope: input.scope,
			scopeRef: input.scopeRef ?? input.containerTag,
			maxEntities: input.maxEntities,
			maxEpisodes: input.maxEpisodes,
			maxPerType: input.maxPerType,
			activityWindowMs: input.activityWindowMs,
		})
	}

	async hydrateActiveSlate(
		input: MdbrainActiveSlateInput = {},
	): Promise<MdbrainActiveSlateResponse> {
		return apiPost(this._opts, "/v1/hydrate-active-slate", {
			agentId: input.agentId,
			scope: input.scope,
			scopeRef: input.scopeRef,
			maxItems: input.maxItems,
		})
	}

	async state(
		input: MdbrainActiveSlateInput = {},
	): Promise<MdbrainStateResponse> {
		return apiGet(
			this._opts,
			`/v1/state${q(input.agentId, {
				scope: input.scope,
				scopeRef: input.scopeRef,
			})}`,
		)
	}

	async buildDiscoveryProjection(
		input: MdbrainDiscoveryProjectionInput,
	): Promise<MdbrainDiscoveryProjectionResponse> {
		return apiPost(this._opts, "/v1/discovery-projection", {
			agentId: input.agentId,
			kind: input.kind,
			query: input.query,
			scope: input.scope,
			scopeRef: input.scopeRef,
			maxItems: input.maxItems,
			timeRange: input.timeRange,
		})
	}

	async buildContextBundle(
		input: MdbrainContextBundleInput = {},
	): Promise<MdbrainContextBundleResponse> {
		return apiPost(this._opts, "/v1/context-bundle", {
			agentId: input.agentId,
			query: input.query,
			scope: input.scope,
			scopeRef: input.scopeRef,
			sessionId: input.sessionId,
			tokenBudget: input.tokenBudget,
			maxActiveItems: input.maxActiveItems,
			maxEvidenceItems: input.maxEvidenceItems,
			maxRecentEvents: input.maxRecentEvents,
			includeDiscoveryProjection: input.includeDiscoveryProjection,
			discoveryKind: input.discoveryKind,
			includeProfile: input.includeProfile,
			timeRange: input.timeRange,
			mode: input.mode,
		})
	}

	async status(agentId?: string): Promise<MdbrainStatusResponse> {
		return apiGet(this._opts, `/v1/status${q(agentId)}`)
	}

	async getDetailedStatus(
		agentId?: string,
	): Promise<MdbrainDetailedStatusResponse> {
		return apiGet(this._opts, `/v1/status/detailed${q(agentId)}`)
	}

	async stats(agentId?: string): Promise<MdbrainStatsResponse> {
		return apiGet(this._opts, `/v1/stats${q(agentId)}`)
	}

	async sync(input?: {
		agentId?: string
		reason?: string
		force?: boolean
	}): Promise<{ ok: true }> {
		return apiPost(this._opts, "/v1/sync", {
			agentId: input?.agentId,
			reason: input?.reason,
			force: input?.force,
		})
	}

	async probeEmbedding(
		agentId?: string,
	): Promise<MdbrainProbeEmbeddingResponse> {
		return apiGet(this._opts, `/v1/probes/embedding${q(agentId)}`)
	}

	async probeVector(agentId?: string): Promise<{ ok: boolean }> {
		return apiGet(this._opts, `/v1/probes/vector${q(agentId)}`)
	}

	async relevanceExplain(input: {
		query: string
		agentId?: string
		sourceScope?: "all" | "memory" | "kb" | "structured"
		sessionKey?: string
		maxResults?: number
		minScore?: number
		deep?: boolean
	}): Promise<MdbrainRelevanceExplainResponse> {
		return apiPost(this._opts, "/v1/admin/relevance/explain", {
			query: input.query,
			agentId: input.agentId,
			sourceScope: input.sourceScope,
			sessionKey: input.sessionKey,
			maxResults: input.maxResults,
			minScore: input.minScore,
			deep: input.deep,
		})
	}

	async relevanceBenchmark(input?: {
		agentId?: string
		datasetPath?: string
		maxResults?: number
		minScore?: number
		retrievalLane?: "native" | "raw-session"
	}): Promise<MdbrainRelevanceBenchmarkResponse> {
		return apiPost(this._opts, "/v1/admin/relevance/benchmark", {
			agentId: input?.agentId,
			datasetPath: input?.datasetPath,
			maxResults: input?.maxResults,
			minScore: input?.minScore,
			retrievalLane: input?.retrievalLane,
		})
	}

	async benchmarkIngest(input: {
		datasetPath: string
		agentId?: string
		scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
		limitConversations?: number
		limitTurnsPerConversation?: number
	}): Promise<MdbrainBenchmarkIngestResponse> {
		return apiPost(this._opts, "/v1/admin/benchmarks/ingest", {
			datasetPath: input.datasetPath,
			agentId: input.agentId,
			scope: input.scope,
			limitConversations: input.limitConversations,
			limitTurnsPerConversation: input.limitTurnsPerConversation,
		})
	}

	async importConversations(
		input: MdbrainConversationImportInput,
	): Promise<MdbrainConversationImportResponse> {
		return apiPost(this._opts, "/v1/import/conversations", {
			datasetPath: input.datasetPath,
			agentId: input.agentId,
			scope: input.scope,
			limitConversations: input.limitConversations,
			limitTurnsPerConversation: input.limitTurnsPerConversation,
		})
	}

	async relevanceReport(
		agentId?: string,
		windowMs?: number,
	): Promise<MdbrainRelevanceReportResponse> {
		return apiGet(
			this._opts,
			`/v1/admin/relevance/report${q(agentId, { windowMs })}`,
		)
	}

	async relevanceSampleRate(
		agentId?: string,
	): Promise<MdbrainRelevanceSampleRateResponse> {
		return apiGet(this._opts, `/v1/admin/relevance/sample-rate${q(agentId)}`)
	}

	async accessTrends(input?: {
		agentId?: string
		collection?:
			| "events"
			| "structured_mem"
			| "procedures"
			| "episodes"
			| "entities"
			| "relations"
		memoryIds?: string[]
		windowDays?: number
		limit?: number
	}): Promise<MdbrainAccessTrendResponse> {
		return apiGet(
			this._opts,
			`/v1/admin/access-trends${q(input?.agentId, {
				collection: input?.collection,
				memoryIds: input?.memoryIds?.join(","),
				windowDays: input?.windowDays,
				limit: input?.limit,
			})}`,
		)
	}

	async accessSummaries(input: {
		agentId?: string
		collection:
			| "events"
			| "structured_mem"
			| "procedures"
			| "episodes"
			| "entities"
			| "relations"
		memoryIds: string[]
		windowDays?: number
	}): Promise<MdbrainAccessSummaryResponse> {
		return apiGet(
			this._opts,
			`/v1/admin/access-summaries${q(input.agentId, {
				collection: input.collection,
				memoryIds: input.memoryIds.join(","),
				windowDays: input.windowDays,
			})}`,
		)
	}

	async listRecallTraces(input?: {
		agentId?: string
		limit?: number
	}): Promise<MdbrainRecallTrace[]> {
		return apiGet(
			this._opts,
			`/v1/admin/traces${q(input?.agentId, { limit: input?.limit })}`,
		)
	}

	async getRecallTrace(input: {
		traceId: string
		agentId?: string
	}): Promise<MdbrainRecallTrace | null> {
		return apiGet(
			this._opts,
			`/v1/admin/traces/${encodeURIComponent(input.traceId)}${q(input.agentId)}`,
		)
	}

	async listJobs(input?: {
		agentId?: string
		status?: MdbrainMemoryJobStatus
		limit?: number
		jobType?: MdbrainMemoryJobType
	}): Promise<MdbrainMemoryJob[]> {
		return apiGet(
			this._opts,
			`/v1/jobs${q(input?.agentId, {
				status: input?.status,
				limit: input?.limit,
				jobType: input?.jobType,
			})}`,
		)
	}

	async getJob(input: {
		jobId: string
		agentId?: string
	}): Promise<MdbrainMemoryJob | null> {
		return apiGet(
			this._opts,
			`/v1/jobs/${encodeURIComponent(input.jobId)}${q(input.agentId)}`,
		)
	}

	async traceChain(
		input: MdbrainTraceChainInput,
	): Promise<MdbrainTraceChainResponse> {
		return apiPost(this._opts, "/v1/chain-trace", {
			factId: input.factId,
			collection: input.collection,
			agentId: input.agentId,
			maxDepth: input.maxDepth,
		})
	}

	async scanNovelty(
		input?: MdbrainScanNoveltyInput,
	): Promise<MdbrainNoveltyResponse> {
		return apiPost(this._opts, "/v1/novelty-scan", {
			agentId: input?.agentId,
			limit: input?.limit,
			scope: input?.scope,
		})
	}

	async consolidate(
		input?: MdbrainConsolidateInput,
	): Promise<MdbrainConsolidateResponse> {
		return apiPost(this._opts, "/v1/consolidate", {
			agentId: input?.agentId,
			maxEvents: input?.maxEvents,
			minCombinedScore: input?.minCombinedScore,
			scope: input?.scope,
		})
	}

	async selfEdit(
		input: MdbrainSelfEditInput,
	): Promise<MdbrainSelfEditResponse> {
		return apiPost(this._opts, "/v1/self-edit", {
			block: input.block,
			action: input.action,
			content: input.content,
			agentId: input.agentId,
		})
	}

	// ---------------------------------------------------------------------------
	// Wiki (T6 MCP tools)
	// ---------------------------------------------------------------------------

	async wikiSearch(input: {
		query: string
		scope?: string
		scopeRef?: string
		kind?: string
		trustTier?: string
		state?: string
		privacyTier?: string
		recipe?: "fast" | "hybrid" | "deep"
		maxResults?: number
		minScore?: number
		agentId?: string
	}): Promise<unknown> {
		return apiPost(this._opts, "/v1/wiki/search", {
			query: input.query,
			scope: input.scope,
			scopeRef: input.scopeRef,
			kind: input.kind,
			trustTier: input.trustTier,
			state: input.state,
			privacyTier: input.privacyTier,
			recipe: input.recipe,
			maxResults: input.maxResults,
			minScore: input.minScore,
			agentId: input.agentId,
		})
	}

	async wikiGet(input: {
		slug: string
		scope: string
		scopeRef: string
		format?: "json" | "markdown" | "html"
		agentId?: string
	}): Promise<unknown> {
		const qs = new URLSearchParams({
			scope: input.scope,
			scopeRef: input.scopeRef,
		})
		if (input.format) qs.set("format", input.format)
		if (input.agentId) qs.set("agentId", input.agentId)
		return apiGet(this._opts, `/v1/wiki/${input.slug}?${qs}`)
	}

	async wikiApply(input: {
		// Create or update a wiki page. When slug+scope+scopeRef match an
		// existing page, it updates; otherwise it creates.
		kind: string
		title: string
		slug: string
		summary: string
		body: string
		frontmatter: {
			type: string
			title?: string
			description?: string
			resource?: string
			tags?: string[]
			entityTypes?: string[]
			privacyTier?: string
		}
		scope: string
		scopeRef: string
		trustTier: string
		agentId?: string
	}): Promise<unknown> {
		// Upsert: try POST (create); on 409 DUPLICATE_SLUG, fall back to PATCH
		// (update existing page, bumps revision). Honors the create-or-update
		// contract the tool description advertises.
		const body = {
			kind: input.kind,
			title: input.title,
			slug: input.slug,
			summary: input.summary,
			body: input.body,
			frontmatter: input.frontmatter,
			scope: input.scope,
			scopeRef: input.scopeRef,
			trustTier: input.trustTier,
			agentId: input.agentId,
		}
		try {
			return await apiPost(this._opts, "/v1/wiki", body)
		} catch (err) {
			if (err instanceof MdbrainClientError && err.status === 409) {
				return apiPatch(this._opts, `/v1/wiki/${input.slug}`, body)
			}
			throw err
		}
	}

	async wikiExportOkf(input: {
		scope: string
		scopeRef: string
		outDir: string
		okfBundleId?: string
		agentId?: string
	}): Promise<unknown> {
		return apiPost(this._opts, "/v1/wiki/okf-export", {
			scope: input.scope,
			scopeRef: input.scopeRef,
			outDir: input.outDir,
			okfBundleId: input.okfBundleId,
			agentId: input.agentId,
		})
	}

	async wikiLint(input: {
		scope: string
		scopeRef: string
		kind?: string
		limit?: number
		agentId?: string
	}): Promise<unknown> {
		// Lists pages for lint review. Surfaces pages needing attention for
		// manual review. T12 contradiction detector will populate contradictions[]
		// for a fuller lint; for now this lists pages (optionally by kind) so a
		// human can spot stale/superseded entries. The list route accepts a state
		// filter — we don't force one here so callers see the full picture.
		const qs = new URLSearchParams({
			scope: input.scope,
			scopeRef: input.scopeRef,
		})
		if (input.kind) qs.set("kind", input.kind)
		if (input.agentId) qs.set("agentId", input.agentId)
		const limit = input.limit ?? 100
		qs.set("limit", String(limit))
		return apiGet(this._opts, `/v1/wiki/lint?${qs}`)
	}

	async wikiDelete(input: {
		slug: string
		scope: string
		scopeRef: string
		hard?: boolean
		agentId?: string
	}): Promise<{
		ok: boolean
		slug: string
		scope: string
		scopeRef: string
		hard: boolean
	}> {
		const params = new URLSearchParams({
			scope: input.scope,
			scopeRef: input.scopeRef,
		})
		if (input.hard) params.set("hard", "true")
		if (input.agentId) params.set("agentId", input.agentId)
		return apiDelete(this._opts, `/v1/wiki/${input.slug}?${params}`)
	}

	async wikiImportOkf(input: {
		bundleDir: string
		scope: string
		scopeRef: string
		trustTier: "restricted" | "standard" | "admin"
		okfBundleId: string
		agentId?: string
	}): Promise<unknown> {
		return apiPost(this._opts, "/v1/wiki/okf-import", {
			bundleDir: input.bundleDir,
			scope: input.scope,
			scopeRef: input.scopeRef,
			trustTier: input.trustTier,
			okfBundleId: input.okfBundleId,
			agentId: input.agentId,
		})
	}

	async wikiMaintain(input: {
		scope: string
		scopeRef: string
		agentId?: string
	}): Promise<unknown> {
		return apiPost(this._opts, "/v1/wiki/maintain", {
			scope: input.scope,
			scopeRef: input.scopeRef,
			agentId: input.agentId,
		})
	}
}

function normalizeMetadata(
	meta: MdbrainAddInput["metadata"],
): Record<string, unknown> | undefined {
	if (!meta) {
		return undefined
	}
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(meta)) {
		out[k] = v
	}
	return out
}
