/**
 * Request shapes for the Mdbrain HTTP API.
 * Runtime implementation lives in @mdbrain/memory-bridge.
 */

export type MdbrainContainerTag = string

export type MdbrainWikiPromotion = {
	page: {
		kind: "entity" | "concept" | "synthesis" | "source" | "report" | "procedure"
		title: string
		slug: string
		summary: string
		body: string
		frontmatter: Record<string, unknown> & { type: string }
		claims: Array<{
			id: string
			text: string
			confidence?: number
			evidence?: Array<Record<string, unknown>>
			derivedFrom?: string[]
		}>
		scope: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
		scopeRef: string
		trustTier: "restricted" | "standard" | "admin"
		permissions?: {
			allowedSubjects?: string[]
			allowedGroups?: string[]
			allowedRoles?: string[]
			allowedDepartments?: string[]
		}
	}
}

export type MdbrainAddInput = {
	content: string
	idempotencyKey: string
	requestId?: string
	/** @deprecated Prefer `sessionId`. */
	containerTag?: MdbrainContainerTag
	entityContext?: string
	customId?: string
	metadata?: Record<string, string | number | boolean | null>
	agentId?: string
	sessionId?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
	promotionPolicy?: "none" | "wiki"
	wikiPromotion?: MdbrainWikiPromotion
}

export type MdbrainSearchInput = {
	query: string
	/** @deprecated Prefer `sessionKey`. */
	containerTag?: MdbrainContainerTag
	limit?: number
	agentId?: string
	minScore?: number
	sessionKey?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
}

export type MdbrainSearchDegradation = {
	kind: "throttled"
	scope: "denied" | "legacy-fallback-skipped" | "vector-lane-skipped"
	retryAfterMs: number
}

export type SearchConfig = {
	recipe?: "fast" | "hybrid" | "deep" | "temporal" | "chain-of-thought"
	recallProfile?: "latency" | "balanced" | "proof"
	maxResults?: number
	searchMode?: "auto" | "direct" | "agentic"
	maxPasses?: number
	sourcePreference?: Array<
		| "reference"
		| "conversation"
		| "structured"
		| "procedural"
		| "episodic"
		| "graph"
	>
	timeRange?: { preset?: string; start?: string; end?: string }
	needExactEvidence?: boolean
	allowConstraintRelaxation?: boolean
	numCandidates?: number
	fusionMethod?: "scoreFusion" | "rankFusion" | "js-merge"
	hybridMode?: "hybrid" | "vector-only"
	allowHybridBackstop?: boolean
	lexicalPrefilter?: "disabled" | "experimental"
}

export type MdbrainConversationRecallInput = {
	query?: string
	sessionId?: string
	roles?: Array<"user" | "assistant" | "system" | "tool">
	startTime?: string
	endTime?: string
	timezone?: string
	includeToolMessages?: boolean
	limit?: number
	agentId?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
}

export type MdbrainConversationImportInput = {
	datasetPath: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	limitConversations?: number
	limitTurnsPerConversation?: number
	agentId?: string
}

export type MdbrainSourceAgent = {
	id: string
	name: string
	runId?: string
}

export type MdbrainActorRole = "user" | "assistant" | "system"
export type MdbrainMemoryFeedbackSignal = "confirm" | "correct" | "irrelevant"

export type MdbrainLifecycleFamily = "structured" | "procedure"
export type MdbrainLifecycleState = "active" | "invalidated" | "conflicted"
export type MdbrainLifecycleHistoryKind = "revision" | "current"

type MdbrainStableHandleBase = {
	family: MdbrainLifecycleFamily
	id: string
	agentId: string
	scope: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef: string
	revision: number
	state: MdbrainLifecycleState
	validFrom?: string
	validTo?: string
	updatedAt?: string
}

export type MdbrainStructuredStableHandle = MdbrainStableHandleBase & {
	family: "structured"
	structured: {
		type: string
		key: string
	}
}

export type MdbrainProcedureStableHandle = MdbrainStableHandleBase & {
	family: "procedure"
	procedure: {
		procedureId: string
	}
}

