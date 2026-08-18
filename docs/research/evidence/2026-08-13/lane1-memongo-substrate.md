# LANE 1 — Memongo Substrate Self-Facts (local code only)

> ⚠️ **Raw research notes — superseded where the synthesis differs.** Authoritative claims live in `../../2026-08-13-memongo-absorb-company-brain.md`; known stale claims are marked SUPERSEDED in place. (Banner added 2026-08-13, v4 remediation.)

Repo: `/Users/rom.iluz/Dev/memongo` — branch `main`, HEAD = `8833026c0c` "feat(memory): harden parallel evidence retrieval" (2026-08-13 17:48 +0300), **1 commit ahead of origin/main (unpushed)** — verified via `git status -sb` → `main...origin/main [ahead 1]`.
All citations are repo-root-relative `memongo:<path>:<line>`. Labels: [SUBSTRATE-FACT] = verified in code; [BENCHMARK-EVIDENCE] = measured artifact exists; [EXTERNAL-SPEC] = external source; UNSUPPORTED = claim without code/benchmark backing.

---

## 1. What the memory engine actually does (from code)

### 1.1 Architecture in one paragraph

[SUBSTRATE-FACT] A single MongoDB backend (`MemoryBackend = "mongodb"`, memongo:packages/lib/src/types.memory.ts:1) stores: conversation **events** (raw turns), **structured_mem** (derived facts), **procedures**, **kb/kb_chunks** (knowledge base docs + chunks), **episodes**, **entities/relations/entity_links** (graph). Retrieval is orchestrated by `searchV2()` (memongo:packages/memory-engine/src/mongodb-search-v2.ts:217) which plans retrieval paths, runs lanes, fuses, reranks, and projects results. Apps never touch the engine directly — they go through `@memongo/memory-bridge` (stable facade) over `MongoDBMemoryManager`.

### 1.2 Consolidation ("Dreamer")

[SUBSTRATE-FACT] `mongodb-consolidator.ts` implements a 5-phase offline pipeline (header comment, memongo:packages/memory-engine/src/mongodb-consolidator.ts:1-20):

