# MDBrain over Memongo HTTP — accepted implementation specification

**Status:** Accepted for implementation  
**Date:** 2026-08-16  
**Source of truth:** `docs/handoff/2026-08-14-mdbrain-refactor-over-memongo-http.md`

## Problem Statement

MDBrain currently combines a differentiated wiki/company-brain product with a copied, increasingly divergent memory engine. That duplication prevents MDBrain from consuming current Memongo correctness, durability, retrieval, and operational improvements without repeatedly copying source. It also leaves wiki governance, storage ownership, audit atomicity, connector security, API hardening, and product-surface parity problems unresolved.

The approved product boundary is two independent products: MDBrain owns wiki/product behavior and Memongo owns memory behavior. MDBrain must consume an independently deployed Memongo through a versioned, authenticated HTTP contract. It must never import Memongo packages, use Memongo source, access Memongo collections, dual-write, or silently fall back to its copied engine.

## Solution

Refactor the existing MDBrain repository in place around two deep modules:

1. An MDBrain-owned memory gateway that exposes MDBrain domain operations while containing the complete versioned Memongo HTTP contract, authentication, scope derivation, deadlines, cancellation, idempotency, runtime validation, error mapping, readiness, and telemetry.
2. An MDBrain-owned wiki store that owns its MongoDB client, database, schema, migrations, transactions, readiness, and shutdown lifecycle without depending on a memory manager.

Before product traffic moves, establish a server-owned identity and capability model and apply it to every wiki read and mutation. Then migrate public memory capabilities to the HTTP gateway, add durable delivery/promotion semantics, reconcile REST/MCP/client/AI-tool surfaces, harden operations, and remove the copied memory engine only after all cutover gates pass.

The first supported upstream baseline is the Memongo HTTP API reporting version `2.0.1`, anchored to immutable audited source commit `2398cf13902aa2f66deb6c38a28579c90746da8b`. Implementation must capture and hash the generated OpenAPI document and recorded fixtures from the exact deployed artifact. A service that reports `2.0.1` but does not match the accepted contract digest is incompatible.

The cutover is clean-slate, based on the approved handoff's statement that there are no production users or data. A read-only inventory is a mandatory deletion gate. Any production data, unknown ownership, or active production client detected by that inventory invalidates clean-slate cutover and requires a user decision before data movement or deletion.

## User Stories

