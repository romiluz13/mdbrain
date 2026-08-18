# Service-Boundary Amendment: Mdbrain as Gateway over an Independently Deployed Memongo

**Date:** 2026-08-13 (v4 — remediated after a third 3/3 BLOCK fresh review, 14 findings)
**Authors:** Founding-engineer research lead + CTO (adversarial co-review)
**Status:** **Draft — adversarial remediation.** Not agreed. Thesis approved; v4 awaits a fourth fresh 3-axis review (architecture / security / evidence). Clean is required before spec/tickets and PLAN_READY; H1–H6 go to the human only after clean.
**Supersedes:** the package-dependency recommendation (Option B) of `docs/research/2026-08-13-memongo-absorb-company-brain.md` v5, by user decision. §12 is the complete section-by-section supersession matrix using v5's actual headings; v5's security/governance/eval gates remain binding and cumulative.
**Durable evidence:** `docs/research/evidence/2026-08-13/service-boundary/` — lanes A–E (superseded claims corrected in place); published-tag source dumps (`v1-v200.ts`, `app-v200.ts`, `scope-identity-v200.ts`, `laneC-client-v200.ts`, `laneC-v1-v200.ts`, `openapi-spec-v200.ts`); `git-ls-tree-v2.0.0.txt`; npm registry captures for **all six** published packages (`npm-memongo-{lib,memory,memory-engine,memory-bridge,client,tools}-2026-08-13.json`, uniform gitHead `bdad0fbf…`); `container-registry-probes-2026-08-13.txt`.

## 0. User-decision context (binding)

1. Memongo and mdbrain are **separate projects**. Zero Memongo source changes are permitted or implied anywhere in this amendment.
2. Mdbrain is **not in production and has no users**. No compatibility layer, no deprecation window, and **clean-slate cutover is the default** — legacy local engine data is archived/dropped unless the human later explicitly asks to preserve it. The Lane D fidelity/loss matrix (`laneD-topology-migration.md` §2) is retained as contingency evidence only, not as architecture.
3. Mdbrain consumes **only the published Memongo wire contract**. Published means: git tag `v2.0.0` = commit `bdad0fbf28c7f3360f8c206a415dd26e727e25dc` = npm `@memongo/*@2.0.0` (six packages, registry captures above). Anything existing only at local HEAD `8833026c0c` (2.0.1, unpushed) — idempotency keys, `/v1/write-events` batch, `/ready`, API Dockerfile, `version` echo, client timeouts — is **unpublished and must not be depended on**. Public tags `v2.1.0` (commit `674dea5ec2fd`, 2026-08-01) and `v2.1.1` (commit `3d1cf46efe0d`, 2026-08-02) have no npm/GitHub-Release counterpart; provenance unknown; ignored as a surface.
4. Current OSS reality, stated honestly: mdbrain is **source-available and can connect to a separately self-hosted Memongo**, but **there is no supported integrated production distribution yet** (§7, §10).

## 1. Agreed thesis

**Mdbrain is a gateway/orchestrator over an independently deployed Memongo service, not a packager of Memongo.** Mdbrain owns: wiki/company-brain code, its own collections, identity (subject/group/capability perimeter), connectors, orchestration, UX, and the write-delivery machinery (§5). Memongo owns: the memory substrate behind its published API, its own database and prefix policy, its own release cadence.

- **Development** proceeds against published v2.0.0 with **declared weak delivery semantics** (§5: durable intent + single automatic dispatch + explicit unknown/dead-letter — not at-least-once).
- **Production release is blocked** until an independently published Memongo server artifact satisfies the production gate (§7), or the human explicitly accepts weaker production semantics (H4). This amendment is not authorization to change Memongo; whether to open a separate Memongo hardening/release task is the human's choice (H4).

## 2. Contract coverage (bound to the published artifact)

Lane A audited the published tag directly (`git show v2.0.0:<path>`; full tree in `git-ls-tree-v2.0.0.txt`): **43 HTTP routes** in `memongo@2.0.0:apps/api/src/routes/v1.ts` ↔ **43 published `@memongo/client@2.0.0` methods** — full route coverage. Local HEAD carries **42** routes (adds unpublished `/v1/write-events`; removes the two benchmark routes — `memongo:apps/api/src/app.test.ts:630-631` asserts their absence). Every published-contract claim here binds to that exact artifact; unpublished HEAD deltas are registered per-lane in the evidence files.

