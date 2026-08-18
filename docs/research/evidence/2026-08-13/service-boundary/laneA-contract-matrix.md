# LANE A — Contract Coverage Matrix: memongo published v2.0.0 vs mdbrain needs

Date: 2026-08-13. mdbrain HEAD `1b7e234` (2026-07-30). memongo local HEAD `8833026c0c` (2.0.1, unpushed).
Published surface = git tag `v2.0.0` = commit `bdad0fbf28c7f3360f8c206a415dd26e727e25dc` = npm `@memongo/memory-engine@2.0.0` / `@memongo/memory-bridge@2.0.0` (npm dist-tag `latest: 2.0.0`, versions `[1.1.0, 2.0.0]` — evidence `docs/research/evidence/2026-08-13/npm-memongo-memory-engine-2026-08-13.json`, `npm-memongo-memory-bridge-2026-08-13.json`). Tags `v2.1.0`/`v2.1.1` exist locally but are pi-extension tags whose `packages/*/package.json` still say `2.0.0` — NOT published to npm; ignored.

All evidence labels: [SUBSTRATE-FACT] code-verified with cite, unless noted.

## 1. Published memongo v2.0.0 remote surface (tag `v2.0.0`, verified via `git show v2.0.0:...`)

### 1.1 HTTP routes — memongo:apps/api/src/routes/v1.ts (single file at v2.0.0), 43 routes

> ⚠️ SUPERSEDED 2026-08-13 (amendment v2, evidence finding 1): published v2.0.0 = **43 routes** (the table below lists 43 rows; the original "42" header was a miscount), ↔ 43 client methods. HEAD = **42** (adds `/write-events`, removes the 2 benchmark routes). Verified via tag grep `git show v2.0.0:apps/api/src/routes/v1.ts | grep -oE '\.(get|post)\("' | wc -l` = 43.

| Route | v1.ts line | Client method (packages/client/src/client.ts) |
| --- | --- | --- |
| POST /search | 819 | `search` (463) |
| POST /search-kb | 846 | `searchKB` (528) |
| POST /recall-conversation | 878 | `recallConversation` (544) |
| POST /import/conversations | 923 | `importConversations` (873) |
| POST /lifecycle/get | 953 | `getLifecycleItem` (561) |
| POST /lifecycle/update | 980 | `updateLifecycleItem` (569) |
| POST /lifecycle/delete | 1019 | `deleteLifecycleItem` (578) |
| POST /lifecycle/history | 1059 | `getLifecycleHistory` (587) |
| POST /procedures/outcome | 1099 | `reportProcedureOutcome` (596) |
| POST /memory/feedback | 1146 | `applyMemoryFeedback` (607) |
| POST /search-detailed | 1228 | `searchDetailed` (480) |
| POST /hydrate-active-slate | 1347 | `hydrateActiveSlate` (711) |
| POST /discovery-projection | 1367 | `buildDiscoveryProjection` (734) |
| POST /context-bundle | 1408 | `buildContextBundle` (748) |
| POST /read-file | 1474 | `readFile` (622) |
| POST /add | 1494 | `add` (451) |
| POST /write-event | 1530 | `writeEvent` (636) |
| POST /extract | 1607 | `extract` (682) |
| POST /write-structured | 1631 | `writeStructured` (662) |
| POST /write-procedure | 1651 | `writeProcedure` (672) |
| POST /profile | 1671 | `profile` (689) |
| GET /state | 1700 | `state` (722) |
| GET /status | 1717 | `status` (769) |
| GET /status/detailed | 1728 | `getDetailedStatus` (773) |
| GET /stats | 1739 | `stats` (779) |
| POST /sync | 1750 | `sync` (783) |
| GET /probes/embedding | 1765 | `probeEmbedding` (795) |
| GET /probes/vector | 1776 | `probeVector` (801) |
| POST /admin/relevance/explain | 1787 | `relevanceExplain` (805) |
| POST /admin/relevance/benchmark | 1819 | `relevanceBenchmark` (825) |
| POST /admin/benchmarks/ingest | 1906 | `benchmarkIngest` (857) |
| GET /admin/relevance/report | 1934 | `relevanceReport` (885) |
| GET /admin/relevance/sample-rate | 1950 | `relevanceSampleRate` (895) |
| GET /admin/access-trends | 1961 | `accessTrends` (901) |
| GET /admin/access-summaries | 1991 | `accessSummaries` (925) |
| GET /admin/traces | 2025 | `listRecallTraces` (947) |
| GET /admin/traces/:traceId | 2040 | `getRecallTrace` (957) |
| GET /jobs | 2060 | `listJobs` (967) |
| GET /jobs/:jobId | 2093 | `getJob` (983) |
| POST /chain-trace | 2113 | `traceChain` (993) |
| POST /novelty-scan | 2138 | `scanNovelty` (1004) |
| POST /consolidate | 2154 | `consolidate` (1014) |
| POST /self-edit | 2175 | `selfEdit` (1026) |