1. As an MDBrain user, I want memory retrieval backed by current Memongo behavior, so that I benefit from its durability and retrieval improvements without knowing the implementation boundary.
2. As an MDBrain user, I want wiki behavior to remain available, so that the refactor does not discard the company-brain product.
3. As an MDBrain user, I want unavailable memory dependencies reported explicitly, so that an outage is not misrepresented as an empty result.
4. As an MDBrain user, I want partial retrieval labeled as degraded, so that I can distinguish incomplete evidence from a complete answer.
5. As an API client, I want one coherent contract across REST, client SDK, MCP, and AI tools, so that capabilities do not depend on an accidental surface.
6. As an API client, I want request deadlines and cancellation, so that calls do not hang indefinitely.
7. As an API client, I want stable sanitized errors with correlation IDs, so that failures are actionable without leaking secrets or internals.
8. As an API client, I want scoped memory operations to preserve `scope` and `scopeRef`, so that tenant boundaries are enforced end to end.
9. As an API client, I want retries to respect operation safety, so that timeouts do not duplicate writes.
10. As an operator, I want Memongo compatibility checked at readiness, so that an incompatible deployment never receives traffic.
11. As an operator, I want private control-plane routes excluded from tenant credentials, so that tenant traffic cannot invoke administration or maintenance.
12. As an operator, I want MDBrain and Memongo to use independently owned databases and credentials, so that compromise and migration boundaries remain clear.
13. As an operator, I want a deep readiness probe, so that traffic starts only when wiki transactions and required Memongo lanes are usable.
14. As an operator, I want immutable container inputs and generated secrets, so that local and production deployments avoid mutable or default credentials.
15. As an operator, I want documented backup and restore ownership for each product, so that recovery does not couple their schemas.
16. As a security administrator, I want identity, groups, roles, departments, trust tier, and capabilities derived from the authenticated principal, so that request fields cannot elevate authority.
17. As a security administrator, I want request fields to narrow rather than widen authority, so that user input cannot bypass server policy.
18. As a security administrator, I want unknown or stale external identities to fail closed, so that connector ACL drift does not disclose content.
19. As a wiki reader, I want governance applied before and after graph expansion, transclusion, contradiction lookup, lint, revision lookup, and export, so that indirect reads cannot leak protected content.
20. As a wiki editor, I want write authorization checked against the governed target, so that visibility does not imply mutation rights.
21. As a wiki administrator, I want permission changes and hard deletes to require dedicated capabilities, so that ordinary writers cannot perform privileged mutations.
22. As an auditor, I want page changes and revisions committed atomically, so that every visible mutation has a durable audit record.
23. As an auditor, I want existing claim evidence and lineage preserved on unrelated updates, so that provenance is never silently destroyed.
24. As a connector administrator, I want connector secrets kept inside server-side providers and redacted from results and logs, so that credentials cannot escape through normal APIs.
25. As a connector administrator, I want GitHub ACLs mapped to namespaced subjects and groups with revocation behavior, so that the first supported live connector has a truthful authorization model.
26. As an MDBrain user, I want unsupported connector discovery labeled preview or unavailable, so that stubs are not advertised as production connectors.
27. As an exporter, I want Obsidian and OKF paths contained by real paths, so that slugs and symlinks cannot escape the configured root.
28. As an OKF user, I want conformance tested against a pinned external specification, so that import/export claims are reproducible.
29. As an orchestrator, I want a durable local delivery intent before a Memongo write, so that a crash cannot erase the intended work.
30. As an orchestrator, I want confirmed Memongo receipts before wiki promotion, so that wiki lineage never claims a write that may not exist.
31. As an orchestrator, I want ambiguous outcomes reconciled with the same idempotency key, so that retries cannot invent success or duplicate promotion.
32. As an orchestrator, I want dead-letter and unknown states visible, so that irrecoverable and unresolved delivery failures are operable.
33. As a maintainer, I want all memory callers to cross one gateway, so that future Memongo contract changes are localized.
34. As a maintainer, I want wiki callers to use one wiki store, so that schema lifecycle no longer depends on a memory engine.
35. As a maintainer, I want the copied engine removed after cutover proof, so that divergence cannot resume.
36. As a package consumer, I want a clear major-version compatibility boundary, so that removal of direct-engine exports is explicit rather than silently broken.
37. As a release engineer, I want clean-consumer package tests, so that every retained public package installs and runs without workspace-only dependencies.
38. As a reviewer, I want generated route/surface parity tests, so that future routes cannot ship on only one accidental surface.
39. As a reviewer, I want live HTTP, MongoDB transaction, security, and failure-injection evidence, so that unit tests alone cannot produce a production-ready claim.
40. As the product owner, I want the existing-repository choice measured by a bounded prototype, so that the narrow architecture decision can be revisited only with evidence and explicit approval.

## Implementation Decisions

### 1. Product and ownership boundaries

- MDBrain and Memongo remain separate products, repositories, processes, databases, credentials, migrations, backups, and release cadences.
- The only runtime memory boundary is authenticated HTTP. No Memongo package, source, collection, schema initializer, or database credential enters MDBrain.
- MDBrain keeps the wiki/company-brain domain, governance, connectors, OKF, orchestration, API, MCP, client, AI-tool, and web product surfaces.
- The copied MDBrain memory engine is frozen during migration and deleted after the no-caller and integrated-proof gates pass. It is not a fallback.
- There is no dual write. Before cutover, traffic remains on the old deployment; after cutover, memory traffic uses only Memongo.
- Local/OSS defaults to one physical MongoDB cluster with separate logical databases and least-privilege principals. Production may use separate clusters without changing code. Database ownership never becomes shared.

### 2. Supported Memongo contract

- The initial compatibility target is Memongo API `2.0.1` at audited commit `2398cf13902aa2f66deb6c38a28579c90746da8b`.
- Build evidence must include the exact deployed artifact identity, advertised API version, OpenAPI SHA-256 digest, and recorded success/error fixtures.
- Compatibility requires both an accepted semantic version range and an accepted contract digest. Version strings alone are insufficient.
- The gateway validates every response at runtime. Unknown fields may be tolerated only where the schema explicitly allows forward-compatible extension; missing or invalid required fields are contract failures.
- Production transport requires validated HTTPS, hostname verification, and no automatic cross-origin redirect. Plain HTTP is accepted only for an explicit loopback/local development mode.
- Tenant and control-plane credentials are distinct. Root/admin credentials never serve tenant requests.
- Credentials, authorization headers, URLs containing secrets, response internals, and connector secrets are redacted from logs and errors.