export type MdbrainStableHandle =
	| MdbrainStructuredStableHandle
	| MdbrainProcedureStableHandle

export type MdbrainLifecycleStructuredData = {
	type: string
	key: string
	value: string
	context?: string
	confidence?: number
	source?: string
	sessionId?: string
	tags?: string[]
	salience?: string
	temporalScope?: string
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	sourceReliability?: number
	reinforcementCount?: number
	reviewAt?: string
	lastConfirmedAt?: string
	sourceAgent?: MdbrainSourceAgent
	artifact?: Record<string, unknown>
}

export type MdbrainLifecycleProcedureData = {
	procedureId: string
	name: string
	intentTags?: string[]
	triggerQueries?: string[]
	steps: string[]
	successSignals?: string[]
	confidence?: number
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	successCount?: number
	failCount?: number
	lastSuccessAt?: string
	lastFailureAt?: string
	sourceAgent?: MdbrainSourceAgent
}

export type MdbrainLifecycleItem =
	| {
			family: "structured"
			handle: MdbrainStructuredStableHandle
			data: MdbrainLifecycleStructuredData
			createdAt?: string
			updatedAt?: string
	  }
	| {
			family: "procedure"
			handle: MdbrainProcedureStableHandle
			data: MdbrainLifecycleProcedureData
			createdAt?: string
			updatedAt?: string
	  }

export type MdbrainLifecycleHistoryEntry = MdbrainLifecycleItem & {
	historyKind: MdbrainLifecycleHistoryKind
	supersededAt?: string
}

export type MdbrainStructuredLifecyclePatch = Partial<
	Pick<
		MdbrainLifecycleStructuredData,
		| "value"
		| "context"
		| "confidence"
		| "source"
		| "sessionId"
		| "tags"
		| "salience"
		| "temporalScope"
		| "provenance"
		| "sourceEventIds"
		| "sourceReliability"
		| "reviewAt"
		| "lastConfirmedAt"
		| "sourceAgent"
		| "artifact"
	> & { validTo: string }
>

export type MdbrainProcedureLifecyclePatch = Partial<
	Pick<
		MdbrainLifecycleProcedureData,
		| "name"
		| "intentTags"
		| "triggerQueries"
		| "steps"
		| "successSignals"
		| "confidence"
		| "provenance"
		| "sourceEventIds"
		| "sourceAgent"
	>
>

export type MdbrainLifecycleGetInput = {
	handle: MdbrainStableHandle
}

export type MdbrainLifecycleUpdateInput =
	| {
			handle: MdbrainStructuredStableHandle
			patch: MdbrainStructuredLifecyclePatch
	  }
	| {
			handle: MdbrainProcedureStableHandle
			patch: MdbrainProcedureLifecyclePatch
	  }

export type MdbrainLifecycleDeleteInput = {
	handle: MdbrainStableHandle
	invalidatedBy?: Record<string, unknown>
}

export type MdbrainLifecycleHistoryInput = {
	handle: MdbrainStableHandle
	limit?: number
}

export type MdbrainProcedureOutcomeInput = {
	handle: MdbrainProcedureStableHandle
	success: boolean
	note?: string
	actorRole?: MdbrainActorRole
}

export type MdbrainMemoryFeedbackInput =
	| {
			handle: MdbrainStructuredStableHandle
			signal: "confirm"
			note?: string
			actorRole?: MdbrainActorRole
	  }
	| {
			handle: MdbrainStructuredStableHandle
			signal: "correct"
			patch: MdbrainStructuredLifecyclePatch
			note?: string
			actorRole?: MdbrainActorRole
	  }
	| {
			handle: MdbrainStructuredStableHandle
			signal: "irrelevant"
			note?: string
			actorRole?: MdbrainActorRole
			invalidatedBy?: Record<string, unknown>
	  }

export type MdbrainProfileInput = {
	/** @deprecated Prefer `scopeRef`. */
	containerTag?: MdbrainContainerTag
	agentId?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
	maxEntities?: number
	maxEpisodes?: number
}