**Parity: 43 routes ↔ 43 client methods — 100% route coverage by the published `@memongo/client@2.0.0`.** [SUBSTRATE-FACT] (count corrected 2026-08-13, see supersession note above)

### 1.2 Local HEAD (8833026c0c) surface — published-vs-HEAD deltas

HEAD splits routes into `memongo:apps/api/src/routes/v1-{search,write,lifecycle,context,status,maintenance,admin}-routes.ts`. Route set at HEAD = 42 real routes (43 grep hits include a `.get("jsonBody"` middleware false positive; 43 published − 2 benchmark removed + 1 `/write-events` added = 42), but:

- ADDED at HEAD (UNPUBLISHED): `POST /write-events` (batch write) — memongo:apps/api/src/routes/v1-write-routes.ts:200; client method `writeEvents` (memongo:packages/client/src/client.ts:895). **Not in v2.0.0.**
- REMOVED at HEAD (published in v2.0.0): `POST /admin/relevance/benchmark` and `POST /admin/benchmarks/ingest`, plus client methods `relevanceBenchmark`/`benchmarkIngest`. Removal is intentional: memongo:apps/api/src/app.test.ts:630-631 asserts the paths are gone; memongo:packages/memory-engine/src/index.ts:9-10 (HEAD): "Benchmark and evaluation tooling lives outside the published package."
- HEAD engine is modularized: searchV2 lives in `memongo:packages/memory-engine/src/mongodb-search-v2.ts` (at v2.0.0 it was inlined in mongodb-manager.ts:9594).

**Delta rule for this lane: mdbrain may depend ONLY on the published v2.0.0 rows. `/write-events` is a blocker if depended on (it is not — see §3). The benchmark-route removal at HEAD is a forward risk if the service ever upgrades past 2.0.0 (see §6).**

## 2. mdbrain actual memory call set

### 2.1 Bridge — mdbrain:packages/memory-bridge/src/mdbrain-bridge.ts (1249 LOC), **46 async exports = 43 remote route adapters + 3 process-local helpers** (`getManager`, `shutdown`, `waitForBenchmarkSearchReadiness`) (lines 52–1241)

> ⚠️ SUPERSEDED 2026-08-13 (amendment v2, evidence finding 2/3): original text said "44 exported functions". Verified `grep -cE '^export async function' mdbrain-bridge.ts` = 46. `getManager` (production caller mdbrain:apps/api/src/routes/v1.ts:2089-2092) and `shutdown` (production caller mdbrain:apps/api/src/server.ts:28) are NOT unused — only `waitForBenchmarkSearchReadiness` has zero non-test callers.