### 3. Memory gateway interface

The gateway exports domain operations, not a generic `fetch` escape hatch. Operations are grouped as:

- retrieval and context;
- writes and extraction;
- lifecycle and feedback;
- delivery receipt lookup/reconciliation;
- compatibility and readiness.

Every call receives a server-derived principal/scope context plus correlation ID, deadline, and optional cancellation signal. Callers cannot supply a wider agent, scope, scope reference, or credential class than the authenticated principal permits.

Retrieval returns an explicit state:

- `complete`: every required lane succeeded;
- `partial`: optional lanes failed and omissions are identified;
- `degraded`: a required preferred lane failed but an approved fallback lane answered;
- `failed`: no required retrieval leg produced a trustworthy answer.

Gateway failures form one sanitized discriminated contract:

- validation;
- unauthenticated;
- forbidden;
- not found;
- idempotency conflict;
- rate limited, including retry timing when present;
- upstream unavailable;
- deadline exceeded with known no-write outcome;
- outcome unknown after an ambiguous write timeout;
- incompatible version or contract;
- malformed upstream response;
- internal failure.

Each failure declares whether retry is safe and whether the write outcome is `not-applied`, `applied`, or `unknown`. Reads may use bounded jittered retries for transient failures. Writes retry automatically only when the selected Memongo operation proves idempotency for the same key and payload fingerprint. An ambiguous outcome is never converted to success.

### 4. Route and product-surface disposition matrix

`Public parity` means the operation has a deliberate REST API, typed client, MCP tool, and AI-tool disposition generated from one registry. A surface may intentionally omit an operation only when the registry records the reason and parity tests assert the omission.

| Memongo operation | Class | MDBrain disposition |
| --- | --- | --- |
| `POST /v1/search` | Tenant read | Retain; public parity |
| `POST /v1/search-detailed` | Tenant read | Retain; public parity |
| `POST /v1/search-kb` | Tenant read | Retain; public parity |
| `POST /v1/recall-conversation` | Tenant read | Retain; public parity |
| `POST /v1/profile` | Tenant read | Retain; public parity |
| `POST /v1/hydrate-active-slate` | Tenant read | Retain; public parity |
| `POST /v1/discovery-projection` | Tenant read | Retain; public parity |
| `POST /v1/context-bundle` | Tenant read | Retain; public parity |
| `GET /v1/state` | Tenant read | Retain as scoped state; public parity |
| `POST /v1/read-file` | Server-local file read | Remove from tenant surface; defer until a resource-safe remote contract exists |
| `POST /v1/add` | Tenant write | Retain as compatibility convenience over idempotent event delivery |
| `POST /v1/write-event` | Tenant write | Retain; public parity; idempotency required |
| `POST /v1/write-events` | Tenant write | Retain for internal batching and typed client; MCP/AI tools use bounded single/batch semantics declared by registry |
| `POST /v1/extract` | Tenant write | Retain; public parity |
| `POST /v1/write-structured` | Tenant write | Retain; public parity |
| `POST /v1/write-procedure` | Tenant write | Retain; public parity |
| `POST /v1/lifecycle/get` | Tenant lifecycle | Retain; public parity |
| `POST /v1/lifecycle/update` | Tenant lifecycle | Retain; public parity |
| `POST /v1/lifecycle/delete` | Tenant lifecycle | Retain; public parity with dedicated capability |
| `POST /v1/lifecycle/history` | Tenant lifecycle | Retain; public parity |
| `POST /v1/procedures/outcome` | Tenant feedback | Retain; public parity |
| `POST /v1/memory/feedback` | Tenant feedback | Retain; public parity |
| `POST /v1/import/conversations` | Operator ingestion | Remove from tenant API; expose only as authenticated operator workflow without server-local path input |
| `GET /v1/status` | Service control plane | Consume only for gateway compatibility/readiness; do not proxy publicly |
| `GET /v1/status/detailed` | Service control plane | Private operator surface only |
| `GET /v1/stats` | Service control plane | Private operator surface only |
| `POST /v1/sync` | Service control plane | Private operator surface only |
| `GET /v1/probes/embedding` | Service control plane | Readiness composition only; not tenant-visible |
| `GET /v1/probes/vector` | Service control plane | Readiness composition only; not tenant-visible |
| `POST /v1/chain-trace` | MDBrain orchestration/control | Private orchestration surface; no tenant pass-through |
| `POST /v1/novelty-scan` | MDBrain orchestration/control | Private orchestration surface; no tenant pass-through |
| `POST /v1/consolidate` | MDBrain orchestration/control | Private orchestration surface; no tenant pass-through |
| `POST /v1/self-edit` | MDBrain orchestration/control | Private orchestration surface; no tenant pass-through |
| `POST /v1/admin/relevance/explain` | Memongo admin | Never tenant-proxied; operator credential only if retained |
| `GET /v1/admin/relevance/report` | Memongo admin | Never tenant-proxied |
| `GET /v1/admin/relevance/sample-rate` | Memongo admin | Never tenant-proxied |
| `GET /v1/admin/access-trends` | Memongo admin | Never tenant-proxied |
| `GET /v1/admin/access-summaries` | Memongo admin | Never tenant-proxied |
| `GET /v1/admin/traces` | Memongo admin | Never tenant-proxied |
| `GET /v1/admin/traces/:traceId` | Memongo admin | Never tenant-proxied |
| `GET /v1/jobs` | Memongo admin | Private operator observation only |
| `GET /v1/jobs/:jobId` | Memongo admin | Private operator observation only |

