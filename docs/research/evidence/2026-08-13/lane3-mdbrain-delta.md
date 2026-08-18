# LANE 3 — Mdbrain current state + delta map vs Memongo (local code only)

> ⚠️ **Raw research notes — superseded where the synthesis differs.** Authoritative claims live in `../../2026-08-13-memongo-absorb-company-brain.md`; known stale claims are marked SUPERSEDED in place. (Banner added 2026-08-13, v4 remediation.)

Date: 2026-08-13. Repos: `mdbrain` = /Users/rom.iluz/Dev/mdbrain, `memongo` = /Users/rom.iluz/Dev/memongo.
All citations are repo-root-relative file:line with repo prefix. Evidence labels: [SUBSTRATE-FACT] unless noted.

## 0. Provenance and divergence direction [SUBSTRATE-FACT]

- Memongo is the original: first commit `65d193dbdf` "chore: initial Memongo release" dated 2026-05-06 (`git -C memongo log --reverse`).
- Mdbrain is a fork: its first commit `3695cfe` "chore: import memongo baseline + LLM-wiki research artifacts" is dated 2026-07-08; second commit `b177c8e` "rename @memongo/*→ @mbrain/* + scaffold @mbrain/wiki-engine" (2026-07-08 22:14). Git histories share **zero** commit objects (import, not fork-clone).
- Memongo kept moving: HEAD `8833026c0c` "feat(memory): harden parallel evidence retrieval" dated **2026-08-13** (today). Root `memongo/package.json` version **2.0.1**; engine `memongo/packages/memory-engine/package.json` = `@memongo/memory-engine@2.0.1`.
- Mdbrain HEAD `1b7e234` dated **2026-07-30**; engine `mdbrain/packages/memory-engine/package.json` = `@mdbrain/memory-engine@1.1.0`.
- Net: **mdbrain = memongo baseline (~v1.x, early July) + wiki-engine + benchmark/batch tooling, renamed; MOST of memongo's 2.0.0 security/correctness wave is absent** (v4 correction: mdbrain deliberately backported one subset at commit 4364a8e9 — "most absent", not "none"). Original wave contents (memongo/CHANGELOG.md "2.0.0 - 2026-07-31": tenant-isolation floor, bitemporal recall fixes, durable job leases, idempotent writes, transactions).

## 1. Mdbrain actual surface (from code)

### 1.1 packages/memory-engine (~103k LOC src incl. tests; 89 test files / ~54k test LOC)

Monolithic manager: `mdbrain/packages/memory-engine/src/mongodb-manager.ts` — single `MongoDBMemoryManager` class at line 1983, with public methods spanning search (2750), searchDetailed (3023), relevanceExplain/Benchmark/Report (3277/3672/3854), waitForBenchmarkSearchReadiness (4281), benchmarkIngest (5667), importConversations (5691), searchKB (5753), lifecycle CRUD (6889–6967), buildContextBundle (7118), recallConversation (7248), consolidate (7292), writeConversationEvent (7683), extractEvent (7835).
Wide public barrel: `mdbrain/packages/memory-engine/src/index.ts` (441 lines) re-exports ~250 symbols — manager, config, plus most module-level helpers (collection accessors, rerankers, enrichment builders, job helpers).
Mdbrain-only engine modules (absent in memongo): batch embedding jobs (`batch-runner.ts`, `batch-http.ts`, `batch-voyage.ts`, `batch-upload.ts`, `batch-output.ts`, `batch-status.ts`, `batch-utils.ts`, `batch-embedding-common.ts`, `batch-provider-common.ts`, `batch-error-utils.ts` — e.g. `mdbrain/packages/memory-engine/src/batch-runner.ts:13` `runEmbeddingBatchGroups`), in-package benchmark harness (`mongodb-benchmark-harness.ts`, `mongodb-benchmark-runner.ts`, `mongodb-benchmark-dataset.ts`, `mongodb-benchmark-readiness.ts`, `benchmark-failure-taxonomy.ts`, `benchmark-parity-envelope.ts`), `embedding-model-limits.ts`.

### 1.2 packages/wiki-engine (mdbrain-only, 11,725 LOC, 30 files)

No counterpart anywhere in memongo (grep for wiki in memongo src only finds a `wikiSource` metadata field at `memongo/packages/memory-engine/src/mongodb-schema-validator-knowledge.ts:31` and `wikiUrl` at `memongo/packages/memory-engine/src/mongodb-graph.ts:72`).

