<h1 align="center">MDBrain</h1>

<p align="center">
  <strong>The MongoDB-native LLM wiki. A self-maintaining company brain for AI agents.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mdbrain/wiki-engine"><img alt="@mdbrain/wiki-engine" src="https://img.shields.io/npm/v/%40mdbrain%2Fwiki-engine?label=%40mdbrain%2Fwiki-engine"></a>
  <a href="https://www.npmjs.com/package/@mdbrain/client"><img alt="@mdbrain/client" src="https://img.shields.io/npm/v/%40mdbrain%2Fclient?label=%40mdbrain%2Fclient"></a>
  <a href="https://github.com/romiluz13/mdbrain/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/romiluz13/mdbrain?label=License"></a>
  <a href="https://github.com/romiluz13/mdbrain"><img alt="GitHub stars" src="https://img.shields.io/github/stars/romiluz13/mdbrain?style=social"></a>
</p>

<p align="center">
  <a href="#why">Why</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#why-mongodb">Why MongoDB</a> ·
  <a href="#comparison">Comparison</a> ·
  <a href="#architecture">Architecture</a>
</p>

---

## Why

Andrej Karpathy said it best: instead of retrieving chunks at query time (RAG), an LLM should build and maintain a **persistent, interlinked, pre-synthesized knowledge layer** that compounds over time. That's an LLM wiki.

The problem? Every existing solution is either:

- **File-based** (OpenWiki, OKF) — no search, no governance, no scale, no concurrency
- **Bolt-on memory** (Mem0, Letta) — no wiki structure, no contradiction detection, no governance
- **Graph-only** (Graphiti, Zep) — no document model, no hybrid search, complex infrastructure

MDBrain is the first to combine the wiki paradigm with a real database substrate. Wiki pages hold claims, evidence, contradictions, questions, relationships, and backlinks — all backed by MongoDB Atlas hybrid search, governance gates, and LLM-driven self-maintenance.

## Quickstart

```bash
git clone https://github.com/romiluz13/mdbrain.git
cd mdbrain
bun install

# Start MongoDB (Atlas Local Preview — full Atlas Search + Vector Search locally)
docker compose -f docker/mongodb/docker-compose.preview.yml up -d

# Start the API
export MDBRAIN_MONGODB_URI="mongodb://127.0.0.1:27017/?directConnection=true"
export MDBRAIN_API_KEY="local-dev-secret"
cd apps/api && bun run dev
```

Create and search wiki pages:

```bash
# Create a wiki page
curl -s http://127.0.0.1:3847/v1/wiki \
  -H "content-type: application/json" \
  -H "authorization: Bearer local-dev-secret" \
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
  -H "authorization: Bearer local-dev-secret" \
  -d '{"query": "customer balance", "scope": "workspace", "scopeRef": "default"}'
```

Install the client SDK:

```bash
npm install @mdbrain/client @mdbrain/wiki-engine
```

## Why MongoDB

This is the core architectural decision. Here's the argument:

**Postgres is a relational database with vectors bolted on. MongoDB Atlas is an AI data platform built for this.**

| Capability | PostgreSQL + pgvector | MongoDB Atlas |
| --- | --- | --- |
| **Auto-embeddings** | Requires external orchestration (Python workers, LangChain pipelines) | Native. Define a field as `autoEmbed`, Atlas handles chunking, embedding, delta detection, sync. Zero pipeline code. |
| **Hybrid search** | Manual union of `tsvector` + pgvector results, app-side merging | `$rankFusion` — full-text + vector in one aggregation query, server-side scoring |
| **Document model** | Normalized tables + JOINs for wiki structure (claims, evidence, questions, relationships, backlinks) | One document per wiki page. Nested claims, arrays of evidence, embedded relationships. No JOINs. |
| **Synchronization tax** | Vectors in separate sidecar table, must sync with operational data | Vectors and operational data in the same document, same transaction. No stale vectors. |
| **Workload isolation** | Vector queries compete with OLTP on the same process | Dedicated Search Nodes — vector queries don't compete with writes |
| **Local dev parity** | pgvector needs separate install, different behavior than cloud | Atlas Local Preview runs the exact same mongot + Atlas Search engine locally |