**Verdict: the core company-brain memory plane is covered by the published contract**, subject to the §5.7 audience restriction (critical) — search/search-detailed (recipes, `fusionMethod`, `sourcePreference`, evidence modes), write-event/write-structured/write-procedure/extract, lifecycle CRUD, consolidation, jobs, stats/status/probes, traces, access trends.

**Removed/deferred from mdbrain's product surface** (deliberate cuts, not gaps):

- `/add` — **removed from the supported production surface**; raw writes standardize on `/write-event` (§5.6).
- Runtime benchmark routes/tools (`/admin/relevance/benchmark`, `/admin/benchmarks/ingest`, `mdbrain_benchmark_ingest`, `mdbrain_relevance_benchmark`) — benchmark machinery stays offline in Memongo; already removed at Memongo HEAD. Mdbrain's company-brain eval spec (v5 §8, binding) is unaffected.
- Server-local `read-file` and `import/conversations` — removed/deferred from the public remote product unless a deployment explicitly mounts shared storage; never client-path semantics.
- Process-local bridge helpers (`getManager`, `shutdown`, `waitForBenchmarkSearchReadiness`) — explicit replacements per §3.
- The unused signed full-memory export (`mdbrain:packages/memory-bridge/src/mdbrain-export.ts`, zero app references) — deferred.

## 3. Engine deletion — actual disposal table

`mdbrain:packages/memory-engine` **is deleted with no hidden local fallback**. Bridge inventory: **46 async exports = 43 remote route adapters + 3 process-local helpers**; mdbrain's API carries **43 memory routes (benchmarks included) + 12 wiki routes (lint and revisions included)**; the route file invokes **44 bridge names (43 adapters + `getManager`)**. After the §2 cuts, retained adapters = **38** (43 − relevanceBenchmark − benchmarkIngest − readFile − importConversations − add).

| Item | Action | Replacement / owner | Verification |
| --- | --- | --- | --- |
| `packages/memory-engine/**` (src, tests, package) | **remove** (git history is the archive) | — | repo-wide import check: zero `@mdbrain/memory-engine` hits AND zero relative `packages/memory-engine/src/**` imports |
| `packages/memory-bridge/src/mdbrain-bridge.ts` (1249 LOC) | **rewrite** | thin adapter over mdbrain-owned transport (§4.4); 38 retained adapters; public signatures preserved where apps consume them | apps/api + apps/mcp compile; adapter-contract tests against recorded v2.0.0 fixtures |
| `getManager` helper | **remove** | wiki-owned `MongoClient` (rows below) | wiki routes pass with no engine import |
| `shutdown` helper | **remove** | explicit wiki-client `close()` in API lifecycle | shutdown test: client closed |
| `waitForBenchmarkSearchReadiness` | **remove** | — (zero non-test callers) | grep zero |
| `packages/memory-bridge/src/mdbrain-export.ts` | **remove/defer** | — | grep zero references |
| `packages/mdbrain-memory` (published as **`@mdbrain/memory`**) | **repoint or deprecate** (H6) | re-export new bridge + wire types | publish dry-run |
| `packages/wiki-engine/package.json` dep `@mdbrain/memory-engine` | **remove** (stale manifest entry; zero src imports — verified 2026-08-13) | — | `bun install` clean; wiki tests pass |
| `wiki-engine` `getWikiDbHandle(manager)` duck-typing (`wiki-bridge.ts:229-248`) | **rewrite** | mdbrain-owned `MongoClient`/`Db` from `MDBRAIN_MONGODB_URI`; `ensureWikiSchema` called by mdbrain itself | wiki integration tests against own DB |
| `scripts/prepare-mongodb-runtime.ts` | **rewrite** | wiki schema/collections only (imports `mongodb` directly today); Memongo bootstraps its own schema on its own DB | dry-run on fresh cluster |
| `scripts/check-mongodb-runtime-parity.ts` | **rewrite** | wiki-side schema/index verification only | CI job green |
| `scripts/mongodb-cluster-preflight.ts` | **rewrite** | wiki-DB preflight only | CI job green |
| `scripts/real-capability-stress.ts` | **remove/archive** | exercises engine internals directly — imports `@mdbrain/memory-engine` AND relative `packages/memory-engine/src/{backend-config,mongodb-kb,mongodb-scope}.ts` (verified 2026-08-13); a full HTTP rewrite is possible but not justified for a stress harness | grep zero engine imports |
| `scripts/memory-eval-core.ts` (+ `.test.ts`) | **rewrite/relocate** | imports engine fixtures via relative `packages/memory-engine/src/test-helpers/memory-eval-fixtures.js` (verified); eval fixtures relocate to an mdbrain-owned test-fixtures module; suite stays HTTP-level via `@mdbrain/client` | eval suite green against gateway |
| `scripts/mdbrain-init.ts` | **rewrite** | consumes `mdbrainBridgeGetManager` (verified :11,:84) → wiki-owned client; Memongo bootstraps itself | init on fresh cluster |
| `scripts/mdbrain-migrate.ts` | **rewrite** | consumes `mdbrainBridgeGetManager` (verified :8,:57) → wiki-owned client | migration tests green |
| `scripts/real-memory-eval.ts`, `compare-memory-eval.ts`, `real-agent-smoke.ts`, `proof-pack.ts`, `stress-test.ts` | **retain** | HTTP-level via `@mdbrain/client` (verified for the first four; stress-test to be confirmed HTTP-only at implementation) | run against gateway |
| `scripts/check-docs-integrity.mjs`, `validate-mintlify-build.mjs`, `proof-artifacts.ts`, `proof-pack-baseline.ts` | **retain** | docs/artifact tooling, no engine coupling | CI green |
| `apps/api/src/server.ts:28` shutdown hook | **repoint** | close wiki client | lifecycle test |
| `apps/api/src/routes/v1.ts` memory routes | **rewrite** | tenant-facing subset per §5.6/H6 table; admin/agent-global removed from tenant surface (§4.3) | route-inventory test matches approved table |
| `apps/mcp` memory tools | **rewrite** | same subset; drop benchmark/read-file/import tools; `extract` per §7.2 classification | MCP tool-list test |
| Root `package.json` workspaces, `turbo` graph, `bun.lock`, `check-publishability` | **update/regenerate** | — | clean install + publish dry-run |
| Engine docs/tests references | **remove/archive** | — | grep zero |

