# Lane E — Cross-Service Consistency + Managed Plane

**Audited:** mdbrain HEAD `1b7e234` (2026-07-30); memongo local HEAD `8833026c0c` (2.0.1, unpushed); PUBLISHED memongo = git tag `v2.0.0` = npm `@memongo/*@2.0.0` (npm gitHead `bdad0fbf28c7f3360f8c206a415dd26e727e25dc`, published 2026-07-31T14:53Z — registry.npmjs.org/@memongo/memory-bridge, accessed 2026-08-13 [EXTERNAL-SPEC]).

**Published-surface audit method note:** no shell available in this lane, so `git show v2.0.0:<path>` was executed indirectly via `raw.githubusercontent.com/romiluz13/memongo/v2.0.0/<path>` (repo is public; tag objects fetched successfully) plus the npm registry. Every published-vs-HEAD delta relied on is called out explicitly.

---

## E.1 Consistency model mdbrain can honestly document

### E.1.1 Substrate facts

1. **[SUBSTRATE-FACT] No distributed transaction exists across the boundary, and none can.** Wiki writes go to mdbrain-owned collections (`wiki_pages`, `wiki_revisions`; mdbrain:packages/wiki-engine/src/wiki-schema.ts, exported via mdbrain:packages/wiki-engine/src/index.ts:13-28). Memory event writes go to memongo-owned collections via the published API/bridge. There is no shared `ClientSession` path spanning both, and "mdbrain never reads/writes memongo-owned collections" forbids creating one. The only honest model is **two independent single-store writes with mdbrain-side sequencing, outbox, and compensation**.

2. **[SUBSTRATE-FACT] The locked revision-atomicity decision (page+revision atomic, mdbrain-side, same DB) is architecturally unaffected — but the current implementation does NOT honor it.** `recordWikiPageRevision` is explicitly best-effort: it takes **no `ClientSession`**, catches all errors, and "a failure here is logged but never thrown" (mdbrain:packages/wiki-engine/src/wiki-revisions.ts:36-75). `createWikiPage`/`updateWikiPage` accept an optional session and pass it to the page write, but call `recordWikiPageRevision(handle, {...})` **without** the session (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:~420, ~665-675) and likewise run `recomputeBacklinksAfterChange` outside any session (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:~381-389, ~660-664). Consequence: a crash between page write and revision insert loses the audit snapshot; a backlink recompute failure leaves stale denormalized backlinks. **GAP → resolution (a) mdbrain-side fix** (thread the session into revision recording or wrap page+revision in `withTransaction`): zero memongo dependency. The decision stays locked; the code must catch up.

3. **[SUBSTRATE-FACT] The atomicity machinery exists mdbrain-side and is proven in-repo.** `WikiDbHandle` carries an optional `client?: MongoClient` precisely so callers can `session.withTransaction()` (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:186-200, comment block). `importOkfBundle` already does exactly this — `handle.client.startSession()` + `session.withTransaction(async () => runImportLoop(session))`, with a coded fallback to non-transactional per-concept import on standalone (no-replica-set) deployments, detected via error codes 20/263 (mdbrain:packages/wiki-engine/src/okf.ts:~455-560, `isTransactionNotSupported`). Both `wiki_pages` and `wiki_revisions` live in the same DB under the same prefix (mdbrain:packages/wiki-engine/src/wiki-schema.ts), so same-DB atomicity needs no memongo cooperation.

4. **[SUBSTRATE-FACT] mdbrain cannot borrow memongo's DB handle from the published package.** memongo HEAD `MongoDBMemoryManager` declares `private readonly client`, `private readonly db`, `private readonly prefix` (memongo:packages/memory-engine/src/mongodb-manager.ts:467-469); mdbrain's `getWikiDbHandle` duck-types `db`/`prefix`/`client` off the manager (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:203-228) and would throw "manager does not expose db + prefix" against a published memongo manager. **Resolution (a):** mdbrain constructs its own `MongoClient`/`Db` from `MDBRAIN_MONGODB_URI` (mdbrain already owns this env contract) and builds `WikiDbHandle` directly — wiki collections are mdbrain-owned regardless. Not a blocker; do not depend on a memongo-side getter.