export type MdbrainActiveSlateInput = {
	agentId?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
	maxItems?: number
}

export type MdbrainDiscoveryProjectionInput = {
	agentId?: string
	kind: "entity-brief" | "topic-brief" | "what-changed" | "contradiction-report"
	query?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
	scopeRef?: string
	maxItems?: number
	timeRange?: { preset?: string; start?: string; end?: string }
}

export type MdbrainTraceChainInput = {
	factId: string
	collection: string
	agentId?: string
	maxDepth?: number
}

export type MdbrainScanNoveltyInput = {
	agentId?: string
	limit?: number
	scope?: string
}

export type MdbrainConsolidateInput = {
	agentId?: string
	maxEvents?: number
	minCombinedScore?: number
	scope?: string
}

export type MdbrainSelfEditInput = {
	block: "user" | "persona" | "instructions"
	action: "append" | "replace" | "prepend"
	content: string
	agentId?: string
}

export type MdbrainSelfEditResponse = {
	upserted: boolean
	id: string
}

export type MdbrainExtractInput = {
	eventId: string
	agentId?: string
}

export type MdbrainExtractResponse = {
	ok: true
	jobId: string
	scheduled: boolean
}

// ---------------------------------------------------------------------------
// Response types for typed client methods (JSON wire format — dates as strings)
// ---------------------------------------------------------------------------

export type MdbrainReadFileResponse = {
	text: string
	path: string
	locator?: string
	source?: string
	sourceType?: string
	title?: string
	key?: string
	type?: string
	error?: string
	disabled?: boolean
}

export type MdbrainConversationRecallCitation = {
	eventId: string
	sessionId?: string
	role: "user" | "assistant" | "system" | "tool"
	timestamp: string
	sourceRef?: string
	preview: string
}

export type MdbrainConversationRecallResult = {
	citation: MdbrainConversationRecallCitation
	score?: number
	matchType: "filter" | "semantic" | "hybrid"
}

export type MdbrainConversationRecallResponse = {
	results: MdbrainConversationRecallResult[]
	metadata: {
		totalMatched: number
		queryUsed?: string
		filtersApplied: string[]
		searchMethod: "standard" | "semantic" | "hybrid"
		durationMs: number
		throttled?: { retryAfterMs: number }
	}
}

export type MdbrainStatsResponse = {
	sources: Array<{ source: string; files: number; chunks: number }>
	totalFiles: number
	totalChunks: number
	embeddingCoverage: Record<string, number>
	embeddingStatusCoverage: Record<string, number>
	cachedEmbeddings: number
	staleFiles: string[]
	collectionSizes: { files: number; chunks: number; embeddingCache: number }
	indexStats: Array<{
		name: string
		collection: string
		size: number
		accesses: number
	}>
}

export type MdbrainProfileResponse = {
	agentId: string
	scope: string
	scopeRef: string
	preferences: Array<{
		key: string
		value: string
		salience: string
		updatedAt: string
	}>
	decisions: Array<{
		key: string
		value: string
		salience: string
		updatedAt: string
	}>
	facts: Array<{
		key: string
		value: string
		salience: string
		updatedAt: string
	}>
	todos: Array<{
		key: string
		value: string
		salience: string
		updatedAt: string
	}>
	topEntities: Array<{ name: string; type: string; relationCount: number }>
	recentEpisodes: Array<{
		title: string
		summary: string
		type: string
		timeRange: { start: string; end: string }
	}>
	activityPatterns: {
		roleDistribution: Record<string, number>
		totalEvents: number
		lastActive: string | null
	}
	synthesizedAt: string
}

export type MdbrainRelevanceExplainResponse = {
	runId?: string
	latencyMs: number
	sourceScope: string
	health: "ok" | "degraded" | "insufficient-data"
	fallbackPath?: string
	sampleRate: number
	artifacts: Array<{
		artifactType: string
		summary: Record<string, unknown>
		rawExplain?: unknown
		compression?: "none"
	}>
	results: Array<Record<string, unknown>>
}