MDBrain-specific route decisions:

| MDBrain surface | Disposition |
| --- | --- |
| Legacy relevance benchmark and server-local benchmark ingestion | Remove from public API; replace with repository test/evaluation commands |
| Public Memongo admin, access-trend, trace, job, sync, probe, consolidation, novelty, and self-edit pass-throughs | Remove from tenant API/MCP/client/tools; retain only deliberate private operator integrations |
| Wiki create/apply, list, governed get/transclusion, search, lint, revision list/detail, update, soft delete, hard delete, OKF import/export | Retain with public parity and capability checks |
| Wiki maintenance trigger that only returns `accepted` without performing durable work | Remove as a public success path; reintroduce only as a durable operator job |
| Wiki delete and revision list/detail missing from MCP or clients | Add to parity registry and generated checks |
| Signed memory-engine export | Remove with the copied engine; keep OKF wiki export. A future Memongo remote export requires a separately versioned contract |

### 5. Server-owned identity and governance

The authenticated principal contains:

- stable subject ID;
- display name as non-authoritative metadata;
- namespaced external groups;
- roles and departments;
- server-assigned trust tier;
- allowed scope/scope-reference pairs;
- capabilities: read, write, administer, change permissions, hard delete, export, and manage connectors;
- identity provider and membership freshness/version.

Request data may select a subset of allowed authority but may never create or widen authority. `admin` trust does not imply a global unfiltered query. Every query still receives explicit scope and capability constraints.

Governance applies to direct reads, lists, lint, revisions, revision details, transclusion, backlinks, maps, graph expansion, contradiction detection and records, search/reranking, export, and maintenance. It is applied before retrieval and again after any expansion or composition step. Protected claim text is not copied into records readable by a weaker principal.

Every mutation performs a governed target lookup, checks the operation capability, checks field-level permission for trust/ACL changes, and uses a separate hard-delete capability. Unknown subjects/groups and stale memberships fail closed.

### 6. Wiki storage lifecycle

The wiki store owns one process-scoped MongoDB client lifecycle for the configured wiki URI and database. It provides:

- connection and configuration resolution from MDBrain-owned settings;
- wiki database and collection namespace access;
- schema/index initialization and verification for wiki-owned collections only;
- transaction execution with session propagation;
- live transaction readiness;
- health/readiness state;
- deterministic graceful shutdown;
- migration entry points.

The memory gateway never initializes wiki storage. The wiki store never receives a Memongo manager or accesses a Memongo database.

Create, update, soft delete, hard-delete audit marker, revision insertion, and any local delivery/promotion outbox mutation that belongs to the same business action execute in one transaction. Production startup fails readiness when transactions are unavailable. Existing claims are copied intact on unrelated updates; only accepted new claims extend evidence and lineage.

### 7. Delivery, idempotency, outbox, and promotion state machine

