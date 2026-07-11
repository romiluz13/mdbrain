# MDBrain

<p align="center">
  <strong>MongoDB-native LLM Wiki — a self-maintaining company brain for AI agents.</strong>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#okf-interchange">OKF</a> ·
  <a href="#connectors">Connectors</a> ·
  <a href="#governance">Governance</a> ·
  <a href="./docs/specs/2026-07-08-mdbrian-llm-wiki-design.md">Design Spec</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mdbrian/memory"><img alt="@mdbrian/memory" src="https://img.shields.io/npm/v/%40mdbrian%2Fmemory?label=%40mdbrian%2Fmemory"></a>
  <a href="https://www.npmjs.com/package/@mdbrian/client"><img alt="@mdbrian/client" src="https://img.shields.io/npm/v/%40mdbrian%2Fclient?label=%40mdbrian%2Fclient"></a>
  <a href="https://www.npmjs.com/package/@mdbrian/wiki-engine"><img alt="@mdbrian/wiki-engine" src="https://img.shields.io/npm/v/%40mdbrian%2Fwiki-engine?label=%40mdbrian%2Fwiki-engine"></a>
</p>

MDBrain is a MongoDB-native LLM wiki engine. Instead of retrieving chunks at
query time (RAG), an LLM builds and maintains a persistent, interlinked,
pre-synthesized knowledge layer that compounds over time. Wiki pages hold
claims, evidence, contradictions, questions, relationships, and backlinks —
all enforced by governance gates (scope, trust tiers, permissions).

**Inspirations:** LangChain OpenWiki (LLM-maintained code wiki, git-diff
incremental), Google Open Knowledge Format / OKF (vendor-neutral
concept-per-page interchange), arXiv:2606.24535 "Governed Shared Memory for
Multi-Agent LLM Systems" (fleet-memory governance primitives).

## What's different

| Feature | OpenWiki | Mem0/Letta | **MDBrian** |
| --- | --- | --- | --- |
| Storage | File-system markdown | Postgres + pgvector | **MongoDB (Atlas)** |
| Hybrid search | Planned | ✅ | ✅ ($vectorSearch + $search + $rankFusion) |
| OKF interchange | In progress | ❌ | ✅ (import + export round-trip) |
| Governance | ❌ | ❌ | ✅ (scope, trust tiers, permissions, contradiction detection) |
| Self-maintenance | Scheduled runs | Reactive | ✅ (git-diff + Dreamer 5-phase) |
| MCP tools | Planned | ❌ | ✅ (5 wiki tools) |
| Connectors | Gmail, Notion, Git, Twitter, HN | ❌ | Obsidian, GitHub, Confluence, Notion, Slack, CRM |

## Quickstart

Prerequisites: Node.js 20+, Bun 1.2+, Docker (for local MongoDB with Atlas Search).

```bash
git clone https://github.com/romiluz13/mdbrian.git
cd mdbrian
bun install

# Start MongoDB (Atlas Local Preview with mongot for Atlas Search + Vector Search)
docker compose -f docker/mongodb/docker-compose.preview.yml up -d
export MDBRAIN_MONGODB_URI="mongodb://127.0.0.1:27017/?directConnection=true"
export MDBRAIN_API_KEY="local-dev-secret"
# Optional: Atlas Model API key for auto-embeddings (al-... prefix)
export VOYAGE_API_KEY="al-your-atlas-model-api-key"

# Start the API (Hono server on port 3847)
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

# Search wiki pages (hybrid: vector + text + rank fusion)
curl -s http://127.0.0.1:3847/v1/wiki/search \
  -H "content-type: application/json" \
  -H "authorization: Bearer local-dev-secret" \
  -d '{"query": "customer balance", "scope": "workspace", "scopeRef": "default"}'

# Get a page with backlinks + contradictions
curl -s "http://127.0.0.1:3847/v1/wiki/tables/accounts?scope=workspace&scopeRef=default" \
  -H "authorization: Bearer local-dev-secret"
```

## OKF Interchange