- Collections `wiki_pages` + `wiki_revisions`: `mdbrain/packages/wiki-engine/src/wiki-schema.ts:508-511,527`; $jsonSchema validators via `ensureWikiSchemaValidation` (wiki-schema.ts:550); Atlas **autoEmbed** vector index with `model: "voyage-4-large"` (wiki-schema.ts:644-649) — pages auto-embed from derived `text` (no app-side embedding, per mdbrain/CHANGELOG.md Unreleased).
- OKF import/export: `wiki-engine/src/okf.ts` (1227 LOC + 1146 LOC tests); hardened import (commit 93e2456).
- Search: `wiki-search.ts` (487 LOC, hybrid $vectorSearch + $search + $rankFusion); `queryVector` param removed (mdbrain/CHANGELOG.md Unreleased "Changed").
- Governance: `wiki-governance.ts` (scope enforcement, trust tiers, permissions) + `wiki-contradictions.ts`.
- Maintenance: `wiki-maintenance.ts` (git-diff + Dreamer self-maintenance), `wiki-migrate.ts` (structured_mem → wiki migration), `wiki-backlinks.ts`, `wiki-revisions.ts`, `wiki-transclusion.ts` (`{{page:slug}}`, commit 64d1c90), `wiki-map-pointer.ts`, `wiki-renderer.ts`.
- Connectors: `wiki-connectors.ts` (777 LOC — Obsidian, GitHub, Confluence, Notion, Slack, CRM per mdbrain/CHANGELOG.md Unreleased).
- Version marker: `WIKI_ENGINE_VERSION = "0.1.0"` (`mdbrain/packages/wiki-engine/src/index.ts:11`).

### 1.3 packages/memory-bridge

`mdbrain/packages/memory-bridge/src/mdbrain-bridge.ts` (1248 LOC): 44 exported `mdbrainBridge*` functions (full list at lines 52–1241). Notably `mdbrainBridgeGetManager` (line 358) now lazy-imports `@mdbrain/wiki-engine` and calls `ensureWikiSchema` on every manager resolution (lines 368-383), with fail-open logging. Plus `mdbrain-export.ts` (HMAC-SHA256 signed export bundles, `MDBRAIN_EXPORT_SIGNING_KEY`, line 179) and `memory-config.ts` (`.mdbrain/mdbrain.json`, line 6).

### 1.4 packages/client (`client.ts`, 53 async methods), packages/tools (`withMdbrain`, `createOpenAIMiddleware`, `createMdbrainTools` at `mdbrain/packages/tools/src/index.ts:13,14,308`), packages/mdbrain-memory (pure re-export of bridge+engine, `mdbrain/packages/mdbrain-memory/src/index.ts:1-2`)

### 1.5 apps/api (Hono)

Single route file `mdbrain/apps/api/src/routes/v1.ts` (55 route registrations). Mdbrain-only routes: 12 wiki routes (`v1.post("/wiki")`, `/wiki/search`, `/wiki/okf-import`, `/wiki/okf-export`, `/wiki/maintain`, `/wiki/lint`, `/wiki/revisions`, `v1.get/patch/delete("/wiki/*")`) plus `/admin/benchmarks/ingest`, `/admin/relevance/benchmark`. No `scope-identity.ts` module (memongo has one — see §4).

### 1.6 apps/mcp

Single `mdbrain/apps/mcp/src/server.ts` exposing 55 tools, incl. 7 wiki tools (`mdbrain_wiki_apply/export_okf/get/import_okf/lint/maintain/search`) and `mdbrain_benchmark_ingest`, `mdbrain_relevance_benchmark`. No `mdbrain_extract` tool despite `extractEvent` existing in the bridge (`mdbrain/packages/memory-bridge/src/mdbrain-bridge.ts:495`).

## 2. Overlap/gap matrix (feature level)