MDBrain does not implicitly promote every memory write. Promotion is an explicit orchestration decision referencing an immutable, confirmed Memongo receipt or explicitly supplied immutable event.

A local intent uses a stable operation ID, payload fingerprint, principal/scope, and promotion policy. Its state transitions are:

`recorded → delivering → confirmed → promotion-pending → promoted`

Failure branches are:

- `delivering → retryable` when Memongo proves no application;
- `delivering → outcome-unknown` after an ambiguous timeout;
- `outcome-unknown → confirmed` only after reconciliation with the same idempotency key and fingerprint;
- `outcome-unknown → dead-letter` after bounded reconciliation exhaustion;
- any state → `conflict` when the same key is observed with a different fingerprint;
- `promotion-pending → dead-letter` after bounded transactional promotion failures.

The intent is persisted before network delivery. Memongo receipt identity is persisted before promotion. Promotion identity, page/revision state, and wiki lineage commit atomically. Replays with the same operation ID are no-ops returning the existing receipt/promotion result. No timeout is treated as success, and no direct Memongo ingress is advertised as an MDBrain-integrated promotion path.

### 8. Connector, path, and OKF decisions

- GitHub is the first connector eligible for a production-ready claim because it has the strongest current implementation and an existing ACL-mapping seam. It must map repository/user/team identities to namespaced subjects/groups, handle revocation, and fail closed before that claim.
- Confluence, Notion, Slack, CRM, and other incomplete discovery flows remain preview/adapter interfaces until each has real discovery, ACL, revocation, and replay evidence.
- Connector authentication returns only non-secret identity and capability metadata. Secrets remain inside a connector/secret-provider boundary.
- Obsidian and OKF exports validate slug components, reject absolute/traversal/separator tricks, resolve existing path components, reject symlink escapes, and prove final real-path containment.
- OKF compatibility is pinned to a revalidated external commit and conformance fixture set. Content credibility fields never become authorization trust.

### 9. Caller-by-caller engine deletion map

| Current caller or dependency | Replacement and deletion gate |
| --- | --- |
| Memory bridge manager construction and all manager-capability duck typing | Replace with the domain HTTP gateway; remove manager construction only after retrieval, write, lifecycle, feedback, status, and orchestration conformance tests pass |
| Memory bridge side-effectful wiki schema initialization | Move entirely to the wiki store; remove after independent startup/readiness tests pass |
| API wiki database handle derived from the bridge manager | Inject/use the wiki store directly; remove after every wiki route passes storage and governance tests |
| Wiki engine's manager-derived database handle and compatibility search wrapper | Accept the wiki store handle and explicit remote memory dependencies; remove after wiki search and transaction tests pass |
| Wiki package dependency on the copied engine | Remove after the wiki store, embedding/search configuration contract, and clean package install are proven |
| Aggregate memory package engine re-export | Replace with documented remote client/gateway exports in the next major version; no compatibility fallback |
| Wiki initialization and migration commands | Use the wiki store lifecycle and migration entry points |
| MongoDB runtime preparation and parity commands | Split into MDBrain wiki-store checks and remote Memongo readiness/contract checks; remove engine schema imports |
| Capability stress and memory evaluation commands | Rebuild as black-box HTTP evaluations or retire with a documented replacement |
| Engine test-fixture imports used by evaluation | Replace with contract-owned fixtures that do not import production engine source |
| Publishability cohort entry for the copied engine | Remove; add the public wiki package and remote aggregate/client packages to coherent pack/install checks |
| API/MCP/client/admin benchmark and server-local import/read behavior | Remove or convert to explicit private operator/evaluation workflows according to the route matrix |
| Engine-coupled signed export | Remove; retain governed wiki OKF export and defer remote memory export until Memongo exposes a versioned operation |
| Documentation and READMEs advertising direct engine access | Rewrite as HTTP boundary documentation; keep historical evidence only when clearly marked superseded |
| Copied engine package, tests, source-relative scripts, lockfile nodes, and Turbo tasks | Delete last, after all rows above, zero-reference searches, live smoke tests, and clean-slate inventory pass |

Required contraction searches cover engine package imports, source-relative engine imports, memory-manager construction, manager-derived wiki handles, and fallback branches. Production results must be zero before deletion.

### 10. Public package and release decisions