MDBrain uses [Google's Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/)
as its import/export interchange format. OKF bundles are directories of
`concept.md` files with YAML frontmatter (required: `type`). MDBrain's internal
`wiki_pages` schema is richer than OKF — OKF is a strict-subset projection.

```bash
# Import an OKF bundle
curl -s http://127.0.0.1:3847/v1/wiki/okf-import \
  -H "content-type: application/json" \
  -H "authorization: Bearer local-dev-secret" \
  -d '{"bundleDir": "/path/to/okf-bundle", "scope": "workspace", "scopeRef": "default", "trustTier": "standard"}'

# Export wiki pages to OKF
curl -s http://127.0.0.1:3847/v1/wiki/okf-export \
  -H "content-type: application/json" \
  -H "authorization: Bearer local-dev-secret" \
  -d '{"scope": "workspace", "scopeRef": "default", "outDir": "/tmp/okf-export"}'
```

## Connectors

Six source connectors ingest external data into wiki_pages, all implementing
the Connector ABC (authenticate / discover / ingest / mapPermissions):

| Connector | Type | Auth | Source |
| --- | --- | --- | --- |
| **Obsidian** | Bidirectional | Local vault | `.md` files (OKF format) |
| **GitHub** | Read-first | Token/SSH | Git repo (git-diff maintenance) |
| **Confluence** | Read-first | API token | Spaces + pages |
| **Notion** | Read-first | Integration token | Databases + pages |
| **Slack** | Read-first | Bot token (xoxb-) | Channels → events → Dreamer |
| **CRM** | Read-first | OAuth/API key | Salesforce/HubSpot contacts + companies |

## Governance

MDBrain implements the arXiv:2606.24535 governance primitives:

- **Scoped retrieval** — `scope` + `scopeRef` enforced on every read path
  (search, get-by-slug, get-by-id, graph traversal, OKF export). The arXiv
  GET-by-id leak is prevented.
- **Trust tiers** — restricted (own scope only), standard (own scope +
  public/internal cross-scope), admin (full cross-scope propagation).
- **Permissions** — `allowedRoles` + `allowedDepartments` + `privacyTier`
  filter every page read.
- **Contradiction detection** — runs BEFORE dedup/near-duplicate gating
  (prevents the arXiv pipeline-ordering bug). Cross-page contradictions are
  detected, recorded, and surfaced via `wiki_lint`.
- **Supersession audit trail** — superseded claims are retained with
  `state="superseded"`, not deleted.

## Self-Maintenance

Two maintenance strategies, unified through the same governance gates:

- **Git-diff maintenance** (OpenWiki pattern): detects changed source files
  via `maintenanceHash`, sends changed snippets to an LLM, regenerates only
  affected pages.
- **Dreamer-wiki promotion** (5-phase): novelty scan → similarity → injection
  classification → entity + claim extraction → promote to wiki_pages. For
  event/conversation sources.

## MCP Tools

Five MCP tools for agent access to the wiki:

- `mdbrian_wiki_search` — hybrid search (vector + text + rank fusion)
- `mdbrian_wiki_get` — get page by slug (JSON, markdown, or HTML)
- `mdbrian_wiki_apply` — create or update a page (upsert)
- `mdbrian_wiki_export_okf` — export pages as OKF bundle
- `mdbrian_wiki_lint` — list pages + unresolved contradictions

### Start the MCP server

```bash
export MDBRAIN_API_URL="http://127.0.0.1:3847"
export MDBRAIN_API_KEY="local-dev-secret"
cd apps/mcp && bun run start
```

Connect from any MCP-compatible agent (Claude Desktop, Cursor, etc.) by pointing
it at the MCP server's stdio or HTTP transport.

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

The web console wiki tab lets you browse pages (filterable by kind), view full
page details (claims, contradictions, questions, relationships, backlinks), and
search.

## Packages

| Package | Description |
| --- | --- |
| `@mdbrian/wiki-engine` | Wiki pages schema, CRUD, OKF, search, governance, maintenance, connectors |
| `@mdbrian/memory-engine` | MongoDB memory manager (events, episodes, structured_mem, entities) |
| `@mdbrian/memory-bridge` | Bridge layer (config resolution, manager lifecycle) |
| `@mdbrian/client` | TypeScript HTTP client (wiki + memory methods) |
| `@mdbrian/tools` | AI SDK tools |
| `@mdbrian/lib` | Shared utilities |
| `@mdbrian/api` | Hono HTTP API server |
| `@mdbrian/mcp` | MCP server (5 wiki + existing memory tools) |
| `@mdbrian/web` | Next.js web console (wiki browsing tab) |

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `MDBRAIN_MONGODB_URI` | Yes | MongoDB connection string (local or Atlas) |
| `MDBRAIN_API_KEY` | Yes | API authentication key (any string for local dev) |
| `MDBRAIN_API_URL` | MCP only | URL of the MDBrain API server (default: `http://127.0.0.1:3847`) |
| `MDBRAIN_AGENT_ID` | Optional | Default agent ID (default: `"default"`) |
| `VOYAGE_API_KEY` | Optional | Atlas Model API key for auto-embeddings (`al-...` prefix) |

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

## License

MIT