| Area | mdbrain | memongo | Notes |
| --- | --- | --- | --- |
| Core engine (search/episodes/graph/procedures/KB/consolidation) | ✅ | ✅ | Same module names; shared files often diverged (~~35 of 160~~ SUPERSEDED 2026-08-13 v4: tree-bound relative-path manifest shows **39 of 167** byte-identical, 128 diverged, +29 mdbrain-only, +113 memongo-only — `engine-file-drift-2026-08-13.txt` via `generate-engine-file-drift.sh` v2.0.0) |
| LLM wiki engine | ✅ wiki_pages/OKF/governance/connectors | ❌ | mdbrain-only, ~11.7k LOC |
| Batch embedding jobs (Voyage batch API) | ✅ `batch-*.ts` | ❌ (in engine) | memongo mentions batch HTTP retries in changelog but engine has no batch-* modules |
| In-package benchmark harness | ✅ `mongodb-benchmark-*` | moved out | memongo: benchmarks live in top-level `memongo/benchmarks/` (data/results dirs, LongMemEval_S pinned dataset, `memongo/benchmarks/README.md:25-68`); index.ts header: "Benchmark and evaluation tooling lives outside the published package" (`memongo/packages/memory-engine/src/index.ts:9-10`) |
| Contradiction detection (engine) | ❌ | ✅ `memongo/packages/memory-engine/src/mongodb-contradiction.ts` (+ e2e) | mdbrain has wiki-side contradictions only |
| Relation extraction (LLM) | ❌ | ✅ `mongodb-relation-extraction.ts` (+ e2e) | |
| Temporal extraction / bitemporal promotion | partial (`mongodb-temporal.ts`, `mongodb-bitemporal.ts` both sides) | ✅ + `mongodb-temporal-extraction.ts`, promotion/validity e2e tests | memongo 2.0.0 changelog claims validity-filter correctness fix |
| Conversation import | ✅ `importConversations` | ✅ + `mongodb-conversation-import.ts`, `mongodb-conversation-dataset.ts`, evidence-mode module | memongo expanded this into first-class modules |
| Idempotent writes / TTL events | ❌ | ✅ `idempotencyKey`, `expiresAt`, `mongodb-idempotency-fingerprint.ts` | see §5 |
| Transactions | ⚠️ **SUPERSEDED 2026-08-13 (v3 review):** mdbrain HAS `session.withTransaction` with majority write concern (mdbrain:packages/memory-engine/src/mongodb-sync.ts:287-310, mongodb-kb.ts:203-316) — the real mdbrain gap is wiki-engine session propagation (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:374-411,614-681) | ✅ + w:"majority" per changelog | |
| Capability registry / client registry | ❌ | ✅ `mongodb-capability-registry.ts`, `mongodb-client-registry.ts` | powers `memongoBridgeCapabilities` |
| Search v2 (multi-lane planner) | ❌ (single `mongodb-search.ts`) | ✅ `mongodb-search-v2.ts`, `-lanes`, `-ranking`, `-temporal`, `-budget` | memongo manager falls back to `legacySearch` (`memongo/packages/memory-engine/src/mongodb-manager-search.ts:306-307,680`) |
| Manager architecture | monolith (mongodb-manager.ts ~8k LOC) | split into **9 production** `mongodb-manager-{admin,host,jobs,lifecycle,read,relevance,search,sync,write}*.ts` modules (10 files counting the root mongodb-manager.ts) | same class name, `memongo/.../mongodb-manager.ts:474` |
| API tenant hardening | ❌ client-supplied scope | ✅ `memongo/apps/api/src/scope-identity.ts:28` "Single source of truth for resolving tenant-scope fields" | memongo 2.0.0 breaking change; mdbrain API has no equivalent module |
| MCP transport | stdio single file | stdio + `http-transport.ts`, `tool-registry.ts`, contract-conformance tests | |
| Pi extension package | ❌ | ✅ `memongo/packages/pi-extension/` (extensions/lifecycle.ts) | |
| lib contracts | basic | + `contract.ts`, `contract-mcp.ts`, `contract-routes.ts` + tests | |
| Web console wiki tab | ✅ `mdbrain/apps/web/app/console/page.tsx` | ❌ | |

## 3. (a) Exported-symbol deltas

### Engine barrel