Duplicated engine fallback is forbidden at every row. The final repo-wide check covers BOTH the package specifier and relative engine source paths.

## 4. Identity, tenant security, and transport

Memongo's published auth model (Lane B, byte-identical published↔HEAD): root key + env-provisioned scoped keys (`{token, agentIds?, scopes?, scopeRefs?}`), the 403 tenant floor on caller-supplied `(agentId, scope, scopeRef)` tuples, admin/agent-global route classes. **There is no end-user authentication, no on-behalf-of token, no read-only key type.** Memongo is a trusted-subsystem tenant floor, nothing more.

1. **Mdbrain is the subject/group/capability perimeter.** Mdbrain authenticates subjects/groups/capabilities against its decided server principal and **mints** `agentId`/`scope`/`scopeRef` server-side. Caller-supplied scope fields are never forwarded. The Memongo credential is an internal gateway/service credential, never an end-user token.
2. **No root key for ordinary traffic.** Each mdbrain tenant maps to a concrete Memongo scoped credential/deployment with constrained `agentId`/`scopeRef` allow-lists; for the strongest floor, a tenant-dedicated Memongo deployment or an exact scopeRef key list — wildcards only inside a tenant-isolated deployment. The root/admin credential is provisioned separately and never appears in request paths.
3. **Admin/agent-global routes are never tenant-facing.** Control-plane-only consumers (status/stats/sync/probes/jobs/traces/chain-trace/self-edit/relevance explain/report/sample-rate/access trends/summaries) use a separate admin credential, a private network path, an explicit admin capability, and an audit log. Per-route classification lands in the H6 table (§11).
4. **Transport is mdbrain-owned.** The published `@memongo/client` cannot abort requests (no timeout/AbortSignal at v2.0.0, `client.ts:112-137`) and blindly retries non-idempotent writes (`client.ts:91-93,106-137`). Runtime transport is **mdbrain-owned direct `fetch` over the published wire contract** with real `AbortSignal` deadlines, runtime response-schema validation, and a per-operation retry policy (contract-safe retries: reads and keyed upserts only). `@memongo/client`/`@memongo/lib` may supply **reference types only — never the transport**. No `@memongo/memory-engine` or `@memongo/memory-bridge` packages in mdbrain.
5. **Memory ACL partitioning — scoped to immutable-audience memory only** (see §5.7 for the critical restriction). For memory whose audience is immutable (tenant-wide or user-partitioned at write time), mdbrain derives scopeRef partitions server-side: base tenant-visible partition plus namespaced audience partitions. Search fans out `/search-detailed` only across partitions the principal may read, capped (§6.7), then fuses/dedups.
6. Security consequence stated plainly: **a bug in mdbrain's scope/partition-minting logic is a cross-tenant memory leak with no floor below the per-tenant credential.** The v5 P0 security program remains P0 and binding.

