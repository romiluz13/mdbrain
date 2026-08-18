# Lane C — Retrieval Composition + Failure Semantics

Scope: published contract = memongo git tag v2.0.0 (commit bdad0fbf28c7f3360f8c206a415dd26e727e25dc = npm @memongo/*@2.0.0). HEAD = 8833026c0c (2.0.1, unpushed). mdbrain HEAD = 1b7e234. All memongo v2.0.0 line cites refer to the tagged blob (`git show v2.0.0:<path>`); HEAD cites refer to working-tree files.

---

## 1. Search knobs: remotely exposed (published) vs internal-only

### Published (v2.0.0) remote knobs, per endpoint

**POST /v1/search** — memongo:v2.0.0:apps/api/src/routes/v1.ts:819-844

- Exposed: `query` (or `q`), `maxResults`/`limit`, `minScore`, `sessionKey`, `scope`, `scopeRef`, `agentId`.
- NOT exposed: fusion method, numCandidates, weights, rerank, embedding model. [SUBSTRATE-FACT]

**POST /v1/search-kb** — memongo:v2.0.0:apps/api/src/routes/v1.ts:846-876

- Exposed: `query`, `maxResults`, `minScore`, `filter: { tags?, category?, source? }` (loose-cast, unvalidated), `scopeRef`, `agentId`.
- NOT exposed (published): `fusionMethod`. **Published-vs-HEAD delta:** HEAD adds top-level `fusionMethod: "scoreFusion"|"rankFusion"|"js-merge"` (memongo:apps/api/src/routes/v1-search-routes.ts:85-91) and validates the filter with a strict zod schema (memongo:apps/api/src/lib/validation.ts:121-128). Depending on either = unpublished-surface blocker.

**POST /v1/search-detailed** — memongo:v2.0.0:apps/api/src/routes/v1.ts:1228-1346; client type memongo:v2.0.0:packages/client/src/types.ts:29-50

- Exposed via `searchConfig`: `recipe` ("fast"|"hybrid"|"deep"|"temporal"|"chain-of-thought"), `recallProfile` ("latency"|"balanced"|"proof"), `maxResults`, `searchMode` ("auto"|"direct"|"agentic"), `maxPasses`, `sourcePreference`, `timeRange`, `needExactEvidence`, `numCandidates`, **`fusionMethod` ("scoreFusion"|"rankFusion"|"js-merge")**, `hybridMode` ("hybrid"|"vector-only"), `allowHybridBackstop`, `lexicalPrefilter` ("disabled"|"experimental"). [SUBSTRATE-FACT]
- Exposed top-level: `minScore`, `maxResults`, `searchMode`, `sourcePreference`, `timeRange`, `needExactEvidence`, `maxPasses`, `returnPlan`, and per-source scopes: `conversationScope { sessionKey }`, `structuredScope { type, state, salience }`, `referenceScope { source, category, tags }`, `proceduralScope { state, intentTags }`.
- "Conversation-evidence mode" maps to `needExactEvidence` + `conversationScope.sessionKey` (published; engine wires both at memongo:v2.0.0:packages/memory-engine/src/mongodb-manager.ts:1807, 3147-3274). Budget knobs = `maxResults`, `numCandidates`, `maxPasses`.

**POST /v1/recall-conversation** — memongo:v2.0.0:apps/api/src/routes/v1.ts:878-921

- Exposed: `query?`, `sessionId?`, `roles`, `startTime`/`endTime`, `asOf`, `timezone`, `includeToolMessages`, `limit`. Returns per-result `citation` objects (memongo:v2.0.0:packages/client/src/types.ts:386-402).

**Query embedding model: NOT remotely exposed on any endpoint.** Embedding config is server-side; only `embeddingConfig` on the admin benchmark route (memongo:v2.0.0:apps/api/src/routes/v1.ts:1828-1851) and read-only `GET /v1/probes/embedding` (line 1765) touch it. mdbrain cannot choose the embedding model per query over HTTP — resolution (a): accept server-configured model; if mdbrain's wiki embeddings must match, that's a service-boundary blocker (embedding pipeline is memongo-internal).

### Internal-only (never crosses HTTP, both versions)

- Per-pipeline fusion weights (mdbrain in-process uses vectorWeight 0.7 / textWeight 0.3 — mdbrain:packages/memory-engine/src/mongodb-manager.ts:2580-2582), `embeddingMode`, `capabilities`, per-source enable flags, `explain`/trace hooks, rerank function injection. No remote rerank knob exists in the published contract (server-controlled).

---

## 2. Retrieval composition mdbrain must own above the service

Today's in-process composition (to be replicated/replaced): parallel `Promise.all` fanout across runtime-conversation, bridge-conversation, KB, structured sources (mdbrain:packages/memory-engine/src/mongodb-manager.ts:2562-2567), then cross-source score-sort + `deduplicateSearchResults` + `rerankResults` (mdbrain:packages/memory-engine/src/mongodb-manager.ts:2690-2702). Wiki composition is separate: server-side `$rankFusion` RRF of vector+text inside one aggregation (mdbrain:packages/wiki-engine/src/wiki-search.ts:253-272), governance post-filter (mdbrain:packages/wiki-engine/src/wiki-search.ts:418-428), optional rerank (431-448), graph expansion (451-471).

Above a remote memongo service mdbrain must own:

1. **Parallel fanout across trust boundaries.** memongo /search, /search-kb (or one /search-detailed), and mdbrain-side wiki search are independent HTTP/DB calls. Use `Promise.allSettled`, not `Promise.all` — one failed leg must degrade, not blank the whole response. Resolution (a), mdbrain-side adapter.
2. **Cross-service score normalization / RRF.** memongo result scores (fused per its own corpus) and mdbrain wiki scores are on different scales (wiki hybrid score comes from `$meta: "scoreDetails"` value — mdbrain:packages/wiki-engine/src/wiki-search.ts:271-273). Raw score merge is UNSUPPORTED; mdbrain must fuse by rank (RRF) or normalize per-source before merging. Resolution (a).
3. **Wiki governance: AFTER fusion today, and it must stay mdbrain-owned.** Governance post-filters RRF output (mdbrain:packages/wiki-engine/src/wiki-search.ts:418-428) — rank positions and `maxResults` are computed pre-filter, so filtering under-fills pages. memongo's published contract has NO governance knob (roles/departments/trustTier absent; search-kb filter is only tags/category/source). If wiki content ever moves into memongo KB, pre-fusion governance enforcement server-side is a **service-boundary blocker (c)**; with wiki staying mdbrain-side, the fix is (a) over-fetch + post-filter with a fill target.
4. **Provenance/citation assembly.** Published /search-detailed already returns rich per-result provenance: `provenance`, `sourceEventIds`, `sourceReliability`, `trust{score,confidence,exactness,freshness,contradiction,...}`, plus `metadata.passes`, `resultsRejected`, `evidenceCoverage`, `noDirectEvidenceReason`, `constraintRelaxations` (memongo:v2.0.0:packages/client/src/client.ts:170-272). /recall-conversation returns citations (types.ts:386-402). Wiki results carry only `{page, score, source}` (mdbrain:packages/wiki-engine/src/wiki-search.ts:302-312) — mdbrain owns wiki citation assembly (a).
5. **Timeouts.** Published server has NO per-request HTTP timeout (only shutdown-drain timers — memongo:v2.0.0:apps/api/src/app.ts:405-453); published client has NO timeout/AbortSignal (memongo:v2.0.0:packages/client/src/client.ts:112-137). mdbrain must wrap every service call in `AbortSignal.timeout` itself (a). **Delta:** HEAD client adds `timeoutMs` default 30_000 via `AbortSignal.timeout/any` (memongo:packages/client/src/client.ts:60-61,196-203) — unpublished.
6. **Honest degraded behavior — no silent empty.** Two distinct cases:
   - **memongo service results:** published contract surfaces degradation honestly (`noDirectEvidenceReason`, `evidenceCoverage`, `constraintRelaxations`); mdbrain must propagate these, not flatten to "no results". (a)
   - **mdbrain wiki search:** `searchWikiPages` is documented "never throws ... empty" (mdbrain:packages/wiki-engine/src/wiki-search.ts:400-401) and swallows real failures: search-index failure → `return []` at mdbrain:packages/wiki-engine/src/wiki-search.ts:329-335 (only rerank-stage failures are logged/retried, 320-328); graph expansion `catch { return [] }` at 391-394; rerank failure silently kept at 446-448. The task's cite (407-410) has drifted — current HEAD lines 407-410 are `maxResults`/`recipeDefaults`; the swallow sites are as listed. Under the service boundary this is **mdbrain-side, not memongo's fault**: wiki queries hit mdbrain-owned collections directly. Resolution (a): distinguish "index unavailable/timeout" (degraded flag + error) from "genuinely no hits" (empty ok), matching the metadata contract memongo already publishes.

---

## 3. Failure semantics over HTTP

### Status taxonomy — published v2.0.0 [SUBSTRATE-FACT]

| Status | Code(s) | Where |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | every route (e.g. v1.ts:823-827) |
| 401 | `UNAUTHORIZED` | app.ts:564-565 |
| 403 | `FORBIDDEN` | scoped-key policy, app.ts:570-606 |
| 404 | `NOT_FOUND`, `EVENT_NOT_FOUND` | jobs v1.ts:2104-2106; /extract scope miss v1.ts:1624-1626 |
| 413 | `PAYLOAD_TOO_LARGE` | bodyLimit onError, app.ts:537-545 |
| 429 | `RATE_LIMITED` + `Retry-After` header | fixed-window limiter, app.ts:116-120 |
| 500 | per-route codes `SEARCH_FAILED`, `SEARCH_KB_FAILED`, `SEARCH_DETAILED_FAILED`, `ADD_FAILED`, `WRITE_EVENT_FAILED`, `EXTRACT_FAILED`, `WRITE_STRUCTURED_FAILED`, `WRITE_PROCEDURE_FAILED`, etc. | routes pass `err.message` verbatim into the body |
| 202 | success (async job accepted) | /extract only, v1.ts:1620 |

Error body shape (both versions): `{ error: { code: string, message: string } }` — memongo:apps/api/src/lib/errors.ts:5-18; published Error schema memongo:v2.0.0:apps/api/src/openapi-spec.ts:2789-2797.

**Published-vs-HEAD deltas (failure semantics):**

1. Published 500 bodies **leak raw internal error messages** (driver text, paths) — e.g. memongo:v2.0.0:apps/api/src/routes/v1.ts:841-843. HEAD replaces this with `internalError` (sanitized "internal server error (request id: …)", full detail logged server-side) — memongo:apps/api/src/lib/errors.ts:56-92, app.ts:524-529. mdbrain must not parse published `error.message` for control flow; only `code` is stable-ish.
2. **503 does not exist in published.** HEAD maps Mongo network errors (MongoNetworkError/MongoNetworkTimeoutError/MongoServerSelectionError) to `503 SERVICE_UNAVAILABLE` (memongo:apps/api/src/lib/errors.ts:24-53,78-91). On published, a Mongo outage surfaces as 500 `*_FAILED` with a driver message — mdbrain cannot reliably classify retriable dependency failure vs bug. Resolution (a): mdbrain adapter treats 500-with-network-message heuristically or just bounds retries; (c) precise classification is blocked until a release ships the 503 mapping.
3. HEAD adds `422 IDEMPOTENCY_CONFLICT` (memongo:apps/api/src/routes/v1-write-routes.ts:85-88, 178-181) and request-id middleware (memongo:apps/api/src/app.ts:547). Unpublished → blocker if depended on.

### Timeouts

None server-side per request (both versions). Client: published none; HEAD 30s default (above). mdbrain owns its deadline budget either way.

### Reads vs writes vs idempotency (published)

- **Reads (safe to retry freely):** all GETs (`/state`, `/status*`, `/stats`, `/jobs*`, `/probes/*`, `/admin/relevance/report`, `/admin/access-*`, `/admin/traces*`) and read-only POSTs (`/search`, `/search-kb`, `/search-detailed`, `/recall-conversation`, `/profile`, `/context-bundle`, `/hydrate-active-slate`, `/discovery-projection`, `/read-file`, `/lifecycle/get`, `/lifecycle/history`, `/chain-trace`).
- **Idempotent writes (natural key, safe replay):** `/write-structured` — upsert by key (memongo:v2.0.0:packages/memory-engine/src/mongodb-structured-memory.ts:645-659,794-797); `/write-procedure` — upsert by procedureId (mongodb-procedures.ts:460,534-550); `/lifecycle/update` — handle-targeted patch; `/lifecycle/delete` — handle-targeted invalidation.
- **Non-idempotent writes (published):** `/add` and `/write-event` — blind inserts, no dedup/idempotency key anywhere in v2.0.0 (`git grep idempotencyKey v2.0.0` = zero hits in engine/bridge); `/memory/feedback` and `/procedures/outcome` — state transitions that increment `reinforcementCount` (memongo:v2.0.0:packages/memory-engine/src/mongodb-structured-memory.ts:194), so replay double-counts; `/import/conversations`, `/sync`, `/consolidate`, `/self-edit`, `/novelty-scan` — side-effecting maintenance, no replay protection.
- **CRITICAL HAZARD:** the published @memongo/client retries **429/503 on ALL methods including non-idempotent POSTs** (memongo:v2.0.0:packages/client/src/client.ts:91-93 `shouldRetryStatus`, 106-137 retry loop). A 429-then-retry on `/write-event` can double-write (the write may have succeeded before the 429/500 was synthesized — actually 429 fires pre-route so it's safe; the real risk is caller-level retry after 500/timeout where the insert may have landed). mdbrain's own client mirrors this (mdbrain:packages/client/src/client.ts:114-131). Resolution (a): mdbrain adapter must disable retry for non-idempotent writes and use query-back verification; retry is contract-proven safe ONLY for reads and keyed upserts on the published surface. **HEAD fixes this** (per-write UUIDv4 idempotency key stable across retries, `Idempotency-Key` header + `customId`, receipts, 422 conflict — memongo:packages/client/src/client.ts:236-242,614-634,860-881; memongo:apps/api/src/routes/v1-helpers.ts:309-313) — unpublished, so relying on it is a blocker.
- **Async receipt pattern (published):** `/extract` → 202 with job, poll `GET /v1/jobs/:jobId` (404 `NOT_FOUND` until visible) — v1.ts:1607-1629, 2093-2111. This is the only published receipt/query-back pair for write-adjacent work.

---

## 4. Reconciliation after partial cross-service success

Scenario: mdbrain wiki write (mdbrain-owned `wiki_pages`, direct MongoDB — allowed) succeeds + memongo memory write fails, or vice versa. What the **published** contract supports:

1. **Receipts:** every write returns `{ ok: true, eventId, chunkCreated }` (/add, /write-event — v1.ts:1519-1523, 1589-1593) or the upserted document (/write-structured, /write-procedure). mdbrain can persist these receipts as its cross-service outbox ledger. (a)
2. **Idempotent replay:** only the keyed writes (/write-structured, /write-procedure, /lifecycle/update, /lifecycle/delete) can be replayed blindly to converge after a partial failure. Conversation-event writes CANNOT be replayed safely on published — ⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 1): the semantics are **durable intent + single automatic dispatch + explicit unknown/dead-letter**, NOT at-least-once (no automatic retry of non-idempotent writes). Server-internal read-time dedup (`deduplicateSearchResults` by evidence identity, memongo:v2.0.0:packages/memory-engine/src/mongodb-manager.ts:1670-1674) mitigates search pollution but the duplicate events persist. Resolution: (a) mdbrain-side adapter: single-attempt write + receipt ledger + query-back reconciliation REPORTING only. ⚠️ SUPERSEDED 2026-08-13 (amendment v4, evidence finding 1): query-back NEVER justifies writing again — a post-marker ambiguous outcome is terminal `unknown`/dead-letter in v2 development, never redispatched. Event-level dedup is **(c) service-boundary blocked** until an idempotency-key release ships (HEAD has it, unpublished).
3. **Query-back verification:** `/recall-conversation` (by sessionId/time/content) and `/search` can confirm an event landed; `/jobs/:jobId` confirms async work. This is fuzzy for events (no GET-by-eventId read endpoint; `/extract` takes eventId but is a 202 extraction trigger, not a read — v1.ts:1607-1629). Gap: **no published read-by-eventId**. Resolution (a): verify via recall-conversation within the same sessionId+time window; exact event fetch is (c) blocked on the published surface.
4. **Wiki side:** mdbrain controls it — `createWikiPage` has natural dedup via 409 `DUPLICATE_SLUG` (mdbrain:apps/api/src/routes/v1.ts:2186-2189), so create replay is safe; `updateWikiPage` appends revisions (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:514), so update replay double-revisions — mdbrain must treat wiki updates as non-idempotent and reconcile via `GET /wiki` read-back. Compensation order for partial success: write the *reversible/keyed* side first (wiki create is compensable via delete; keyed memory upserts are re-playable), the *non-idempotent* side (conversation event) last, and ledger the eventId receipts so a later reconciliation pass can query-back and only then mark the pair committed.
5. **Saga/queue guidance:** a retry queue is contract-safe ONLY for: reads, keyed upserts, and (HEAD-only) keyed event writes. ⚠️ SUPERSEDED 2026-08-13 (amendment v4, evidence finding 1): the "verify-then-write-once / write on confirmed-absent" path for published event writes is REJECTED — confirmed-absent is heuristic (no read-by-id), so it cannot gate re-dispatch. In v2 development only PRE-marker failures retry; post-marker ambiguity is terminal `unknown`, never auto-redispatched. Production redispatch requires the amendment §7.1 idempotency contract (same-key replay returning the original receipt or conflict).

---

## Gap resolutions summary

| Gap | Resolution |
| --- | --- |
| No remote fusion knob on /search (simple) | (a) use /search-detailed `searchConfig.fusionMethod`, or accept server default |
| /search-kb fusionMethod (HEAD-only) | (a) use published /search-detailed referenceScope instead, or defer (b) |
| No remote query-embedding-model knob | (a) server-configured model; (c) if per-query model needed |
| Cross-service score fusion (wiki + memory) | (a) mdbrain-owned RRF/rank fusion |
| Wiki governance pre-fusion inside memongo | (c) blocker — keep wiki mdbrain-side; (a) over-fetch + post-filter |
| Silent empty wiki results | (a) mdbrain-side fix (mdbrain:packages/wiki-engine/src/wiki-search.ts:329-335,391-394,446-448) — mdbrain owns this collection, NOT memongo |
| No request timeouts (published server+client) | (a) mdbrain AbortSignal wrapper |
| Published 500s leak internals / no 503 taxonomy | (a) classify on `code` + status only; (c) precise retriable-503 is HEAD-only |
| Published client retries non-idempotent writes | (a) mdbrain adapter disables write retries; never use published client blind-retry for /add, /write-event, /memory/feedback, /procedures/outcome |
| Event-write idempotency / receipts / /write-events batch | (c) HEAD-only, unpublished — do not depend |
| No read-by-eventId | (a) query-back via recall-conversation for reconciliation REPORTING only — never as a re-dispatch basis (amendment v4); (c) exact fetch |

Verdict: **No hard blockers for Lane C's core retrieval path** — published /search-detailed exposes fusion/budget/evidence knobs sufficient for mdbrain composition; all composition (fanout, RRF, governance, citations, timeouts, degradation surfacing) is mdbrain-ownable via (a). The one genuine service-boundary exposure is **write idempotency + read-by-eventId for reconciliation** (⚠️ SUPERSEDED 2026-08-13: published semantics = durable intent + single dispatch + explicit unknown outcome with fuzzy query-back — NOT at-least-once; the real fix ships in HEAD but is unpublished).
