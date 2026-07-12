# Mdbrain Repository Guidelines

- Repo: <https://github.com/romiluz13/mdbrain>
- In chat replies, file references must be repo-root relative only (example: `packages/memory-engine/src/mongodb-manager.ts:80`); never absolute paths or `~/...`.

## Project Structure

Mdbrain is a **Turborepo/Bun monorepo** providing MongoDB-native long-term AI memory.

```
mdbrain/
  apps/
    api/          HTTP API server (Hono)
    mcp/          MCP server (stdio, calls HTTP API)
    web/          Next.js web console
  packages/
    memory-engine/   Core MongoDB memory: embeddings, graph, episodes, search, KB, analytics
    memory-bridge/   Stable facade for the engine used by apps
    wiki-engine/      LLM wiki: wiki_pages, OKF, search, governance, maintenance, connectors
    mdbrain-memory/  Published re-export package
    client/          TypeScript HTTP client SDK
    tools/           AI SDK tool helpers
    lib/             Shared types and utilities
  docker/
    mongodb/         Local MongoDB dev stack (atlas-local + mongot)
  docs/              Mdbrain documentation
```

## Build, Test, and Development

- Runtime: Node 20+, Bun 1.2+ as package manager
- Install: `bun install`
- Build: `bun run build` (Turbo)
- Dev: `bun run dev`
- Test: `bun run test` (Turbo -> Vitest)
- Type-check: `bun run check-types`
- Lint/format: `bun run lint` / `bun run format` (Biome)
- MongoDB local: `cd docker && docker compose up` (or `docker compose -f docker/docker-compose.yml up`)

## Coding Style

- Language: TypeScript (ESM). Strict typing; avoid `any`.
- Formatting/linting via Biome (tabs, double quotes, semicolons as needed).
- Keep files under ~500 LOC; split/refactor when it improves clarity.
- Tests: colocated `*.test.ts` with source, Vitest + V8 coverage.
- Written English: American spelling and grammar.

## Package Naming

- `@mdbrain/memory-engine` -- core engine
- `@mdbrain/memory-bridge` -- facade
- `@mdbrain/wiki-engine` -- LLM wiki engine (wiki_pages, OKF, search, governance)
- `@mdbrain/client` -- HTTP client SDK
- `@mdbrain/tools` -- AI SDK tools
- `@mdbrain/lib` -- shared utilities (private)
- `@mdbrain/api`, `@mdbrain/mcp`, `@mdbrain/web` -- apps (private)

## Commit Guidelines

- Follow concise, action-oriented commit messages (e.g., `engine: add graph expansion`).
- Group related changes; avoid bundling unrelated refactors.

## Security

<!-- scar: 2026-07-12 — MongoDB $jsonSchema validators reject undefined-valued fields. normalizeInput in wiki-bridge.ts must NOT set optional fields to undefined — use conditional spread (only when the value is truthy). Setting embedding: undefined when the schema says bsonType: 'array' causes 'Document failed validation' on every insert. -->

- Never commit secrets. Use environment variables (`MDBRAIN_MONGODB_URI`, `MDBRAIN_API_KEY`, etc.).
- Never publish real connection strings, API keys, or personal data in code or docs.