search (388), waitForBenchmarkSearchReadiness (407), searchKB (423), readFile (438), add (453), writeConversationEvent (472), extractEvent (495), writeStructuredMemory (508), writeProcedure (520), profile (532), hydrateActiveSlate (552), buildDiscoveryProjection (571), buildContextBundle (600), recallConversation (647), lifecycle get/update/delete/history (676/688/701/714), reportProcedureOutcome (730), applyMemoryFeedback (745), searchDetailed (762), status/getDetailedStatus/stats/sync (891/898/905/912), probeEmbedding/probeVector (924/931), relevanceExplain (936), relevanceBenchmark (956), relevanceReport (989), relevanceSampleRate (997), benchmarkIngest (1004), importConversations (1020), accessTrends (1041), accessSummaries (1057), traceChain (1074), scanNovelty (1094), consolidate (1111), selfEdit (1130), getState (1149), listRecallTraces (1183), getRecallTrace (1196), listMemoryJobs (1209), getMemoryJob (1228). Plus getManager (358) and shutdown (52).

⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 2): the original "every one of these maps 1:1" was imprecise. Exact: **46 bridge exports total; 43 are remote route adapters mapping to the 43 published routes; 3 are process-local helpers** (`getManager` — production caller routes/v1.ts:2089-2092; `shutdown` — production caller server.ts:28; `waitForBenchmarkSearchReadiness` — zero non-test callers). The adapters map to published routes; the helpers get explicit replacements, not mappings.

### 2.2 apps/api — mdbrain:apps/api/src/routes/v1.ts, 55 routes (evidence mdbrain-routes.txt)

- 43 memory routes = exact mirror of memongo v2.0.0's 43-route set — the benchmark routes (`/admin/relevance/benchmark`, `/admin/benchmarks/ingest`, mdbrain:apps/api/src/routes/v1.ts:1685) are INCLUDED in the 43, not extra. Only bridge functions are invoked (verified 2026-08-13: **44 distinct `mdbrainBridge*` names in v1.ts = 43 remote adapters + `mdbrainBridgeGetManager`**).
- 12 wiki routes total INCLUDING `/wiki/lint` and `/wiki/revisions*` — mdbrain-only, served by `@mdbrain/wiki-engine` (imported at mdbrain:apps/api/src/routes/v1.ts:51-70). **Not a memongo dependency.** (Duplicate line from the original draft deleted 2026-08-13, amendment v4 evidence finding 2.)
- Wiki routes obtain their Mongo handle via `mdbrainBridgeGetManager(agentId)` → `getWikiDbHandle(manager)` (mdbrain:apps/api/src/routes/v1.ts:2089-2092). This is the ONLY runtime coupling from the wiki surface into the in-process memory manager.

### 2.3 apps/mcp — mdbrain:apps/mcp/src/server.ts

55 tools (evidence mdbrain-mcp-tools.txt). **Already service-shaped**: calls `@mdbrain/client` over HTTP (`new MdbrainClient({ baseUrl: process.env.MDBRAIN_API_URL, apiKey: ... })`, server.ts:10-13). 51 `mdbrain.*(` client invocations. Wiki tools + `mdbrain_benchmark_ingest`/`mdbrain_relevance_benchmark` included. Zero engine imports.

### 2.4 Engine consumers (who imports `@mdbrain/memory-engine`)

Only TWO runtime importers in the entire repo (grep `from "@mdbrain/memory-engine"`, excluding dist/tests): [SUBSTRATE-FACT]

1. mdbrain:packages/memory-bridge/src/mdbrain-bridge.ts:37,42 (types + `closeAllMemorySearchManagers`/`getMemorySearchManager`/`materializeBlocks`), :1248 (type re-exports).
2. mdbrain:packages/mdbrain-memory/src/index.ts:2 (`export * from "@mdbrain/memory-engine"` — published re-export package).

- `@mdbrain/wiki-engine` declares the dep in package.json:26 but **never imports it in src** — wiki-bridge.ts:229 `getWikiDbHandle(manager: unknown)` only extracts `{ db, prefix }`. Stale manifest entry.
- apps/api imports only `@mdbrain/memory-bridge` (package.json:17) + `@mdbrain/wiki-engine`.
- mdbrain-only engine modules `batch-*.ts` (Voyage batch embedding jobs) and `mongodb-benchmark-*` are **referenced nowhere outside packages/memory-engine** (grep for `batch-runner|runEmbeddingBatch|mongodb-benchmark` across apps/packages = zero non-engine hits).

