# Changelog

All notable changes to Mdbrain will be documented in this file.

## Unreleased

### Added

- LLM wiki engine (`@mdbrain/wiki-engine`): wiki_pages schema, CRUD API, OKF
  import/export, hybrid search ($vectorSearch + $search + $rankFusion), MCP
  tools, Map & Pointer generator, backlinks, migration (structured_mem → wiki),
  governance (scope enforcement, trust tiers, permissions, contradiction
  detection), self-maintenance (git-diff + Dreamer), and 6 source connectors
  (Obsidian, GitHub, Confluence, Notion, Slack, CRM).
- Web console wiki browsing tab.
- Stress test script (`bun run stress-test`).

### Fixed

- Wiki schema initialization: `mdbrainBridgeGetManager` now calls
  `ensureWikiSchema` so wiki_pages search indexes are created on startup.
- Atlas Search index filter fields changed from `string` to `token` type —
  the `equals()` operator requires `token` type.
- MongoDB $jsonSchema validation: `normalizeInput` no longer sets
  undefined-valued optional fields (MongoDB rejects undefined for typed
  fields in $jsonSchema validators).
- Repo name corrected from `mdbrian` to `mdbrain` everywhere.

## 1.1.0 - 2026-06-24

- Prepared the public Apache-2.0 open-source release.
- Published the MongoDB-native memory engine, bridge, client, AI SDK tools, MCP
  server, API, web console, and docs as the supported launch surface.
- Added scoped benchmark evidence wording without claiming a Mem0 LongMemEval
  judged-answer win or broad ecosystem leadership.
- Added release gates for type checking, linting, build, tests, publishability,
  proof pack, and agent smoke validation.
