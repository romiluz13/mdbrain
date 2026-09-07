# Changelog

All notable changes to Mdbrain will be documented in this file.

## Unreleased

### Added

- Operator-triggered maintenance CLI (`bun run wiki:maintenance`, i.e.
  `scripts/maintenance-run.ts`): `git-diff` (detect changed sources via
  `maintenanceHash`, regenerate affected pages) and `dreamer` (promote
  JSONL events through the 5-phase pipeline), with shared
  `--scope/--scopeRef/--dry-run/--json` flags, a JSON run summary, nonzero
  exit on item errors, and guaranteed store shutdown. Dry-run performs
  detection only — no LLM calls, no writes.
- An OpenAI-compatible LLM adapter for maintenance tooling
  (`scripts/lib/openai-compatible-llm.ts`) with an explicit environment
  contract (`MDBRAIN_LLM_*`: base URL, key, model, auth style, token
  parameter, timeout, response byte cap, structured-outputs toggle),
  retry-on-transient-only transport (429/500/502/503/504, max 2), API-key
  redaction in every error message, refusal/truncation/malformed-JSON
  typed errors, and a local JSON Schema subset validator
  (`scripts/lib/json-schema.ts`) as the validation floor for every
  response regardless of provider Structured Outputs support.
- `DreamerClassifier` (phase 3 injection classification + phase 4 per-claim
  confidence extraction with event provenance) and
  `MaintenanceResult.extractionMode` disclosure (`"llm"` vs
  `"heuristic-importer"`).

### Changed

- Dreamer promotion is now LLM-classified: phases 3–4 call a configured
  classifier and phase 5 routes per verdict (`ignore` → disclosed
  rejection, `contradiction` → contradiction counter, `new`/`update` →
  pipeline-gated promotion). It fails closed with
  `MaintenanceLlmUnconfiguredError` when no classifier is configured; the
  legacy whole-event/0.7-confidence importer is an explicit
  `--importer heuristic-importer` opt-in, never the default.
- Root `bun run test` now sweeps the whole `scripts/` tree
  (`bunx vitest run --dir scripts`; previously `scripts/*.test.ts` shell
  expansion missed `scripts/lib/**`), and `bun run check-types`
  additionally typechecks the scripts tree via `scripts/tsconfig.json`
  (root `@types/node` and `vitest` devDependencies added; `apps/api` gains
  a build-only tsconfig that excludes tests from dist so the
  contract-parity cross-app import no longer needs a `@ts-expect-error`).

### Removed

- The GitHub/Confluence/Notion/Slack/CRM shell connectors
  (`packages/wiki-engine/src/wiki-connectors.ts` and their exports/tests):
  they reported success while writing nothing. The Obsidian connector
  (beta) stays for real vault discovery and path-contained export; its
  `ingest` now throws `ConnectorNotImplementedError` instead of returning
  a zero-count success.

### Fixed

- API handlers now dispatch and query with the canonical identity authorized
  by request middleware, while accepting whitespace-padded equivalent
  `agentId`, `scope`, and `scopeRef` spellings. Existing wiki pages stored in
  whitespace-padded scope partitions are not migrated automatically and are
  not addressed by canonical requests; operators must migrate or reclaim those
  partitions separately.
- Memory delivery intents now persist an undefined-stripped payload: the
  MongoDB driver serializes `undefined` as `null`, so an intent recorded with
  absent optional fields (`sessionId`/`timestamp`/`metadata` omitted) stored a
  different shape than the one fingerprinted — every reconciliation replay
  flagged a `payloadFingerprint` conflict and the intent could never complete.
  The ledger now stores exactly what it fingerprints.
- The delivery dispatch lease now scales with `MEMONGO_TIMEOUT_MS`
  (30s floor, 2 × bridge deadline + 10s settlement margin — a cold dispatch
  performs up to two deadline-bounded round trips: the contract
  compatibility check and the write). A raised bridge deadline without a
  matching lease let the reconciler reclaim mid-flight writes and surface
  spurious `DELIVERY_LEASE_LOST` conflicts (observed on the keyless compose
  bundle's one-time ~62s first write).
- The wiki search readiness probe now enforces its per-operation bound via
  the MongoDB driver's `timeoutMS` deadline instead of a `Promise.race`,
  so a timed-out probe cancels the underlying operation rather than
  abandoning it mid-flight on the connection pool.

### Changed

- `/ready` now reports a wiki search capability block: `text` stays
  fail-closed (broken text lane → 503), while `vector`/`autoEmbed` report
  `ready`/`unavailable` with an actionable, non-secret diagnostic. A missing
  or rejected Voyage model key no longer masquerades as a working stack.
- The README quickstart is now one canonical path (`docker/compose.full.yml`)
  with verbatim commands, a key-provisioning paragraph, and a documented
  keyless dev mode; `compose-smoke` requires the wiki page it creates to be
  returned by hybrid search (empty results fail).
- The compose bundle raises the Memongo bridge deadline
  (`MEMONGO_TIMEOUT_MS: 120000`) and the smoke's first write carries a 180s
  client deadline: a keyless boot pays a one-time ~60s Memongo index-bootstrap
  wait on the first memory write (measured 61.7s first, 51ms second). Keyed
  boots are unaffected.
- Dev-convenience compose stacks are relabeled and explicitly excluded from
  the canonical quickstart.

### Removed

- `packages/memory-bridge/src/mdbrain-export.ts` (unreachable from the
  package entry; its "export every memory" header over-promised). Marked for
  post-sale revival with a real retrieval path.
- Dead `apps/api/wrangler.jsonc` and `apps/mcp/wrangler.jsonc` (runtimes are
  `@hono/node-server` and stdio; the web `wrangler.jsonc` stays — live via
  OpenNext).

## 2.0.0 - 2026-08-17

### Added

- Version-pinned Memongo 2.0.1 HTTP gateway with compatibility readiness.
- Independent `WikiStore` with transaction-required schema initialization.
- Durable intent-before-dispatch delivery, bounded reconciliation, redacted
  admin visibility, and receipt-gated transactional wiki promotion.
- Governed wiki CRUD, revisions, OKF import/export, search, maintenance, and
  six read-only connector discovery adapters.

### Changed

- All memory operations now cross the supported Memongo HTTP contract.
- Event-producing writes require caller-owned idempotency keys.
- REST, client, MCP, AI tools, web, OpenAPI, and proof surfaces now expose only
  supported contract operations.
- All publishable packages are versioned `2.0.0`.

### Removed

- The copied `@mdbrain/memory-engine` package and every direct-engine path.
- Raw filesystem, sync, stats, relevance diagnostics, benchmark/import,
  trace/job, novelty, consolidation, and self-edit public operations.
- Direct MongoDB migration and engine parity scripts.

## 1.1.0 - 2026-06-24

- Prepared the public Apache-2.0 open-source release.
- Published the MongoDB-native memory engine, bridge, client, AI SDK tools, MCP
  server, API, web console, and docs as the supported launch surface.
- Added scoped benchmark evidence wording without claiming a Mem0 LongMemEval
  judged-answer win or broad ecosystem leadership.
- Added release gates for type checking, linting, build, tests, publishability,
  proof pack, and agent smoke validation.