### E.1.2 Ordering, outbox, replay, compensation

**Documented model (honest, publishable):**

- **Write ordering rule:** for flows that must produce both a wiki page and a memory event (e.g. connector ingest, decision capture), mdbrain writes the **wiki page first** (durable, mdbrain-owned, atomic-with-revision after the E.1.1(2) fix), then enqueues the memory event in an **mdbrain-owned outbox collection** in the same DB — the outbox row can even share the wiki page's transaction. ⚠️ SUPERSEDED 2026-08-13 (amendment v4, evidence finding 1): the relay performs a SINGLE automatic dispatch per durable intent — not "drains with retries." Only pre-`dispatch_started`-marker failures are retryable; post-marker ambiguity is terminal `unknown`/dead-letter, never auto-redispatched (v2 dev). Production same-key replay awaits the §7.1 idempotency contract. Reverse order (event-first) is acceptable only for Dreamer-source events where the wiki page is derived later (pull model, self-healing).
- **Idempotent replay — published receipts:** published memongo `@2.0.0` write endpoints `/v1/add` and `/v1/write-event` return `{ ok, eventId, chunkCreated }` (memongo@2.0.0:apps/api/src/routes/v1.ts — raw.githubusercontent.com/romiluz13/memongo/v2.0.0/apps/api/src/routes/v1.ts, accessed 2026-08-13; `/v1/add` handler and `/v1/write-event` handler both `return c.json({ ok: true, eventId: out.eventId, chunkCreated: out.chunkCreated })`). **No `idempotencyKey`, no `IDEMPOTENCY_CONFLICT`, no `/v1/write-events` batch, no `replayed` flag exist at 2.0.0** — all four are HEAD-only (2.0.1, unpushed): memongo:apps/api/src/routes/v1-write-routes.ts:33-90 (idempotencyKey on `/add`), :~190-345 (batch with per-item receipts, `customId`→idempotencyKey, `replayed?: boolean`). **Published-vs-HEAD delta relied on: idempotency is NOT in the published surface.**
  - **GAP → resolution (a), mdbrain-side adapter on published API:** ⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 1): delivery semantics are **durable intent + single automatic dispatch + explicit unknown/dead-letter outcome** — NOT at-least-once, and there is NO automatic retry-after-timeout that "accepts a rare duplicate." The outbox row persists canonical payload + identity + ACL + hash + mdbrain-generated idempotency key BEFORE dispatch; a CAS `dispatch_started` marker is written before opening the socket; confirmed receipt → delivered; definitive rejection → rejected/dead-letter; timeout/process death/lease expiry after the marker → `unknown` (never re-pending, never auto-redispatched). Server-side idempotent replay remains **deferred** until a published memongo release ships the §7.1 idempotency contract.
- **Compensating actions (published):** the 2.0.0 API exposes lifecycle invalidation — the delete-lifecycle route accepts `invalidatedBy` and soft-invalidates a memory item (memongo@2.0.0:apps/api/src/routes/v1.ts, `memongoBridgeDeleteLifecycleItem({ handle, invalidatedBy })` handler). This is the published lever for "un-write" compensation when an outbox replay produced a confirmed duplicate or a wiki page was superseded after event promotion. Wiki-side compensation is native: soft delete sets `state=superseded` + `validTo` and records a `delete` revision (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:~690-720).
- **Provenance linkage for reconciliation exists:** wiki pages initialize `sourceEventIds: []` and claims carry `sourceMemId` (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:~330-340, ~290-300) — the mdbrain-side join key for drift detection.

---

## E.2 Consistency SLOs, failure windows, reconciliation jobs

**Achievable guarantees (published surface only):**

