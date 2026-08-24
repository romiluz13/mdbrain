# Dependencies

MDBrain is a Bun workspace with four applications and six packages. `package.json` declares Node.js `>=20.19.0`, Bun `1.2.5`, and the `apps/*` and `packages/*` workspace globs. Turborepo runs package scripts in dependency order.

Counts below are direct manifest entries, not transitive lockfile packages. An internal dependency includes both `workspace:*` references and pinned `@mdbrain/*` versions used by publishable packages.

## Package dependency counts

| Manifest | Runtime: internal | Runtime: external | Development | Peer |
| --- | ---: | ---: | ---: | ---: |
| `package.json` | 0 | 0 | 4 | 0 |
| `apps/api/package.json` | 3 | 3 | 3 | 0 |
| `apps/mcp/package.json` | 1 | 2 | 3 | 0 |
| `apps/web/package.json` | 1 | 4 | 10 | 0 |
| `apps/docs/package.json` | 0 | 0 | 1 | 0 |
| `packages/client/package.json` | 0 | 0 | 3 | 0 |
| `packages/lib/package.json` | 0 | 0 | 3 | 0 |
| `packages/memory-bridge/package.json` | 1 | 0 | 5, including 2 internal test/build dependencies | 0 |
| `packages/wiki-engine/package.json` | 1 | 2 | 3 | 0 |
| `packages/mdbrain-memory/package.json` | 2 | 0 | 2 | 0 |
| `packages/tools/package.json` | 1 | 1 | 5 | 1 |

## Workspace dependencies

| Consumer | Internal dependency | Why it exists |
| --- | --- | --- |
| `apps/api` | `@mdbrain/lib` | Shared scopes, types, logging, and utility behavior. |
| `apps/api` | `@mdbrain/memory-bridge` | Version-pinned server-side access to Memongo. |
| `apps/api` | `@mdbrain/wiki-engine` | Wiki storage, governance, revisions, search, delivery intents, and mutation intents. |
| `apps/mcp` | `@mdbrain/client` | Typed calls from stdio MCP tools to the HTTP API. |
| `apps/web` | `@mdbrain/client` | Browser-side console access and shared response types. |
| `packages/memory-bridge` | `@mdbrain/lib` | Shared memory scope and configuration types. |
| `packages/memory-bridge` development | `@mdbrain/client`, `@mdbrain/tools` | Cross-package tests and type/build verification. |
| `packages/wiki-engine` | `@mdbrain/lib` | Shared logger and common types. |
| `packages/mdbrain-memory` | `@mdbrain/client`, `@mdbrain/memory-bridge` | Convenience package that re-exports client and server-side memory surfaces. |
| `packages/tools` | `@mdbrain/client` | API transport behind AI SDK tool definitions and middleware. |

Publishable packages use exact `2.0.0` internal versions where their npm artifacts must depend on other published MDBrain packages. Private applications use `workspace:*`.

## External runtime dependencies

| Dependency | Used by | Why it exists |
| --- | --- | --- |
| `@hono/node-server` | `apps/api/package.json` | Runs the Hono fetch application on Node.js. |
| `hono` | `apps/api/package.json` | HTTP routing, middleware, request contexts, and responses. |
| `tsx` | `apps/api/package.json`, `apps/mcp/package.json` | Executes TypeScript entry points directly for start and development scripts. |
| `@modelcontextprotocol/sdk` | `apps/mcp/package.json` | Implements the stdio MCP server and tool protocol. |
| `next` | `apps/web/package.json` | Web application framework and production build. |
| `react`, `react-dom` | `apps/web/package.json` | Web interface rendering. |
| `gsap` | `apps/web/package.json` | Marketing and demo animation. |
| `mongodb` | `packages/wiki-engine/package.json` | MongoDB client, sessions, collections, indexes, validators, and search-index administration. |
| `js-yaml` | `packages/wiki-engine/package.json` | Reads and writes YAML used by OKF interchange. |
| `zod` | `packages/tools/package.json` | Defines validated AI tool input schemas. |
| `ai` | `packages/tools/package.json` | Peer integration for the Vercel AI SDK; version `>=5.0.0` is required when that adapter is used. |