- mdbrain `packages/memory-engine/src/index.ts` exports ~250 symbols (wide barrel, includes helper functions like `writeEvent`, `consolidateMemory`, `expandGraph`, `synthesizeProfile`).
- memongo deliberately trimmed to ~50 stable symbols (manager + request/response types) in `index.ts:13-61` ("P4.1 trim", header comment lines 1-11) and moved the rest to `internal-barrel.ts` (216 symbols) behind `@memongo/memory-engine/internal`.
- Overlap: 200 of mdbrain's exported symbols exist in memongo's index+internal combined.
- **mdbrain-only exports** (not in either memongo barrel): benchmark/dataset surface — `MemoryBenchmarkDataset`, `MemoryBenchmarkConversation`, `MemoryBenchmarkTurn`, `MemoryBenchmarkIngestResult`, `MemoryBenchmarkRunReport`, `MemoryBenchmarkReleaseGate`, `MemoryBenchmarkBuildIdentity`, `ingestBenchmarkDataset`, `loadBenchmarkDataset`, `importConversationDataset`, `evaluateRankingCase`, `rankResultSessions`, `summarizeBenchmarkExecutions`, `QueryGovernanceCandidate`, `QueryGovernanceReport`, `buildQueryGovernanceReport`, `RelevanceBenchmarkResult` (all in `mdbrain/packages/memory-engine/src/index.ts`).
- **memongo-only public exports**: none by name beyond renamed prefix; its unique functionality (writeConversationEventsBatch, capabilities) is reached via manager methods, not barrel symbols. memongo-only public type: `MemoryStateFamily` exists on both (mdbrain index.ts tail; memongo index.ts:74-84).

### Bridge facades

Identical 1:1 renamed surface except:

- **mdbrain-only**: `mdbrainBridgeWaitForBenchmarkSearchReadiness` (`mdbrain/packages/memory-bridge/src/mdbrain-bridge.ts:407`), `mdbrainBridgeRelevanceBenchmark` (956), `mdbrainBridgeBenchmarkIngest` (1004).
- **memongo-only**: `memongoBridgeWriteConversationEventsBatch` (`memongo/packages/memory-bridge/src/memongo-bridge.ts:211`), `memongoBridgeCapabilities` + `MemongoBridgeCapabilities` type (688, 678), `memongoBridgePingMongo` (704).
- Export-bundle module: mdbrain's `mdbrain-export.ts` adds BSON-type canonicalization (ObjectId/Decimal128/Long/Timestamp tagged objects) and a depth-100 cycle guard (lines 116-153, 62-71) absent from `memongo/packages/memory-bridge/src/memongo-export.ts` (which has plain `canonicalize(value)` at line 64). **Porting direction: mdbrain is AHEAD here** — signed bundles are byte-stable across BSON types only in mdbrain.

## 4. (b) API contract differences

1. **writeConversationEvent**: memongo adds `validAt?: Date`, `invalidAt?: Date`, `expiresAt?: Date`, `idempotencyKey?: string` (`memongo/packages/memory-engine/src/mongodb-manager-write.ts:52-72`); mdbrain's bridge version has only agentId/role/body/sessionId/timestamp/metadata/scope/scopeRef (`mdbrain/packages/memory-bridge/src/mdbrain-bridge.ts:472-493`). Memongo also has the batch variant returning per-item receipts (memongo-bridge.ts:211-244).
2. **searchKB**: memongo adds `scopeRef` (tenant-isolated, comment at memongo-bridge.ts:118-121) and `fusionMethod?: MemoryMongoDBFusionMethod` (memongo-bridge.ts:112-121); mdbrain lacks both (mdbrain-bridge.ts:423-436).
3. **Manager method deltas**: memongo-only — `writeConversationEventsBatch`, `repairEventProjections`, `repairExtractionOutbox`, `replayIdempotentEventWrite`, `startMemoryJobWorker`/`stopMemoryJobWorker`/`drainMemoryJobQueue`, `legacySearch`, `executeSearchUncoalesced`, `scheduleBackgroundExtraction`, change-stream resume-token persistence (all in `memongo/packages/memory-engine/src/mongodb-manager-*.ts`). mdbrain-only — `relevanceBenchmark` (mongodb-manager.ts:3672), `benchmarkIngest` (5667), `waitForBenchmarkSearchReadiness` (4281).
4. **HTTP routes**: identical 40-route core; mdbrain-only = 12 wiki routes + `/admin/benchmarks/ingest` + `/admin/relevance/benchmark` (`mdbrain/apps/api/src/routes/v1.ts`); memongo-only = `v1.post("/write-events")` (batch) (`memongo/apps/api/src/routes/v1-write-routes.ts`). memongo splits routes into 8 files + OpenAPI split into 7 path files + `version.ts`; mdbrain has one v1.ts + one openapi-spec.ts.
5. **MCP tools**: same 47 renamed tools; mdbrain-only = 7 wiki tools + `mdbrain_benchmark_ingest` + `mdbrain_relevance_benchmark`; memongo-only = `memongo_extract` (`memongo/apps/mcp/src/tools/`). Mdbrain exposes engine `extractEvent` via bridge/API but not MCP.
6. **Client SDK**: mdbrain-only methods = `benchmarkIngest`, `relevanceBenchmark`, `wikiApply/wikiDelete/wikiExportOkf/wikiGet/wikiImportOkf/wikiLint/wikiMaintain/wikiSearch` (`mdbrain/packages/client/src/client.ts`); memongo-only = `writeEvents` (batch). memongo client has `client.test.ts` + `version.ts`; mdbrain client has no tests.
7. **Config**: bridge config filename differs (`.mdbrain/mdbrain.json` vs `.memongo/memongo.json`); memongo `memory-config.test.ts` (199 LOC) vs mdbrain (101 LOC) — memongo tests more config surface (likely TTL config for P4.4.1).

