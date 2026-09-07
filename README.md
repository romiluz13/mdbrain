<h1 align="center">MDBrain</h1>

<p align="center">
  <strong>A governed MongoDB LLM wiki with Memongo-backed long-term memory.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mdbrain/wiki-engine"><img alt="@mdbrain/wiki-engine" src="https://img.shields.io/npm/v/%40mdbrain%2Fwiki-engine?label=%40mdbrain%2Fwiki-engine"></a>
  <a href="https://www.npmjs.com/package/@mdbrain/client"><img alt="@mdbrain/client" src="https://img.shields.io/npm/v/%40mdbrain%2Fclient?label=%40mdbrain%2Fclient"></a>
  <a href="https://github.com/romiluz13/mdbrain/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/romiluz13/mdbrain?label=License"></a>
  <a href="https://github.com/romiluz13/mdbrain"><img alt="GitHub stars" src="https://img.shields.io/github/stars/romiluz13/mdbrain?style=social"></a>
</p>

<p align="center">
  <a href="#why">Why</a> ·
  <a href="#why-mongodb">Why MongoDB</a> ·
  <a href="#comparison">Comparison</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#architecture">Architecture</a>
</p>

---

## Why

Andrej Karpathy said it best: instead of retrieving chunks at query time (RAG), an LLM should build and maintain a **persistent, interlinked, pre-synthesized knowledge layer** that compounds over time. That's an LLM wiki.

Every existing solution is either:

- **File-based** (OpenWiki, OKF) — no search, no governance, no scale, no concurrency
- **Bolt-on memory** (Mem0, Letta) — no wiki structure, no contradiction detection, no governance
- **Graph-only** (Graphiti, Zep) — no document model, no hybrid search, complex infrastructure

MDBrain is the first to combine the wiki paradigm with a real database substrate. Wiki pages hold claims, evidence, contradictions, questions, relationships, and backlinks — all backed by MongoDB Atlas hybrid search, graph traversal, governance gates, and LLM-driven self-maintenance.

## Why MongoDB

This is the core architectural decision. Here's the argument.

**Postgres is a relational database with vectors bolted on. MongoDB Atlas is an AI data platform built for this.**

### One platform. One pipeline. Zero sync tax

The alt stack for an AI wiki is 5+ systems: a vector store for embeddings, a keyword search engine for full-text, a graph database for relationships, a custom merge layer to combine results, an external reranker API, and a sync pipeline to keep everything consistent. Every component is a failure point and a sync lag.

MongoDB runs all of it in one aggregation pipeline:

```
db.wiki_pages.aggregate([
  { $vectorSearch: { ... } },     // semantic search (auto-embedded via Voyage AI)
  { $search: { ... } },           // full-text search (BM25)
  { $rankFusion: { ... } },       // hybrid scoring, server-side
  { $rerank: { ... } },           // cross-encoder reranking (MongoDB 8.3+)
  { $graphLookup: { ... } },      // multi-hop relationship traversal
  { $limit: 10 }
])
```

One query. One round trip. No stitching. No stale vectors from sync lag.

### The synchronization tax is the killer

With a separate vector store, you must keep two systems in sync — operational data in your DB, embeddings in the vector store. MongoDB puts vectors and operational JSON in the **same document, same transaction**. When an agent learns a new fact, the document and its embedding update atomically. No stale vectors. No hallucinations from desynchronized state.

**Auto-embeddings eliminate the pipeline.** MDBrain defines a `text` field on every wiki page (title + summary + body). Atlas auto-generates embeddings via Voyage AI (`voyage-4-large`). No app-side embedding code. No batch jobs. No rate-limit management. When a page is updated, Atlas re-embeds only the changed text. Query with plain natural language — no pre-computed query vectors.

### The document model is the natural shape of a wiki

A wiki page IS a document: title, summary, body, nested claims with evidence, arrays of questions, relationships to other pages, backlinks, person cards. In Postgres, this is 5+ tables with JOINs on every read. In MongoDB, it's one document. No JOINs. No serialization tax. No `ALTER TABLE` locks when the schema evolves.

MDBrain's wiki schema evolved 20+ times during development with zero migration windows. In Postgres, every new field is an `ALTER TABLE` that holds an exclusive lock during backfill — a maintenance window agents can't wait for.