export type MdbrainBenchmarkBuildIdentity = {
	source: "env" | "unknown"
	commitSha?: string
	buildId?: string
	buildLabel?: string
}

export type MdbrainBenchmarkReleaseGate = {
	gate:
		| "official-retrieval"
		| "internal-retrieval"
		| "conversation-recall-regression"
		| "query-governance"
	status: "passed" | "warning" | "not-run" | "advisory-only"
	evidence: string
}

export type MdbrainBenchmarkRunReport = {
	generatedAt: string
	build: MdbrainBenchmarkBuildIdentity
	corpus: {
		datasetVersion: string
		datasetName?: string
		datasetKind?: "generic" | "longmemeval" | "locomo" | "legacy-query"
		scenarios?: number
		cases: number
		scoredCases?: number
		skippedCases?: number
	}
	metrics: {
		internal: {
			hitRate: number
			emptyRate: number
			avgTopScore: number
			p95LatencyMs: number
			rAt5?: number
			rAt10?: number
			ndcgAt10?: number
		}
		official?: {
			longMemEval?: {
				retrievalCases: number
				abstentionCases: number
				session: MdbrainBenchmarkOfficialRetrievalMetrics
				turn?: MdbrainBenchmarkOfficialRetrievalMetrics
			}
			loCoMo?: {
				qaCases: number
				abstentionCases: number
				sessionEvidenceRecallAt5: number
				sessionEvidenceRecallAt10: number
				dialogEvidenceRecallAt5?: number
				dialogEvidenceRecallAt10?: number
			}
		}
	}
	releaseGates: MdbrainBenchmarkReleaseGate[]
	warnings: string[]
	degradations: string[]
}

export type MdbrainRelevanceBenchmarkResponse = {
	datasetVersion: string
	datasetName?: string
	datasetKind?: "generic" | "longmemeval" | "locomo" | "legacy-query"
	scenarios?: number
	cases: number
	scoredCases?: number
	skippedCases?: number
	hitRate: number
	emptyRate: number
	avgTopScore: number
	p95LatencyMs: number
	rAt5?: number
	rAt10?: number
	ndcgAt10?: number
	questionTypeBreakdown?: Array<{
		questionType: string
		cases: number
		scoredCases: number
		hitRate: number
		rAt5: number
		rAt10: number
		ndcgAt10: number
	}>
	officialMetrics?: {
		longMemEval?: {
			retrievalCases: number
			abstentionCases: number
			session: MdbrainBenchmarkOfficialRetrievalMetrics
			turn?: MdbrainBenchmarkOfficialRetrievalMetrics
		}
		loCoMo?: {
			qaCases: number
			abstentionCases: number
			sessionEvidenceRecallAt5: number
			sessionEvidenceRecallAt10: number
			dialogEvidenceRecallAt5?: number
			dialogEvidenceRecallAt10?: number
		}
	}
	ingest?: {
		conversationsIngested: number
		turnsIngested: number
		skippedConversations: number
		failedLines: number
		failedTurns: number
	}
	regressions: Array<{
		metricName: string
		baseline: number
		current: number
		delta: number
		severity: "low" | "medium" | "high"
	}>
	queryGovernance?: {
		status: "advisory-only"
		generatedAt: string
		candidates: Array<{
			candidateId: string
			source: "benchmark" | "operator-trace"
			queryShapeFamily: "search-detailed"
			recipe?: "fast" | "hybrid" | "deep" | "temporal" | "chain-of-thought"
			scope: "cluster"
			reason: string
			evidence: {
				datasetName?: string
				datasetKind?: "generic" | "longmemeval" | "locomo" | "legacy-query"
				cases: number
				hitRate: number
				p95LatencyMs: number
				rAt5?: number
				ndcgAt10?: number
			}
			recommendedAction: "inspect-query-stats" | "consider-setQuerySettings"
			rollbackNote: string
		}>
		notes: string[]
	}
	benchmarkReport?: MdbrainBenchmarkRunReport
}