- Phase 0 gate: rate limiter + unprocessed-event count check.
- Phase 1 orient: `$facet` parallel stats.
- Phase 2 extract+decide: **8 regex category patterns** — decision, preference, fact, contact, todo, milestone, problem, emotional (memongo:packages/memory-engine/src/mongodb-consolidator.ts:110-148) — conservative rule ("false negatives OK, false positives NOT OK", line 101-103), then `$vectorSearch` similarity ADD/NOOP with `SIMILARITY_THRESHOLD_NOOP = 0.85` (line 183).
- ~~Phase 3 deduction / Phase 4 induction: **stubs for a future LLM agent**~~ **SUPERSEDED 2026-08-13 (v3 review):** the header comment (lines 10-12) is stale. LLM deduction/induction IS implemented (issue #31): `deduceFactsFromMemories`/`induceFactsFromMemories` run tenant-grouped per scope over observed facts only (inference-on-inference excluded), persist inferred facts flagged `origin: "llm-inference"`, and degrade to a skip only when no LLM provider is configured (memongo:packages/memory-engine/src/mongodb-consolidator.ts:1032-1139). Separate `mongodb-consolidation-adjudication.ts` and `mongodb-consolidation-reasoning.ts` modules exist.
- Phase 5 prune: near-duplicate merge via `$vectorSearch` at `SIMILARITY_THRESHOLD_PRUNE = 0.92` (line 184).
Promoted facts are written via `writeStructuredMemory()`; processed events are marked `dreamerProcessedAt` + `dreamerRunId` (header lines 14-19). Public entry: `consolidateMemory()` (line 350), exposed through the bridge as `memongoBridgeConsolidate` (memongo:packages/memory-bridge/src/memongo-bridge.ts:840).

### 1.3 Novelty detection

[SUBSTRATE-FACT] Surprisal-based: for each candidate event (max 30), run `$vectorSearch` k-NN (k=5 default) against the autoEmbed index on `body`, exclude self, average neighbor scores, `surprisal = 1 - avgSimilarity`, sort descending (memongo:packages/memory-engine/src/mongodb-novelty.ts:1-19). Graceful degradation when mongot is unavailable (line 16). Bridge: `memongoBridgeScanNovelty` (memongo:packages/memory-bridge/src/memongo-bridge.ts:824).

### 1.4 Reasoning chains

[SUBSTRATE-FACT] `traceChain` uses MongoDB `$graphLookup` over `sourceEventIds` links across collections `structured_mem`, `entities`, `relations`, `procedures`, `entity_links` (id-field map at memongo:packages/memory-engine/src/mongodb-reasoning-chain.ts:35-41), up to `DEFAULT_MAX_DEPTH = 3` hops (line 43); supports forward (premise tree) and reverse (downstream dependents) traversal (header lines 1-13). Bridge: `memongoBridgeTraceChain({factId, collection, maxDepth?})` (memongo:packages/memory-bridge/src/memongo-bridge.ts:809).

### 1.5 Episodes

[SUBSTRATE-FACT] `Episode` type: `{episodeId, type: "daily"|"weekly"|"thread"|"topic"|"decision", title, summary, timeRange, sourceEventIds?, tiered short/medium/longTermSummary, topics?, status}` (memongo:packages/memory-engine/src/mongodb-episodes.ts:23-46). Summaries are produced by an **injected `EpisodeSummarizer` function** — the engine does NOT call an LLM itself; callers wire their own LLM (comment lines 47-51). `materializeEpisode()` (line 186) reads events by time range (or a pre-selected set), hashes `sourceEventIds` for identity (`hashSourceEventIds`, line 171), marks events consolidated. `checkAutoEpisodeTriggers()` (line 762) auto-materializes on session gap (default 30 min), ≥50 unconsolidated events, 60-min rate limit.

### 1.6 Graph relationships

[SUBSTRATE-FACT] Entity types: person, org, project, topic, feature, issue, document, custom, location, system, concept (memongo:packages/memory-engine/src/mongodb-graph.ts:46-58). Extraction is **regex by default** (`RegexEntityExtractor`), with optional LLM enrichment provider (`EnrichmentProvider`) and typed relation extraction (`extractTypedRelations`, line 1897). API: `upsertEntity` (336), `upsertRelation` (439), `upsertEntityLink` (705), `expandGraph` (951, bounded by `graph.maxGraphDepth`), `findEntitiesByName` (860), autocomplete (1986), conservative delete (1287). Temporal validity clauses are merged into graph reads (`buildCurrentValidityClause`/`buildLiveStateClause`).

### 1.7 KB chunks

[SUBSTRATE-FACT] Two collections: `kb` (documents) + `kb_chunks` (chunks) with tenant isolation on `scopeRef` — every read/write/delete filters on it (memongo:packages/memory-engine/src/mongodb-kb.ts:25-34, "issue #27"). Chunks come from `chunkMarkdown` with configurable tokens/overlap (`kb.chunking` config). `searchKB()` (memongo:packages/memory-engine/src/mongodb-kb-search.ts:114) supports metadata filters `{tags, category, source}` resolved to a bounded `docId $in` filter (limit 10,000 docs, lines 71-111).

### 1.8 Retrieval (vector / FTS / hybrid)

[SUBSTRATE-FACT] `searchV2` plans over 8 retrieval paths — `active-critical | structured | raw-window | graph | hybrid | kb | episodic | procedural` (`RetrievalPath`, memongo:packages/memory-engine/src/mongodb-retrieval-planner.ts:14-22) via deterministic `planRetrieval()` (line 814) + `classifyRetrievalQuery()` (line 1072). Pipeline phases (timed, memongo:packages/memory-engine/src/mongodb-search-v2.ts): `phase:plan` (451) → `phase:rewrite` (458, optional synonym-expansion query rewriter) → `phase:lanes` (1427, parallel lanes) → `phase:result-normalization` (1453) → `phase:heuristic-rerank` (1458) → `phase:post-retrieval-scoring` (1467) → `phase:conversation-evidence` (1230) → `phase:temporal-coverage` (1483) → `phase:temporal-candidate-merge` (1508) → `phase:turn-precision` (1511) → `phase:precision-merge` (1568) → `phase:lane-controls-pre-rerank` (1584) → `phase:rerank` (1601) → `phase:lane-controls-post-rerank` (1650) → `phase:final-normalize` (1663) → `phase:projection` (1673).

[SUBSTRATE-FACT] Server-side fusion waterfall: `$scoreFusion` (MongoDB 8.3+, minMaxScaler normalization → comparable [0,1] scores; comment memongo:packages/memory-engine/src/mongodb-kb-search.ts:204-207) → `$rankFusion` (RRF; raw scores rescaled to [0,1] by `normalizeAndFilterRankFusionResults` because raw RRF tops out at Σweights/61 ≈ 0.0164, comment lines 272-278) → `js-merge` client-side RRF (`mergeHybridResultsMongoDB`, memongo:packages/memory-engine/src/mongodb-kb-search.ts:442-462) → vector-only lane → text-only `$search` lane → last-resort BSON `$text` (lines 470-514). Hybrid lane weights are locked at vector 0.7 / text 0.3 (`KB_FUSION_VECTOR_WEIGHT`/`KB_FUSION_TEXT_WEIGHT`, lines 26-27). FTS uses OR-join tokenization (fixes an upstream AND-join recall bug, memongo:packages/memory-engine/src/mongodb-hybrid.ts:1-32).

[SUBSTRATE-FACT] Embedding mode is `"automated"` only (`MemoryMongoDBEmbeddingMode = "automated"`, memongo:packages/lib/src/types.memory.ts:8): Atlas autoEmbed embeds server-side from the text field; queries send `query: { text }` + `model` instead of vectors (`buildVectorSearchStage`).

### 1.9 Reranking

[SUBSTRATE-FACT] Optional Voyage cross-encoder rerank (`rerank-2.5` | `rerank-2.5-lite`), gated by config `reranking.enabled` (memongo:packages/memory-engine/src/mongodb-reranker.ts:13-27). Endpoint auto-routes by API-key prefix: `al-...` → `https://ai.mongodb.com/v1/rerank` (Atlas proxy), else `https://api.voyageai.com/v1/rerank` (lines 43-52). Optional instruction-following prefix; post-cross-encoder boosts: `recencyBoost` (default 0.2), `accessBoost` (0.2), `temporalProximityBoost` (0.1) — config at memongo:packages/lib/src/types.memory.ts:125-145. Strict mode (`MEMONGO_RERANK_STRICT`/`MEMONGO_BENCHMARK_STRICT`) turns rerank failure into an error instead of silent skip (mongodb-reranker.ts:54-61).

### 1.10 Conversation evidence modes

[SUBSTRATE-FACT] New in HEAD commit: `ConversationEvidenceMode = "parallel" | "serial" | "disabled"` (memongo:packages/memory-engine/src/mongodb-conversation-evidence-mode.ts:1). `searchConversationEvidenceEvents()` (memongo:packages/memory-engine/src/mongodb-search-lanes.ts:441) runs only when `isConversationEvidenceQuery()` matches — regex classes for conversation-evidence and recommendation-memory queries plus temporal-coverage detection (memongo:packages/memory-engine/src/mongodb-search-temporal.ts:124-133). In `parallel` mode the evidence lane starts **before the primary lanes settle** (promise kicked off at memongo:packages/memory-engine/src/mongodb-search-v2.ts:1269-1298, awaited at 1470-1476); `serial` restores the old post-lane behavior (1477-1481); `disabled` skips it. Evidence results are capped at `min(maxResults, 20)`.

### 1.11 Backend config

[SUBSTRATE-FACT] `resolveMemoryBackendConfig()` (memongo:packages/memory-engine/src/backend-config.ts:177) resolves `ResolvedMongoDBConfig` (type at lines 35-60+): uri (with `MEMONGO_FORCE_MONGODB_URI` override, line 202), database, collectionPrefix, deploymentProfile (`atlas-local-preview` default), embeddingMode, **queryEmbeddingModel** (new, default `voyage-4-lite`), **conversationEvidenceMode** (new), fusionMethod (`rankFusion` default), recallProfile (`latency|balanced|proof`), quantization, pool/network knobs, `numCandidates` (default 500, `MEMONGO_NUM_CANDIDATES`), reranking group, cache group, relevance/telemetry/benchmark groups, TTL group (`memoryTtlDays`, session `ttl.sessionDays` with partial TTL indexes on `expiresAt`, memongo:packages/lib/src/types.memory.ts:94-105). Per-search cost budget: `DEFAULT_SEARCH_BUDGET = { maxAggregations: 12, maxEmbeds: 5 }` (memongo:packages/memory-engine/src/mongodb-search-budget.ts:55-58); exhaustion degrades lanes to empty results.

---

## 2. HEAD commit 8833026c0c — what changed and what it adds

`git show --stat`: 48 files, +2544/−368. Themes per commit message: "deterministic query budgets, client-side fusion, cache identity, and capability-safe evidence retrieval… benchmarks resumable, retry-bounded, fail-closed, deployment-bound."

### 2.1 New capabilities [SUBSTRATE-FACT]

1. **Configurable read-path query embedding model.** New type `MemoryMongoDBQueryEmbeddingModel = "voyage-4-large" | "voyage-4" | "voyage-4-lite"` (memongo:packages/lib/src/types.memory.ts:10-13), new config key `memory.mongodb.queryEmbeddingModel` + env `MEMONGO_QUERY_EMBEDDING_MODEL` (memongo:packages/memory-engine/src/backend-config.ts:296-299, validator at 818-836; `.env.example` documents rollback rationale). Default flipped from hardcoded `voyage-4-large` to **`voyage-4-lite`** (backend-config.ts:168-169; `mongodb-search.ts` default changed; inline `$vectorSearch` lanes in `mongodb-search-lanes.ts:353,536` now take `params.queryEmbeddingModel` instead of the hardcoded literal). Rationale in code comment: Voyage 4 models share one embedding space, so the query model can differ from the index-time model without reindexing (memongo:packages/lib/src/types.memory.ts:40-44). Also fixed `KNOWN_MODEL_DIMENSIONS["voyage-4-lite"]` 512 → 1024 (backend-config.ts:26).
2. **Conversation evidence mode knob** (`MEMONGO_CONVERSATION_EVIDENCE_MODE`, default `parallel`; memongo:packages/memory-engine/src/mongodb-conversation-evidence-mode.ts:1-20) with **parallel overlap of the evidence lane against primary retrieval** plus **budget reservation**: `tryReserveSearchBudget()` atomically reserves aggregation/embed units before concurrent work starts so the parallel evidence lane can't starve or blow the per-search cap (memongo:packages/memory-engine/src/mongodb-search-budget.ts:218-290); reservation converts to consumption exactly once and releases unused capacity. If the reservation can't be satisfied, the lane degrades to empty results rather than overspending (lines 235-248).
3. **Cache identity hardening.** `QueryCacheKeyParams` now folds in `queryEmbeddingModel`, `conversationEvidenceMode`, `fusionMethod`, and a reranker fingerprint (enabled|model|topN|minScore|sha256(instruction)|boosts) so a cached page can never serve a different parameterization (memongo:packages/memory-engine/src/mongodb-query-cache.ts:42-60, `serializeKeyParams` 123-167; wired at memongo:packages/memory-engine/src/mongodb-manager-search.ts:623-633, 694-698, 790-797, 980-988, 1175-1182).
4. **Lifecycle filtering on evidence lane.** `searchConversationEvidenceEvents` now applies a `lifecycleMatch` `$match` — `validAt <= queryTime`, `invalidAt` null-or-future, `expiresAt` future — after vector search (memongo:packages/memory-engine/src/mongodb-search-lanes.ts:469-490, 542), and both inline event lanes set `returnStoredSource: false`.
5. **Text-fallback index gating corrected.** BSON `$text` fallback indexes are ensured whenever named serving text indexes are not queryable — management-API availability alone no longer suffices (`shouldEnsureTextFallbackIndexes`, memongo:packages/memory-engine/src/mongodb-schema-standard-indexes.ts; call site in mongodb-manager-lifecycle.ts). Schema validator gained optional `expiresAt` date field (mongodb-schema-validator-memory.ts).
6. **Phase-latency accounting.** `phase:unaccounted` now sums 17 named phases instead of 4 (memongo:packages/memory-engine/src/mongodb-manager-search.ts:906-933); part3 tests assert attribution of always-on, conditional temporal/turn-precision, and post-rerank phases (memongo:packages/memory-engine/src/mongodb-manager-search.part3.test.ts).
7. **Benchmark harness hardening** (scripts/benchmark/*): checkpoint resume keyed on dataset digest + scenario manifest + config hash, bounded idempotent retries, fail-closed publication (incomplete ingest/unsettled workers fail the run), deployment-bound scenarios — matching the gates documented in memongo:benchmarks/README.md:51-73.

### 2.2 Test evidence for the commit [SUBSTRATE-FACT]

- `mongodb-manager-search.part2.test.ts` (+164): asserts `vsStage.model === "voyage-4-large"` flows into the `$rankFusion` vector stage, and that conversation evidence **starts while the primary retrieval lane is still pending** (promise-gate test, lines 208-220).
- `mongodb-manager-search.part3.test.ts` (+147): phase-latency attribution tests.
- `mongodb-search-budget.test.ts` (+75), `mongodb-query-cache.test.ts` (+55), `mongodb-kb-search.test.ts` (+55), `backend-config.test.ts` (+82), `mongodb-conversation-evidence-mode.test.ts` (+21), `mongodb-operation-accounting.test.ts` (+47), benchmark checkpoint/retry/scenario tests (+85/+58/+220).

---

## 3. `@memongo/memory-bridge` public API surface

Package `@memongo/memory-bridge` v2.0.1, single entry `./dist/memongo-bridge.js` (memongo:packages/memory-bridge/package.json). All symbols from memongo:packages/memory-bridge/src/memongo-bridge.ts unless noted.

**Lifecycle/infra:** `memongoBridgeShutdown(): Promise<void>` (:62) · `memongoBridgeGetManager(agentId?): Promise<MongoDBMemoryManager>` (:81) · `type MemongoBridgeContext = { agentId: string }` (:73) · `buildMemongoConfig` re-export (:722, from memory-config.ts:50) · `MEMONGO_CONFIG_FILENAME`, `resolveMemongoStandaloneWorkspaceDir`, `resolveMemongoConfigFilePath`, `resolveBridgeConfig()` (memory-config.ts:10,12,22,99).

**Search/read:** `memongoBridgeSearch({query, agentId?, maxResults?, minScore?, sessionKey?, scope?, scopeRef?})` (:93) · `memongoBridgeSearchKB({query, agentId?, scopeRef?, maxResults?, minScore?, filter?: {tags?, category?, source?}, fusionMethod?})` (:112) · `memongoBridgeReadFile({relPath, from?, lines?, agentId?}): Promise<ManagerReadResult>` (:133) · `memongoBridgeSearchDetailed({query, …, searchMode?: "auto"|"direct"|"agentic", sourcePreference?, timeRange?, needExactEvidence?, maxPasses?, returnPlan?, conversationScope?, structuredScope?, referenceScope?, proceduralScope?, searchConfig?: {recipe?: "fast"|"hybrid"|"deep"|"temporal"|"chain-of-thought", recallProfile?, fusionMethod?, hybridMode?, …}})` (:496-544).

**Write:** `memongoBridgeAdd({content, agentId?, sessionId?, metadata?, scope?, scopeRef?, idempotencyKey?, expiresAt?})` (:148) · `memongoBridgeWriteConversationEvent({role: "user"|"assistant"|"system"|"tool", body, …})` (:171) · `memongoBridgeWriteConversationEventsBatch({events: Array<…>})` (:211) · `memongoBridgeExtractEvent({eventId, …}): Promise<{jobId, scheduled}>` (:245) · `memongoBridgeWriteStructuredMemory({entry: StructuredMemoryEntry, …})` (:261) · `memongoBridgeWriteProcedure({entry: ProcedureEntry, …})` (:284) · `memongoBridgeImportConversations({datasetPath, limitConversations?, limitTurnsPerConversation?, …}): Promise<MemoryConversationImportResult>` (:759).

**State/context:** `memongoBridgeProfile({maxEntities?, maxEpisodes?, maxPerType?, activityWindowMs?, …})` (:303) · `memongoBridgeHydrateActiveSlate({maxItems?, …}): Promise<MemoryActiveSlate>` (:323) · `memongoBridgeBuildDiscoveryProjection({kind: "entity-brief"|"topic-brief"|"what-changed"|"contradiction-report", query?, timeRange?, …}): Promise<MemoryDiscoveryProjection>` (:337) · `memongoBridgeBuildContextBundle({query?, sessionId?, tokenBudget?, maxActiveItems?, maxEvidenceItems?, maxRecentEvents?, includeDiscoveryProjection?, discoveryKind?, includeProfile?, timeRange?, mode?: "full"|"wake-up"}): Promise<MemoryContextBundle>` (:363) · `memongoBridgeGetState(…): Promise<MemoryStateFamily & {partial?}>` (:876) · `memongoBridgeRecallConversation({query?, sessionId?, roles?, startTime?, endTime?, asOf?, timezone?, includeToolMessages?, limit?}): Promise<ConversationRecallResponse>` (:407).

**Lifecycle items:** `memongoBridgeGetLifecycleItem({handle: MemoryStableHandle})` (:440) · `memongoBridgeUpdateLifecycleItem({handle, patch})` (:447) · `memongoBridgeDeleteLifecycleItem({handle, invalidatedBy?})` (:455) · `memongoBridgeGetLifecycleHistory({handle, limit?})` (:463) · `memongoBridgeReportProcedureOutcome({handle, success, note?, actorRole?})` (:474) · `memongoBridgeApplyMemoryFeedback({handle, signal: MemoryFeedbackSignal, patch?, …})` (:484).

**Ops/status:** `memongoBridgeStatus` (:625) · `memongoBridgeGetDetailedStatus(): Promise<V2Status>` (:632) · `memongoBridgeStats(): Promise<MemoryStats>` (:639) · `memongoBridgeSync({reason?, force?})` (:646) · `memongoBridgeProbeEmbedding` (:658) · `memongoBridgeProbeVector` (:665) · `type MemongoBridgeCapabilities = DetectedCapabilities` (:678) + `memongoBridgeCapabilities()` (:688) · `memongoBridgePingMongo()` (:704).

**Analytics/intelligence:** `memongoBridgeRelevanceExplain({query, sourceScope?, deep?, …}): Promise<RelevanceExplainResult>` (:724) · `memongoBridgeRelevanceReport({windowMs?})` (:744) · `memongoBridgeRelevanceSampleRate()` (:752) · `memongoBridgeAccessTrends({collection?, memoryIds?, windowDays?, limit?})` (:779) · `memongoBridgeAccessSummaries({collection, memoryIds, windowDays?})` (:795) · `memongoBridgeTraceChain({factId, collection, maxDepth?})` (:809) · `memongoBridgeScanNovelty({limit?, scope?, scopeRef?})` (:824) · `memongoBridgeConsolidate({maxEvents?, minCombinedScore?, resolveContradictions?, llmDedup?, scope?, scopeRef?})` (:840) · `memongoBridgeSelfEdit({block: "user"|"persona"|"instructions", action: "append"|"replace"|"prepend", content}): Promise<{upserted, id}>` (:862) · `memongoBridgeListRecallTraces({limit?})` (:914) · `memongoBridgeGetRecallTrace({traceId})` (:922) · `memongoBridgeListMemoryJobs({status?, limit?, jobType?})` (:930) · `memongoBridgeGetMemoryJob({jobId})` (:944).

**Re-exported types:** `MemoryStableHandle` (:952); `MemoryConversationImportResult, MemoryLifecycleHistoryEntry, MemoryLifecycleItem, ProcedureEntry, StructuredMemoryEntry` from `@memongo/memory-engine/internal` (:953-958).

## 4. `@memongo/lib` memory types

memongo:packages/lib/src/types.memory.ts (182 lines): `MemoryBackend = "mongodb"` (:1) · `MemoryMongoDBDeploymentProfile = "atlas-local-preview"|"atlas-managed"|"community-mongot"` (:3) · `MemoryMongoDBEmbeddingMode = "automated"` (:8) · **`MemoryMongoDBQueryEmbeddingModel` (:10, new in HEAD)** · `MemoryMongoDBFusionMethod = "scoreFusion"|"rankFusion"|"js-merge"` (:15) · `MemoryMongoDBRecallProfile = "latency"|"balanced"|"proof"` (:20) · `MemoryScope = MemoryScopeValue` (:29, derived from contract.ts enum) · `MemorySourceToggleConfig` (:30) · `MemoryMongoDBConfig` (:34-170): uri/database/collectionPrefix/deploymentProfile/embeddingMode/queryEmbeddingModel/fusionMethod/recallProfile/quantization/pool+socket knobs/memoryTtlDays/ttl{enabled,sessionDays}/changeStreams/numCandidates/kb{chunking,autoImportPaths,maxDocumentSize,autoRefreshHours}/episodes{minEventsForEpisode}/graph{maxGraphDepth,entityExtraction{method: "regex"|"llm"}}/queryRewriting{method: "synonym-expansion"}/reranking{model,topN,minScore,instruction,recencyBoost,accessBoost,temporalProximityBoost}/cache{conversationTtlSec,kbTtlSec,similarityThreshold}/relevance{telemetry,retention,benchmark}/legacySearchFallback/searchBudget · `MemoryCitationsMode = "auto"|"on"|"off"` (:171) · `MemoryConfig` (:173-181, backend/citations/sources{reference,conversation,structured}/mongodb).

lib barrel (memongo:packages/lib/src/index.ts:1-96) additionally exports contract (`MEMORY_SCOPE_VALUES`, `MEMONGO_API_ROUTES`, `MEMONGO_MCP_TOOL_FIELDS`, API error schema), env helpers (`applyMongoDbForceUriOverride`), logger, retry, SSRF policy, auth/API-key rotation, paths, redaction, MIME detection, concurrency runner.

**Adjacent scope notes:** `packages/client` exports `MemongoClient`, `MemongoClientError` + types (packages/client/src/index.ts:1-2). `packages/tools` provides AI-SDK tool helpers (`memory-context.ts`, `cache-identity.ts`, `middleware-core.ts`, `openai/`, `vercel/`).

---

## 5. README/marketing claim check

- README "stores conversations, facts, procedures, knowledge-base chunks, episodes, and graph relationships… retrieves context with vector search, full-text search, and hybrid ranking" — [SUBSTRATE-FACT] all six stores and all three retrieval modes verified above.
- benchmarks/README.md reproducibility gates (pinned LongMemEval SHA-256 `d6f21ea9…a442`, atomic checkpoints, fail-closed publication) — [SUBSTRATE-FACT] gates exist in `scripts/benchmark/` (HEAD commit added checkpoint/retry/scenario modules + tests). [BENCHMARK-EVIDENCE] `benchmarks/results/` contains two git-tracked n≤5 sample logs; all other b16/prebenchmark logs are **untracked local observations, not durable benchmark evidence** (v4 qualification).
- Competitor statements in benchmarks/README.md:6-16 (mem0 harness/checksum, Zep 84%→75.14% vs 58.44%) — [COMPETITOR-CLAIM]/[EXTERNAL-SPEC]-grade assertions made BY this repo about others; not re-verified here (out of scope: local code only).
- No headline benchmark score is asserted in the root README, so nothing to mark UNSUPPORTED there. ~~Deduction/induction LLM phases are explicitly stubs~~ **SUPERSEDED 2026-08-13 (v3 review):** deduction/induction are implemented — see §1.2 correction above (memongo:packages/memory-engine/src/mongodb-consolidator.ts:1032-1139).

## 6. Residual risks / open questions

- Untracked benchmark logs under `benchmarks/results/b16-2026-08-04/` exist; not read (out of scope, do-not-touch).
- `queryEmbeddingModel` default flip to `voyage-4-lite` changes read-path embedding cost/quality; rollback = env var, no reindex needed (Voyage 4 shared space claim is a code comment, memongo:packages/lib/src/types.memory.ts:41-44 — [SUBSTRATE-FACT] as intent, [EXTERNAL-SPEC] for Voyage's actual space-sharing guarantee, not verified locally).
- Parallel evidence mode changes latency shape; `serial` restores prior behavior per `.env.example` comment.