### Graph traversal, natively

Wiki pages are nodes. Relationships are directed edges. Backlinks are reverse edges. MDBrain's wiki IS a graph — and MongoDB traverses it natively with `$graphLookup`.

The GraphRAG pattern: `$vectorSearch` finds seed pages semantically → `$graphLookup` traverses relationships multi-hop → the LLM gets graph-enriched context, not just flat chunks. This reduces hallucinations by giving the agent a structured map of how concepts connect.

For wiki relationship graphs (page → related page → related page), 1-3 hops is exactly the range MongoDB's `$graphLookup` is optimized for. No Neo4j. No separate graph database.

### Built once. Runs anywhere

Same APIs across Atlas cloud and self-managed (Atlas Local Preview). `$vectorSearch`, `$search`, `$rankFusion`, and `$rerank` require Atlas Search (`mongot`) — available on Atlas cloud and Atlas Local Preview, not plain MongoDB Community. MDBrain uses Atlas Local Preview (`docker compose -f docker/mongodb/docker-compose.preview.yml up -d`) — the exact same `mongot` + Atlas Search engine runs on your laptop as in production. No vendor lock-in within the Atlas ecosystem.

Note: `$vectorSearch`, `$search`, `$rankFusion`, and `$rerank` require Atlas Search (`mongot`). Atlas Local Preview provides the same engine locally; plain MongoDB Community does not support these stages.

| Capability | PostgreSQL + pgvector | MongoDB Atlas |
| --- | --- | --- |
| **Auto-embeddings** | External orchestration (Python workers, LangChain pipelines) | Native. `autoEmbed` field, Atlas handles chunking, embedding, delta detection, sync. Zero pipeline code. |
| **Hybrid search** | Manual union of `tsvector` + pgvector, app-side merging | `$rankFusion` — full-text + vector in one aggregation, server-side scoring |
| **Graph traversal** | Recursive CTEs (complex, limited) or separate graph DB | `$graphLookup` — multi-hop traversal in the same pipeline as search |
| **Document model** | Normalized tables + JOINs for wiki structure | One document per page. Nested claims, arrays of evidence, embedded relationships. No JOINs. |
| **Schema evolution** | `ALTER TABLE` holds exclusive lock during backfill | Add a field at write time. Zero downtime. Zero migration. |
| **Sync tax** | Vectors in sidecar table, must sync with operational data | Vectors and operational data in same document, same transaction |
| **Local dev parity** | pgvector needs separate install, different behavior | Atlas Local Preview runs same engine locally |

**Real adopters running MongoDB for AI:** Zomato (50% monthly growth, $10B scale), Novo Nordisk, Factory, Mercor, Financial Times (1M+ daily hybrid searches). MongoDB re-accelerated to ~25% revenue growth in 2026, driven by AI workloads.

## Comparison

| Feature | OpenWiki | Mem0 / Letta | Graphiti / Zep | **MDBrain** |
| --- | --- | --- | --- | --- |
| **Paradigm** | File-based wiki | Bolt-on memory | Graph memory | **Database-backed wiki** |
| **Storage** | File-system markdown | Postgres + pgvector | Neo4j / FalkorDB | **MongoDB Atlas** |
| **Hybrid search** | Planned | Partial | Graph traversal | **$vectorSearch + $search + $rankFusion** |
| **Graph traversal** | None | None | Native (Neo4j) | **$graphLookup (native MongoDB)** |
| **Auto-embeddings** | None | App-side | App-side | **Native (Voyage AI via Atlas)** |
| **OKF interchange** | In progress | None | None | **Import + export round-trip** |
| **Governance** | None | None | None | **Scope, trust tiers, permissions** |
| **Contradiction detection** | None | ADD-only bias (stores contradictions) | None | **Cross-page, runs before dedup** |
| **Self-maintenance** | Scheduled runs | Reactive | Reactive | **Git-diff + Dreamer 5-phase (wiki Dreamer simplified)** |
| **MCP tools** | Planned | None | None | **30 supported tools (6 wiki)** |
| **Connectors** | 6 (Gmail, Notion, Git, Twitter, HN, web) | None | None | **Obsidian (beta): discovery + export; ingest throws** |
| **Web console** | None (CLI only) | None | None | **Next.js wiki browser** |
| **Backlinks** | None | None | Graph edges | **Auto-computed from relationships** |
| **Supersession audit** | None | None | None | **Retained, not deleted** |