## 5. Write path, delivery semantics, promotion, and consistency

1. **Promotion boundary (load-bearing):** Memongo has no published change feed, list, or fetch-by-event-ID. Every promotable memory write **MUST** pass through the mdbrain gateway/outbox. Direct Memongo clients are not exposed in an integrated deployment; bypassing writes are memory-only and cannot be guaranteed to enter the company wiki.
2. **Delivery semantics, stated exactly: durable intent + single automatic non-idempotent dispatch + explicit unknown/dead-letter outcome.** Not at-least-once. Two separate transition tables:

   **v2 development (published contract):**

   | Event | Transition | Retry? |
   | --- | --- | --- |
   | Row persisted (canonical payload + identity + ACL + hash + mdbrain idempotency key) | → `pending` (intent claim only) | — |
   | CAS marker durable BEFORE socket opens | `pending` → `dispatch_started` | — |
   | Failure BEFORE the marker | stays `pending` | ✅ retryable |
   | Confirmed receipt | → `delivered` (eventId persisted) | terminal |
   | Definitive rejection | → `rejected`/dead-letter | terminal |
   | Timeout / process death / lease expiry AFTER the marker | → `unknown` | ❌ **terminal; NEVER re-`pending`, NEVER auto-redispatched** |

   **Production (only once the §7.1 idempotent contract exists):**

   | State | Recovery |
   | --- | --- |
   | `unknown` | recoverable by **automatic bounded same-key replay** (recommended over operator-manual): the contract returns either the original persisted receipt (→ `delivered`) or a stable conflict (→ dead-letter + alert). Replay is bounded by attempts/deadline and itself lease-fenced. |
   | crash fixtures split | crash-before-marker (safe retry) vs crash-after-marker-before-socket vs after-server-commit vs after-response-before-receipt-persistence — each a named fixture |

3. **Outbox machinery:** leases with fencing tokens, ordering key, attempt counters, poison/dead-letter, retention, crash recovery on restart. Kill-test matrix (mandatory fixtures): crash before send; after marker before socket; during upload; after server commit but before response; after response but before receipt persistence; concurrent-relay lease contention.
4. **Promotion identity (the current Dreamer is explicitly NOT idempotent and must be replaced/tested):** unique `promotionKey = tenant/workspace + canonical ingress intent ID + transform version` persisted on the outbox row, with the chosen target page slug; after a **delivered** receipt, the wiki page/claim lineage + promotion status mutate atomically; a replayed delivery is a **true no-op**; an `unknown` delivery **never claims lineage**; no composite lineage dedup until a receipt exists.
5. **Revision atomicity (locked decision):** wiki page + revision commit atomically in the same mdbrain-side transaction. Current code violates this — session-less best-effort revision calls at `mdbrain:packages/wiki-engine/src/wiki-bridge.ts:411-419` (create), `681-689` (update), `728-736` (delete); `recordWikiPageRevision` takes no session and never throws (`wiki-revisions.ts:36-75`). Fix is mdbrain-side. **Production additionally requires a successful live transaction probe at startup — NO standalone-MongoDB fallback for page+revision+outbox.** The coded degradation in `okf.ts` (error codes 20/263) is development-only.
6. **Development tenant write surface (published contract):** `/write-event` (single dispatch), keyed `/write-structured`/`/write-procedure`, governed lifecycle ops. **All other mutators are control-plane at-most-once/manual or removed** — never tenant-proxied (§7.2, H6 table).
7. **CRITICAL audience restriction on events (published contract):** `/lifecycle/delete` accepts only **structured/procedure stable handles** ("handle must be a valid structured/procedure stable handle", `memongo@2.0.0:apps/api/src/routes/v1.ts:1026` region) — **event receipts cannot be invalidated or deleted** on v2.0.0. Therefore, for published-v2 development:
   - **Mutable-ACL connector content is PROHIBITED from Memongo events.** GitHub/Slack source content stays **mdbrain wiki-only** (wiki governance, soft delete, and revisioning are native mdbrain-side).
   - Memongo v2 receives only memory whose **audience is immutable at write time** — tenant-wide or user-partitioned. There is **no repartition protocol for events**; the earlier §5.7 repartition design is deleted as impossible on the published surface.
   - Structured facts/procedures (keyed, lifecycle-addressable) MAY carry partition semantics, since lifecycle invalidation works for them.