## 5. (c) Test coverage deltas

Counts: mdbrain engine = 89 test files / ~53,945 test LOC; memongo engine = 137 test files / ~74,052 test LOC (both incl. e2e). [SUBSTRATE-FACT — file counts]

**Tested on memongo side only** (no mdbrain counterpart file): contradiction (`mongodb-contradiction.test.ts` + e2e), relation-extraction (+ e2e), temporal-extraction (+2 e2e), transactions, single-flight, query-cache-invalidation, consolidation-reasoning (+e2e)/adjudication/consolidator-state, capability-registry, client-registry, operation-accounting, search-budget, scope (`mongodb-scope.test.ts`), recency-access-boost, procedures-concurrency, structured-memory-concurrency, kb-fusion-plumbing + kb-isolation/kb-reingest e2e, embedding-coverage e2e, projection-repair e2e, memory-jobs e2e, vector-bitemporal/vector-index-shape e2e, remote-http unit test, manager split tests (jobs×4, search×4, write×2, lifecycle, read, relevance, sync, admin).

**Tested on mdbrain side only**: batch-* (batch-http, batch-output, batch-status, batch-voyage, batch-error-utils), benchmark harness/runner/readiness, benchmark-failure-taxonomy, benchmark-parity-envelope, `mongodb-conversation-recall-benchmark.test.ts`, embedding-model-limits. Wiki-engine: 13 test files (~4.4k LOC) with no memongo equivalent at all.

**Shared modules where memongo's tests are substantially larger** (diff line counts): mongodb-manager.test.ts (Δ4,850), mongodb-schema.test.ts (+ part2/3/4 on memongo), mongodb-consolidator.test.ts (+ part2/3), mongodb-graph.test.ts (+ segment2), mongodb-events.test.ts (+ part2), backend-config.test.ts (+ part2).

## 6. (d) Migration / data compatibility

### Collection names — shared/core suffixes align (mdbrain additionally owns embedding_cache, wiki_pages, wiki_revisions)

Identical accessor lists in `mdbrain/packages/memory-engine/src/mongodb-schema.ts:39-192` and `memongo/packages/memory-engine/src/mongodb-schema-collections.ts:16-247`: chunks, files, meta, knowledge_base, kb_chunks, structured_mem(+_revisions), procedures(+_revisions), relevance_runs/artifacts/regressions, events, entities, relations, entity_links, episodes, ingest_runs, projection_runs, query_cache, memory_telemetry, access_events, memory_mutations, memory_quarantine, lane_coverage, consolidation_runs, recall_traces, memory_jobs, session_chunks, memory_evidence.

- **mdbrain-only**: `embedding_cache` (mongodb-schema.ts:47, unique index `uq_embedding_cache_composite` at :1534) and wiki `wiki_pages`/`wiki_revisions` (wiki-schema.ts:527).
- **memongo-only**: none by name.

### $jsonSchema validators — compatible (loose-superset both ways)

Required-field sets match on core collections: events require `[eventId, agentId, role, body, scope, scopeRef, timestamp]` on both (mdbrain mongodb-schema.ts:720-728; memongo mongodb-schema-validator-memory.ts:15-23). Entities/relations/episodes/procedures required sets likewise match (mdbrain :787-795, :851-858; memongo validator-memory.ts:96-104, 159-167). Memongo's new fields (`expiresAt`, `idempotencyKey`, `extractionJobPendingAt`, `projectedAt`…) are **optional properties**, and neither side sets `additionalProperties: false` → mdbrain-written docs pass memongo validators and vice versa. [SUBSTRATE-FACT]

- mdbrain's `expiresAt` is required only on **query_cache** (mongodb-schema.ts:1051, TTL idx at :2163-2167); memongo extends the same expireAfterSeconds:0 pattern to events/structured_mem (memongo mongodb-events.ts:125, mongodb-schema-standard-indexes-core.ts:218-228, -graph.ts:103).