## 3. THE MATRIX — mdbrain memory operation × coverage

Legend: pub2.0.0 = published v2.0.0 route+client; HEAD = local unpushed; need = mdbrain runtime need today.

| mdbrain operation | published-2.0.0 | local-HEAD | mdbrain-need | verdict |
| --- | --- | --- | --- | --- |
| Search/retrieval (basic) | ✅ POST /search (v1.ts:819) → `searchV2` pipeline (memongo:packages/memory-engine/src/mongodb-manager.ts:2944 at v2.0.0) | ✅ | ✅ bridge.search (388), route, MCP | COVERED |
| Search/retrieval (detailed, agentic) | ✅ POST /search-detailed (v1.ts:1228) w/ full `searchConfig` (recipe, fusionMethod, hybridMode, lexicalPrefilter, sourcePreference, timeRange — client types.ts:29-50) | ✅ | ✅ bridge.searchDetailed (762) | COVERED |
| searchV2 lanes/fusion/rerank reachability | ✅ lanes: internal, reported as `lanesUsed`/`lanesSkipped` in detailed response (client types.ts:1040-1041); fusion: per-request `searchConfig.fusionMethod` ∈ scoreFusion/rankFusion/js-merge (types.ts:46); rerank: server-side `MEMONGO_RERANKING_ENABLED`/`reranking.{model,topN}` (memongo:packages/memory-engine/src/backend-config.ts:477-487 at v2.0.0), applied inside searchV2 | ✅ (+ per-lane latency instrumentation) | ✅ mdbrain needs quality parity only, not per-request rerank toggles | COVERED (rerank is deploy-config, not request-param — see §5) |
| KB search | ✅ POST /search-kb (v1.ts:846) | ✅ | ✅ bridge.searchKB (423) | COVERED |
| KB ingest | ❌ no HTTP route (engine-only `ingestToKB`, memongo:packages/memory-engine/src/mongodb-kb.ts:98 at v2.0.0) | ❌ same | ❌ mdbrain never calls ingestToKB anywhere (grep = 0 hits outside engine) | NOT A GAP (dead surface both sides) |
| Write single event | ✅ POST /write-event (v1.ts:1530) | ✅ | ✅ bridge.writeConversationEvent (472) | COVERED |
| Batch writes | ❌ no /write-events | ✅ POST /write-events (v1-write-routes.ts:200) — UNPUBLISHED | ❌ mdbrain has no /write-events route, no batch-write caller; bulk path = /import/conversations | NOT A GAP (do not depend on HEAD-only route) |
| Write structured / procedure / add / extract | ✅ /write-structured, /write-procedure, /add, /extract | ✅ | ✅ bridge 508/520/453/495 | COVERED |
| Conversation import | ✅ POST /import/conversations (v1.ts:923) | ✅ | ✅ bridge.importConversations (1020), MCP tools | COVERED |
| Lifecycle CRUD + history | ✅ 4 routes (953-1059) | ✅ | ✅ bridge 676-714, MCP | COVERED |
| Episodes | ✅ internal to searchV2 (episodic lane; `sourcePreference` includes "episodic"); no direct route — mdbrain doesn't expose one either | ✅ | ✅ indirect only (no mdbrain route/tool calls getEpisodes*/searchEpisodes outside engine) | COVERED (via search lanes) |
| Graph | ✅ internal graph lane ("graph" in sourcePreference); no direct route | ✅ | ✅ indirect only (no mdbrain route calls expandGraph/upsertEntity; wiki has its OWN expandGraph at mdbrain:packages/wiki-engine/src/wiki-search.ts:347) | COVERED (via search lanes) |
| Consolidation trigger | ✅ POST /consolidate (v1.ts:2154) | ✅ | ✅ bridge.consolidate (1111) | COVERED |
| Jobs (list/get) | ✅ GET /jobs, /jobs/:jobId (2060/2093) | ✅ | ✅ bridge 1209/1228 | COVERED |
| Stats/status/state/sync/probes | ✅ 7 routes (1700-1776) | ✅ | ✅ bridge 891-931 | COVERED |
| Relevance explain/report/sample-rate/access-trends/access-summaries/traces | ✅ 7 routes (1787-2040) | ✅ | ✅ bridge 936-1057 | COVERED |
| Benchmark run + ingest | ✅ /admin/relevance/benchmark (1819), /admin/benchmarks/ingest (1906) | ❌ REMOVED at HEAD (app.test.ts:630-631) | ✅ mdbrain routes 1685 + benchmark ingest route + MCP tools | COVERED by published 2.0.0; FORWARD RISK if service upgrades past 2.0.0 (§6) |
| Export/import (memory) | ❌ no /export route; ✅ /import/conversations | same | mdbrain's signed export (mdbrain:packages/memory-bridge/src/mdbrain-export.ts) is **unreferenced by any app route** (grep: zero hits outside bridge) | NOT A GAP (mdbrain-local, unused at runtime) |
| Context bundle / discovery projection / active slate / novelty / self-edit / chain-trace / read-file / profile / procedures outcome / memory feedback | ✅ all published (v1.ts 1099-2175) | ✅ | ✅ bridge 438-1130 | COVERED |

