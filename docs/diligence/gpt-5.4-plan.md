# MDBrain Acquisition-Readiness Remediation Plan

**Status:** Round 1 independent plan, planning only  
**Method:** Documentation-Driven Development (DDD)  
**Target:** A fresh evaluator can verify the product, its public claims match the shipped code, and incomplete surfaces are not presented as finished features.

## 1. Outcome and acceptance boundary

The acquisition-ready release must satisfy all of the following:

1. A fresh clone, Docker, Bun 1.2.5, and a MongoDB Atlas Model API key are sufficient to boot the complete stack. No sibling Memongo checkout is required.
2. The documented commands reach healthy MongoDB Search, Memongo 2.1.0, MDBrain API, and web services, then create and retrieve a known wiki page through the public API.
3. The default hybrid-search path is ready before `/ready` returns `200`; a missing or invalid model API key produces an actionable failure instead of a misleading healthy state.
4. Only implemented connectors are exported and advertised. Obsidian becomes a callable, tested one-shot import/export integration.
5. Git-diff and Dreamer maintenance have supported one-shot CLI entry points, bounded OpenAI-compatible LLM calls, and deterministic failure semantics.
6. Dreamer classification affects behavior and claim extraction is structured. The existing “whole event at confidence 0.7” shortcut is not called a five-phase implementation.
7. README, package docs, changelog, web architecture copy, tool counts, Memongo pin, and governance wording agree with executable behavior.
8. Unreachable signed-export code and nonfunctional API/MCP Wrangler configurations are removed; the live OpenNext web configuration remains.
9. Existing repository quality gates and new full-stack/claim-drift gates pass.

## 2. Verified baseline

- `README.md:118-167` starts `docker/docker-compose.minimal.yml`, which runs `mongo:7` without `mongot`, then promises hybrid wiki search.
- `packages/wiki-engine/src/wiki-search-probe.ts:25-66` makes `/ready` depend on a live Atlas Search index and `$search` round trip.
- `docker/compose.full.yml:1-93` has the correct service topology, but Memongo builds from `../../memongo` and MongoDB uses the mutable `preview` tag.
- `packages/wiki-engine/src/wiki-schema.ts:842-955` defines a Voyage `autoEmbed` vector index and a text Search index; index creation warnings do not fail startup.
- `packages/wiki-engine/src/wiki-search.ts:445-480` applies role, subject, group, and department ACLs after a four-times over-fetch; scope and scalar filters are index-side.
- `packages/memory-bridge/src/memongo-runtime.ts` pins Memongo contract `2.1.0` plus a canonical SHA-256, despite `README.md:128` saying `2.0.1`.
- `apps/mcp/src/server.ts` declares 30 MCP tool names; `packages/tools/src/index.ts:316-402` exposes 14 AI SDK helpers, despite the README’s single count of 34.
- `packages/wiki-engine/src/wiki-connectors.ts:70-223` has real Obsidian discovery/export but a no-op `ingest`; the other five concrete connector classes are API-shaped shells.
- No application or script imports a connector. Maintenance functions are exported from `packages/wiki-engine/src/index.ts:184-186` but have no production caller.
- `packages/wiki-engine/src/wiki-maintenance.ts:329-341` computes and discards Dreamer’s injection type, then treats the entire event as one 0.7-confidence claim.
- `packages/memory-bridge/src/mdbrain-export.ts` is only imported by its own test and is not reachable through the package’s sole `.` export.
- `apps/api/wrangler.jsonc` points Wrangler at a Node/Hono server and `apps/mcp/wrangler.jsonc` points it at a stdio server. Neither app has a Wrangler script.
- `apps/web/wrangler.jsonc` is live OpenNext configuration and must remain.
- `apps/web/lib/marketing/comparisons.ts:241` describes **OpenWiki’s** strengths, not MDBrain’s. It is not evidence of an MDBrain connector claim and should not be rewritten for this finding.

## 3. Decisions

### D1. Make `docker/compose.full.yml` the canonical quickstart

Do not repair the plain `mongo:7` stack into a partial product. Keep it only as a clearly labeled transaction-only developer fixture, and remove it from all product quickstarts. The canonical route is Atlas Local because the public API requires MongoDB Search and the default query recipe uses both Search and Vector Search.

### D2. Use immutable, published images

