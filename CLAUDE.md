# Mdbrain Repository Guidelines

- Repo: https://github.com/romiluz13/mdbrain
- In chat replies, file references must be repo-root relative only (example: `packages/memory-bridge/src/memongo-http-client.ts:80`); never absolute paths or `~/...`.

## Project Structure

Mdbrain is a **Turborepo/Bun monorepo** providing MongoDB-native long-term AI memory.

```
mdbrain/
  apps/
    api/          HTTP API server (Hono)
    mcp/          MCP server (stdio, calls HTTP API)
    web/          Next.js web console
  packages/
    memory-bridge/   Versioned Memongo HTTP gateway used by apps
    wiki-engine/     Governed LLM wiki and MongoDB store
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

- `@mdbrain/memory-bridge` -- versioned Memongo HTTP gateway
- `@mdbrain/wiki-engine` -- governed LLM wiki engine
- `@mdbrain/client` -- HTTP client SDK
- `@mdbrain/tools` -- AI SDK tools
- `@mdbrain/lib` -- shared utilities (private)
- `@mdbrain/api`, `@mdbrain/mcp`, `@mdbrain/web` -- apps (private)

## Commit Guidelines

- Follow concise, action-oriented commit messages (e.g., `engine: add graph expansion`).
- Group related changes; avoid bundling unrelated refactors.

## Security

- Never commit secrets. Use environment variables (`MDBRAIN_WIKI_MONGODB_URI`, `MEMONGO_API_KEY`, `MDBRAIN_API_KEY`, etc.).
- Never publish real connection strings, API keys, or personal data in code or docs.