export type MdbrainBenchmarkOfficialRetrievalMetrics = {
	recallAnyAt1: number
	recallAllAt1: number
	ndcgAnyAt1: number
	recallAnyAt3: number
	recallAllAt3: number
	ndcgAnyAt3: number
	recallAnyAt5: number
	recallAllAt5: number
	ndcgAnyAt5: number
	recallAnyAt10: number
	recallAllAt10: number
	ndcgAnyAt10: number
	recallAnyAt30: number
	recallAllAt30: number
	ndcgAnyAt30: number
	recallAnyAt50: number
	recallAllAt50: number
	ndcgAnyAt50: number
}

export type MdbrainRelevanceReportResponse = {
	health: "ok" | "degraded" | "insufficient-data"
	runs: number
	sampledRuns: number
	emptyRate: number
	avgTopScore: number
	fallbackRate: number
	lastRegressionAt?: string
	profileCapabilities: {
		textExplain: boolean
		vectorExplain: boolean
		fusionExplain: boolean
	}
}

export type MdbrainRelevanceSampleRateResponse = {
	enabled: boolean
	current: number
	base: number
	max: number
	windowSize: number
	degradedSignals: number
}

export type MdbrainBenchmarkIngestResponse = {
	datasetPath: string
	datasetName?: string
	conversationsIngested: number
	turnsIngested: number
	skippedConversations: number
	failedLines: number
	failedTurns: number
	startedAt: string
	completedAt: string
}

export type MdbrainConversationImportResponse = {
	datasetPath: string
	datasetName?: string
	datasetKind?: "generic" | "longmemeval" | "locomo"
	conversationsImported: number
	turnsImported: number
	skippedConversations: number
	failedLines: number
	failedTurns: number
	startedAt: string
	completedAt: string
}

export type MdbrainAccessTrendResponse = Array<{
	collection: string
	memoryId: string
	day: string
	count: number
	rolling7dCount: number
	lastAccessedAt?: string
}>

export type MdbrainAccessSummaryResponse = Array<{
	collection: string
	memoryId: string
	accessCount: number
	lastAccessedAt?: string
}>

export type MdbrainTraceChainResponse = {
	factId: string
	collection: string
	nodes: Array<{
		type: "event" | "fact" | "gap"
		id: string
		collection: string
		body?: string
		role?: string
		timestamp?: string
		depth: number
		reason?: string
	}>
	chainComplete: boolean
	maxDepthReached: boolean
	agentId: string
}

export type MdbrainNoveltyResponse = {
	events: Array<{
		eventId: string
		body: string
		noveltyScore: number
		timestamp: string
		role: string
		nearestNeighborDistance: number
	}>
	scannedCount: number
	error?: string
	agentId: string
}

export type MdbrainConsolidateResponse = {
	runId: string
	agentId: string
	eventsProcessed: number
	factsPromoted: number
	factsPruned: number
	conflictsResolved: number
	durationMs: number
	candidates: Array<{
		eventId: string
		body: string
		timestamp: string
		noveltyScore: number
		importanceDecay: number
		accessCount: number
		combinedScore: number
	}>
	orientStats?: {
		unprocessedCount: number
		byRole: Array<{ role: string; count: number }>
		topScopes: Array<{ scope: string; lastActivity: string }>
	}
	prunedCount?: number
}

export type MdbrainRecallTrace = {
	traceId: string
	agentId: string
	query: string
	timestamp: string
	lanesUsed?: string[]
	lanesSkipped?: string[]
	totalHits?: number
	latencyMs?: number
	hitsByLane?: Record<string, number>
	topHitIds?: string[]
	tokenBudgetUsed?: number
	bundleMode?: "full" | "wake-up"
}

export type MdbrainMemoryJobStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"

export type MdbrainMemoryJobType =
	| "consolidation"
	| "extraction"
	| "import"
	| "materialization"
	| "enrichment"