| Guarantee | Wiki store (mdbrain DB) | Memory store (memongo, 2.0.0) |
| --- | --- | --- |
| Write durability | Single-DB writes; page+revision atomic **only after E.1.1(2) fix**; today revision may lag/loss | Canonical event durable at 2xx receipt (`eventId`); chunk projection flagged by `chunkCreated` |
| Ordering | Monotonic `revision` counter per page | None published across events; mdbrain outbox enforces send order per correlation id |
| Staleness | Revisions listable immediately post-write (mdbrain:packages/wiki-engine/src/wiki-revisions.ts:78-101) | Derived memory (structured/procedures) lags events by async extraction (`/v1/extract` → 202 at 2.0.0; job tracking via `/v1/jobs`, `/v1/jobs/:jobId` — present at 2.0.0, confirmed in v1.ts import list) |
| Cross-store | Wiki derived from memory events is **eventually consistent**, bounded by mdbrain maintenance cadence (`runDreamerPromotion` is pull-based over caller-supplied `EventInput[]`, per-event try/catch with `errors[]`, upsert-by-slug with semantic-search fallback — mdbrain:packages/wiki-engine/src/wiki-maintenance.ts:233-331) | — |

**Failure windows to document:**

1. Wiki write ok → memongo event write fails: dangling `sourceEventIds` reference. ⚠️ SUPERSEDED 2026-08-13 (amendment v4): NOT "covered by outbox retry" — pre-marker failure retries; post-marker ambiguity becomes terminal `unknown` → dead-letter with operator reconciliation (mdbrain-side job to build).
2. Memongo commit → receipt lost (timeout): ⚠️ SUPERSEDED 2026-08-13 (amendment v4): the row goes terminal `unknown` — the metadata correlation id + periodic dedupe reconciliation only DETECT a possible duplicate; they do not close the window by redispatch (forbidden). Exact closure requires the §7.1 idempotency contract.
3. Event ok → Dreamer promotion not yet run: wiki stale; self-healing on next run; detectable via `lastMaintainedAt`/`freshness` fields on pages (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:~155-160).
4. Revision snapshot lost (today's code): silent audit gap until E.1.1(2) fix ships.
5. Standalone (non-replica-set) self-hosted MongoDB: `withTransaction` unsupported → OKF import already degrades gracefully with a logged warning (mdbrain:packages/wiki-engine/src/okf.ts:~530-560). ⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 1): the "best-effort on standalone" extension to page+revision atomicity is REJECTED for production — production requires a successful live transaction probe at startup with NO standalone fallback for page+revision+outbox. The OKF-import degradation remains development-only.

**Reconciliation jobs mdbrain must run (all mdbrain-side, published API only):**

- Outbox relay + dead-letter sweep (mdbrain-owned collection).
- Dreamer/git-diff maintenance scheduler (exists: mdbrain:packages/wiki-engine/src/wiki-maintenance.ts:83-151, 255+).
- Drift audit: join wiki `sourceEventIds`/claim `sourceMemId` against memongo lifecycle/search reads; compensate via published `invalidatedBy` lifecycle delete.
- Backlink/consistency sweeps already exist mdbrain-side (`recomputeAllBacklinks`, mdbrain:packages/wiki-engine/src/wiki-backlinks.ts via index.ts export).

---

## E.3 Managed control plane mapping (locked OSS-core decision)

Managed = connector ops, identity/ACL sync, observability, upgrades, enterprise onboarding; core fully self-hostable. Per-capability proof:

1. **Connector ops — PROVEN mdbrain-side.** Connectors (`Obsidian/GitHub/Confluence/Notion/Slack/Crm`, `ConnectorRegistry`) are wiki-engine code writing mdbrain-owned collections (mdbrain:packages/wiki-engine/src/index.ts:~155-180 export block; mdbrain:packages/wiki-engine/src/wiki-connectors.ts). Scheduling, credentials vault, and retry are plane-side code. No memongo dependency at all.
2. **Identity/ACL sync — PROVEN with one infra caveat.** Wiki governance (scope filters, trust tiers, permissions) is mdbrain-side (mdbrain:packages/wiki-engine/src/wiki-governance.ts via index.ts:~100-115). Memongo-side auth is env/provisioned API keys and scoped keys at the deployment layer (memongo@2.0.0:apps/api/src/app.ts — auth middleware, `MEMONGO_ALLOW_INSECURE_NO_AUTH` gate; no key-management endpoint exists at 2.0.0). The managed plane therefore syncs identity by **provisioning deployment config**, not by calling a memongo admin API — plane-side infrastructure code, no unpublished runtime dependency. **GAP → (a) adapter** (plane manages env/secret material at deploy time); if runtime key-minting via API is ever required, that becomes a service-boundary blocker — flag, don't design for it now.
3. **Observability — PROVEN on published surface, with HEAD-only extras deferred.** Published-consumable signals (all present at v2.0.0, verified in tag's v1.ts import list): `/health` (liveness), `/v1/status`, `/v1/status/detailed` (`memongoBridgeGetDetailedStatus`), `/v1/stats`, `/v1/probes/embedding`, `/v1/probes/vector` (`memongoBridgeProbeEmbedding/ProbeVector`), `/v1/jobs` + `/v1/jobs/:jobId`, `/v1/admin/access-trends`, `/v1/admin/access-summaries`, `/v1/admin/traces`. **Published-vs-HEAD deltas relied on:** deep 3-lane `/ready` (mongo/vector/embedding, memongo:apps/api/src/lib/readiness.ts:1-90) and the `version` echo on `/v1/status` (memongo:apps/api/src/routes/v1-status-routes.ts:64-74) are **HEAD-only** — absent from memongo@2.0.0:apps/api/src/app.ts (only `/health` + `/openapi.json`). **GAP → (a)** plane composes readiness from `/health` + the two published probes; version-skew detection → **(b) deferred** (plane pins the deployed memongo image/npm version itself until a published status-version echo exists).
4. **Upgrades — PROVEN plane-side.** The plane owns deployment artifacts (npm pin `@memongo/*@2.0.0`, docker images) and mdbrain's own migration scripts (`wiki:migrate`, mdbrain:packages/wiki-engine/src/wiki-migrate.ts). No memongo cooperation needed beyond published behavior continuity.
5. **Enterprise onboarding — PROVEN mdbrain-side.** OKF import/export (mdbrain:packages/wiki-engine/src/okf.ts), legacy migration (`migrateStructuredMem`, `migrateProcedures`, `migrateLegacyToWiki`, `checkMigrationCoverage` — mdbrain:packages/wiki-engine/src/wiki-migrate.ts via index.ts:~88-95). Transactional import degrades safely on standalone (E.1.1(3)).

**No managed capability requires unpublished memongo surface. Zero service-boundary blockers found in this lane.**

---

## E.4 Observability across the boundary — telemetry inventory + gaps

**Published (2.0.0) consumable telemetry** [SUBSTRATE-FACT vs tag; URLs above]:

- Liveness: `GET /health` → `{ ok, service: "memongo-api" }`.
- Status/capability: `GET /v1/status`, `GET /v1/status/detailed`, `GET /v1/stats`, `GET /v1/state`, `POST /v1/profile`.
- Probes: `GET /v1/probes/embedding`, `GET /v1/probes/vector`.
- Async-work visibility: `GET /v1/jobs`, `GET /v1/jobs/:jobId` (status filter: pending/running/completed/failed/cancelled).
- Quality/usage: `/v1/admin/access-trends`, `/v1/admin/access-summaries`, `/v1/admin/traces`, `/v1/admin/relevance/report` (present at 2.0.0 imports).

**Gaps (each resolved by taxonomy):**

1. **No deep readiness at 2.0.0** (`/ready` HEAD-only) → **(a)** adapter: plane composes readiness = `/health` ∧ `probes/vector` ∧ `probes/embedding`. Note the engine itself has no live search-index readiness signal even at HEAD (memongo:apps/api/src/lib/readiness.ts:14-18 comment) → **(b) deferred** documentation caveat.
2. **No server version echo at 2.0.0** → **(b) deferred**; plane pins versions at deploy time.
3. **No projection-lag / ingest-run telemetry published** (`getProjectionLag`/`recordIngestRun` exist in engine internals at HEAD, memongo:packages/memory-engine/src/mongodb-manager.ts:61-66 import block, but are not reachable through published bridge/API at 2.0.0) → **(a)** approximate lag via `/v1/jobs` pending/running counts + `/v1/stats` deltas; **(b)** defer precise lag SLOs.
4. **No metrics/tracing export (no `/metrics`, no OTLP) on either service**; mdbrain API itself exposes only `/health`, no `/ready` (mdbrain:apps/api/src/app.ts, final lines) → **(a)** plane polls the published endpoints and synthesizes SLIs; mdbrain-side `/ready` for its own DB lane is mdbrain code to add.
5. **Duplicate-detection telemetry for outbox replay** does not exist server-side at 2.0.0 → **(a)** mdbrain-side reconciliation reports.

---

## Published-vs-HEAD delta register (all deltas this lane relies on)

| Feature | Published v2.0.0 | HEAD 2.0.1 (unpublished) | Lane E consequence |
| --- | --- | --- | --- |
| `idempotencyKey` on `/v1/add`, `/v1/write-event` | ABSENT (memongo@2.0.0 bridge `memongoBridgeAdd` has no such param) | Present (memongo:apps/api/src/routes/v1-write-routes.ts:33-90) | Outbox must self-guarantee; server idempotency deferred |
| `/v1/write-events` batch + per-item receipts + `replayed` | ABSENT | Present (v1-write-routes.ts:~190-345) | Batch replay receipts deferred |
| `GET /ready` 3-lane readiness | ABSENT (app.ts at tag: `/health` only) | Present (readiness.ts) | Plane composes from probes |
| `version` echo on `/v1/status` | Not verified at tag; treat as absent | Present (v1-status-routes.ts:64-74) | Version skew detection deferred |
| `@memongo/memory-engine` export surface | WIDE barrel (procedures fns, AccessTracker, benchmark harness, migration backfill all from `.`) | Trimmed ~50-symbol surface + `./internal` subpath (memongo:packages/memory-engine/src/index.ts:1-10 P4.1 note; package.json HEAD adds `./internal`) | mdbrain must import only what 2.0.0's `.` exports; must NOT rely on the HEAD trim's symbol names being stable, and must never import `./internal` (unpublished at 2.0.0 — package.json at tag has no `exports["./internal"]`) |
| npm published versions | `1.1.0`, `2.0.0` (latest=2.0.0; no 2.0.1) | — | registry.npmjs.org/@memongo/memory-bridge, accessed 2026-08-13 |

## Verdict

Lane E finds **zero service-boundary blockers**. The honest consistency model is: single-DB atomicity mdbrain-side for wiki page+revision (locked decision stands; current code is best-effort and needs the mdbrain-side session fix — GAP (a)); durable-intent + single-dispatch cross-boundary delivery with explicit unknown/dead-letter outcomes via an mdbrain-owned outbox, published `eventId` receipts, and published `invalidatedBy` lifecycle compensation (⚠️ SUPERSEDED 2026-08-13: was "at-least-once"; server-side idempotency intentionally deferred — GAP (b)); eventual wiki-from-memory consistency via the existing pull-based Dreamer/git-diff maintenance with documented staleness windows. Every managed-plane capability (connector ops, identity/ACL sync, observability, upgrades, onboarding) is implementable with mdbrain-side code plus the published 2.0.0 surface only. All HEAD-only conveniences (`/ready`, idempotency keys, batch receipts, `/internal` exports) are correctly classified as deferred or adapter-resolved; nothing depends on them.