8. **Write ordering:** wiki page first (durable, atomic-with-revision after the fix), outbox enqueue in the same transaction, relay performs the §5.2 single dispatch. Compensation for keyed items uses published lifecycle invalidation (`invalidatedBy`); events have no compensation path on v2.0.0 (§5.7). Wiki-side soft delete is native.
9. **Consistency documentation:** two independent single-store writes with mdbrain-side sequencing, outbox, and compensation; wiki-from-memory eventually consistent, bounded by maintenance cadence.

## 6. Composite reads

1. **Primary composite plan:** ONE Memongo `/search-detailed` call per allowed ACL partition (§4.5, immutable-audience partitions only) + one mdbrain-local wiki search. A global deadline budget spans all legs; overlapping `/search` + `/search-kb` + detailed calls are avoided.
2. Parallel `Promise.allSettled` fanout — one failed leg degrades, never blanks the response. Per-leg `AbortSignal.timeout` deadlines (§4.4).
3. **Rank-based fusion (RRF)** across services. **Lineage dedup before final rank only on proven join keys** (`sourceEventIds`/`sourceMemId`); if lineage is unavailable for a result pair, **do not merge or boost** — return both with explicit per-source provenance.
4. Wiki governance applied **before and after** fusion, with over-fetch + fill target; governance stays mdbrain-owned.
5. Provenance/citation assembly mdbrain-side for wiki results; Memongo's published provenance fields propagated, not flattened.
6. **Response states, defined:** `complete`; `partial` (result-bearing leg failed, another succeeded); `degraded` (quality/optional feature failed — usable); **all required legs failing → non-2xx 503, never empty 200**. Per-leg sanitized status/code/deadline. Governance-filtered zero IS a genuine empty. Wiki swallow sites (`mdbrain:packages/wiki-engine/src/wiki-search.ts:329-335, 391-394, 446-448`) must honor this.
7. **Partition-cap overflow:** exceeding the ACL fanout cap is an explicit non-success — fail closed with **`ACL_PARTITION_LIMIT_EXCEEDED`**, no composite answer, never `complete`.
8. Failure classification: `error.code` + status only; published 500 bodies leak raw driver messages and 503 does not exist at v2.0.0 — mdbrain never parses `error.message` for control flow.

## 7. Production gate (cumulative — necessary AND not sufficient alone)

Production release of an mdbrain-integrated deployment is **blocked** until ALL of the following hold. Items 1–6 are Memongo-artifact requirements (satisfied only by an independently published Memongo release); items 7–12 are mdbrain-side; the retained v5 gates (§12) are cumulative on top.