## 4. HARD ACCEPTANCE QUESTION — can mdbrain:packages/memory-engine be DELETED with no hidden local fallback?

**YES, with three mdbrain-side adapter items — all resolution type (a) (mdbrain-side adapter over the published API). No product feature deferral is required for the memory domain.** Duplicated engine fallback is not needed and not proposed.

Hidden couplings found (each resolves to exactly one category):

1. **In-process manager calls in the bridge** — mdbrain:packages/memory-bridge/src/mdbrain-bridge.ts:37-42 imports `getMemorySearchManager`/`MongoDBMemoryManager`. Resolution (a): rewrite bridge as a thin HTTP adapter over published `@memongo/client@2.0.0`; §3 shows the 43 remote adapters map to published methods; the 3 process-local helpers get explicit replacements (amendment v2 §3). The public bridge signature surface can be preserved so apps/api call sites and the type re-exports at :1241 keep compiling (types sourced from `@memongo/client` types.ts or a local type module).
2. **Wiki Mongo handle** — wiki routes and `mdbrainBridgeGetManager` schema-init (mdbrain-bridge.ts:368-383, routes/v1.ts:2089-2092) borrow the manager's MongoDB connection for `wiki_pages`/`wiki_revisions`. Resolution (a): wiki-engine already takes a `{ db, prefix }` handle (`getWikiDbHandle`, wiki-bridge.ts:229) — mdbrain opens its own `MongoClient` (its own `MDBRAIN_MONGODB_URI`/database) and calls `ensureWikiSchema` itself. wiki_* collections are mdbrain-owned, so this does NOT violate the "never touch memongo-owned collections" rule, provided mdbrain uses its own database or its own distinct collection set.
3. **`@mdbrain/mdbrain-memory` re-export package** — mdbrain:packages/mdbrain-memory/src/index.ts:1-2 re-exports engine+bridge. Resolution (a): repoint to bridge + `@memongo/client` types; or (b) intentionally defer/deprecate the re-export package. Not a runtime blocker for apps.
4. **mdbrain-only engine internals (batch-*.ts, mongodb-benchmark-*)** — die with the engine. No deferral needed: nothing outside the engine references them [SUBSTRATE-FACT], and benchmark *product* functionality is served by the published memongo routes.

**Minimum deferral list: EMPTY.** The only features mdbrain has that memongo lacks (wiki-engine) never depended on memory-engine code at runtime — only on a borrowed Mongo connection (item 2).