export type MdbrainMemoryJob = {
	jobId: string
	jobType: MdbrainMemoryJobType
	agentId: string
	status: MdbrainMemoryJobStatus
	createdAt: string
	startedAt?: string
	completedAt?: string
	error?: string
	inputCount?: number
	outputCount?: number
	durationMs?: number
	metadata?: Record<string, unknown>
}

export type MdbrainSearchKBResponse = {
	degradation?: MdbrainSearchDegradation
	results: Array<{
		path: string
		startLine: number
		endLine: number
		score: number
		snippet: string
		source: string
		canonicalId?: string
		timestamp?: string
		scope?: string
		scopeRef?: string
	}>
}

export type MdbrainSearchResponse = {
	degradation?: MdbrainSearchDegradation
	results: Array<{
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
	}>
}

export type MdbrainContextBundleInput = {
	agentId?: string
	query?: string
	scope?: "session" | "user" | "agent" | "workspace" | "tenant" | "global"
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
	timeRange?: { preset?: string; start?: string; end?: string }
	/** "wake-up" returns a compact 250-token projection for session start. Default: "full". */
	mode?: "full" | "wake-up"
}

// ---------------------------------------------------------------------------
// Wiki workspace (typed views of /v1/wiki and /v1/wiki/revisions)
// ---------------------------------------------------------------------------

/** Evidence attached to a wiki claim. Mirrors the API's claim evidence objects. */
export type MdbrainWikiClaimEvidence = {
	kind: "file" | "url" | "event" | "api" | "manual" | "agent"
	sourceId: string
	path?: string
	lines?: string
	weight?: number
	confidence?: number
	privacyTier?: string
	note?: string
}

/** Evidence as returned by the API: event evidence also carries the
 *  `[[event:EVENT_ID]]` marker. The marker is response-only. */
export type MdbrainWikiClaimEvidenceView = MdbrainWikiClaimEvidence & {
	marker?: string
}

/** A governed claim on a wiki page, as returned by the API. `marker` is the
 *  claim's `[[wiki:SLUG#CLAIM_ID@rREVISION]]` citation marker at the revision
 *  the response shows; it is response-only. */
export type MdbrainWikiClaim = {
	id: string
	text: string
	status: "active" | "superseded" | "contradicted" | "disputed"
	confidence: number
	marker?: string
	evidence: MdbrainWikiClaimEvidenceView[]
	derivedFrom: string[]
	supersedesClaimId?: string
	sourceMemId?: string
	validFrom?: string
	validTo?: string
	writerAgent?: MdbrainSourceAgent
}

/** A claim sent to POST /v1/wiki or PATCH /v1/wiki/:slug. The caller owns the
 *  id: a patch merges claims into the page by id (same id replaces, new id is
 *  appended, `claims: []` clears them all). validFrom and validTo are left out
 *  on purpose: the store holds them as dates and a JSON body can only carry
 *  strings, which the schema rejects. */
export type MdbrainWikiClaimInput = {
	id: string
	text: string
	status?: MdbrainWikiClaim["status"]
	confidence?: number
	evidence?: MdbrainWikiClaimEvidence[]
	writerAgent?: MdbrainSourceAgent
	derivedFrom?: string[]
	supersedesClaimId?: string
	sourceMemId?: string
}

/** A relationship sent to POST /v1/wiki or PATCH /v1/wiki/:slug. A patch
 *  replaces the page's whole relationship list rather than merging it. */
export type MdbrainWikiRelationshipInput = {
	targetPageSlug: string
	targetTitle: string
	kind: string
	weight?: number
	confidence?: number
	evidenceKind?: string
	privacyTier?: string
}

/** A wiki page as served by GET /v1/wiki/:slug (format=json) and the wiki
 *  mutation routes. JSON-serialized: timestamps are ISO strings. */