- The aggregate MDBrain memory package remains only as a remote-client compatibility package for the next major release. Direct engine exports are removed and documented as a breaking change; no local-engine shim or fallback remains.
- The wiki package remains public and joins the coherent version/publishability cohort unless clean-consumer testing proves that its public contract cannot be supported. Workspace-only imports are release blockers.
- Every retained public package gets reproducible pack and clean-install tests.
- Engine-internal benchmarks, stress tools, initialization, migration, and parity scripts are rewritten around public HTTP/wiki-store seams or retired.

### 11. API and operational hardening

- Add request IDs, secure headers, bounded request bodies, configurable fail-closed CORS defaults, one sanitized internal-error envelope, and structured redacted telemetry.
- Readiness composes wiki MongoDB ping, a live wiki transaction probe, accepted Memongo version/contract, and the Memongo lanes required by enabled product features.
- Container images are pinned to immutable versions/digests, local ports bind to loopback by default, default passwords are removed, replica-set initialization is explicit, and generated credentials are required.
- MDBrain and Memongo backup/restore procedures are independent. Cross-product references are restored through receipts and reconciliation, not shared database snapshots.

### 12. Clean-slate cutover and rollback

The selected cutover is clean-slate. Before deletion or traffic switch, a read-only preflight records:

- old engine document counts and ownership classification;
- active API keys/clients and deployment inventory;
- outstanding jobs/outbox work;
- current MDBrain and Memongo artifact identities.

A zero/known-test-only result permits clean-slate cutover. Any production or unknown data stops before mutation and opens a production-data decision.

Rollout order is: deploy compatible Memongo; verify contract/readiness; deploy MDBrain with the HTTP gateway dark; run conformance and smoke tests; enable a bounded canary; disable canary on any contract/security/delivery failure; promote after soak; then remove the copied engine in a later contraction change. There is never a dual-write period.

Before engine deletion, rollback means redeploying the previous MDBrain release and routing traffic back before the clean-slate switch. After cutover, rollback means redeploying the previous known-good HTTP-gateway release while leaving Memongo data untouched. After engine deletion, Git history can restore source for diagnosis, but the local engine is not an operational fallback. Promotion can be paused independently while confirmed receipts remain reconcilable.

### 13. Bounded existing-repository prototype

The first implementation ticket performs a bounded compatibility prototype in the existing repository:

- implement one retrieval (`search`) and one idempotent write (`write-event`) against recorded Memongo fixtures through the proposed gateway;
- detach wiki storage far enough to run a representative create/read/revision transaction without a memory manager;
- run representative API, MCP, client, wiki, and package checks;
- count required product-shell rewrites and classify failures.

The prototype is limited to one fresh implementation context and produces measurements, not a second architecture. The existing-repository choice passes when the gateway and wiki-store seams preserve at least 80% of representative existing product tests without rewriting wiki/product behavior and require changes primarily at the two planned seams. It is falsified when more than 30% of preserved wiki/product modules need semantic rewrites, the two seams cannot keep API/MCP/client behavior coherent, or representative tests cannot be made green without retaining engine internals.

A pass continues in the existing repository. A falsification stops before a new repository, data mutation, or broad rewrite and requests explicit user approval to reconsider greenfield.

## Testing Decisions

Good tests assert externally observable authorization, delivery, compatibility, and product behavior. They do not assert private helper structure or duplicate upstream Memongo unit tests. Contract fixtures are generated from the pinned deployed artifact; fakes must conform to the same fixtures as live smoke tests.

### Test and proof matrix

