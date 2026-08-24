# Getting started

This page covers the shortest supported path from a clean clone to a running MDBrain API. Local development requires Bun, Node.js, a transaction-capable MongoDB for the wiki, and a compatible Memongo 2.0.1 HTTP service.

## Prerequisites

- Node.js 20.19 or newer, as declared in `package.json`
- Bun 1.2.5, the version used by `.github/workflows/ci.yml`
- Docker for the local MongoDB profiles
- A separately running Memongo service

## Install

```bash
git clone https://github.com/romiluz13/mdbrain.git
cd mdbrain
bun install
```

The workspace list in `package.json` includes every directory under `apps/*` and `packages/*`. Turborepo coordinates package-level builds, tests, and type checks through `turbo.json`.

## Start wiki MongoDB

For CRUD, governance, revisions, and transactions without Atlas Search:

```bash
docker compose -f docker/docker-compose.minimal.yml up -d
```

For Atlas Search, vector search, and auto-embeddings:

```bash
VOYAGE_API_KEY=al-your-atlas-model-api-key \
  docker compose -f docker/mongodb/docker-compose.preview.yml up -d
```

The preview image and key requirements are documented in `docker/mongodb/docker-compose.preview.yml`. Plain MongoDB Community does not provide `$vectorSearch`, `$search`, `$rankFusion`, or `$rerank`.

## Configure the API

Copy the variable names from `.env.example` into your local environment. A minimal local configuration is:

```bash
export MDBRAIN_WIKI_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0"
export MEMONGO_API_URL="http://127.0.0.1:3900"
export MEMONGO_API_KEY="local-memongo-secret"
export MEMONGO_ALLOW_INSECURE_LOCAL="1"
export MDBRAIN_API_KEY="local-dev-secret"
```

`packages/memory-bridge/src/memongo-runtime.ts` requires the Memongo URL and tenant API key. `packages/wiki-engine/src/wiki-store.ts` reads the wiki connection, database, and collection prefix.

Start the API:

```bash
bun run --cwd apps/api dev
```

The Node entry point in `apps/api/src/server.ts` listens on `127.0.0.1:3847` by default.

## Verify readiness

```bash
curl -fsS http://127.0.0.1:3847/health
curl -fsS http://127.0.0.1:3847/ready
```

`/ready` checks both the Memongo contract and retrieval path and the wiki transaction path. Optional `MEMONGO_READINESS_CONTROL_LANES` values add control, embedding, or vector probes.

## Run other applications

```bash
# MCP server over stdio
MDBRAIN_API_URL=http://127.0.0.1:3847 \
MDBRAIN_API_KEY=local-dev-secret \
bun run --cwd apps/mcp start

# Next.js console and product site
bun run --cwd apps/web dev

# Mintlify docs
bun run --cwd apps/docs dev
```

Open the web app at `http://localhost:3040` and Mintlify at `http://localhost:3003`.

## Quality gates

The same sequence is used by `.github/workflows/ci.yml`:

```bash
bun install --frozen-lockfile
bun run check-types
bun run lint
bun run build
bun run check-publishability
bun run test
```

Live dependency checks are separate:

```bash
bun run proof-pack
bun run memory-eval
bun run agent-smoke
```

`docs/platform/PRODUCTION-READY.md` and `docs/platform/validation-pack.md` list the release-blocking invariants for contract compatibility, tenant isolation, idempotency, reconciliation, promotion, and redaction.

For development conventions, continue to [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md). For environment details, see [Configuration](../reference/configuration.md).