## Quickstart

One canonical path: the full bundle (`docker/compose.full.yml`) boots MongoDB + Atlas Search, Memongo, the API, and the web console in a single command. The dev-convenience stacks (`docker/mongodb/docker-compose.preview.yml`, `docker/docker-compose.minimal.yml`) are labeled as such and are never part of this path.

### Model API key (required for the full experience)

The auto-embed vector search lane needs an **Atlas Model API key** (`al-...` prefix). Create one at cloud.mongodb.com → AI Models → Create model API key ([docs](https://www.mongodb.com/docs/voyageai/management/api-keys/)). Direct VoyageAI keys (`pa-...`) do not work as-is — mongot routes through ai.mongodb.com; to use one, also set `EMBEDDING_PROVIDER_ENDPOINT=https://api.voyageai.com/v1/embeddings` in the environment.

Without a key the bundle still boots, honestly degraded: hybrid search serves through the text lane, and `/ready` reports `wiki.search.vector = "unavailable"` with an actionable diagnostic (`wiki.search.text` stays `"ready"` and readiness stays 200). That is a documented degraded mode — not a hidden failure. An **invalid** key is worse than none: it registers the auto-embed index but fails the query-embedding call, which makes the default hybrid search return 503.

### Boot the bundle

mdbrain and memongo must be sibling checkouts (the compose build context is `../../memongo` relative to `docker/compose.full.yml`). From a fresh parent directory:

```bash
git clone https://github.com/romiluz13/mdbrain.git
git clone https://github.com/romiluz13/Memongo.git memongo
cd mdbrain

# Memongo prerequisite: pin the sibling checkout to the revision matching
# the pinned contract. The exact ref is recorded beside the pin in
# packages/memory-bridge/src/memongo-runtime.ts (MEMONGO_CONTRACT_SOURCE_REF)
# and verified in docs/diligence/agreed-plan.md (PR1 implementation record)
# — CI uses the same source.
git -C ../memongo checkout fa0f19db6267e86d41e909b42e3d2be1bb207a35

# Bring up MongoDB+Search, Memongo, the API, and the web console
export VOYAGE_API_KEY=al-your-atlas-model-api-key
docker compose -f docker/compose.full.yml up -d --wait --wait-timeout 180
```

Health — this exercises the Memongo contract check (exact version + canonical SHA-256, enforced at runtime by the memory bridge) and the search capability block:

```bash
curl -fsS http://127.0.0.1:3847/ready
```

Keyed boot (expected):

```json
{
	"ok": true,
	"service": "mdbrain-api",
	"wiki": {
		"transactional": true,
		"search": { "text": "ready", "vector": "ready", "autoEmbed": "ready" }
	}
}
```

Keyless boot: same call returns 200 with `wiki.search.vector` / `autoEmbed` reporting `"unavailable"` plus a `detail` diagnostic. In a keyless bundle the **first memory write** also waits out Memongo's one-time index-bootstrap horizon (~60s measured; the bundle's bridge deadline is raised to cover it) — every later write returns in milliseconds. Keyed boots do not hit the wait.

The web console is at http://127.0.0.1:3040. The compose default API key is `dev-mdbrain-key` (substitute the `authorization` header below if you set `MDBRAIN_API_KEY`).

### Create and search wiki pages

```bash
# Create a wiki page
curl -s http://127.0.0.1:3847/v1/wiki \
  -H "content-type: application/json" \
  -H "authorization: Bearer dev-mdbrain-key" \
  -d '{
    "kind": "concept",
    "title": "Accounts Table",
    "slug": "tables/accounts",
    "summary": "Holds customer balance data.",
    "body": "# Accounts Table\n\n## Columns\n\n- id (PK)\n- balance (decimal)\n- currency (string)",
    "frontmatter": { "type": "concept" },
    "scope": "workspace",
    "scopeRef": "default",
    "trustTier": "standard"
  }'

# Hybrid search (vector + text + rank fusion, auto-embedded via Voyage AI)
curl -s http://127.0.0.1:3847/v1/wiki/search \
  -H "content-type: application/json" \
  -H "authorization: Bearer dev-mdbrain-key" \
  -d '{"query": "customer balance", "scope": "workspace", "scopeRef": "default"}'
```

Run the end-to-end smoke (auth, memory write/read path, wiki create, and hybrid search that must return the page it just created — empty results fail). The smoke imports the client SDK, whose entry point resolves to its built `dist/` — install and build it first (same prerequisites CI uses):

```bash
bun install --frozen-lockfile
bunx turbo run build --filter '@mdbrain/client'
MDBRAIN_API_KEY=dev-mdbrain-key bun scripts/compose-smoke.ts
```

Tear down (keeps data in named volumes) with `docker compose -f docker/compose.full.yml down`; add `-v` to remove the volumes too.

### Keyless dev mode (separate from the canonical path)

Without an Atlas Model API key you can still develop against the text search lane:

```bash
# MongoDB + mongot, no key (official image quickstart form). Loopback-only
# binding: atlas-local runs unauthenticated, so it must never listen on
# other interfaces.
docker run -d -p 127.0.0.1:27017:27017 --name atlas-local mongodb/mongodb-atlas-local:preview

# Run the API on the host
export MDBRAIN_WIKI_MONGODB_URI="mongodb://127.0.0.1:27017/?directConnection=true"
export MDBRAIN_API_KEY="local-dev-secret"
cd apps/api && bun run dev
```

`/ready` reports `wiki.search.vector` / `autoEmbed` as `"unavailable"` (the auto-embed index cannot be registered without a model key); the text lane serves searches. Memory features still require a compatible Memongo HTTP service matching the pinned contract (2.1.0, SHA-256 verified at runtime) — same sibling checkout as above (pinned to `MEMONGO_CONTRACT_SOURCE_REF`), run locally, with the API pointed at it:

```bash
export MEMONGO_API_URL="http://127.0.0.1:3847"   # your locally running Memongo
export MEMONGO_API_KEY="your-memongo-key"        # required by the bridge
# A plain-HTTP loopback Memongo needs this explicit opt-in:
export MEMONGO_ALLOW_INSECURE_LOCAL="1"
```

### Client SDK

```bash
npm install @mdbrain/client @mdbrain/wiki-engine
```

## Architecture

```
Sources          Connectors                 Maintenance               Governance
───────         ──────────                 ──────────                ──────────
Obsidian   ──┐  Obsidian (beta):        ──┐  Git-diff (LLM)       ──┐  Scope filter
(beta)     ──┘  vault discovery +       ──┘  Dreamer (5-phase,       │  Trust tiers
                path-contained export        LLM-classified,         │  Permissions
                (ingest throws               operator-triggered      │  Contradiction (before dedup)
                ConnectorNotImplemented      CLI only)               │  Supersession audit
                Error)                                                │
                                                                      ▼
                              ┌─────────────────────────────┐
                              │     wiki_pages (MongoDB)     │
                              │  claims · evidence · questions│
                              │  contradictions · backlinks  │
                              │  relationships · personCard   │
                              └─────────────────────────────┘
                                      │               │
                              ┌───────┴───────┐       │
                              │ Hybrid Search │       │
                              │ $vectorSearch │  $graphLookup
                              │ $search       │  (multi-hop)  │
                              │ $rankFusion   │       │
                              │ $rerank       │       │
                              └───────────────┘       │
                                      │               │
                              ┌───────┴───────────────┴────┐
                              │  API · MCP · Web Console   │
                              │  OKF import/export         │
                              └────────────────────────────┘
```

Memory and wiki storage are separate ownership domains:

```text
Clients -> MDBrain API -> Memongo HTTP gateway -> Memongo-owned memory
                    \-> WikiStore -> MDBrain-owned wiki MongoDB
                    \-> delivery intents -> receipt-gated wiki promotion
```

## Features

**Wiki pages** — Each page is a structured document with a title, summary, body, claims (with confidence + evidence), open questions, relationships to other pages, and a person card for entity pages. Pages are versioned with revision numbers and validity dates.

**Hybrid search** — Atlas Vector Search (semantic, auto-embedded via Voyage AI) + Atlas Search (full-text, lucene.standard) combined via `$rankFusion` with reciprocal rank fusion scoring. One query, server-side scoring, no app-side merging.

**Reranking** — Native MongoDB `$rerank` aggregation stage (MongoDB 8.3+, Voyage `rerank-2.5`) runs server-side in the pipeline. For older MongoDB versions, an app-side callback reranker is supported as fallback. Completes the retrieval funnel: vector search → text search → hybrid fusion → reranking.

**Graph traversal** — Native MongoDB `$graphLookup` traverses wiki relationships multi-hop in a single aggregation pipeline. The GraphRAG pattern: semantic retrieval finds seed pages, `$graphLookup` expands their relationships, the LLM gets graph-enriched context. Wiki pages are nodes, relationships are edges, backlinks are reverse edges. No N+1 queries — one pipeline, one round trip.

**OKF interchange** — Import and export [Google's Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/) bundles. MDBrain's internal schema is richer than OKF; OKF is a strict-subset projection for interoperability.

**Governance** — Implements the arXiv:2606.24535 governance primitives: scoped retrieval (scope + scopeRef enforced on every read path), trust tiers (restricted / standard / admin), permissions (allowedRoles + allowedDepartments + privacyTier), and supersession audit trail. Governance is native to the database query layer, not app-side checks.

**Contradiction detection** — Cross-page contradictions are detected BEFORE dedup/near-duplicate gating (prevents the arXiv pipeline-ordering bug). Contradictions are recorded, surfaced via `wiki_lint`, and can be resolved (newest_wins, authority_wins, human_escalation).

**Self-maintenance** — Two strategies, unified through the same governance gates, both operator-triggered via `bun run wiki:maintenance` (never a silent background loop): git-diff maintenance (detects changed source files via `maintenanceHash`, regenerates only affected pages through the configured LLM) and Dreamer 5-phase promotion for event/conversation sources (novelty scan, vector similarity with a 0.65 floor, LLM injection classification — ignore/new/update/contradiction, per-claim confidence extraction with event provenance, promotion through the pipeline gate). Both require an LLM (`MDBRAIN_LLM_*`) and fail closed with `MaintenanceLlmUnconfiguredError` when it is not configured; the legacy whole-event importer is an explicit `--importer heuristic-importer` opt-in, disclosed in the run summary. Every LLM response is JSON-Schema-constrained and validated locally; there is no silent success path (refusals, truncation, and malformed output are hard errors).

**MCP tools** — 30 tools for supported memory and wiki operations, including 6 wiki-specific tools. Connect from Claude Desktop, Cursor, or any MCP-compatible agent.

**Connectors** — Obsidian (beta): real vault discovery + path-contained export; `ingest` throws `ConnectorNotImplementedError` until the post-sale roadmap item lands. The GitHub/Confluence/Notion/Slack/CRM shell connectors were removed: they reported success while writing nothing.

**Backlinks** — Auto-computed from relationship targets. Incremental recomputation on page create/update/delete. Excluded for soft-deleted (superseded) pages.

**Durable delivery** — Gateway writes persist a local intent before dispatch to Memongo. A bounded background reconciler resumes retryable, ambiguous, and promotion-pending work with the original idempotency key. Receipt-gated wiki promotion is explicit, idempotent, and transactionally records wiki lineage.

## MCP Server

```bash
export MDBRAIN_API_URL="http://127.0.0.1:3847"
export MDBRAIN_API_KEY="local-dev-secret"
cd apps/mcp && bun run start
```

Connect from any MCP-compatible agent by pointing it at the MCP server's stdio transport.

## CLI

```bash
# Generate a wiki-map pointer block in AGENTS.md + CLAUDE.md
bun run wiki:init -- --scope workspace --scopeRef default

```

## Web Console

```bash
cd apps/web && bun run dev
# Open http://localhost:3040 → Console tab → Wiki tab
```

Browse pages (filterable by kind), view full page details (claims, contradictions, questions, relationships, backlinks), and search.

## Packages

| Package | Description |
| --- | --- |
| `@mdbrain/wiki-engine` | Wiki pages schema, CRUD, OKF, search, graph traversal, governance, maintenance, connectors |
| `@mdbrain/memory-bridge` | Version-pinned Memongo HTTP gateway |
| `@mdbrain/memory` | Aggregate client and gateway exports |
| `@mdbrain/client` | TypeScript HTTP client (wiki + memory methods) |
| `@mdbrain/tools` | AI SDK helpers for the supported HTTP surface |
| `@mdbrain/lib` | Shared utilities |
| `@mdbrain/api` | Hono HTTP API server (private) |
| `@mdbrain/mcp` | MCP server (private) |
| `@mdbrain/web` | Next.js web console (private) |

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `MDBRAIN_WIKI_MONGODB_URI` | Yes | Transaction-capable MongoDB connection for MDBrain-owned wiki collections |
| `MEMONGO_API_URL` | Yes | Base URL of the compatible Memongo HTTP service |
| `MEMONGO_API_KEY` | Yes | Tenant key used only by the Memongo gateway |
| `MEMONGO_CONTROL_API_KEY` | For control readiness lanes | Separate server-local key for Memongo status and probes |
| `MEMONGO_READINESS_CONTROL_LANES` | Optional | Comma-separated required `control`, `embedding`, and/or `vector` lanes |
| `MDBRAIN_API_KEY` | Yes | API authentication key (any string for local dev) |
| `MDBRAIN_ALLOW_DEV_PRINCIPAL` | Trusted local development only | Set to `1` to opt into the unauthenticated development principal when no admin or scoped API key is configured. Production refuses this mode |
| `MDBRAIN_API_URL` | MCP only | URL of the MDBrain API server (default: `http://127.0.0.1:3847`) |
| `MDBRAIN_OKF_ALLOWED_ROOTS` | OKF import/export | Comma-separated filesystem roots allowed for OKF import and export. Paths and roots are realpath-resolved to prevent symlink escape |
| `MDBRAIN_OKF_ALLOW_UNRESTRICTED` | Trusted local development only | Set to `true` to allow unrestricted OKF filesystem access when no allowed roots are configured. Do not use in shared or production deployments |
| `MDBRAIN_LLM_BASE_URL` | Maintenance CLI only* | Base URL of an OpenAI-compatible `/chat/completions` endpoint for git-diff regeneration and Dreamer classification. *Required for non-dry-run `bun run wiki:maintenance` |
| `MDBRAIN_LLM_API_KEY` | Maintenance CLI only* | API key for the LLM endpoint (never echoed in error messages) |
| `MDBRAIN_LLM_MODEL` | Maintenance CLI only* | Model name for chat completions |
| `MDBRAIN_LLM_AUTH_STYLE` | Optional | `authorization-bearer` (default), `api-key`, or `x-api-key` |
| `MDBRAIN_LLM_TOKEN_PARAM` | Optional | `max_tokens` (default) or `max_completion_tokens` |
| `MDBRAIN_LLM_TIMEOUT_MS` | Optional | Total budget for all attempts of one call (default 60000) |
| `MDBRAIN_LLM_MAX_RESPONSE_BYTES` | Optional | Response body cap (default 262144) |
| `MDBRAIN_LLM_STRUCTURED_OUTPUTS` | Optional | `0`/`false` disables `response_format: json_schema` for models without Structured Outputs support (the schema then rides in the prompt; output is still validated locally) |
| `VOYAGE_API_KEY` | Optional* | Atlas Model API key (`al-...` prefix) for the auto-embed vector search lane. *Required for the full quickstart experience; without it the stack boots degraded (text-lane search only) and `/ready` reports `vector`/`autoEmbed` as `unavailable` |

## Acknowledgments

- **[LangChain OpenWiki](https://github.com/langchain-ai/openwiki)** — LLM-maintained code wiki, git-diff incremental updates
- **[Google Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/)** — Vendor-neutral concept-per-page interchange format
- **[arXiv:2606.24535](https://arxiv.org/abs/2606.24535)** — "Governed Shared Memory for Multi-Agent LLM Systems" (governance primitives)
- **[MongoDB Five Pillars](https://mdb-five-pillars.demo-portal.mongoarena.com/)** — One data platform, built for AI, trustworthy by default
- **[John Underwood](https://github.com/JohnGUnderwood/mdb-community-search)** — MongoDB docker stack foundation
- **Andrej Karpathy** — The LLM wiki idea that started all of this

## License

Apache-2.0