Publish a public Memongo `2.1.0` OCI image, record its multi-platform digest, and consume it by digest. Pin the Atlas Local manifest digest as well. Remove the `../../memongo` build context from the canonical compose file. The runtime contract version and SHA check remains the semantic compatibility gate even after image pinning.

### D3. Require the model key for the advertised hybrid quickstart

Use Compose required-value interpolation for `VOYAGE_API_KEY`. Document how to create an `al-...` MongoDB Atlas Model API key. Do not ship a dummy value or silently describe text-only degradation as hybrid search.

### D4. Keep one real connector and delete five shells

Retain the provider-neutral connector contract, registry, and Obsidian implementation. Make Obsidian `ingest` actually create/update wiki pages and expose a one-shot CLI. Remove GitHub, Confluence, Notion, Slack, and CRM concrete classes/config types/tests/public exports until they have authenticated discovery and integration tests. This is a deliberate pre-release public-surface reduction, recorded in the changelog.

### D5. Wire maintenance as explicit one-shot operations

Add operator-run CLIs, suitable for CI or cron, rather than introducing an in-process scheduler. Scheduling, distributed leases, retries, and tenant policy are deployment concerns and should not be improvised for diligence.

### D6. Finish Dreamer semantics before calling it five-phase

Make structured analysis a required dependency of Dreamer promotion. It returns an injection decision and granular claims; `ignore`, `new`, `update`, and `contradiction` must lead to distinct tested behavior. Remove the implicit whole-event fallback. If a heuristic path remains useful, expose it under an explicitly different name and do not market it as Dreamer.

### D7. Correct governance wording, do not redesign authorization in this pass

The current post-filter prevents unauthorized results from being returned; the residual issue is recall/underfill, not a demonstrated disclosure. Describe the split honestly and add non-leakage/underfill tests. Defer native role/department filtering to a separate, benchmarked design because Vector Search and Search accept different filter grammars and an unreviewed rewrite would increase security risk.

### D8. Remove dead artifacts instead of manufacturing features around them

Delete `mdbrain-export.ts` and its test. It only signs caller-supplied data and does not implement the “export every memory” guarantee in its header. This does not affect the implemented OKF wiki export. Delete the API and MCP Wrangler files; retain the web Wrangler file.

## 4. Documentation basis

Versions come from `package.json` and `bun.lock`: Bun 1.2.5, Node >=20.19 (container Node 22), MongoDB Node driver 7.2.0, Hono 4.12.28 with `@hono/node-server` 1.19.14, MCP SDK 1.29.0, Wrangler 4.107.1, and OpenNext Cloudflare 1.20.1. Docker Compose and the OpenAI-compatible HTTP contract are external, living interfaces, so pin minimum supported behavior in project docs and exercise it in CI.

