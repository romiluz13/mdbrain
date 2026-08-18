import type {
	MdbrainAddInput,
	MdbrainActiveSlateInput,
	MdbrainConversationRecallInput,
	MdbrainConversationRecallResponse,
	MdbrainContextBundleInput,
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
	MdbrainProfileInput,
	MdbrainProfileResponse,
	MdbrainProcedureOutcomeInput,
	MdbrainSearchInput,
	MdbrainSearchKBResponse,
	MdbrainSearchResponse,
	SearchConfig,
	MdbrainWikiPromotion,
} from "./types.js"
import {
	apiDelete,
	apiGet,
	apiPatch,
	apiPost,
	MdbrainClientError,
	resolveDeadlineMs,
} from "./transport.js"
import type {
	MdbrainClientOptions,
	MdbrainRequestOptions,
} from "./transport.js"

export { MdbrainClientError }
export type { MdbrainClientOptions, MdbrainRequestOptions }

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
		requestOptions?: MdbrainRequestOptions,
	): Promise<{ ok: true; eventId: string; chunkCreated: boolean }> {
		return apiPost(
			this._opts,
			"/v1/add",
			{
				content: input.content,
				agentId: input.agentId,
				containerTag: input.containerTag,
				sessionId: input.sessionId ?? input.containerTag,
				metadata: normalizeMetadata(input.metadata),
				scope: input.scope,
				scopeRef: input.scopeRef,
				promotionPolicy: input.promotionPolicy,
				wikiPromotion: input.wikiPromotion,
			},
			{
				"Idempotency-Key": input.idempotencyKey,
				...(input.requestId ? { "X-Request-ID": input.requestId } : {}),
			},
			"same-key",
			requestOptions,
		)
	}

	async search(
		input: MdbrainSearchInput & {
			agentId?: string
			minScore?: number
			sessionKey?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainSearchResponse> {
		return apiPost(
			this._opts,
			"/v1/search",
			{
				query: input.query,
				agentId: input.agentId,
				limit: input.limit,
				minScore: input.minScore,
				containerTag: input.containerTag,
				sessionKey: input.sessionKey ?? input.containerTag,
				scope: input.scope,
				scopeRef: input.scopeRef,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async searchDetailed(
		input: {
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
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainSearchDetailedResponse> {
		return apiPost(
			this._opts,
			"/v1/search-detailed",
			{
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
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async searchKB(
		input: {
			query: string
			agentId?: string
			limit?: number
			minScore?: number
			filter?: { tags?: string[]; category?: string; source?: string }
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainSearchKBResponse> {
		return apiPost(
			this._opts,
			"/v1/search-kb",
			{
				query: input.query,
				agentId: input.agentId,
				limit: input.limit,
				minScore: input.minScore,
				filter: input.filter,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async recallConversation(
		input: MdbrainConversationRecallInput = {},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainConversationRecallResponse> {
		return apiPost(
			this._opts,
			"/v1/recall-conversation",
			{
				query: input.query,
				sessionId: input.sessionId,
				roles: input.roles,
				startTime: input.startTime,
				endTime: input.endTime,
				timezone: input.timezone,
				includeToolMessages: input.includeToolMessages,
				limit: input.limit,
				agentId: input.agentId,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async getLifecycleItem(
		input: MdbrainLifecycleGetInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(
			this._opts,
			"/v1/lifecycle/get",
			{ handle: input.handle },
			undefined,
			"safe",
			requestOptions,
		)
	}

	async updateLifecycleItem(
		input: MdbrainLifecycleUpdateInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(
			this._opts,
			"/v1/lifecycle/update",
			{
				handle: input.handle,
				patch: input.patch,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async deleteLifecycleItem(
		input: MdbrainLifecycleDeleteInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(
			this._opts,
			"/v1/lifecycle/delete",
			{
				handle: input.handle,
				invalidatedBy: input.invalidatedBy,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async getLifecycleHistory(
		input: MdbrainLifecycleHistoryInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainLifecycleHistoryEntry[]> {
		return apiPost(
			this._opts,
			"/v1/lifecycle/history",
			{
				handle: input.handle,
				limit: input.limit,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async reportProcedureOutcome(
		input: MdbrainProcedureOutcomeInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(
			this._opts,
			"/v1/procedures/outcome",
			{
				handle: input.handle,
				success: input.success,
				note: input.note,
				actorRole: input.actorRole,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async applyMemoryFeedback(
		input: MdbrainMemoryFeedbackInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainLifecycleItem> {
		return apiPost(
			this._opts,
			"/v1/memory/feedback",
			{
				handle: input.handle,
				signal: input.signal,
				...(input.signal === "correct" ? { patch: input.patch } : {}),
				...(input.signal === "irrelevant" && input.invalidatedBy
					? { invalidatedBy: input.invalidatedBy }
					: {}),
				note: input.note,
				actorRole: input.actorRole,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async writeEvent(
		input: {
			role: "user" | "assistant" | "system" | "tool"
			body: string
			idempotencyKey: string
			requestId?: string
			agentId?: string
			sessionId?: string
			timestamp?: string
			metadata?: Record<string, string | number | boolean | null>
			scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
			scopeRef?: string
			promotionPolicy?: "none" | "wiki"
			wikiPromotion?: MdbrainWikiPromotion
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<{ ok: true; eventId: string; chunkCreated: boolean }> {
		return apiPost(
			this._opts,
			"/v1/write-event",
			{
				role: input.role,
				body: input.body,
				agentId: input.agentId,
				sessionId: input.sessionId,
				timestamp: input.timestamp,
				metadata: normalizeMetadata(input.metadata),
				scope: input.scope,
				scopeRef: input.scopeRef,
				promotionPolicy: input.promotionPolicy,
				wikiPromotion: input.wikiPromotion,
			},
			{
				"Idempotency-Key": input.idempotencyKey,
				...(input.requestId ? { "X-Request-ID": input.requestId } : {}),
			},
			"same-key",
			requestOptions,
		)
	}

	async writeStructured(
		input: {
			entry: Record<string, unknown>
			agentId?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<{ upserted: boolean; id: string }> {
		return apiPost(
			this._opts,
			"/v1/write-structured",
			{
				entry: input.entry,
				agentId: input.agentId,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async writeProcedure(
		input: {
			entry: Record<string, unknown>
			agentId?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<{ upserted: boolean; id: string }> {
		return apiPost(
			this._opts,
			"/v1/write-procedure",
			{
				entry: input.entry,
				agentId: input.agentId,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async extract(
		input: MdbrainExtractInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainExtractResponse> {
		return apiPost(
			this._opts,
			"/v1/extract",
			{
				eventId: input.eventId,
				agentId: input.agentId,
			},
			undefined,
			"never",
			requestOptions,
		)
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
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainProfileResponse> {
		return apiPost(
			this._opts,
			"/v1/profile",
			{
				agentId: input.agentId,
				containerTag: input.containerTag,
				scope: input.scope,
				scopeRef: input.scopeRef ?? input.containerTag,
				maxEntities: input.maxEntities,
				maxEpisodes: input.maxEpisodes,
				maxPerType: input.maxPerType,
				activityWindowMs: input.activityWindowMs,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async hydrateActiveSlate(
		input: MdbrainActiveSlateInput = {},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainActiveSlateResponse> {
		return apiPost(
			this._opts,
			"/v1/hydrate-active-slate",
			{
				agentId: input.agentId,
				scope: input.scope,
				scopeRef: input.scopeRef,
				maxItems: input.maxItems,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async state(
		input: MdbrainActiveSlateInput = {},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainStateResponse> {
		return apiGet(
			this._opts,
			`/v1/state${q(input.agentId, {
				scope: input.scope,
				scopeRef: input.scopeRef,
			})}`,
			requestOptions,
		)
	}

	async buildDiscoveryProjection(
		input: MdbrainDiscoveryProjectionInput,
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainDiscoveryProjectionResponse> {
		return apiPost(
			this._opts,
			"/v1/discovery-projection",
			{
				agentId: input.agentId,
				kind: input.kind,
				query: input.query,
				scope: input.scope,
				scopeRef: input.scopeRef,
				maxItems: input.maxItems,
				timeRange: input.timeRange,
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async buildContextBundle(
		input: MdbrainContextBundleInput = {},
		requestOptions?: MdbrainRequestOptions,
	): Promise<MdbrainContextBundleResponse> {
		return apiPost(
			this._opts,
			"/v1/context-bundle",
			{
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
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	// ---------------------------------------------------------------------------
	// Wiki (T6 MCP tools)
	// ---------------------------------------------------------------------------

	async wikiSearch(
		input: {
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
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<unknown> {
		return apiPost(
			this._opts,
			"/v1/wiki/search",
			{
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
			},
			undefined,
			"safe",
			requestOptions,
		)
	}

	async wikiGet(
		input: {
			slug: string
			scope: string
			scopeRef: string
			format?: "json" | "markdown" | "html"
			agentId?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<unknown> {
		const qs = new URLSearchParams({
			scope: input.scope,
			scopeRef: input.scopeRef,
		})
		if (input.format) qs.set("format", input.format)
		if (input.agentId) qs.set("agentId", input.agentId)
		return apiGet(this._opts, `/v1/wiki/${input.slug}?${qs}`, requestOptions)
	}

	async wikiApply(
		input: {
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
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<unknown> {
		const deadlineAt =
			Date.now() + resolveDeadlineMs(this._opts, requestOptions)
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
			return await apiPost(
				this._opts,
				"/v1/wiki",
				body,
				undefined,
				"never",
				requestOptions,
			)
		} catch (err) {
			if (err instanceof MdbrainClientError && err.status === 409) {
				const remainingOptions: MdbrainRequestOptions = {
					...requestOptions,
					timeoutMs: Math.max(0, deadlineAt - Date.now()),
				}
				return apiPatch(
					this._opts,
					`/v1/wiki/${input.slug}`,
					body,
					remainingOptions,
				)
			}
			throw err
		}
	}

	async wikiExportOkf(
		input: {
			scope: string
			scopeRef: string
			outDir: string
			okfBundleId?: string
			trustTier?: string
			agentId?: string
			returnContent?: boolean
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<unknown> {
		return apiPost(
			this._opts,
			"/v1/wiki/okf-export",
			{
				scope: input.scope,
				scopeRef: input.scopeRef,
				outDir: input.outDir,
				okfBundleId: input.okfBundleId,
				trustTier: input.trustTier,
				agentId: input.agentId,
				returnContent: input.returnContent,
			},
			undefined,
			"never",
			requestOptions,
		)
	}

	async wikiLint(
		input: {
			scope: string
			scopeRef: string
			kind?: string
			limit?: number
			agentId?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<unknown> {
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
		return apiGet(this._opts, `/v1/wiki/lint?${qs}`, requestOptions)
	}

	async wikiDelete(
		input: {
			slug: string
			scope: string
			scopeRef: string
			hard?: boolean
			agentId?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<{
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
		return apiDelete(
			this._opts,
			`/v1/wiki/${input.slug}?${params}`,
			requestOptions,
		)
	}

	async wikiImportOkf(
		input: {
			bundleDir: string
			scope: string
			scopeRef: string
			trustTier: "restricted" | "standard" | "admin"
			okfBundleId: string
			agentId?: string
		},
		requestOptions?: MdbrainRequestOptions,
	): Promise<unknown> {
		return apiPost(
			this._opts,
			"/v1/wiki/okf-import",
			{
				bundleDir: input.bundleDir,
				scope: input.scope,
				scopeRef: input.scopeRef,
				trustTier: input.trustTier,
				okfBundleId: input.okfBundleId,
				agentId: input.agentId,
			},
			undefined,
			"never",
			requestOptions,
		)
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