## 5. searchV2-quality retrieval over the published contract — explicit test

Question: is lanes/fusion/rerank-quality retrieval reachable via published HTTP/client at v2.0.0?

- [SUBSTRATE-FACT] `POST /search` → `memongoBridgeSearch` → `manager.search` → `searchV2(...)` with `legacySearch` fallback only when v2 returns nothing (memongo:packages/memory-engine/src/mongodb-manager.ts:2857,2944,3061-3064 at v2.0.0). Lanes are the default engine path, not opt-in.
- [SUBSTRATE-FACT] `POST /search-detailed` accepts `searchConfig` pass-through (v1.ts:1274-1281 at v2.0.0) incl. `recipe` (fast/hybrid/deep/temporal/chain-of-thought), `fusionMethod` (scoreFusion/rankFusion/js-merge), `hybridMode`, `searchMode` (auto/direct/agentic), `maxPasses`, `sourcePreference` (reference/conversation/structured/procedural/episodic/graph), `timeRange`, `lexicalPrefilter` (client types.ts:29-50; client.searchDetailed:480-524).
- [SUBSTRATE-FACT] Lane-level observability is in the published response: `lanesUsed`/`lanesSkipped` (client types.ts:1040-1041 at v2.0.0), plus per-request `reranker{model,stage}` stage metadata (types.ts:712-715).
- [SUBSTRATE-FACT] Reranking (Cohere `rerank-2.5`/`rerank-2.5-lite`) is enabled server-side via `MEMONGO_RERANKING_ENABLED` + `reranking.{model,topN}` config (backend-config.ts:477-487 at v2.0.0); `rerankResults` runs inside the search pipeline (HEAD mongodb-manager-search.ts:455 confirms the same at HEAD). It is NOT a per-request HTTP parameter — it is a service deployment config. mdbrain adapter must therefore require the memongo service deployment to have reranking enabled (operational requirement, not a contract gap).

**Verdict: searchV2-quality retrieval (lanes/fusion/rerank) IS reachable over the published contract.** Per-request control covers recipe/fusion/mode/lane-preference; rerank is deploy-config on the service.

## 6. Residual risks / forward notes

- RISK-1 (medium): `/admin/relevance/benchmark` + `/admin/benchmarks/ingest` and their client methods are published in 2.0.0 but REMOVED at unpushed HEAD (benchmark tooling moved out of the published package). mdbrain's benchmark routes/MCP tools depend on them. Mitigation: pin the service + client to `@memongo/*@2.0.0`; if memongo later publishes 2.0.1, benchmark features resolve to (b) deferred or (c) service-boundary blocker — do NOT build on HEAD behavior.
- RISK-2 (low): `/write-events` batch write is HEAD-only/unpublished. mdbrain has no need today; if batch-ingest volume becomes a need, resolution is (a) loop `/write-event` or use `/import/conversations`, never the unpublished route.
- RISK-3 (low): rerank/fusion defaults are server-side config; the mdbrain-side adapter cannot guarantee retrieval quality unless the memongo deployment is configured with reranking enabled. Add a deploy-time check (e.g. assert via /status/detailed or a probe) rather than a code dependency.
- RISK-4 (info): memongo tags v2.1.0/v2.1.1 exist locally but are unpublished (npm latest=2.0.0; their package.json still 2.0.0) — do not treat them as published surface.

## Evidence files cross-checked

docs/research/evidence/2026-08-13/: mdbrain-routes.txt (55), mdbrain-mcp-tools.txt (56), mdbrain-engine-exports.txt (263), mdbrain-client.txt (51), memongo-routes.txt (42 real, HEAD), memongo-client.txt (42, HEAD — predates `writeEvents`), memongo-engine-exports.txt, memongo-internal.txt, npm-memongo-memory-{engine,bridge}-2026-08-13.json, lane3-mdbrain-delta.md. All inventory claims above were re-verified against `git show v2.0.0:...` and HEAD sources directly on 2026-08-13.