| Decision | Official source | Application |
|---|---|---|
| Atlas Local container | [Deploy Atlas Local with Docker](https://www.mongodb.com/docs/atlas/cli/current/atlas-cli-deploy-docker/) | Use the Atlas Local image, built-in health behavior, and replica-set/Search topology rather than `mongo:7`. |
| Automated embeddings | [Automated Embedding](https://www.mongodb.com/docs/atlas/atlas-vector-search/automated-embedding/) | Treat model access as a real dependency of the `autoEmbed` index and default hybrid query. |
| MongoDB AI API keys | [Manage MongoDB AI API Keys](https://www.mongodb.com/docs/voyageai/management/api-keys/) | Document the required `al-...` key and never commit it. |
| Search index lifecycle | [Manage Search Indexes with the Node.js Driver](https://www.mongodb.com/docs/drivers/node/current/indexes/search-indexes/) | Wait for both expected indexes and prove queryability before readiness. |
| Transactions | [Node.js Driver Transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/) | Preserve replica-set transactions and existing `withTransaction` behavior. |
| Rank fusion | [`$rankFusion`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankfusion/) | Preserve the existing hybrid retrieval pipeline and validate it end to end. |
| Search compound filters | [MongoDB Search `compound`](https://www.mongodb.com/docs/atlas/atlas-search/compound/) | Document which scalar governance fields are applied inside Search. |
| Vector filters | [`$vectorSearch` filter](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/#mongodb-vector-search-pre-filter) | Do not assume Search and Vector Search ACL expressions are interchangeable. |
| Compose variables | [Interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/) | Use `${VOYAGE_API_KEY:?message}` for fail-fast configuration. |
| Compose readiness | [Startup order](https://docs.docker.com/compose/how-tos/startup-order/) and [`docker compose up --wait`](https://docs.docker.com/reference/cli/docker/compose/up/) | Keep health-conditioned dependencies and make the documented command wait for readiness. |
| Structured model output | [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | Constrain maintenance responses with JSON Schema and validate again locally. |
| Package public surface | [npm `package.json` exports](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#exports) and [Node 22 packages](https://nodejs.org/download/release/v22.22.0/docs/api/packages.html#package-entry-points) | Treat only declared package exports as public/reachable and test packed artifacts. |
| Hono Node runtime | [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs) | Keep the API on `@hono/node-server`; do not imply a Workers deployment. |
| MCP tools | [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | Verify advertised MCP tools through `tools/list`, not source-text counting. |
| Cloudflare/OpenNext config | [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) and [OpenNext Cloudflare get started](https://opennext.js.org/cloudflare/get-started) | Keep only the web Worker configuration that is consumed by its build/deploy scripts. |
| Filesystem safety | [Node.js 22 file-system API](https://nodejs.org/download/release/v22.22.0/docs/api/fs.html) | Preserve the existing containment and symlink defenses for Obsidian export/import paths. |
| Repository runtime | [Install Bun](https://bun.com/docs/installation) and [Turborepo `run`](https://turborepo.com/docs/reference/run) | Keep the pinned Bun version and existing monorepo gates. |

## 5. Implementation workstreams

### Workstream A — Self-contained, executable quickstart (P0)

**Files**

- `docker/compose.full.yml`
- `docker/docker-compose.minimal.yml`
- `docker/mongodb/docker-compose.preview.yml`
- `.env.example`
- `README.md`
- `scripts/compose-smoke.ts`
- `.github/workflows/ci.yml`
- optionally `docker/README.md` for the transaction-only fixture

**Steps**

1. Publish Memongo 2.1.0 as a public multi-platform OCI image from the Memongo repository. Capture its immutable digest and attach source revision, SBOM, and provenance in that repository’s release process.
2. Resolve the current supported Atlas Local multi-platform digest. Record both image tags and digests in a short dependency-update note; add ownership and a monthly digest-refresh process.
3. Replace the Memongo sibling `build.context` with the digest-pinned image. Pin Atlas Local by digest. Keep MDBrain API/web local builds so the evaluator tests the checked-out source.
4. Change `VOYAGE_API_KEY` interpolation to required-value syntax with a useful error. Add a dedicated `docker/.env.quickstart.example` containing only quickstart inputs and non-secret local defaults.
5. Retain loopback host bindings, health checks, and `condition: service_healthy`. Do not expose MongoDB or Memongo beyond localhost.
6. Update `probeWikiSearch` to require both named indexes and perform a bounded default-hybrid query, not only a text query. Return a capability-specific failure while preserving the current 5-second client timeout.
7. Make `ensureWikiSearchIndexes` report individual vector/text creation status. A failed vector index must remain visible to readiness and logs rather than becoming an unexplained later 503.
8. Replace README quickstart commands with the full compose stack and `docker compose ... up --build --wait --wait-timeout 180`. State Docker Compose v2 and the model key as prerequisites.
9. Extend `compose-smoke.ts`: create a uniquely named wiki page, poll hybrid search until that exact slug is returned, and continue testing memory write/recall and the web endpoint. Empty wiki results are no longer a pass.
10. Change `bundle-smoke` to check out only MDBrain. Supply `VOYAGE_API_KEY` from protected CI for the hybrid lane. Add a secret-free structural job that runs `docker compose config` with a redacted nonfunctional placeholder and builds MDBrain images, so fork PRs still receive useful feedback.
11. Keep `docker-compose.minimal.yml` only if renamed/documented as transaction-only and explicitly incompatible with API readiness/search. Otherwise remove it after updating all references.

**Proposed, untested Compose shape**

```yaml
services:
  mongodb:
    image: mongodb/mongodb-atlas-local:preview@sha256:<verified-manifest-digest>
    environment:
      VOYAGE_API_KEY: ${VOYAGE_API_KEY:?Set an Atlas Model API key with an al- prefix}
  memongo:
    image: ghcr.io/romiluz13/memongo:2.1.0@sha256:<verified-manifest-digest>
```

The placeholders must be replaced with registry-resolved digests before implementation is considered complete.

**Acceptance**

- A clean checkout with no `../memongo` directory reaches healthy status with the README commands.
- `/ready` is `200` only after the Memongo contract and both wiki search lanes pass.
- The documented create request succeeds and the documented hybrid query returns the created slug.
- Missing `VOYAGE_API_KEY` fails before containers start; invalid credentials fail readiness with a non-secret diagnostic.
- `scripts/compose-smoke.ts` fails if search returns an empty result or the wrong page.

### Workstream B — Honest, usable connector surface (P1)

**Files**

- `packages/wiki-engine/src/wiki-connectors.ts`
- `packages/wiki-engine/src/wiki-connectors.test.ts`
- `packages/wiki-engine/src/index.ts`
- new `scripts/wiki-obsidian-sync.ts` and focused tests
- `package.json`
- `packages/wiki-engine/README.md`
- `CHANGELOG.md`

**Steps**

1. Store the `WikiDbHandle` in `ObsidianConnector`; use relative vault paths/IDs for stable identity and never persist host-absolute paths.
2. Implement one-shot Obsidian ingest using `createWikiPage`/`updateWikiPage`. Map Markdown title/frontmatter/body into a source page, record `frontmatter.resource` and a maintenance hash, apply `mapPermissions`, and report accurate processed/created/updated/error counts.
3. Reuse `writeContainedFiles` for export and preserve its traversal, symlink, all-or-nothing, and nested-slug tests.
4. Add `wiki:sync:obsidian` with `import` and `export` modes, explicit vault/scope/scopeRef flags, preflight authentication, JSON summary output, nonzero exit on partial failure, and guaranteed store shutdown.
5. Do not start a long-lived watcher in the CLI. A later daemon can own watcher lifecycle, debounce persistence, retries, and leader election.
6. Delete the five shell connector classes and their config exports/tests. Keep `SourceConnector`, `ConnectorRegistry`, shared result types, and Obsidian.
7. Add integration tests proving discovery followed by ingest creates a page, a changed file updates rather than duplicates it, cursor filtering works, permission defaults are internal, and malicious paths cannot escape the vault.

**Acceptance**

- No exported connector returns success with zero work by design.
- `bun run wiki:sync:obsidian -- import ...` changes a test MongoDB-backed wiki and a second unchanged run is idempotent.
- Public docs say “Obsidian connector plus an extension contract,” not “six connectors.”

### Workstream C — Production-callable maintenance (P1)

**Files**

- `packages/wiki-engine/src/wiki-maintenance.ts`
- `packages/wiki-engine/src/wiki-maintenance.test.ts`
- new `scripts/lib/openai-compatible-llm.ts`
- new `scripts/wiki-maintenance.ts`
- focused script tests
- `package.json`
- `.env.example`

**Steps**

1. Extract the OpenAI-compatible request mechanics already demonstrated by `scripts/real-agent-smoke.ts` into a small shared adapter. Continue using `MDBRAIN_LLM_BASE_URL`, `MDBRAIN_LLM_API_KEY`, `MDBRAIN_LLM_MODEL`, `MDBRAIN_LLM_AUTH_STYLE`, and `MDBRAIN_LLM_TOKEN_PARAM`.
2. Add timeout/abort, response-size limits, source/event-size limits, bounded concurrency, retry only on explicit transient status codes, and redacted errors. Never log credentials or full source/event content.
3. Request JSON-Schema-constrained output and validate the parsed result locally before it reaches write code. Reject unknown decision values, empty claims, out-of-range confidence, or malformed payloads.
4. Keep `LlmGenerateFn` dependency injection for git-diff maintenance. Add a separate `DreamerAnalyzeFn` that receives the event plus the top similar candidate and returns:
   - `decision`: `ignore | new | update | contradiction`
   - target/title/summary/body fields appropriate to the decision
   - granular claims with explicit confidence and source-event provenance
5. Make phase 3 control phase 5: `ignore` performs no write; `new` creates a page; `update` targets the matched page; `contradiction` enters the existing contradiction-before-dedup write gate. Do not keep `_injectionType` as dead computation.
6. Remove the automatic whole-event/0.7-confidence extraction path. If retained for emergency deterministic operation, rename it as a heuristic importer and report that mode in `MaintenanceResult`.
7. Add a one-shot CLI:
   - `git-diff`: enumerate explicitly included tracked files, compare maintenance hashes, invoke `runGitDiffMaintenance`.
   - `dreamer`: read validated JSONL events from a file/stdin and invoke `runDreamerPromotion`.
   - both require scope/scopeRef, support a preflight/dry-run that performs no writes, emit a machine-readable summary, and return nonzero if any item failed.
8. Do not let a process loop become the scheduler. Document invocation from CI/cron and idempotency expectations.

**Adapted from the official Structured Outputs guide**

```ts
// Proposed, untested adapter boundary. The implementation must use the
// configured OpenAI-compatible base URL/model and validate again locally.
const body = {
  model,
  messages,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "mdbrain_maintenance",
      strict: true,
      schema: maintenanceSchema
    }
  }
};
```

**Acceptance**

- Fake-server tests cover success, refusal/malformed JSON, timeout, 429/5xx retry bounds, and credential redaction.
- Unit tests prove every Dreamer decision changes behavior as specified and no unclassified write occurs.
- CLI integration tests prove dry-run is write-free, repeated source input is idempotent, and per-item failures produce a nonzero exit.
- README calls maintenance “operator-triggered” and names the supported commands; it does not imply autonomous scheduling.

### Workstream D — Truth-in-advertising and drift prevention (P0/P1)

**Files**

- `README.md`
- `packages/wiki-engine/README.md`
- `docs/platform/capability-matrix.md`
- `CHANGELOG.md`
- `apps/web/lib/marketing/architecture.ts`
- any other matches found by a final repository-wide claim audit
- new executable claim-inventory test/script

**Steps**

1. Replace “34 tools” with separate, mechanically verified facts: 30 MCP tool names and 14 AI SDK helpers. Explain aliases if they are included in the MCP count.
2. Add an MCP protocol test that calls `tools/list` and snapshots unique names. Add an SDK test around `Object.keys(createMdbrainTools(...))`. Make the documentation check read generated inventory data or stable markers so count drift fails CI.
3. Replace Memongo 2.0.1 with “contract 2.1.0 plus pinned canonical SHA-256.” Clarify that the bridge package’s own npm version is a separate version.
4. Replace “governance is native to the database query layer” with exact behavior: scope, scopeRef, state, trust tier, and exact privacy tier are index-side; subject/group/role/department visibility is enforced before response by application post-filter over a four-times candidate pool. State the possible underfill without implying a data leak.
5. Replace six-connector copy/diagram rows with the shipped Obsidian integration and provider-neutral extension contract.
6. Describe git-diff and Dreamer maintenance only after Workstream C is callable. Use “operator-triggered” and distinguish LLM-required Dreamer from any heuristic importer.
7. Change the web architecture source stage to link to the actual Obsidian CLI/integration test, not merely the connector interface.
8. Leave `apps/web/lib/marketing/comparisons.ts:241` intact unless an independent source review finds the OpenWiki statement inaccurate; it describes the competitor.
9. Update “verified at” dates only after all linked source anchors are valid on the release commit.

**Acceptance**

- Repository-wide searches find no stale `34 tools`, `Memongo 2.0.1`, “six connectors,” autonomous maintenance, or database-native ACL claim.
- Claim-inventory tests fail on duplicate MCP names and on README count drift.
- Each acquisition-facing capability links to executable code or a passing test, not only an interface.

### Workstream E — Dead-code and deployment-config cleanup (P1)

**Files**

- delete `packages/memory-bridge/src/mdbrain-export.ts`
- delete `packages/memory-bridge/src/mdbrain-export.test.ts`
- delete `apps/api/wrangler.jsonc`
- delete `apps/mcp/wrangler.jsonc`
- retain `apps/web/wrangler.jsonc`
- adjust comments/docs/changelog found by repository-wide search

**Steps**

1. Remove the signed bundle helpers and their “export every memory” invariant. They have no retrieval path and are outside `@mdbrain/memory-bridge`’s declared package entry point.
2. Keep OKF import/export unchanged; it is a separate implemented wiki capability.
3. Remove API/MCP Wrangler files. Their actual runtimes remain Node/Hono HTTP and Node stdio MCP.
4. Keep and validate web OpenNext build/preview/deploy scripts against `apps/web/wrangler.jsonc`.
5. Extend `check-publishability` to verify package entry points and packed files, preventing future compiled-but-unreachable public APIs.

**Acceptance**

- No source, generated declaration, test, or documentation reference remains for `mdbrain-export`.
- API and MCP docs name only their real deployment/runtime model.
- `bun run --cwd apps/web build` and the existing OpenNext preview/build check still consume the web Wrangler configuration.

## 6. Explicit non-changes

- Do not alter `MEMONGO_CONTRACT_VERSION`, its SHA-256, or fail-closed compatibility verification except through the existing pin-bump process.
- Do not merge Memongo storage into MDBrain or bypass its HTTP ownership boundary.
- Do not replace the MongoDB document model, transaction boundary, Search/Vector Search, `$rankFusion`, `$rerank` fallback, or `$graphLookup` architecture.
- Do not weaken search-outage handling into empty results.
- Do not relax API authentication, scope identity, path containment, or loopback Docker bindings.
- Do not rewrite governance filtering during this remediation; document and test it, then handle native ACL filtering in a separate threat-modeled/benchmarked design.
- Do not implement five external SaaS connectors merely to preserve a count.
- Do not add a background scheduler, queue, or control plane for one-shot maintenance commands.
- Do not remove `apps/web/wrangler.jsonc` or port the Node API/stdio MCP server to Workers.
- Do not confuse dead signed-memory export helpers with the live OKF wiki import/export.
- Do not commit model, Memongo, MDBrain, or CI secrets.

## 7. Validation and release gates

Run in this order and stop on the first failure:

1. **Static repository gates**
   - `bun install --frozen-lockfile`
   - `bun run check-types`
   - `bun run lint`
   - `bun run build`
   - `bun run check-publishability`
   - `bun run test`
2. **Focused behavioral gates**
   - connector tests, including MongoDB-backed Obsidian create/update/idempotency
   - maintenance engine and LLM-adapter tests
   - MCP `tools/list` and SDK tool-inventory tests
   - governance non-leakage and top-K underfill regression tests
3. **Compose structural gate, no live secret**
   - render `docker/compose.full.yml` with `docker compose config`
   - confirm no sibling build context, no host-wide port binding, and image references include digests
   - build MDBrain API/web images
4. **Protected hybrid end-to-end gate**
   - export a masked `VOYAGE_API_KEY`
   - `docker compose -f docker/compose.full.yml up --build --wait --wait-timeout 180`
   - `curl -fsS http://127.0.0.1:3847/ready`
   - `MDBRAIN_API_KEY=dev-mdbrain-key bun scripts/compose-smoke.ts`
   - `bun run stress-test` with bounded acquisition-review settings
   - capture `docker compose ps`, image digests, `/ready` capability output, and smoke/stress summaries
   - always `docker compose ... down -v`
5. **Negative-path gate**
   - missing key fails Compose interpolation
   - invalid key prevents hybrid readiness
   - incompatible Memongo contract prevents readiness
   - stopped `mongot` changes readiness to non-200 within the bounded probe
   - unauthorized role/department searches return no protected documents
6. **Fresh-machine release rehearsal**
   - run the README literally in a clean temporary checkout on Linux with no sibling repositories or prior volumes
   - repeat on macOS as a manual release check
   - archive command transcript, timings, image digests, and sanitized outputs as the diligence proof pack

## 8. Delivery sequence and ownership

1. **PR 1, P0:** Publish/pin Memongo and Atlas Local images; repair compose, readiness, smoke, and CI.
2. **PR 2, P1:** Complete and wire Obsidian; remove shell connectors and update public exports.
3. **PR 3, P1:** Add the LLM adapter and maintenance CLI; finish Dreamer decisions/extraction.
4. **PR 4, P0/P1:** Correct all acquisition-facing claims and add inventory drift gates.
5. **PR 5, P1:** Remove dead export/Wrangler artifacts and strengthen publishability checks.
6. **Release candidate:** Run the full validation matrix and publish the sanitized proof pack.

Each PR must be independently green and must not advertise a capability before its implementation PR lands. If external image publication blocks PR 1, the release remains blocked; do not restore the sibling-checkout quickstart as a substitute.

## 9. Definition of done

The work is done only when an evaluator can follow the README from a clean checkout, observe a genuinely hybrid-ready `/ready`, create and retrieve a known wiki page, run the supported Obsidian and maintenance commands, reconcile every public capability claim to an executable test, and find no placeholder connector, unreachable export implementation, or fictitious deployment configuration in the shipped tree.
