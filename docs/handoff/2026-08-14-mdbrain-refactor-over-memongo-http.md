# MDBrain refactor over Memongo HTTP: zero-context handoff

**Date:** 2026-08-14  
**MDBrain repository:** `mdbrain`  
**MDBrain audited commit:** `1b7e2348dde4f618e1f7718161708677849d4ab4`  
**Memongo comparison repository:** sibling `../memongo`  
**Memongo audited commit:** `2398cf13902aa2f66deb6c38a28579c90746da8b`  
**Decision status:** approved by the user  
**Implementation status:** not started in this session  

## Start here

This document is the source of truth for the next MDBrain session.

1. Start a new session with the working directory set to the MDBrain repository.
2. Read this file completely.
3. Read `AGENTS.md`.
4. Inspect `git status --short --branch` before changing anything.
5. Read the earlier research listed in [Earlier evidence and supersession](#earlier-evidence-and-supersession), but do not inherit its superseded package-coupling plan or resume its failed workflow.
6. Reconfirm the target Memongo release or deployed service contract before implementing the transport. The sibling Memongo working tree is evidence, not automatically a consumable release.
7. Produce a fresh implementation plan for the approved existing-repository refactor. Do not begin by creating a new repository.

## Binding decisions

The user made these decisions after five independent architecture reviews and a separate upstream-candidate adjudication:

1. **Refactor the existing MDBrain repository.**
2. **Keep MDBrain and Memongo as separate products, repositories, runtimes, databases, and release cadences.**
3. **MDBrain consumes an independently deployed Memongo through a versioned HTTP wire contract.**
4. **MDBrain must not depend on `@memongo/memory-engine`, `@memongo/memory-bridge`, Memongo internal packages, or Memongo source files.**
5. **MDBrain must not read or write Memongo-owned MongoDB collections directly.**
6. **Do not maintain a synchronized source fork.**
7. **Do not merge MDBrain into Memongo.**
8. **Freeze, replace, and ultimately remove MDBrain's copied `packages/memory-engine` after HTTP parity and cutover gates pass.**
9. **Preserve MDBrain's wiki/company-brain domain, governance, connectors, OKF support, orchestration, and product surfaces.**
10. **Memongo adopts no MDBrain mechanism immediately.** Record typed per-evidence bindings and an explicit contradiction-before-dedup gate as later Memongo candidates, not as prerequisites for this refactor.

The selected option narrowly beat a greenfield rebuild:

| Option | Weighted score | Decision |
| --- | ---: | --- |
| Refactor existing MDBrain over Memongo HTTP | 7.70/10 | **Selected** |
| New greenfield MDBrain over Memongo HTTP | 7.60/10 | Not selected; may be reconsidered only with explicit new user approval after a bounded prototype |
| Continue synchronized source upstreaming | 5.70/10 | Rejected as the permanent model |
| Merge MDBrain into Memongo | 5.20/10 | Rejected |

The 0.10 gap between refactor and greenfield is within estimation uncertainty. The existing repository wins because it contains substantial working wiki/product code and tests. A bounded selective-port prototype may measure that assumption, but it cannot change the repository decision. If the prototype falsifies the assumption, stop and request explicit user approval before starting a greenfield repository.

## Target architecture

```text
Users, MCP clients, SDK clients, and web
                  |
                  v
      MDBrain API and orchestration
        |                       |
        |                       +--> MDBrain-owned MongoDB database
        |                            wiki pages, revisions, governance,
        |                            connectors, outbox, product state
        |
        +--> MDBrain-owned HTTP adapter
                  |
                  | authenticated, scoped, versioned HTTP
                  v
          Independently deployed Memongo
                  |
                  +--> Memongo-owned MongoDB database
                       events, structured memory, procedures,
                       episodes, graph, KB, jobs, retrieval state
```

### The required seam

Create one MDBrain-owned memory module at the HTTP seam. It should hide:

- Memongo URL and credential resolution;
- authentication and server-side scope derivation;
- request deadlines and cancellation;
- retry classification;
- event idempotency keys and replay receipts;
- runtime response validation;
- Memongo version and contract compatibility;
- sanitized error mapping;
- readiness and degradation state;
- telemetry and request correlation.

The module's interface should use MDBrain domain operations, not expose arbitrary HTTP proxying. The existing `@mdbrain/memory-bridge` facade is the likely replacement seam because apps already depend on it, but its implementation must be rewritten rather than layered over the local engine.

Callers and tests should cross the same seam. Keep Memongo route details local to the adapter so a future Memongo release usually requires one adapter update and one conformance run, not edits across API, MCP, web, and wiki code.

### Hard separation invariants

- No `@memongo/memory-engine` or `@memongo/memory-bridge` runtime dependency in MDBrain.
- No `@mdbrain/memory-engine` fallback after cutover.
- No direct access to the Memongo database, collections, validators, indexes, or migrations.
- No shared schema initializer.
- No dual write to the old engine and Memongo.
- No silent fallback to the copied engine when Memongo is unavailable.
- MDBrain owns its wiki MongoDB client, schema lifecycle, and transaction boundary.
- Memongo owns its memory MongoDB client, schema lifecycle, and migrations.
- Memongo credentials stay server-side. Clients never receive the Memongo URL, root key, or collection coordinates.
- Production traffic to Memongo uses validated TLS with redirects disabled or revalidated. Plain HTTP is allowed only for an explicitly local development deployment.
- A failure of every required retrieval leg returns an explicit failure, not an empty successful answer.

## Earlier evidence and supersession

Read these files because they contain extensive code and external-spec evidence:

- `docs/research/2026-08-13-memongo-absorb-company-brain.md`
- `docs/research/2026-08-13-service-boundary-amendment.md`
- `docs/handoff/2026-08-13-mdbrain-memongo-service-boundary-handoff.md`
- `docs/research/evidence/2026-08-13/`

Apply these rules while reading them:

1. The package-dependency recommendation in `2026-08-13-memongo-absorb-company-brain.md` is superseded. The approved seam is HTTP only.
2. The service-boundary thesis in `2026-08-13-service-boundary-amendment.md` remains directionally correct.
3. The old documents are pinned to Memongo commit `8833026c0c`. This handoff compared current Memongo commit `2398cf1390`, which contains later hardening.
4. Claims about published Memongo `2.0.0` remain historical evidence. Select and verify the actual target release or deployable artifact before implementation.
5. Workflow `0eefcd9d-de9a-45da-8bb4-d3f3f861f3f8` failed safely after its user-mandated retry cap. Do not resume it. This approved refactor is a new user-authorized goal and requires a fresh plan.
6. The old "no product code changed" statement applies only to that prior planning run.
7. The old unpushed-commit statement is stale. At handoff creation, MDBrain `main` and Memongo `main` both reported aligned with `origin/main`.
8. The old "Security CLEAN" result reviewed a proposed plan. It does not mean the current MDBrain product is secure; the P0 findings below remain open.
9. The old exact v2.0.0 route count, route cuts, direct-fetch design, topology, clean-slate assumption, H1-H6 list, compatibility wrappers, and adapter count are historical proposals. Re-baseline them rather than inheriting them.

## Audit method

The comparison used five parallel, non-overlapping codebase reviews:

1. MDBrain memory-engine implementation.
2. MDBrain memory-engine tests and helpers.
3. Wiki-engine integration and duplicated memory behavior.
4. Product exposure through API, MCP, web, client, tools, bridge, and aggregate packages.
5. Operations, Docker, scripts, CI, docs, releases, and upstream drift.

The main session then directly rechecked the highest-impact claims in both repositories. Five more decision reviews independently assessed the four architecture choices. A final adjudicator inspected all proposed MDBrain-to-Memongo upstream candidates.

## Current repository state

At handoff creation:

```text
## main...origin/main
?? .pi/
?? docs/2026-07-23-mem0-agent-wiki-article-analysis.md
?? docs/handoff/
?? docs/research/
```

Treat every untracked file as user work. Do not clean, move, overwrite, or delete it without explicit approval.

Recent MDBrain commits:

```text
1b7e234 feat(wiki-engine): make OKF export usable for remote HTTP/MCP callers
c2e91b2 fix(memory-engine): stop episode timeRange drifting on redundant re-materialization
785cea7 feat(mcp): expose wiki OKF import and maintenance as MCP tools
93e2456 fix(wiki-engine): harden OKF import against DoS, injection, and data loss
64d1c90 feat(wiki-engine): add page transclusion
```

No code was changed during the final decision and handoff session. This handoff file is the only intended new repository file from that session.

## What MDBrain is today

MDBrain is an independently renamed import of an older Memongo lineage plus substantial wiki/product work. The repositories do not share Git history and MDBrain declares no `@memongo/*` dependencies.

Current production TypeScript counts:

| Area | Production files | Lines |
| --- | ---: | ---: |
| MDBrain memory engine | 100 | 48,981 |
| Current Memongo memory engine | 132 | 57,479 |
| MDBrain wiki engine | 16 | 6,563 |
| MDBrain wiki-engine tests | 14 | 5,162 |

The wiki engine is 11,725 lines including tests. It is genuine product value, not generated glue.

### What to preserve

`packages/wiki-engine/src/index.ts` exposes the differentiated domain:

- wiki page schema and indexes;
- CRUD and rendering;
- full revision records;
- transclusion;
- OKF import and export;
- hybrid wiki search;
- wiki-map generation;
- backlinks;
- legacy-to-wiki migration;
- governance;
- contradiction and near-duplicate handling;
- git-diff and Dreamer-style maintenance;
- Obsidian, GitHub, Confluence, Notion, Slack, and CRM connector interfaces.

The web console, API routes, MCP tools, and client SDK are also reusable product shell. Refactor them around the new seam; do not discard them by default.

## Why the copied memory engine must go

MDBrain does not leverage current Memongo completely. It duplicates an older engine and has already accumulated correctness, security, performance, release, and operations drift.

Current Memongo contains production modules absent from MDBrain, including:

- `mongodb-transactions.ts`
- `mongodb-idempotency-fingerprint.ts`
- `mongodb-search-budget.ts`
- `mongodb-single-flight.ts`
- `mongodb-client-registry.ts`
- `mongodb-capability-registry.ts`
- `mongodb-contradiction.ts`
- `mongodb-consolidation-adjudication.ts`
- `mongodb-consolidation-reasoning.ts`
- `mongodb-relation-extraction.ts`
- `mongodb-temporal-extraction.ts`
- `mongodb-query-cache-invalidation.ts`
- `mongodb-operation-accounting.ts`
- `mongodb-conversation-evidence-mode.ts`
- `mongodb-search-lanes.ts`
- `mongodb-search-ranking.ts`
- `mongodb-search-temporal.ts`
- split manager modules for admin, host, jobs, lifecycle, read, relevance, search, sync, and write.

This is not a cosmetic file-layout difference. The modules carry behavior that a source fork would need to copy, integrate, test, and repeatedly reconcile.

### Concrete engine gaps

#### Event durability and throughput

MDBrain's `packages/memory-engine/src/mongodb-events.ts` lacks the current Memongo path's:

- `DURABLE_EVENT_WRITE_CONCERN = { w: "majority", wtimeoutMS: 5_000 }`;
- `ClientSession` support;
- `writeEventsBatch`;
- `projectEventChunksBatch`;
- durable write concern on event and extraction state transitions.

Compare MDBrain `packages/memory-engine/src/mongodb-events.ts:120` with Memongo `packages/memory-engine/src/mongodb-events.ts:14`, `:253`, `:308`, and `:744`.

#### Durable job execution

MDBrain `packages/memory-engine/src/mongodb-memory-jobs.ts` exports only create, update, list, and get operations at `:32`, `:46`, `:111`, and `:133`.

Current Memongo also implements:

- batch creation;
- leased claiming;
- lease renewal;
- fenced completion and failure;
- failed-job retry.

See Memongo `packages/memory-engine/src/mongodb-memory-jobs.ts:91`, `:139`, `:199`, `:296`, `:302`, and `:308`.

#### Configuration drift

- MDBrain records `voyage-4-lite` as 512 dimensions at `packages/memory-engine/src/backend-config.ts:18`; current Memongo records 1024.
- MDBrain defaults to database `mdbrain` and per-agent collection prefix `mdbrain_<agent>_` at `packages/memory-engine/src/backend-config.ts:220-227`.
- Current Memongo defaults to a shared `memongo_` prefix and has additional query-embedding, fallback, search-budget, TTL, and conversation-evidence configuration.

Do not solve this by aligning the local engine. Remove the need to keep it aligned.

## Current coupling that the refactor must remove

### Bridge to local engine

`packages/memory-bridge/src/mdbrain-bridge.ts` imports and re-exports `@mdbrain/memory-engine`, creates a local `MongoDBMemoryManager`, and initializes wiki schema as a side effect. The central path starts at `packages/memory-bridge/src/mdbrain-bridge.ts:358`.

The rewritten bridge should call the Memongo HTTP adapter for memory operations and should not initialize wiki storage.

### Wiki to memory-manager internals

`packages/wiki-engine/src/wiki-bridge.ts:213-247` duck-types a memory manager to obtain `Db`, collection prefix, and optional `MongoClient`.

Replace this with a MDBrain-owned wiki storage module that:

- resolves `MDBRAIN_*` configuration;
- owns one MongoDB client lifecycle;
- exposes the wiki `Db`, prefix, sessions, readiness, and shutdown behavior;
- initializes and verifies only MDBrain wiki collections and indexes.

### App and script dependencies

Current direct or indirect engine dependencies include:

- `packages/memory-bridge/src/mdbrain-bridge.ts`
- `packages/mdbrain-memory/src/index.ts`
- `packages/wiki-engine/package.json`
- `scripts/prepare-mongodb-runtime.ts`
- `scripts/check-mongodb-runtime-parity.ts`
- `scripts/real-capability-stress.ts`
- `scripts/memory-eval-core.ts`
- `scripts/mdbrain-init.ts`
- `scripts/mdbrain-migrate.ts`

The API obtains wiki storage through `mdbrainBridgeGetManager` at `apps/api/src/routes/v1.ts:2089-2091`. Initialization and migration scripts do the same. Repoint all of them to the MDBrain-owned wiki storage module.

## Current product-surface gaps

### HTTP API

MDBrain has 55 registered v1 routes, 43 memory routes and 12 wiki routes. Its API currently lacks several hardening controls already present in Memongo:

- request IDs;
- request body-size limits;
- secure headers;
- a deep `/ready` endpoint;
- a single sanitized internal-error envelope.

MDBrain currently exposes only `/health` at `apps/api/src/app.ts:390`. Compare current Memongo `apps/api/src/app.ts:4-7`, `:522`, `:549`, `:571-581`, and `:675-683`.

MDBrain does implement rate limiting and configurable CORS, but its default CORS behavior should be reviewed rather than assumed safe (`apps/api/src/app.ts:292-299`, `:310-336`).

### MCP

`apps/mcp/src/server.ts` declares **55 tools**, despite older docs advertising 53.

Important gaps:

- no `mdbrain_extract` tool;
- `mdbrain_search` omits `scope` and `scopeRef` in both its schema and handler (`apps/mcp/src/server.ts:56-69`, `:1252-1260`);
- `mdbrain_add` omits scope fields (`apps/mcp/src/server.ts:99-109`);
- `mdbrain_write_event` omits `scope`, `scopeRef`, `timestamp`, and `metadata` in both its schema and handler (`apps/mcp/src/server.ts:112-123`, `:1290-1310`);
- no wiki delete tool;
- no wiki revision list or revision detail tools;
- no complete parity check generated from the HTTP route registry.

### Client

`packages/client/src/client.ts:477-493` omits `scope` and `scopeRef` from basic search.

`packages/client/src/client.ts:652-669` accepts role, body, agent, session, timestamp, metadata, and scope for `writeEvent`, but it neither accepts nor sends `scopeRef`.

The older MDBrain client also retries through a generic transport without the current Memongo client's explicit timeout and cancellation support. Current Memongo's client uses `AbortSignal.timeout` and supports caller signals at `packages/client/src/client.ts:194-203`.

### AI SDK tools and web

The tool package does not expose every current detailed retrieval capability. The web console is useful product shell but was not fully type-validated in the audit because local Next.js dependencies were unavailable. Do not infer web correctness from non-web type checks.

## Wiki-engine findings that remain in scope

These issues belong to MDBrain, not Memongo. Replacing the memory substrate will not fix them.

### P0: caller-controlled governance authority

`apps/api/src/routes/v1.ts:2121-2130` builds `GovernanceContext` from caller-supplied `scope`, `scopeRef`, and `trustTier`. A caller can request `admin`, while `buildPermissionsFilter` returns an unrestricted filter for admin at `packages/wiki-engine/src/wiki-governance.ts:67-84`.

The API principal currently contains only token, agent, scope, and scopeRef allowlists (`apps/api/src/app.ts:23-28`). It has no server-owned trust tier, subject identity, groups, roles, departments, or read/write/admin capabilities.

Required direction:

- derive governance identity and capabilities from the authenticated server principal;
- let request fields narrow authority only;
- add subject IDs and namespaced external groups before claiming connector ACL fidelity;
- fail closed for unmapped identities and stale membership.

### P0: lint bypasses governance

`GET /v1/wiki/lint` calls `listWikiPages` and `listUnresolvedContradictions` without a governance context at `apps/api/src/routes/v1.ts:2242-2264`.

The lint route is also exposed through MCP. A same-scope caller can receive information about pages or contradictions that governed reads would deny.

### P0: mutations lack governed authorization

`PATCH /v1/wiki/*` and `DELETE /v1/wiki/*` call `updateWikiPage` and `deleteWikiPage` without a governed target lookup or capability check (`apps/api/src/routes/v1.ts:2421-2516`).

The update primitive permits changes to `trustTier` and `permissions` at `packages/wiki-engine/src/wiki-bridge.ts:536-538`. Hard delete is a query flag. Add:

- read, write, admin, permission-change, and hard-delete capabilities;
- governed target lookup before mutation;
- field-level authorization;
- tests covering REST and MCP mutation paths.

### P0: graph and contradiction reads bypass governance

- Search applies governance to direct results, then appends graph-expanded pages without a post-expansion governance filter (`packages/wiki-engine/src/wiki-search.ts:426-470`).
- `detectContradictions` loads the source and related pages by only slug, scope, and scopeRef (`packages/wiki-engine/src/wiki-contradictions.ts:164-225`).

Apply governance before every read and again after graph expansion. Do not expose protected claim text through contradiction records.

### P0: existing claim evidence is destroyed on update

`packages/wiki-engine/src/wiki-bridge.ts:632-643` rebuilds every existing claim with:

```ts
evidence: [],
writerAgent: undefined,
derivedFrom: [],
supersedesClaimId: undefined,
sourceMemId: undefined,
```

An unrelated update silently destroys provenance and lineage. Preserve the complete existing claim record and append only accepted new claims.

### P0: page and revision writes are not atomic

`recordWikiPageRevision` deliberately catches and suppresses every failure (`packages/wiki-engine/src/wiki-revisions.ts:33-67`) and accepts no `ClientSession`.

Create, update, and soft-delete call it outside the page write's session (`packages/wiki-engine/src/wiki-bridge.ts:411`, `:681`, and `:728`). A page can commit without its audit revision.

Make page mutation, revision insertion, and any local outbox write one transaction. Production should require transaction-capable MongoDB and a live transaction readiness probe.

### P0: connector ACL and secret handling

Connector authentication results can return raw credentials:

- GitHub token at `packages/wiki-engine/src/wiki-connectors.ts:295-305`;
- Notion integration token at `:498-508`;
- Slack bot token at `:595-603`;
- CRM API key at `:669-679`.

Authentication results should expose non-secret identity and capability metadata only. Keep secrets inside a connector or secret-provider module and add redaction tests.

The GitHub connector defines `mapPermissions` but its ingest path delegates to git-diff maintenance without applying the mapped permissions (`packages/wiki-engine/src/wiki-connectors.ts:308-362`). Git-diff maintenance creates and updates pages without permissions (`packages/wiki-engine/src/wiki-maintenance.ts:174-234`).

The permissions model supports only roles, departments, and privacy tier (`packages/wiki-engine/src/wiki-bridge.ts:84-88`). It cannot faithfully represent GitHub collaborators or teams, Slack private-channel members, membership revocation, or unknown identities.

### P0: filesystem path safety

Obsidian export joins an unrestricted page slug into the vault path at `packages/wiki-engine/src/wiki-connectors.ts:232-245`. Reject absolute slugs, `..`, separator tricks, and symlink escapes. Verify the final real path remains inside the configured vault root.

OKF path validation at `packages/wiki-engine/src/okf.ts:85-117` uses lexical resolution but not `realpath` or symlink-component rejection. Export also joins page slugs into the output path at `packages/wiki-engine/src/okf.ts:1003-1015`. Preserve the current allowed-root fail-closed default, then add real-path containment and slug-target checks.

### P0/P1: OKF conformance

Earlier research pinned canonical OKF v0.2 to `GoogleCloudPlatform/knowledge-catalog`, commit `3fcbb9f8` (2026-07-24). Revalidate the external spec before shipping.

Known current gaps:

- export writes `type: index` into reserved `index.md` (`packages/wiki-engine/src/okf.ts:1221-1225`);
- import rejects unknown extension keys beginning with `$` or containing `.` (`packages/wiki-engine/src/okf.ts:682-704`), while the pinned consumer rule said unknown extensions must not cause rejection;
- lexical path containment does not defeat symlinks;
- earlier evidence identified relative-link, source/footnote, arbitrary-heading, and advisory-trust round-trip risks that must be rechecked against current code.

Do not map OKF content credibility fields to authorization trust tiers.

### P1: wiki search correctness

- Vector candidate count has no current Memongo-style upper clamp (`packages/wiki-engine/src/wiki-search.ts:144-164`).
- Search-index failures can collapse to `[]` (`packages/wiki-engine/src/wiki-search.ts:312-335`).
- Graph failures are swallowed (`:391-393`, `:468-470`).
- The application reranker assigns returned scores by the original array index rather than reliably reordering by reranker identity (`:432-448`).
- `minScore` is placed in configuration but is not visibly applied to final results (`:406-410`).
- Search hardcodes `voyage-4-large` for wiki auto-embedding (`:158-163`) instead of using a deliberate MDBrain configuration contract.

Return explicit complete, partial, degraded, and failed states. Never represent an unavailable required search lane as a genuine empty result.

### P1: connector and maintenance product truth

- GitHub, Confluence, Notion, Slack, and CRM discovery currently return empty source lists or require caller-supplied sources. Do not advertise them as complete live connectors.
- The Dreamer promotion path is a simplified wiki compiler, not current Memongo consolidation. It should consume delivered Memongo receipts or explicitly supplied immutable events, not duplicate the memory engine.
- Git-diff hashing is valid wiki maintenance behavior. Keep it in MDBrain; do not generalize it into Memongo.

## Infrastructure and release findings

### Docker

`docker/mongodb/docker-compose.mongodb.yml` currently:

- uses mutable `alpine:latest`, MongoDB `:latest`, and Search `:latest` tags;
- binds MongoDB, mongot gRPC, and mongot health ports to all interfaces;
- defaults admin password to `admin`;
- defaults mongot password to `mongotPassword`;
- does not declare a dedicated replica-set initialization service.

Pin immutable versions or digests, bind local development ports to loopback by default, require generated secrets, and make transaction readiness explicit.

### Publishability

`scripts/check-publishability.ts:31-62` omits `@mdbrain/wiki-engine` even though that package is public. The MDBrain checker also lacks several current Memongo controls for coherent versioning, reproducible packs, and already-published-version handling.

Decide whether wiki-engine remains public. If yes, add it to the package cohort and validate external clean installation. If no, mark it private and stop implying it is independently publishable.

### Signed export

MDBrain's `packages/memory-bridge/src/mdbrain-export.ts` contains a useful HMAC-SHA256 canonical signed export and handles BSON `ObjectId`, `Decimal128`, `Long`, and `Timestamp` (`:60-63`, `:119-152`, `:170-213`).

It currently has no complete HTTP, MCP, and client product journey. Decide whether signed export belongs in MDBrain's product surface after the memory engine is removed or should be replaced by a Memongo remote export operation. Do not keep an engine-coupled orphan module merely because its implementation is good.

## Current Memongo service surface

At audited local commit `2398cf1390`, the local Memongo server reports version `2.0.1` (`apps/api/src/version.ts:6`) and registers 42 `/v1` routes across split route modules:

### Tenant retrieval and context

- `/search`
- `/search-detailed`
- `/search-kb`
- `/recall-conversation`
- `/profile`
- `/hydrate-active-slate`
- `/discovery-projection`
- `/context-bundle`
- `/read-file`

### Writes and lifecycle

- `/add`
- `/write-event`
- `/write-events`
- `/extract`
- `/write-structured`
- `/write-procedure`
- `/import/conversations`
- `/lifecycle/get`
- `/lifecycle/update`
- `/lifecycle/delete`
- `/lifecycle/history`
- `/procedures/outcome`
- `/memory/feedback`

### Status and maintenance

- `/state`
- `/status`
- `/status/detailed`
- `/stats`
- `/sync`
- `/probes/embedding`
- `/probes/vector`
- `/chain-trace`
- `/novelty-scan`
- `/consolidate`
- `/self-edit`

### Operator/admin

- `/admin/relevance/explain`
- `/admin/relevance/report`
- `/admin/relevance/sample-rate`
- `/admin/access-trends`
- `/admin/access-summaries`
- `/admin/traces`
- `/admin/traces/:traceId`
- `/jobs`
- `/jobs/:jobId`

The app also exposes `/health` and `/ready`.

Do not blindly proxy all routes. In the new plan, classify each route as:

- tenant read;
- tenant write;
- MDBrain orchestration;
- private control plane;
- removed or deferred.

Keep root/admin credentials and routes off tenant request paths.

### Current local Memongo capabilities relevant to the adapter

Current source includes:

- HTTP batch event writes;
- per-event idempotency keys;
- scope and scopeRef on event writes;
- scoped extraction;
- client request deadlines and caller cancellation;
- multi-lane readiness covering MongoDB ping, vector capability, and embedding capability, but not a live named search-index probe (`apps/api/src/lib/readiness.ts`);
- request IDs, secure headers, body limits, and sanitized internal errors;
- split route and manager modules;
- durable jobs and event write concerns.

These are reasons to consume Memongo, not to copy its implementation. Verify that the selected deployed version actually contains them.

## What Memongo should learn from MDBrain

The user approved this conclusion:

### Adopt now

Nothing.

### Record for later

1. **Typed per-evidence bindings on structured facts.** Current Memongo has `sourceEventIds`, a single `sourceReliability`, and free-form `provenance` (`packages/memory-engine/src/mongodb-structured-memory.ts:191-216`). It does not have a structured per-evidence array with source kind, source ID, confidence, and weight. Revisit when heterogeneous sources routinely contribute to one fact.
2. **An explicit contradiction-before-dedup gate.** Current Memongo already checks and resolves conflicts before vector similarity dedup in the consolidation flow (`packages/memory-engine/src/mongodb-consolidator.ts:821-920`). A named gate would protect the invariant from future refactors but does not fix a current ordering bug.

### Reject as Memongo work

- Reverse-edge backlinks: current Memongo already supports bidirectional graph expansion and reverse indexes (`packages/memory-engine/src/mongodb-graph.ts:959-1099`; `packages/memory-engine/src/mongodb-schema-standard-indexes-graph.ts:215-240`).
- Content revision history: current Memongo already stores deterministic structured-memory revision snapshots (`packages/memory-engine/src/mongodb-structured-memory.ts:244-273`, `:611-650`).
- Durable knowledge pages: a wiki/product concern.
- OKF: a wiki interchange format.
- Git-diff hashing: a wiki source-maintenance pattern.
- Signed export and verification: current Memongo already has HMAC-SHA256 canonical signing and constant-time verification (`packages/memory-bridge/src/memongo-export.ts:119-163`). MDBrain's BSON normalization is a possible hardening detail, not a missing core feature.

Do not open Memongo feature work from the MDBrain session unless the user separately authorizes it.

## Recommended implementation sequence

### Phase 0: baseline and contract

1. Preserve the current working tree and record both commit IDs.
2. Decide the target Memongo service version or immutable artifact.
3. Capture its OpenAPI or generated route contract.
4. Specify the wire-security contract: production HTTPS, TLS validation, redirect behavior, credential provisioning and rotation, credential class per operation, and log/header redaction.
5. Verify exact agent, scope, and scopeRef authorization semantics plus mutation idempotency, replay, conflict, and ambiguous-timeout behavior.
6. Generate a route disposition table for all MDBrain memory routes, MCP tools, client methods, and AI SDK tools.
7. Write adapter conformance tests from the chosen Memongo contract before replacing implementations.
8. Confirm whether the prior "no production users or data" statement remains true. If true, choose clean-slate cutover. If false, stop and design an explicit migration.

**Gate:** every retained MDBrain memory operation has a verified request, response, authorization, idempotency, failure, and wire-security contract, or an explicit MDBrain composition plan.

### Phase 1: fix the MDBrain identity and wiki security floor

1. Define a server-owned principal with subject, groups, roles, departments, trust tier, and capabilities.
2. Remove caller authority to elevate trust.
3. Govern lint, revisions, transclusion, graph expansion, contradiction reads, export, and every mutation.
4. Add field-level mutation authorization and separate hard-delete authority.
5. Make connector identity mapping and unknown-identity behavior fail closed.

**Gate:** generated REST and MCP security fixtures show zero cross-scope, cross-role, cross-department, cross-subject, and cross-group disclosure.

### Phase 2: give wiki storage independent ownership

1. Add a MDBrain-owned wiki MongoDB client module.
2. Move wiki schema initialization, readiness, sessions, shutdown, and migration there.
3. Make page, revision, and local outbox writes atomic.
4. Repoint API routes, init, migration, parity, and preflight scripts.
5. Remove `getWikiDbHandle(manager)` and wiki schema initialization from the memory bridge.

**Gate:** wiki tests pass using only MDBrain-owned storage, with no local memory manager.

### Phase 3: replace the memory bridge implementation

1. Keep the existing outward bridge interface where it reduces caller churn.
2. Implement it through one HTTP adapter.
3. Add runtime response validation, deadlines, cancellation, retry classification, idempotency, version checks, and error mapping.
4. Use scoped credentials and server-derived scope values.
5. Separate tenant operations from private control-plane operations.

**Gate:** API tests run against an adapter fake built from recorded Memongo fixtures, and live contract smoke tests pass against the selected Memongo deployment.

### Phase 4: reconcile every product surface

1. Generate parity from the API route registry to client methods, MCP tools, AI SDK tools, and OpenAPI.
2. Add missing scopeRef propagation.
3. Add or deliberately remove extract, wiki delete, and wiki revision tools.
4. Remove stale benchmark, server-local file, and admin exposure that does not belong in the product.
5. Add body limits, request IDs, secure headers, readiness, and sanitized errors.

**Gate:** no retained operation exists on only one accidental surface.

### Phase 5: establish the delivery and promotion path

If memory writes can promote wiki content:

1. Persist a MDBrain-owned intent/outbox record before calling Memongo.
2. Use Memongo idempotency keys and exact replay receipts where the selected contract supports them.
3. Promote only after a confirmed memory receipt.
4. Persist promotion identity and wiki lineage atomically with page/revision state.
5. Never infer success after an ambiguous timeout.
6. Do not expose direct Memongo ingress that bypasses MDBrain promotion rules in an integrated deployment.

**Gate:** crash and replay tests prove no duplicate page mutation, no false lineage, and explicit unknown/dead-letter handling.

### Phase 6: remove the copied engine

1. Freeze engine changes while the adapter lands.
2. Delete `packages/memory-engine` only after all retained callers use HTTP.
3. Remove package dependencies, re-exports, tests, and relative script imports.
4. Rewrite or retire engine-internal stress and benchmark scripts.
5. Regenerate `bun.lock` and the Turbo graph.

Required final searches:

```bash
rg '@mdbrain/memory-engine' apps packages scripts
rg 'packages/memory-engine/src' apps packages scripts
rg 'mdbrainBridgeGetManager|getWikiDbHandle' apps packages scripts
```

All production hits must be gone. Historical docs may remain if clearly labeled.

### Phase 7: operations and release hardening

1. Pin container versions or digests.
2. Remove default passwords and public port binding.
3. Add explicit replica-set and transaction readiness.
4. Add wiki-engine to publishability checks or make it private.
5. Add clean-consumer package tests if any public MDBrain packages remain.
6. Document separate database ownership, credentials, backups, and restore.

### Phase 8: integrated proof

Run:

- all non-web type checks;
- all unit tests;
- web type generation and type check after dependencies are restored;
- API-to-Memongo contract tests;
- live MongoDB wiki transaction tests;
- live Memongo HTTP smoke tests;
- REST/MCP/client parity tests;
- security leakage and mutation-authorization suites;
- connector replay and ACL revocation tests;
- failure injection for Memongo unavailable, timeout, 429, 409/422 idempotency conflict as defined by the selected contract, 503, malformed response, and version mismatch;
- TLS certificate, hostname, and redirect failure tests for non-local deployments;
- end-to-end ingest, retrieve, promote, cite, revise, delete, and restore journeys.

Do not claim completion from unit tests alone.

## Validation baseline

Fresh validation during this handoff session:

- 1,937 unit tests passed across 107 test files;
- tools: 10 tests passed;
- wiki-engine: 200 tests passed;
- API: 108 tests passed;
- MCP: 19 tests passed;
- memory-bridge: 58 tests passed;
- memory-engine: 1,542 tests passed;
- non-web type checks passed;
- E2E tests were not run.

Commands:

```bash
bunx turbo run test --filter='!@mdbrain/web'
bunx turbo run check-types --filter='!@mdbrain/web'
```

Turbo reported 12 successful test tasks and 15 successful type-check/build tasks. The results were cache hits for the current source inputs.

The web type check remains blocked by missing local Next.js dependencies:

```text
Error: Cannot find module '/Users/rom.iluz/Dev/mdbrain/node_modules/next/dist/bin/next'
code: 'MODULE_NOT_FOUND'
```

Re-run the relevant checks after each implementation slice. These results are a baseline, not proof for future changes.

## Open implementation decisions for the new MDBrain session

These were deliberately deferred. Resolve them in the MDBrain session, not this Memongo session:

1. Which released or immutable Memongo service artifact is the first supported contract?
2. Does development use one physical MongoDB cluster with two logical databases, or separate clusters? Recommended default for local/OSS is one cluster with distinct databases and least-privilege principals.
3. Is cutover clean-slate? Prior context said there were no production users or data, but re-confirm before deleting anything.
4. Which Memongo routes are tenant-facing, MDBrain orchestration-only, control-plane-only, or removed?
5. Which memory writes are eligible for wiki promotion?
6. Does signed export remain a MDBrain product capability or become a remote Memongo operation?
7. Which connector ships first, with a real ACL and revocation model?
8. Does `@mdbrain/memory` remain a remote client aggregate, get renamed, or get deprecated?
9. What production topology, backup, restore, and managed-control-plane scope is supported?

None of these questions reopens the approved HTTP separation decision.

## Explicit non-goals

- Do not modify Memongo source from the MDBrain refactor session.
- Do not copy current Memongo modules into MDBrain.
- Do not build a third shared core.
- Do not preserve the local engine as a fallback.
- Do not dual-write.
- Do not run both schema initializers against one database.
- Do not turn Memongo into a wiki.
- Do not discard the existing MDBrain repository without both a measured falsification result and explicit new user approval.
- Do not advertise stub connectors as production-ready.
- Do not claim OKF conformance without a pinned conformance suite.
- Do not claim production readiness without live HTTP, MongoDB transaction, security, and failure-path evidence.
- Do not push, publish, release, or delete user data without explicit user authorization.

## First-session prompt

Use this prompt in the new MDBrain session:

> Read `docs/handoff/2026-08-14-mdbrain-refactor-over-memongo-http.md` completely and treat it as the source of truth. Inspect the current working tree without changing or deleting untracked files. We have approved an in-place refactor of MDBrain into a separate product that consumes an independently deployed Memongo through a versioned HTTP interface. Do not use Memongo packages, source files, or collections directly, and do not retain the copied MDBrain memory engine as a fallback. First re-baseline the selected Memongo service contract, inventory every current API/MCP/client/wiki coupling, and produce a dependency-ordered implementation plan with security, contract, migration, deletion, and end-to-end gates. Do not resume the old failed workflow or its package-dependency plan.

## Expected first deliverable

The first deliverable in the new session should be a reviewed implementation plan, not a broad code rewrite. It must contain:

1. A route and product-surface disposition matrix.
2. The MDBrain-owned HTTP adapter interface and failure contract.
3. The MDBrain-owned wiki storage lifecycle.
4. The identity, governance, and mutation-authorization model.
5. The delivery, idempotency, outbox, and promotion state machine.
6. A caller-by-caller engine-deletion map.
7. A clean-slate or migration decision.
8. A test and proof matrix with stop/go gates.
9. A rollback strategy.
10. A bounded prototype that can measure the choice to preserve the existing repository, with an explicit stop-and-ask gate if it falsifies that choice.
