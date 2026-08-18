# LANE D — TOPOLOGY, MIGRATION, OSS COMPOSE

Date: 2026-08-13. Repos: mdbrain = /Users/rom.iluz/Dev/mdbrain @ 1b7e234; memongo = /Users/rom.iluz/Dev/memongo @ HEAD 8833026c0c (2.0.1 unpushed), PUBLISHED = tag v2.0.0 (bdad0fbf28) = npm @memongo/*@2.0.0 (dist-tag `latest=2.0.0` verified against registry 2026-08-13).
Evidence labels: [SUBSTRATE-FACT] code-verified with cite; [EXTERNAL-SPEC]; UNSUPPORTED.

> ⚠️ Prior lane docs (lane1/lane3, absorb-doc §2.5/§7.1) characterized memongo's prefix default from **HEAD** (shared `memongo_`). Auditing the **published tag** changes the picture materially — see §0.

---

## 0. Critical published-vs-HEAD deltas this lane relies on

1. **Collection-prefix default.** Published v2.0.0 defaults to **per-agent** `memongo_<agent>_` (memongo:packages/memory-engine/src/backend-config.ts:221-226 @ v2.0.0, `git show v2.0.0:...`). The **shared** `memongo_` prefix (`DEFAULT_MONGODB_COLLECTION_PREFIX = "memongo_"`) and the `scripts/migrate-to-shared-prefix.ts` utility are **HEAD-only (2.0.1, unpublished)**: HEAD memongo:packages/memory-engine/src/backend-config.ts:175,282-293; `git ls-tree v2.0.0 scripts/` contains no migrate-to-shared-prefix.ts. Consequence: published memongo's physical layout `memongo.memongo_<agent>_<suffix>` is a **structural mirror** of mdbrain's `mdbrain.mdbrain_<agent>_<suffix>` — the "migrate every tenant into a shared prefix" problem described in absorb-doc §7.1 does not exist against the published surface. [SUBSTRATE-FACT]
2. **Idempotency keys / batch writes / TTL.** `git grep -l idempotencyKey v2.0.0 -- packages/ apps/` = **empty**. Published /v1/write-event accepts only role/body/sessionId/timestamp/validAt/invalidAt/metadata/scope/scopeRef (memongo:apps/api/src/routes/v1.ts:1530-1605 @ v2.0.0). `idempotencyKey`, `expiresAt`, and the `/v1/write-events` batch route with per-item receipts are **HEAD-only** (memongo:apps/api/src/routes/v1-write-routes.ts:98-197,200 @ HEAD). [SUBSTRATE-FACT]
3. **No API container story at v2.0.0.** `apps/api/Dockerfile` and `docker/compose.yaml`/`compose.override.yaml` exist only at HEAD. v2.0.0 ships only mongodb-side compose: `docker/docker-compose.yml` is a **symlink** (git mode 120000) → `docker/mongodb/docker-compose.preview.yml` (image `mongodb/mongodb-atlas-local:preview`), plus `docker/docker-compose.minimal.yml` (plain `mongo:7`). [SUBSTRATE-FACT]
4. **Health endpoints.** v2.0.0 API exposes only `/health` (liveness, no Mongo check) (memongo:apps/api/src/app.ts:632 @ v2.0.0). `/ready` is HEAD-only (memongo:apps/api/src/app.ts:679 @ HEAD). [SUBSTRATE-FACT]
5. **Registry anomaly (flag, not resolved).** GitHub tags v2.1.0/v2.1.1 exist publicly (docs/research/evidence/2026-08-13/github-memongo-releases-tags-2026-08-13.txt, tags section) but npm has only 1.1.0 and 2.0.0 and GitHub Releases only v1.1.0/v2.0.0. Audit target remains v2.0.0; the v2.1.x tags' provenance is unknown from available evidence. UNSUPPORTED (provenance).

---

## 1. Topology re-examination (goes back to the human)

### Current state [SUBSTRATE-FACT]

- mdbrain: database `mdbrain` default, per-agent prefix `mdbrain_<agent>_` (mdbrain:packages/memory-engine/src/backend-config.ts:221-227). Wiki collections ride the **same per-agent prefix**: `${prefix}wiki_pages`, `${prefix}wiki_revisions` (mdbrain:packages/wiki-engine/src/wiki-schema.ts:33,469), obtained by duck-typing the memory manager's private `db`/`prefix` (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:229-248).
- memongo published: database `memongo` default, per-agent prefix `memongo_<agent>_`, both overridable by `MEMONGO_MONGODB_DATABASE` / `MEMONGO_MONGODB_COLLECTION_PREFIX` at deploy time (memongo:packages/memory-engine/src/backend-config.ts:220-226 @ v2.0.0; env override at :179). Deploy-time `MEMONGO_*` on the memongo service is ops, allowed.
- memongo keeps manager `client/db/prefix` **private** (memongo:packages/memory-engine/src/mongodb-manager.ts:2056-2058 @ v2.0.0) — under the service boundary mdbrain cannot source a wiki Db handle from the memongo service at all; wiki needs an mdbrain-owned MongoClient.

### Options presented for human decision

**Option T1 — One cluster, two databases (RECOMMENDED DEFAULT).**
One MongoDB 8.x deployment (atlas-local or Atlas). memongo service owns database `memongo` (+ its own prefix policy, ops-set). mdbrain owns database `mdbrain` containing **only** `wiki_pages`/`wiki_revisions` under a fixed mdbrain-side prefix (e.g. `mdbrain_` flat, or keep `mdbrain_<agent>_`).

- Migration consequences: memory data moves via published API (§2). Wiki data **does not move** if today's wiki already lives in db `mdbrain` — only the Db-handle source changes (mdbrain-owned client instead of duck-typing the manager). If per-agent wiki collections exist (`mdbrain_<agent>_wiki_pages`), a one-time mdbrain-side `renameCollection`/copy+drop consolidates or keeps them — mdbrain-owned collections, mdbrain's choice, no boundary crossing.
- Cost: one backup/restore/index-tuning pipeline. Risk: both services share failure domain and resource contention; cross-running both engines on the same database is still forbidden (index-name tug-of-war documented in lane3 §4: uq_kb_* rename divergence).

**Option T2 — Two clusters.**
memongo+its DB on cluster A; mdbrain wiki DB on cluster B.

- Migration consequences: identical data movement to T1, plus a second connection string everywhere. Strongest blast-radius isolation and independent scaling/backup; double infra cost and operational surface; wiki Db-handle question unchanged.

**Option T3 — Full rename of mdbrain's retained namespace (wiki-only DB renamed, e.g. `mdbrain_wiki`, flat `wiki_` prefix).**

- Migration consequences: pure downside vs T1 — every wiki collection must be copied/renamed, every environment's `MDBRAIN_MONGODB_DATABASE` changes, and there is no compensating benefit because under the service boundary the wiki namespace is entirely mdbrain-internal. Only worth doing if the human wants a clean-slate naming signal pre-product.

**Locked-decision re-examination verdict:** the "mdbrain DB + `mdbrain_` prefix" lock was made when mdbrain's engine owned everything. Under the service boundary the decision **shrinks in scope but survives**: mdbrain keeps its DB/prefix for exactly the two collections it still owns (wiki_pages/wiki_revisions); all per-agent memory collections are **retired** after migration (their content lives in memongo-managed `memongo_<agent>_*`). The open sub-question for the human: keep per-agent wiki prefixes (`mdbrain_<agent>_wiki_*`) or consolidate to a single `mdbrain_` wiki prefix during the same cutover — consolidation is a one-time mdbrain-side rename with zero service-boundary impact. This matches absorb-doc §7.1 open question #2 (mdbrain:docs/research/2026-08-13-memongo-absorb-company-brain.md:300).

---

## 2. Migration fidelity matrix — published @2.0.0 API only

One-time mdbrain-side utility: reads `mdbrain.mdbrain_<agent>_*` directly (allowed; mdbrain manager `db` is TS-private but runtime-reachable, mdbrain:packages/memory-engine/src/mongodb-manager.ts:1985 — a plain MongoClient is cleaner). ALL target writes via `@memongo/client@2.0.0` HTTP. Client env: `MEMONGO_API_URL`, `MEMONGO_API_KEY` (memongo:packages/client/src/client.ts:77,82 @ v2.0.0).

| Artifact | Published write path | IDs preserved? | Timestamps preserved? | Idempotent re-run? | Verdict |
| --- | --- | --- | --- | --- | --- |
| Events | `POST /v1/write-event` (v2.0.0 v1.ts:1530-1605) | **NO** — route/bridge/client accept no `eventId`; engine would accept one (memongo:packages/memory-engine/src/mongodb-events.ts:132-202 @ v2.0.0, upsert on `{eventId}` with `$setOnInsert`) but the manager forces `randomUUID()` even at HEAD (memongo:packages/memory-engine/src/mongodb-manager-write.ts:123 @ HEAD) | **YES** for `timestamp`/`validAt`/`invalidAt`; `recordedAt` is server-stamped `new Date()` (mongodb-events.ts:150 @ v2.0.0) — lost | **NO** — no `idempotencyKey` anywhere in v2.0.0 (§0.2); repost duplicates | (a) adapter: mdbrain-side ledger `oldEventId→newEventId` + `metadata.mdbrain_migrated_from` dedupe stamp. **Identity loss is a (c) service-boundary blocker** wherever old eventIds are referenced |
| Structured facts | `POST /v1/write-structured` → upsert keyed on `(agentId, scope, scopeRef, type, key)` (memongo:packages/memory-engine/src/mongodb-structured-memory.ts:645-800 @ v2.0.0) | `_id` NO; natural key (type+key) YES | `validFrom`/`validTo`/`lastConfirmedAt` YES (entry fields, mongodb-structured-memory.ts:78-117 @ v2.0.0); `createdAt`/`updatedAt` forced to server `now` (:710, :792) — **lost** | YES (natural-key upsert) | Content: (a) feasible. `createdAt`, `revision` counter, and **`structured_mem_revisions` history have no published write path → (c) blocker** unless human accepts loss (b) |
| Procedures | `POST /v1/write-procedure` | **YES** — `procedureId` is caller-supplied and is the upsert identity (memongo:packages/memory-engine/src/mongodb-procedures.ts:50-68,451+ @ v2.0.0) | `createdAt`/`updatedAt` server-stamped — lost; `ProcedureEntry` has no validFrom input | YES | (a) feasible for current-row content; revision history (`procedure_revisions`) (c) blocker unless accepted loss (b) |
| KB docs | **NONE published.** `ingestToKB`/`ingestFilesToKB` are engine-internal (memongo:packages/memory-engine/src/mongodb-kb.ts:98,457 @ v2.0.0); zero references in bridge/api/client at v2.0.0 (`git grep` empty). Only `/search-kb`, `/read-file`, `/sync` exist; `/sync` ingests **server-local workspace files** | — | — | — | **(c) BLOCKER.** Workaround-shaped escape hatch: drop source files into the memongo container's workspace + `POST /v1/sync` — requires filesystem coupling to the service and loses docIds/createdAt/hashes-as-originally-stored; only viable if KB is regenerable from source files (b) |
| Episodes | **NONE published.** `materializeEpisode` is derivation-only (memongo:packages/memory-engine/src/mongodb-episodes.ts:185,278 @ v2.0.0; `episodeId = randomUUID()`, stable only per `hashSourceEventIds`) | **NO** — and because eventIds change (row 1), the sourceEventIds hash changes, so re-derivation yields new episodeIds/membership | startedAt/endedAt re-derived from replayed event timestamps — semantically preserved | Re-consolidation on replayed events is hash-deduped (a) | Semantic content: (a) via replay + `POST /v1/consolidate`. **Episode identity + `consolidatedAt`/status history: (c) blocker** unless accepted (b) |
| Entity/relation graph | **NONE published at v2.0.0 OR HEAD** (route grep for entit/relation/graph returns only search-kb). `upsertEntity`/`upsertRelation` engine-internal (memongo:packages/memory-engine/src/mongodb-graph.ts:328,431 @ v2.0.0) | NO — entityIds minted during LLM extraction | firstSeen/createdAt server-stamped | Re-extraction via `POST /v1/extract` per replayed event | **(c) BLOCKER for graph fidelity.** Re-derivation is non-deterministic (LLM extraction) — not a fidelity-preserving migration, only a rebuild (b) if human accepts |
| Idempotency keys | mdbrain engine has none today (grep `idempotencyKey` in mdbrain engine = empty); memongo v2.0.0 API has none (§0.2) | n/a | n/a | n/a | Nothing to preserve. But the migration **itself** needs idempotency → mdbrain-side ledger is mandatory (a). HEAD's unpublished idempotencyKey cannot be relied on |
| Migration ledger | memongo has **no** migrations collection at v2.0.0 or HEAD (grep empty); mdbrain has `${prefix}migrations` `{_id, appliedAt}` (mdbrain:packages/memory-engine/src/mongodb-schema.ts:178-184) | n/a | n/a | n/a | (a): the new migration ledger (`oldId→newId` maps, per-collection checkpoints, counts/hashes for verification) is mdbrain-owned operational state — store it in mdbrain's wiki DB or a sidecar file. Never write it into memongo collections |

**Cross-cutting requirement:** because eventIds are not preservable, every stored `sourceEventIds` reference (structured facts, procedures, episodes, graph entities all carry them) must be rewritten through the `oldEventId→newEventId` ledger during migration. [SUBSTRATE-FACT]

**Bottom line for the human:** exact-fidelity migration is **not achievable** through the published @2.0.0 API for: event IDs, `recordedAt`/`createdAt`/`updatedAt` server timestamps, revision histories, KB docs, episode identity, and the graph. What IS achievable: full content migration of events (with timestamps), structured facts, and procedures (procedures with IDs intact), plus semantic rebuild of episodes/graph via replay. Each loss row above is either a (c) service-boundary blocker or a (b) consciously deferred/accepted loss — that choice is the human's, per-row.

---

## 3. OSS compose story (published artifacts only)

> ⚠️ SUPERSEDED 2026-08-13 (amendment v4, evidence finding 3): the compose sketch below is a **rejected/non-production H5 alternative** — an mdbrain-owned build-from-tag Dockerfile weakens the chosen project boundary and never qualifies for production (amendment §7.4 requires a Memongo-owned build recipe + signed attestation). The shipped OSS default is an externally supplied `MEMONGO_API_URL` (amendment §10.1). Retained below as analysis only. Production language in §4 that says "built from source" is likewise superseded — production requires the published immutable artifact.

### 3.1 Image availability — FINDING

- GitHub Releases v2.0.0: **zero assets** (docs/research/evidence/2026-08-13/github-memongo-releases-tags-2026-08-13.txt).
- Docker Hub: orgs `memongo` and `romiluz13` return `count: 0`; site-wide search for "memongo" returns only unrelated repos (queried 2026-08-13, hub.docker.com/v2). [EXTERNAL-SPEC]
- GHCR: anonymous probe returns 401; no packages are linked from the repo or releases — treated as **no published image**, with the caveat that GHCR cannot be exhaustively verified unauthenticated. UNSUPPORTED (exhaustiveness).
- v2.0.0 tag contains **no `apps/api/Dockerfile`** and no API compose service (§0.3, `git-ls-tree-v2.0.0.txt`); the API app is **not published to npm** (published packages per registry evidence: lib/memory-engine/memory-bridge/memory/client/tools — `npm-*.json` captures, accessed 2026-08-13) — so even npm yields no runnable server. ⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 3): original cited "v2.0.0 release notes" as the package-set source; corrected to registry evidence. GHCR caveat: anonymous probe returned 401 — NOT exhaustively verified; "no image found" holds only for audited sources (GitHub Releases assets + Docker Hub orgs/site-search, captures `container-registry-probes-2026-08-13.txt`).

**Therefore: with no published runnable artifact found in audited sources, the OSS paths are (i) connect mdbrain to a separately self-hosted memongo deployment (externally supplied URL) or (ii) build the memongo API from source (git tag v2.0.0). This is a finding, not a preference.** ⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 3): original said source-build is "the ONLY OSS deployment path" — overclaimed; externally supplied deployments exist as a path. Per amendment §10, an mdbrain-owned Dockerfile building memongo is NOT the shipped OSS default (boundary weakening) and never qualifies for production (§7.4); OSS mdbrain accepts an externally supplied `MEMONGO_API_URL`.

### 3.2 Compose topology sketch (three services)

```yaml
services:
  mongodb:
    image: mongodb/mongodb-atlas-local:<pinned-dated-tag>   # HEAD pins 8.2.6-20260715T144108Z; v2.0.0 used :preview — pin a dated tag
    healthcheck: { test: ["CMD","/usr/local/bin/runner","healthcheck"] }
    environment: [ "VOYAGE_API_KEY=${VOYAGE_API_KEY}" ]     # al-... Atlas Model API key; pa-... keys do NOT work (memongo:docker/mongodb/docker-compose.preview.yml header @ v2.0.0)
  memongo-api:
    build: { context: ./docker/memongo }                    # mdbrain-owned Dockerfile, builds git tag v2.0.0
    depends_on: { mongodb: { condition: service_healthy } }
    environment:
      MEMONGO_MONGODB_URI: mongodb://mongodb:27017/?directConnection=true
      MEMONGO_MONGODB_DATABASE: memongo
      MEMONGO_API_KEY: ${MEMONGO_API_KEY:?}
      MEMONGO_AGENT_ID: main
      # MEMONGO_API_SCOPED_KEYS: JSON per-agent tokens (memongo:.env.example)
      # MEMONGO_MONGODB_COLLECTION_PREFIX: leave unset → per-agent memongo_<agent>_ (v2.0.0 default)
    healthcheck: { test: ["CMD","node","-e","fetch('http://127.0.0.1:3847/health')..."] }
    # NOTE: /health is liveness-only at v2.0.0; /ready is unpublished (§0.4). Startup ordering cannot
    # gate on Mongo-readiness of the API at the published surface — mdbrain must retry its first calls.
  mdbrain-api:
    build: { context: .., dockerfile: apps/api/Dockerfile } # mdbrain's own image
    depends_on: { memongo-api: { condition: service_healthy }, mongodb: { condition: service_healthy } }
    environment:
      MDBRAIN_MONGODB_URI: mongodb://mongodb:27017/?directConnection=true   # wiki DB only
      MDBRAIN_MONGODB_DATABASE: mdbrain
      MEMONGO_API_URL: http://memongo-api:3847                              # @memongo/client env contract (client.ts:77,82 @ v2.0.0)
      MEMONGO_API_KEY: ${MEMONGO_API_KEY}
```

Env/contract notes:

- **Port collision:** mdbrain and memongo both default to 3847 (mdbrain:apps/api/src/server.ts:7; memongo:.env.example) — remap one on the host.
- Search-index readiness is async after first boot (atlas-local builds autoEmbed indexes); mdbrain's startup must tolerate memongo 5xx/`waitForBenchmarkSearchReadiness`-style unavailability — no published readiness gate exists (§0.4).
- Single `mongodb` container serves both databases — matches Option T1. For T2, add a second mongodb service and split the URIs.

---

## 4. Production Atlas variant

- Same constraints; managed MongoDB 8.x Atlas cluster(s). v2.0.0 release notes claim CI validation against real Atlas 8.3+ clusters [COMPETITOR-CLAIM — self-published release notes, evidence file github-memongo-releases-tags-2026-08-13.txt].
- T1-Atlas: one Atlas cluster, databases `memongo` + `mdbrain`; one connection string per service with `mongodb+srv://` URIs (memongo `MEMONGO_MONGODB_URI`, mdbrain `MDBRAIN_MONGODB_URI`). Atlas autoEmbed (Voyage via Atlas Model API key) replaces the local atlas-local container; index definitions are created by each side's own schema-bootstrap against its own database.
- T2-Atlas: two clusters — independent backup/restore/billing; doubles Atlas cost floor.
- ⚠️ SUPERSEDED 2026-08-13 (amendment v4): production deployment must NOT be source-built — it requires the independently published immutable artifact (amendment §7.4). Original text follows for historical context: memongo-api deploys as a container anywhere with Atlas network access (IP allowlist/private endpoint); mdbrain-api needs both Atlas access (wiki DB) and HTTPS access to memongo-api. Bearer `MEMONGO_API_KEY` over TLS is the only auth — scoped per-agent keys via `MEMONGO_API_SCOPED_KEYS`.
- The unpublished HEAD extras (`/ready`, idempotency, batch writes, Dockerfile) would materially improve the production story; depending on any of them is a blocker until a 2.0.1+ release is actually published (§0.5 anomaly).

---

## 5. Open questions for the human

1. Topology: T1 (one cluster two DBs) vs T2 (two clusters)? Wiki prefix: keep `mdbrain_<agent>_wiki_*` or consolidate to flat `mdbrain_` wiki prefix during cutover?
2. Per-row acceptance on the §2 loss matrix (event IDs, createdAt/recordedAt, revision histories, KB, episode identity, graph): which rows are (b) accepted losses / rebuilds, and which rows are hard (c) blockers that stall the service boundary?
3. OSS distribution: is an mdbrain-owned "build memongo from tag" Dockerfile acceptable as the shipped OSS path, given no published memongo image exists?