| Gate | Required proof | Stop condition |
| --- | --- | --- |
| Contract lock | Artifact identity, API version, OpenAPI digest, recorded success/error fixtures, TLS/redirect policy | Version/digest mismatch or missing idempotency semantics |
| Prototype | Search/write-event fixture path, independent wiki transaction, representative test retention metrics | Existing-repository falsification thresholds |
| Clean-slate | Read-only data/client/job inventory | Any production or unknown data/ownership |
| Identity | REST and MCP fixtures for scope, role, department, subject, group, trust, capability, and stale identity | Any authority expansion from request input |
| Governed reads | Direct, graph, transclusion, contradiction, lint, revision, search, and export leakage tests | Any protected content or claim-text disclosure |
| Governed writes | Target lookup, field authorization, permission change, soft/hard delete tests across REST/MCP/client | Any unauthorized mutation |
| Wiki atomicity | Live replica-set transaction tests with failpoints between page, revision, and outbox writes | Partial page/revision/outbox commit |
| Provenance | Update tests preserving evidence, writer, derivation, supersession, and source identity | Any unrelated provenance loss |
| Gateway | Runtime response validation, scope derivation, deadlines, cancellation, redaction, version checks | Arbitrary proxy escape or malformed response accepted |
| Retry/idempotency | 429, unavailable, known timeout, ambiguous timeout, replay, payload conflict, bounded reconciliation | Duplicate effect or inferred success |
| Retrieval states | Complete, partial, degraded, and all-required-legs-failed cases | Empty success for unavailable required legs |
| Surface parity | Generated route registry compared with REST, client, MCP, AI tools, and OpenAPI | Accidental one-surface capability |
| Connector security | Secret redaction, GitHub identity/team mapping, revocation, stale/unknown membership | Secret leak or stale ACL access |
| Path safety | Absolute, traversal, separators, symlink components, final real-path escape | Write outside configured root |
| OKF | Pinned conformance fixtures, extension preservation, links/sources/headings/trust round trips | Unsupported conformance claim |
| Operations | HTTPS certificate/hostname/redirect failures, body limits, headers, CORS, deep readiness, immutable containers | Insecure production transport or false readiness |
| Engine contraction | Zero production references to the engine package/source/manager-derived wiki handle; clean dependency graph | Any production caller or fallback remains |
| Packages | Reproducible packs and clean external installs for every public package | Workspace-only dependency or incoherent versions |
| Integrated proof | Ingest, retrieve, promote, cite, revise, delete, restore; live Memongo and live wiki MongoDB; web type check; all tests/types/lint | Unit-only evidence, failed suite, or unresolved error |

Prior art includes the existing bridge/API contract tests, API contract fixtures, MCP handler tests, client tests, wiki governance tests, wiki revision tests, OKF tests, connector tests, and live MongoDB evaluation harnesses. They should be adapted to the new seams rather than replaced with implementation-detail tests.

## Dependency-Ordered Delivery Map

1. Lock the deployed Memongo contract, run the bounded repository prototype, and prove the clean-slate precondition.
2. Establish the server-owned principal and govern every wiki read surface.
3. Give wiki storage independent ownership and transaction readiness.
4. Govern and atomically audit every wiki mutation while preserving claim evidence.
5. Harden connector secrets/ACLs, path containment, and OKF conformance.
6. Expand the memory bridge with the versioned HTTP gateway and land one complete retrieval slice.
7. Migrate write, extraction, lifecycle, feedback, and batch delivery with explicit idempotency.
8. Add durable delivery reconciliation and receipt-based wiki promotion.
9. Reconcile REST/client/MCP/AI-tool/OpenAPI surfaces and remove tenant control-plane pass-throughs.
10. Harden API readiness, transport, containers, credentials, and package publishing.
11. Migrate or retire every engine-coupled script and aggregate export.
12. Contract: delete the copied engine only after no-caller and live-cutover gates.
13. Run integrated proof, rollback rehearsal, and final documentation.

The ticket files under `.scratch/mdbrain-over-memongo-http/issues/` are the executable dependency graph for this map.

## Out of Scope

- Modifying Memongo source or opening Memongo feature work.
- Importing Memongo packages or copying Memongo modules.
- Building a third shared core.
- Keeping the local engine as fallback or operating a dual-write migration.
- Sharing collection ownership, schema initialization, or database credentials.
- Turning Memongo into a wiki.
- Starting a greenfield repository without prototype falsification and explicit approval.
- Advertising incomplete connectors as production-ready.
- Claiming OKF conformance without a pinned suite.
- Publicly proxying Memongo administration or server-local file operations.
- A migration of production data under the clean-slate decision.
- Publishing, releasing, deleting user data, or changing production traffic without the workflow's release authority and safety gates.

## Further Notes

- The route matrix is intentionally narrower than the current MDBrain API. Compatibility breaks are grouped into the next major release and documented rather than hidden behind insecure pass-throughs.
- Typed per-evidence bindings and a named contradiction-before-dedup gate remain possible future Memongo work, not prerequisites here.
- Current baseline evidence was 1,937 passing non-web unit tests and passing non-web type checks; web checks and all live/e2e proofs must be rerun from a complete install.
- The handoff's untracked files are user work and must not be deleted, moved, or overwritten.