**The synchronization tax is the killer.** With a separate vector store, you must keep two systems in sync — operational data in your DB, embeddings in the vector store. MongoDB puts vectors and operational JSON in the same collection, same transaction. When an agent learns a new fact, the document and its embedding update atomically. No stale vectors. No hallucinations from desynchronized state.

**Auto-embeddings eliminate the pipeline.** MDBrain defines a `text` field on every wiki page (title + summary + body). Atlas auto-generates embeddings via Voyage AI (`voyage-4-large`). No app-side embedding code. No batch jobs. No rate-limit management. When a page is updated, Atlas re-embeds only the changed text. Query with plain natural language — no pre-computed query vectors.

**Real adopters:** Zomato (50% monthly growth, scaled to $10B), Novo Nordisk, Factory, Mercor, Financial Times (1M+ daily hybrid searches). MongoDB re-accelerated to ~25% revenue growth in 2026, driven by AI workloads.

## Comparison

| Feature | OpenWiki | Mem0 / Letta | Graphiti / Zep | **MDBrain** |
| --- | --- | --- | --- | --- |
| **Paradigm** | File-based wiki | Bolt-on memory | Graph memory | **Database-backed wiki** |
| **Storage** | File-system markdown | Postgres + pgvector | Neo4j / FalkorDB | **MongoDB Atlas** |
| **Hybrid search** | Planned | Partial | Graph traversal | **$vectorSearch + $search + $rankFusion** |
| **Auto-embeddings** | None | App-side | App-side | **Native (Voyage AI via Atlas)** |
| **OKF interchange** | In progress | None | None | **Import + export round-trip** |
| **Governance** | None | None | None | **Scope, trust tiers, permissions** |
| **Contradiction detection** | None | ADD-only bias (stores contradictions) | None | **Cross-page, runs before dedup** |
| **Self-maintenance** | Scheduled runs | Reactive | Reactive | **Git-diff + Dreamer 5-phase** |
| **MCP tools** | Planned | None | None | **5 tools shipped** |
| **Connectors** | 6 (Gmail, Notion, Git, Twitter, HN, web) | None | None | **6 (Obsidian, GitHub, Confluence, Notion, Slack, CRM)** |
| **Web console** | None (CLI only) | None | None | **Next.js wiki browser** |
| **Backlinks** | None | None | Graph edges | **Auto-computed from relationships** |
| **Supersession audit** | None | None | None | **Retained, not deleted** |

## Architecture

```
Sources          Connectors          Maintenance          Governance
───────         ──────────          ──────────           ──────────
Obsidian   ──┐  Confluence    ──┐  Git-diff (LLM)  ──┐  Scope filter
GitHub     ──┤  Notion        ──┤  Dreamer (5-phase)──┤  Trust tiers
Confluence ──┤  Slack         ──┤                    │  Permissions
Notion     ──┤  CRM           ──┘                    │  Contradiction (before dedup)
Slack      ──┤                       │               │  Supersession audit
CRM        ──┘                       │               │
                                      ▼               ▼
                              ┌─────────────────────────────┐
                              │     wiki_pages (MongoDB)     │
                              │  claims · evidence · questions│
                              │  contradictions · backlinks  │
                              │  relationships · personCard   │
                              └─────────────────────────────┘
                                      │               │
                              ┌───────┴───────┐       │
                              │ Hybrid Search │       │
                              │ $vectorSearch │       │
                              │ $search       │       │
                              │ $rankFusion   │       │
                              └───────────────┘       │
                                      │               │
                              ┌───────┴───────────────┴────┐
                              │  API · MCP · Web Console   │
                              │  OKF import/export         │
                              └────────────────────────────┘
```

## Features

**Wiki pages** — Each page is a structured document with a title, summary, body, claims (with confidence + evidence), open questions, relationships to other pages, and a person card for entity pages. Pages are versioned with revision numbers and validity dates.