`packages/client` and `packages/lib` intentionally have no production dependencies. `packages/memory-bridge` has no external production dependency; its HTTP transport uses platform APIs and its only runtime manifest edge is `@mdbrain/lib`.

## Development and build dependencies

| Dependency | Scope | Why it exists |
| --- | --- | --- |
| `typescript` | Root and every TypeScript workspace | Type checking and package compilation. |
| `vitest` | Applications and packages with tests | Unit and integration test runner. |
| `@types/node` | Node-facing workspaces | Node.js type declarations. |
| `@biomejs/biome` | Root | Repository linting and formatting. |
| `turbo` | Root | Monorepo task graph and caching. |
| `fast-check` | Root | Property-based tests used by repository scripts. |
| `@playwright/test`, `@axe-core/playwright` | `apps/web/package.json` | Browser end-to-end and accessibility tests. |
| `@vitejs/plugin-react` | `apps/web/package.json` | React integration for the Vitest/Vite test pipeline. |
| `@types/react`, `@types/react-dom` | `apps/web/package.json` | React TypeScript declarations. |
| `@opennextjs/cloudflare`, `wrangler` | `apps/web/package.json` | Builds, previews, and deploys the Next.js application as a Cloudflare Worker. |
| `mintlify` | `apps/docs/package.json` | Local product-documentation development. |
| `@types/js-yaml` | `packages/wiki-engine/package.json` | Type declarations for `js-yaml`. |
| `ai`, `@ai-sdk/provider` | `packages/tools/package.json` | Builds and tests optional AI SDK integrations. |

Exact versions and version ranges remain authoritative in the corresponding package manifests and `bun.lock`.

## Runtime services and images

| Dependency | Source | Why it exists |
| --- | --- | --- |
| Memongo 2.0.1-compatible HTTP service | `packages/memory-bridge/src/memongo-runtime.ts`, `docs/contracts/memongo/2.0.1/` | Owns long-term memory storage and retrieval behind a pinned HTTP contract. It is deployed separately from this repository. |
| MongoDB 7 | `docker/docker-compose.minimal.yml` | Minimal transaction-capable local wiki database. |
| `mongodb/mongodb-atlas-local:preview` | `docker/mongodb/docker-compose.preview.yml` | Local MongoDB with Atlas Search, vector search, and optional auto-embeddings. |
| `mongodb/mongodb-community-server:latest` | `docker/mongodb/docker-compose.mongodb.yml` | Standalone or replica-set `mongod` for the multi-profile local stack. |
| `mongodb/mongodb-community-search:latest` | `docker/mongodb/docker-compose.mongodb.yml` | Local `mongot` search process for the `fullstack` profile. |
| `alpine:latest` and OpenSSL | `docker/mongodb/docker-compose.mongodb.yml`, `docker/mongodb/setup-generator.sh` | One-time generation of MongoDB keyfiles, password files, and optional embedding-key files. |
| Cloudflare Workers | `apps/web/wrangler.jsonc` | Hosts the OpenNext web build, static assets, service self-reference, and observability. |

The wiki requires a replica set or sharded MongoDB deployment for transactions. Vector and Atlas Search features additionally require Atlas or a local `mongot` profile. The API also requires network access to the separately operated Memongo service.

## Continuous integration and publishing

`.github/workflows/ci.yml` installs Bun `1.2.5` with `oven-sh/setup-bun@v2`, installs the frozen lockfile, and runs type checking, Biome linting, the Turbo build, publishability checks, and tests on pull requests and pushes to `main`. `actions/checkout@v4` provides the source checkout.

`.github/workflows/publish.yml` runs on version tags or manual dispatch. It adds Node.js 22 through `actions/setup-node@v4`, repeats build, test, and publishability checks, then publishes the resolved package cohort to npm with provenance. The workflow uses the `NPM_TOKEN` secret as `NODE_AUTH_TOKEN` and requests GitHub's `id-token: write` permission for provenance.

See [Configuration](configuration.md) for runtime variables and [How to contribute](../how-to-contribute/index.md) for the repository workflow.
