# Changelog

All notable changes to Mdbrain will be documented in this file.

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