**Hybrid search** — Atlas Vector Search (semantic, auto-embedded via Voyage AI) + Atlas Search (full-text, lucene.standard) combined via `$rankFusion` with reciprocal rank fusion scoring. One query, server-side scoring, no app-side merging.

**OKF interchange** — Import and export [Google's Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/) bundles. MDBrain's internal schema is richer than OKF; OKF is a strict-subset projection for interoperability.

**Governance** — Implements the arXiv:2606.24535 governance primitives: scoped retrieval (scope + scopeRef enforced on every read path), trust tiers (restricted / standard / admin), permissions (allowedRoles + allowedDepartments + privacyTier), and supersession audit trail.

**Contradiction detection** — Cross-page contradictions are detected BEFORE dedup/near-duplicate gating (prevents the arXiv pipeline-ordering bug). Contradictions are recorded, surfaced via `wiki_lint`, and can be resolved (newest_wins, authority_wins, human_escalation).

**Self-maintenance** — Two strategies, unified through the same governance gates: git-diff maintenance (detects changed source files via `maintenanceHash`, regenerates only affected pages) and Dreamer 5-phase promotion (novelty scan, similarity, injection classification, extraction, promotion for event/conversation sources).

**MCP tools** — Five tools for agent access: `wiki_search`, `wiki_get`, `wiki_apply` (upsert), `wiki_export_okf`, `wiki_lint`. Connect from Claude Desktop, Cursor, or any MCP-compatible agent.

**Connectors** — Six source connectors: Obsidian (bidirectional), GitHub (read-first, git-diff maintenance), Confluence, Notion, Slack, and CRM (Salesforce/HubSpot). All implement the Connector ABC (authenticate / discover / ingest / mapPermissions).

**Backlinks** — Auto-computed from relationship targets. Incremental recomputation on page create/update/delete. Excluded for soft-deleted (superseded) pages.

**Migration** — Idempotent migration from `structured_mem` records to wiki claims and `procedures` records to `kind=procedure` pages, keyed by `sourceMemId` + `frontmatter.migratedFrom`.

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

# Migrate existing structured_mem + procedures to wiki_pages
bun run wiki:migrate -- --scope workspace --scopeRef default

# Dry-run migration (no writes)
bun run wiki:migrate -- --dry-run
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
| `@mdbrain/wiki-engine` | Wiki pages schema, CRUD, OKF, search, governance, maintenance, connectors |
| `@mdbrain/memory-engine` | MongoDB memory manager (events, episodes, structured_mem, entities) |
| `@mdbrain/memory-bridge` | Bridge layer (config resolution, manager lifecycle) |
| `@mdbrain/client` | TypeScript HTTP client (wiki + memory methods) |
| `@mdbrain/tools` | AI SDK tools |
| `@mdbrain/lib` | Shared utilities |
| `@mdbrain/api` | Hono HTTP API server (private) |
| `@mdbrain/mcp` | MCP server (private) |
| `@mdbrain/web` | Next.js web console (private) |

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `MDBRAIN_MONGODB_URI` | Yes | MongoDB connection string (local or Atlas) |
| `MDBRAIN_API_KEY` | Yes | API authentication key (any string for local dev) |
| `MDBRAIN_API_URL` | MCP only | URL of the MDBrain API server (default: `http://127.0.0.1:3847`) |
| `MDBRAIN_AGENT_ID` | Optional | Default agent ID (default: `"default"`) |
| `VOYAGE_API_KEY` | Optional | Atlas Model API key for auto-embeddings (`al-...` prefix) |

## Acknowledgments

- **[LangChain OpenWiki](https://github.com/langchain-ai/openwiki)** — LLM-maintained code wiki, git-diff incremental updates
- **[Google Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/)** — Vendor-neutral concept-per-page interchange format
- **[arXiv:2606.24535](https://arxiv.org/abs/2606.24535)** — "Governed Shared Memory for Multi-Agent LLM Systems" (governance primitives)
- **[John Underwood](https://github.com/JohnGUnderwood/mdb-community-search)** — MongoDB docker stack foundation
- **Andrej Karpathy** — The LLM wiki idea that started all of this

## License

Apache-2.0