### Index definitions — diverged; memongo has the upgrade path, mdbrain does not

- memongo renamed global unique indexes to tenant-scoped ones **with explicit migration**: `uq_kb_hash` → `uq_kb_scope_hash` (`memongo/packages/memory-engine/src/mongodb-schema-standard-indexes-core.ts:96-109`), `uq_kbchunks_path_lines` → `uq_kbchunks_scope_path_lines` (:136-145), structured unique at :160-174. mdbrain still creates the OLD names (`mdbrain/packages/memory-engine/src/mongodb-schema.ts:1610,1646,1680`).
- memongo adds partial unique write-idempotency index `{agentId, idempotencyKey}` on events (`memongo/packages/memory-engine/src/mongodb-schema-standard-indexes-graph.ts:71-83`).
- Consequence: **memongo data loads cleanly into mdbrain's engine** (same collection names, validators are supersets, old unique indexes still satisfiable). **mdbrain data loads into memongo** and memongo's ensure-schema migrates the indexes forward. The reverse hazard: memongo-written events may carry `expiresAt`; mdbrain's engine doesn't read it for events, but the TTL index (if created by memongo) would still expire them — an mdbrain engine pointed at a memongo-upgraded cluster inherits memongo's TTL behavior silently. Cross-running both engines on one cluster is NOT safe (index-name tug-of-war on uq_kb_*).

### Embedding dims/providers — identical

Both default to `DEFAULT_VOYAGE_EMBEDDING_MODEL = "voyage-4-large"` (mdbrain embeddings-voyage.ts:17; memongo embeddings-voyage.ts:17; files differ only in the `@mdbrain/lib` vs `@memongo/lib` import). Same model context table (voyage-3/4 family, lines 35-40 both). Same Gemini dims comment (768/1536/3072, embeddings.ts:97 both). Search-index helper defaults `numDimensions = 1024` but deliberately ignores it for autoEmbed (mdbrain mongodb-schema.ts:3085-3090; memongo mongodb-schema-search-indexes.ts:75-83). Wiki pages auto-embed via Atlas with voyage-4-large (wiki-schema.ts:644-649). → vectors are interchangeable when both sides run default config.

## 7. Marketing-claim check

- mdbrain/CHANGELOG.md 1.1.0 explicitly says it added "scoped benchmark evidence wording **without claiming** a Mem0 LongMemEval judged-answer win" — and indeed mdbrain/README.md contains no LongMemEval numbers (grep: no matches). Not overclaimed. [SUBSTRATE-FACT]
- ~~memongo ships real benchmark artifacts~~ SUPERSEDED 2026-08-13 v4: only two n≤5 sample logs are git-tracked; the b16/prebenchmark result directories are untracked local observations, not shipped evidence. Pinned dataset `memongo/benchmarks/data/longmemeval_s_cleaned.json` (~265 MB per benchmarks/README.md:25-41). [BENCHMARK-EVIDENCE — artifact exists; results not re-verified here]
- mdbrain README line 97 ("Real adopters running MongoDB for AI: Zomato…") is third-party MongoDB marketing, not mdbrain adoption — UNSUPPORTED as an mdbrain claim if read that way.

## 8. Bottom line

Mdbrain = memongo ~1.1 baseline (2026-07-08) + a genuinely new wiki-engine (+11.7k LOC, ~~8 MCP tools, 13 HTTP routes~~ SUPERSEDED 2026-08-13 v4: **7 wiki MCP tools, 12 wiki HTTP routes** per mdbrain-mcp-tools.txt/mdbrain-routes.txt, 2 collections) + in-repo benchmark/batch tooling + a better export canonicalizer. Memongo 2.0.1 is ~5 weeks of engine hardening ahead: tenant-isolated writes, idempotency/TTL/bitemporal write contract, transactions, contradiction + relation-extraction + temporal-extraction, search-v2 lanes, manager refactor, ~20k more test LOC. Data-level migration is feasible in both directions (shared/core collection suffixes align + loose-superset validators; mdbrain-only embedding_cache/wiki_pages/wiki_revisions) with two caveats: memongo's renamed unique indexes (one-way migration code lives only in memongo) and memongo's event TTL fields. API/MCP/client surfaces are not contract-compatible beyond the shared core: wiki + benchmark (mdbrain) vs batch writes + capabilities + tenant enforcement (memongo).