export type MdbrainWikiPageView = {
	_id: string
	kind: string
	title: string
	slug: string
	aliases: string[]
	summary: string
	body: string
	frontmatter: Record<string, unknown>
	claims: MdbrainWikiClaim[]
	contradictions: unknown[]
	questions: unknown[]
	relationships: unknown[]
	personCard: unknown
	entityId?: string
	okfConceptId?: string
	okfBundleId?: string
	scope: string
	scopeRef: string
	trustTier: string
	permissions: Record<string, unknown>
	state: string
	revision: number
	validFrom: string | null
	validTo?: string
	freshness: string
	lastMaintainedAt?: string
	backlinks: unknown[]
	transcludes: string[]
	createdAt: string
	updatedAt: string
}

/** Envelope returned by GET /v1/wiki (page list with filters + pagination). */
export type MdbrainWikiPageListResponse = {
	pages: MdbrainWikiPageView[]
	total: number
}

/** Input for POST /v1/wiki (explicit create). */
export type MdbrainWikiPageCreateInput = {
	kind: string
	title: string
	slug: string
	aliases?: string[]
	summary: string
	body: string
	frontmatter: { type: string } & Record<string, unknown>
	scope: string
	scopeRef: string
	/** Required by the server: one of "restricted" | "standard" | "admin".
	 *  The API rejects create bodies with an omitted/empty tier, so the SDK
	 *  does not default it. */
	trustTier: string
	claims?: MdbrainWikiClaimInput[]
	relationships?: MdbrainWikiRelationshipInput[]
	agentId?: string
}

/** Input for PATCH /v1/wiki/:slug (explicit update). `expectedRevision` is
 *  the revision the caller inspected; it is sent unchanged as the CAS
 *  precondition and never silently refreshed. The server returns
 *  REVISION_CONFLICT (409) when it no longer matches. */
export type MdbrainWikiPageUpdateInput = {
	slug: string
	scope: string
	scopeRef: string
	expectedRevision: number
	title?: string
	aliases?: string[]
	summary?: string
	body?: string
	frontmatter?: { type: string } & Record<string, unknown>
	trustTier?: string
	permissions?: Record<string, unknown>
	claims?: MdbrainWikiClaimInput[]
	relationships?: MdbrainWikiRelationshipInput[]
	agentId?: string
}

/** Who performed a wiki write; recorded on every revision. */
export type MdbrainWikiPageEditor = {
	id: string
	name: string
	runId?: string
}

export type MdbrainWikiRevisionEditKind = "create" | "update" | "delete"

/** One revision summary from GET /v1/wiki/revisions (no snapshot). */
export type MdbrainWikiRevisionSummary = {
	pageSlug: string
	scope: string
	scopeRef: string
	revision: number
	editKind: MdbrainWikiRevisionEditKind
	editor?: MdbrainWikiPageEditor
	createdAt: string
}

/** Envelope returned by GET /v1/wiki/revisions. */
export type MdbrainWikiRevisionListResponse = {
	revisions: MdbrainWikiRevisionSummary[]
}

/** Full revision record from GET /v1/wiki/revisions/:revision, including the
 *  page document as of that revision. */
export type MdbrainWikiRevisionRecord = MdbrainWikiRevisionSummary & {
	snapshot: Record<string, unknown>
}

/** Input for GET /v1/cite. Scope and agent are the caller's, never read from
 *  the marker. An event marker needs `citedBy`, the wiki marker of a claim
 *  whose evidence cites the event. */
export type MdbrainCiteInput = {
	marker: string
	citedBy?: string
	scope: string
	scopeRef: string
	agentId?: string
}

/** A wiki marker resolved: the claim as stored at the marker's revision. */
export type MdbrainCitationClaimResponse = {
	status: "resolved"
	kind: "claim"
	marker: string
	page: {
		slug: string
		title?: string
		revision: number
		revisionCreatedAt: string
	}
	claim: MdbrainWikiClaim
}

/** An event marker resolved through governed recall in the context of a citing claim. */
export type MdbrainCitationEventResponse = {
	status: "resolved"
	kind: "event"
	marker: string
	citedBy: string
	event: {
		eventId: string
		canonicalId: string
		text?: string
		timestamp?: string
		scope: string
		scopeRef: string
	}
}

export type MdbrainCitationResponse =
	| MdbrainCitationClaimResponse
	| MdbrainCitationEventResponse