1. **Idempotent event write + exact reconciliation, specified exactly:** uniqueness namespace = operation + tenant + agent/scope identity + caller key. Canonical fields hashed AFTER server-owned normalization and scope resolution: operation, tenant/agent/scope/scopeRef, role, body, sessionId, timestamp (resolved once and persisted), validAt/invalidAt, metadata as canonical JSON. **Atomic key reservation + event insert.** Same key + same intent → byte/field-stable **original persisted receipt**. Same key + different intent → `409 IDEMPOTENCY_CONFLICT`. In-progress duplicate → `409 IDEMPOTENCY_IN_PROGRESS` + bounded `Retry-After`. Retention ≥ **30 days AND ≥ max(outbox retention + recovery SLA)**. Fixtures: omitted-timestamp/default persistence; explicit-timestamp mismatch; metadata reorder; concurrent first requests; lost response; cross-tenant key reuse; receipt equality; in-progress race. Read-by-eventId required only if replay receipts do not provide exact reconciliation.
2. **Event invalidation for mutable-ACL memory (only if production wants connector memory in Memongo):** authenticated, tenant-scoped, idempotent event invalidation/delete by stable event ID, with original-receipt/replay semantics, and fixtures proving old-partition copies disappear. **Until such a contract exists, §5.7's prohibition stands and ACL partitioning applies only to immutable-audience memory.**
3. **Mutator classification:** tenant product supports only `/write-event`, keyed structured/procedure writes, and governed lifecycle ops. `/extract` is **tenant orchestration only after a confirmed event receipt, single dispatch, no auto-retry in v2**; production requires exact job idempotency or it stays control-plane. `/memory/feedback`, `/procedures/outcome`, `/sync`, `/consolidate`, `/novelty-scan`, `/chain-trace`, `/self-edit`: mdbrain-owned orchestration or control-plane at-most-once/manual, no auto-retry, never tenant-proxied. Exact table: H6 (§11).
4. **Meaningful readiness:** Mongo connectivity, required named text/vector indexes queryable, embedding provider/model readiness, mandatory reranker (HEAD's `/ready` lacks a live search-index signal even at HEAD, `readiness.ts:14-18`).
5. **Immutable, authentic deployable artifact:** independently published Memongo server artifact with source commit, content digest, SBOM, supported API contract, **verified signed attestation** binding digest + source commit + Memongo-owned build recipe + builder identity + SBOM digest; trusted signer/issuer allowlist; deploy **fails closed** on mismatch. Production deployment is never source-built; an mdbrain-owned Dockerfile never qualifies.
6. **Version gate:** artifact digest + allowlisted normalized OpenAPI/required-operation-set hash + runtime schema/contract smoke fixtures. The `info.version="1.0.0"` fingerprint is **rejected** (hardcoded bug, `openapi-spec-v200.ts` `:637-638`).
7. **Live mdbrain transaction probe** at startup (no standalone fallback, §5.5) and **mdbrain wiki named-index readiness**.
8. **Distinct least-privilege MongoDB principals** for `mdbrain` vs `memongo`, with cross-denial **negative fixtures covering: read, write, create/drop/rename collection, create/drop index, validator/schema change, and DB/user/role administration** — each principal retains only the privileges its own DB requires (transactions, index management on its own collections).
9. **Outbox proof fixtures:** §5.3 kill-test matrix; lease fencing/concurrent relay; `unknown` never redispatched (dev semantics); same-key replay (production semantics); no duplicate wiki mutation on replay; outbox backup/restore and backlog recovery.
10. **ACL fixtures:** immutable-audience partition enforcement; §5.7 prohibition (connector content never enters events); §7.2 invalidation fixtures when that contract exists; §6.7 partition-cap overflow; ACL-leakage fixtures on both direct memory reads and promoted wiki pages.
11. **Gateway-only ingress:** network policy enforces that only the mdbrain gateway can reach the Memongo service; the Memongo URL/credential is never exposed to tenants.
12. **Integrated readiness:** mdbrain wiki DB + indexes, the §7.5/§7.6 Memongo gate, credential-class verification (scoped, not root), outbox persistence, relay status/backlog thresholds.

Until then: development against v2.0.0 per §1; mdbrain remains pre-production.

## 8. Topology

The v5-era "shared topology in the mdbrain namespace" decision was made under package-dependency assumptions and is **superseded by service ownership**; it goes back to the human (H1). Recommendation:

- **T1 (recommended default, OSS/pilot): one physical cluster, two logical databases.** Memongo owns database `memongo` + its version-supported prefix policy (published v2.0.0 default: per-agent `memongo_<agent>_`; deploy-time `MEMONGO_*` env on the Memongo service is ops, allowed). Mdbrain owns database `mdbrain` (wiki + outbox/operational collections). T1 requires the §7.8 distinct least-privilege principals, ownership documentation, and separate backup/quota/restore policies per database. Mdbrain never reads/writes Memongo-owned collections at runtime.
- **T2: two clusters** — managed/enterprise scaling-and-isolation option, not the first default.
- **Wiki collection layout:** a **flat shared company wiki** (single `mdbrain_` wiki prefix) is correct ONLY under the formal invariant: `scopeRef` is a globally namespaced tenant/workspace key minted server-side, and a `(scope, scopeRef, slug)` collision across agents in the same workspace is **intended shared knowledge**, enforced at every CRUD/index/search/governance/outbox boundary. Otherwise per-agent wiki prefixes are retained. Recommendation: flat shared wiki under this invariant (H1 sub-question).
- Published-surface note: published v2.0.0's per-agent prefix default structurally mirrors mdbrain's current layout; the shared-prefix migration utility is HEAD-only. Cross-running both engines' schema initializers on one database remains forbidden (index-name tug-of-war, v5 §2.5).

## 9. Migration (clean-slate default)

- Default: **clean-slate cutover**. Old per-agent engine data is archived/dropped (rollback = restore archive). No fidelity migration is a release requirement (user-confirmed: no production users).
- Contingency (only on explicit later request): a one-time mdbrain-side utility may read/inspect old mdbrain collections directly; **all target writes go through the published Memongo API**; the per-row loss matrix (`laneD-topology-migration.md` §2) applies — event IDs, server timestamps, revision histories, KB docs, episode identity, and graph fidelity are NOT preservable through the published v2.0.0 API; each row would be an explicit accepted-loss or blocker decision at that time.

## 10. OSS distribution and managed control plane

1. **OSS mdbrain accepts an externally supplied `MEMONGO_API_URL` + credential.** No source clone/build of Memongo inside mdbrain. A one-command joint compose becomes available only when Memongo independently publishes an immutable runnable artifact. Today **no image was found in audited sources** (GitHub Releases v2.0.0 zero assets; Docker Hub orgs/site-search empty; GHCR anonymous probe 401 — **not exhaustively verified**; captures `container-registry-probes-2026-08-13.txt`, accessed 2026-08-13) and v2.0.0 ships no `apps/api/Dockerfile` (`git-ls-tree-v2.0.0.txt`). The Lane D compose sketch is a rejected/non-production H5 alternative (marked in the evidence).
2. **Managed control plane** (locked OSS-core decision): every managed capability — connector ops, identity/ACL sync (deploy-time provisioning; no runtime key-minting API exists at 2.0.0), observability (composed from `/health` + `/v1/probes/*` + `/v1/status*` + `/v1/jobs`), upgrades (plane-side artifact pins), enterprise onboarding — is implementable with mdbrain-side code plus the published surface (Lane E §E.3). Runtime key-minting via API, if ever required, would be a service-boundary blocker — flagged, not designed-for.
3. §7 is cumulative with the retained v5 gates (§12); neither alone is sufficient.

## 11. Open human decisions (H1–H6)

- **H1 — Topology:** T1 (one cluster, two DBs — recommended) vs T2 (two clusters)? Flat shared company wiki under the §8 invariant (recommended) vs retained per-agent wiki prefixes?
- **H2 — Migration:** confirm clean-slate default; any local dev data worth preserving?
- **H3 — Development timing:** proceed now against published v2.0.0 with §5 weak delivery semantics AND the §5.7 audience restriction, or hold integration until §7 ships?
- **H4 — Minimum-contract ownership:** open a **separate Memongo hardening/release task** later (owner, deadline), or let mdbrain remain pre-production until that artifact appears? Alternative: explicitly accept weaker production semantics.
- **H5 — OSS distribution:** externally supplied `MEMONGO_API_URL` only (recommended) vs mdbrain-owned build-from-tag Dockerfile for OSS convenience (weakens the boundary; never production) vs wait for the immutable artifact?
- **H6 — Surface cuts and route classification.** Proposed exact table:

| Route (published v2.0.0) | Tenant product | Classification |
| --- | --- | --- |
| `/search`, `/search-detailed`, `/search-kb`, `/recall-conversation` | ✅ via gateway, governed | tenant read |
| `/write-event` | ✅ standardized raw write, single dispatch; immutable-audience only (§5.7) | tenant write |
| `/write-structured`, `/write-procedure` | ✅ keyed upserts | tenant write |
| `/lifecycle/get`, `/lifecycle/update`, `/lifecycle/delete`, `/lifecycle/history` | ✅ governed; delete/update reach structured/procedure handles only | tenant write |
| `/profile`, `/context-bundle`, `/hydrate-active-slate`, `/discovery-projection` | ✅ via gateway | tenant read-compose |
| `/extract` | ✅ tenant orchestration ONLY after a confirmed event receipt; single dispatch, no auto-retry in v2; production requires exact job idempotency or reclassifies control-plane | tenant orchestration (conditional) |
| `/add` | ❌ removed/deferred | §2 cut |
| `/memory/feedback`, `/procedures/outcome` | ❌ tenant | mdbrain-owned orchestration, at-most-once, no auto-retry |
| `/sync`, `/consolidate`, `/novelty-scan`, `/self-edit`, `/chain-trace` | ❌ tenant | control-plane manual/at-most-once |
| `/status`, `/status/detailed`, `/stats`, `/state`, `/probes/embedding`, `/probes/vector`, `/jobs`, `/jobs/:jobId` | ❌ tenant | control-plane observability |
| `/admin/relevance/explain`, `/admin/relevance/report`, `/admin/relevance/sample-rate`, `/admin/access-trends`, `/admin/access-summaries`, `/admin/traces`, `/admin/traces/:traceId` | ❌ tenant | control-plane only |
| `/admin/relevance/benchmark`, `/admin/benchmarks/ingest`, `/read-file`, `/import/conversations` | ❌ removed/deferred | §2 cuts |
| `/write-events` (batch) | ❌ | unpublished at v2.0.0 — do not depend |

  Plus: confirm benchmark MCP tools removal and the `@mdbrain/memory` repoint-vs-deprecate call.

## 12. v5 supersession matrix (actual headings)

| v5 section | Status |
| --- | --- |
| §1 Executive thesis | **replaced** (integration-boundary portion by §1 here; the evidence-based problem statement stands as historical) |
| §2 Evidence ledger (2.1–2.7) | **historical** (evidence record; substrate facts unchanged) |
| §3 Corrected claims (3.1–3.4) | **historical** |
| §4 Option A (copy-porting) | **historical** (rejection stands) |
| §4 Option B (package dependency, CHOSEN) | **replaced** by §1 service boundary (user decision) |
| §4 Option C + falsification triggers | **historical** (moot under service boundary) |
| §5.1 Compatibility layer rules | **removed** (human decision: clean cut) |
| §5.2 WikiStorageProvider contract | **replaced** — wiki gets its own mdbrain-owned client (§3); no storage contract with Memongo exists |
| §5.3 Release preconditions (npm cohort) | **replaced** by §7.5 artifact authenticity (mdbrain needs a server artifact, not npm engine packages) |
| §5.4 Config boundary | **replaced** by §4.4 (mdbrain-owned transport; Memongo's env is its own ops) |
| §5.5 Ownership map | **replaced** by §1 service ownership split |
| §6.1 P0 mdbrain security (6.1.1–6.1.8) | **binding** — unchanged; now also the §4.1/§4.5 minting + partition source |
| §6.2 P0 Memongo invariants (consume via pinned release) | **replaced** — consumed via the §7 service contract, not a pinned package |
| §6.3 P0 OKF blockers | **binding** (human decision #1: P0 release gates) |
| §6.4 P1 — maintenance route no-op; connectors stubbed; web console get/list-only; reranker no-reorder; minScore/swallowed errors; GraphRAG/rerank library-only; no live E2E | **binding** (mdbrain-side product truth) |
| §6.4 P1 — connector credential exposure (raw tokens in context) | **binding** — secret-provider/private-credential requirement + redaction tests |
| §6.4 P1 — "Memongo-side P1 inherited with the release" (shared-client lifecycle/single-flight/shutdown; executable API/MCP contracts; batch writes; MCP extract; client retries; temporal/reasoning/typed edges via wiki governance) | **replaced** — nothing is "inherited" from a package under the service boundary: shared-client lifecycle is Memongo's internal concern (historical); API/MCP contracts bind only where gateway-relevant (H6 table); batch writes removed (unpublished); MCP extract classified per §7.3; client retries replaced by mdbrain-owned direct fetch (§4.4); temporal/reasoning/typed-edge behavior lives behind the Memongo service and enters the wiki only through mdbrain governance (binding in that form) |
| §6.5 P1 benchmark evidence discipline | **deferred** — mdbrain's own eval spec (v5 §8) is binding; Memongo's benchmark publication is Memongo's roadmap |
| §6.6 P2 | **binding** |
| §7.1 Topology decision gate | **replaced** by §8 + H1 |
| §7.2 Migration API precondition | **replaced** — clean-slate §9; no schema migration |
| §7.3 Data-migration ledger reconciliation | **deferred** — contingency only (§9) |
| §7.4 Shadow evaluation | **removed** — no dual-run under clean-slate service cutover |
| §7.5 Cutover procedure | **replaced** by §9 + the §7 production gate |
| §7.6 Rollback | **replaced** — clean-slate rollback = restore the archive |
| §8 Company-brain eval gate requirements | **binding** — mdbrain-owned; cumulative with §7 here |
| §9 OKF conformance matrix | **binding** (P0 per human decision #1) |
| §10 Product journeys | **binding** (Ask surface explicitly composite per §6) |
| §11 Non-goals | **binding** (+ §13 here) |
| §12 Open human decisions | **replaced** — resolved decisions recorded; remaining reframed as H1–H6 (§11) |

## 13. Explicit non-goals (binding)

Not building: a general BI/warehouse layer, a public plugin marketplace, a Notion-style block editor, identity-provider/RBAC administration, or a generic ETL platform. Plus: no Memongo source modification, no mdbrain packaging/bundling of Memongo internals, no local engine fallback, no automatic retry of non-idempotent writes, no "exactly-once" claims, no tenant-facing admin proxies, no mutable-ACL connector content in Memongo events before the §7.2 contract, no production release before §7 + the retained v5 gates.

---

*v4 written 2026-08-13 after the third 3/3 BLOCK fresh review (14 findings). Critical correction: published v2.0.0 cannot invalidate event receipts (lifecycle handles are structured/procedure-only, verified at the tag), so mutable-ACL connector content is prohibited from Memongo events during v2 development and the event repartition protocol is deleted. Raw lanes A/C/D/E corrected in place. Status remains draft pending a fourth fresh 3-axis review.*
