# MDBrain — LLM Wiki on MongoDB (Design Spec)

**Date:** 2026-07-08
**Status:** Draft (pending user review)
**Baseline:** mdbrain (MongoDB-native long-term AI memory) → transformed into a wiki-first company brain.
**Inspirations:** LangChain OpenWiki (LLM-maintained code wiki, git-diff incremental), Google Open Knowledge Format / OKF (vendor-neutral concept-per-page interchange spec), arXiv:2606.24535 "Governed Shared Memory for Multi-Agent LLM Systems" (fleet-memory governance primitives).

---

## 0. Problem & Wedge

The "LLM wiki / company brain" category (crystallized by Karpathy's June 2026 gist) inverts RAG: instead of retrieving chunks at query time, an LLM builds and maintains a persistent, interlinked, pre-synthesized knowledge layer that compounds over time. The category's biggest pain is **knowledge staleness + maintenance burden** (humans abandon wikis because upkeep grows faster than value). The field has bifurcated into file-format systems (OpenWiki, OKF — markdown, no database) and infrastructure-first systems (Mem0, Letta, Graphiti, Cognee — vector+graph+metadata glue). No funded competitor uses MongoDB; the category is Postgres+pgvector dominated (Memclaw, mybrains.ai). The unclaimed position: **one MongoDB system that collapses semantic + structured + temporal into a single consistency boundary**, with OKF as the interchange format bridging both camps.

MDBrain is that system. mdbrain already has ~80% of the infrastructure (hybrid retrieval, $graphLookup, Dreamer consolidation, injection classifier, bi-temporal, provenance, scoped retrieval). MDBrain transforms its conceptual center from "memory framework" to "LLM wiki" — wiki pages become the first-class, browsable artifact; the engine serves the wiki.

---

## 1. Architecture: 3-Layer Model (Karpathy-faithful)

```
Layer 3: SCHEMA          page-kind schemas + maintenance rules + governance policies
         │
Layer 2: WIKI            wiki_pages (LLM-synthesized, browsable by humans + agents)
         │               ▲ compiled by Dreamer + git-diff maintenance
         │               │ OKF import/export (interchange)
Layer 1: GRAPH+RAW       entities, relations, events, episodes, KB chunks, ingested docs
         │               $graphLookup backbone + $vectorSearch/$search/$rankFusion retrieval
```

- **Layer 1 (graph + raw):** the existing mdbrain engine — entities, relations, events, episodes, KB chunks. The structural backbone + immutable raw sources. `@mdbrain/memory-engine`.
- **Layer 2 (wiki):** NEW — `wiki_pages` collection, the synthesized browsable artifact. Compiled from layer 1 by two maintenance strategies. `@mdbrain/wiki-engine`.
- **Layer 3 (schema):** page-kind definitions, maintenance rules, governance policies (trust tiers, permission rules, contradiction resolution rules). Lives in `@mdbrain/wiki-engine` as config/types.

---

## 2. Approach: Transformative Refactor (chosen)

mdbrain's conceptual center shifts from memory to wiki pages. Proven infrastructure is kept (hybrid retrieval, $graphLookup, Dreamer consolidation, injection classifier, API/MCP/web); the conceptual model is refactored.

**Transforms inside memory-engine:**

- `structured_mem` facts → **claims on wiki pages** (the `claims[]` field on a page). The `structured_mem` collection becomes a Dreamer source, not the product center. Existing records migrate: the Dreamer compiles them into claims on the relevant entity's wiki page.
- `procedures` → a wiki page `kind: "procedure"`. The `procedures` collection is deprecated; records migrate to `wiki_pages`.
- `episodes`/`events`/`session_chunks` → ingest-source modules (layer 1 raw). Still collected, still consolidated into episodes, but they **feed** the Dreamer which compiles wiki pages. Not the product face.

---

## 3. Package Structure (rename `@mdbrain/*` → `@mdbrain/*`)

| Package | Status | Role |
| --- | --- | --- |
| `@mdbrain/wiki-engine` | **NEW** | `wiki_pages` + OKF import/export + page rendering + Map&Pointer + maintenance (git-diff + Dreamer-wiki) + contradiction detector + backlinks + permissions + trust tiers + connectors (Obsidian bidirectional, Confluence/Notion/Slack/CRM read-first) |
| `@mdbrain/memory-engine` | **KEEP+refactor** | entities/relations graph, $graphLookup, $vectorSearch+$search+$rankFusion, embeddings, injection classifier, bitemporal, scope. Refactored to serve wiki-engine. Dreamer promoted to call wiki-engine. |
| `@mdbrain/memory-bridge` | **KEEP+refactor** | stable facade, wiki operations added |
| `@mdbrain/client` | **KEEP+extend** | HTTP client + wiki methods |
| `@mdbrain/tools` | **KEEP+extend** | AI SDK tools: `wiki_search`, `wiki_get`, `wiki_apply`, `wiki_export_okf`, `wiki_lint` |
| `@mdbrain/lib` | **KEEP** | shared types (add wiki types) |
| `@mdbrain/api` | **KEEP+extend** | Hono API + `/v1/wiki/*` routes |
| `@mdbrain/mcp` | **KEEP+extend** | MCP server + wiki tools |
| `@mdbrain/web` | **KEEP+extend** | Next.js console + wiki browsing/rendering |

---

## 4. `wiki_pages` Collection — Full Schema

```js
{
  _id: ObjectId,
  kind: "entity" | "concept" | "synthesis" | "source" | "report" | "procedure",
  title: string,
  slug: string,              // URL-safe ID = OKF conceptId (file path in bundle)
  aliases: string[],
  summary: string,           // one-paragraph dense (OpenWiki style)
  body: string,              // full markdown (browsable by humans + agents)
  frontmatter: {             // OKF YAML + extensions
    type: string,            // OKF required field
    title: string,           // OKF recommended
    description: string,
    resource: string,        // canonical URI to original asset
    tags: string[],
    timestamp: date,         // ISO 8601
    // extensions (OKF permits extra keys)
    entityTypes: string[],   // person/company/project/concept/...
    privacyTier: "public" | "internal" | "confidential" | "restricted",
  },

  // Claims (openclaw WikiClaim + arXIV governance)
  claims: [{
    id: string,
    text: string,
    status: "active" | "superseded" | "contradicted" | "disputed",
    confidence: number,      // 0-1
    evidence: [{
      kind: "file" | "url" | "event" | "api" | "manual" | "agent",
      sourceId: string,      // ref to raw source / entity / event
      path: string,
      lines: string,
      weight: number,        // 0-1
      confidence: number,    // 0-1
      privacyTier: "public" | "internal" | "confidential" | "restricted",
      note: string,
    }],
    writerAgent: { id, name, runId },   // arXIV provenance
    derivedFrom: string[],              // provenance chain (source claim/event ids)
    supersedesClaimId: string,          // arXIV temporal supersession
    validFrom: date,
    validTo: date,
    updatedAt: date,
  }],

  // Cross-page contradictions
  contradictions: [{
    id: string,
    claimIds: [string, string],
    detectedAt: date,
    resolution: "unresolved" | "newest_wins" | "authority_wins" | "human_escalation",
    resolvedBy: string,
    resolvedAt: date,
    note: string,
  }],

  // Open questions (things the wiki doesn't know yet)
  questions: [{
    id: string,
    text: string,
    status: "open" | "answered",
    answeredByClaimId: string,
    createdAt: date,
  }],

  // Relationships to other pages (openclaw WikiRelationship)
  relationships: [{
    targetPageSlug: string,
    targetTitle: string,
    kind: string,            // "works_at" | "uses" | "depends_on" | "relates_to" | ...
    weight: number,
    confidence: number,
    evidenceKind: string,
    privacyTier: "public" | "internal" | "confidential" | "restricted",
  }],

  // Person card (kind="entity", entityType="person")
  personCard: {
    canonicalId: string,
    handles: string[],
    socials: string[],
    emails: string[],
    timezone: string,
    lane: string,
    askFor: string[],
    avoidAskingFor: string[],
    bestUsedFor: string,
    notEnoughFor: string,
  } | null,

  // Graph link
  entityId: string,          // ref to entities collection (graph backbone node)

  // OKF
  okfConceptId: string,      // file path in OKF bundle (e.g., "tables/users")
  okfBundleId: string,       // which bundle this belongs to

  // Governance (arXIV + mdbrain)
  scope: "session" | "user" | "agent" | "workspace" | "tenant" | "global",
  scopeRef: string,
  trustTier: "restricted" | "standard" | "admin",   // arXIV trust tiers
  permissions: {
    allowedRoles: string[],
    allowedDepartments: string[],
    privacyTier: "public" | "internal" | "confidential" | "restricted",
  },

  // Provenance + temporal (page-level)
  provenance: object,
  sourceAgent: { id, name, runId },
  sourceEventIds: string[],
  sourceReliability: number, // 0-1
  state: "active" | "superseded" | "draft",
  supersedes: string,        // pageId
  supersededBy: string,
  revision: number,
  validFrom: date,
  validTo: date,

  // Maintenance
  lastMaintainedAt: date,
  lastMaintenanceSource: "git-diff" | "dreamer" | "manual" | "api",
  maintenanceHash: string,   // content hash for git-diff detection
  freshness: "fresh" | "stale" | "unknown",

  // Backlinks (auto-generated, not manually edited)
  backlinks: [{
    sourcePageSlug: string,
    sourceTitle: string,
    context: string,
  }],

  // Search
  embedding: number[],       // vector of summary + body

  createdAt: date,
  updatedAt: date,
}
```

**Indexes:** `slug` (unique per scope), `kind`, `entityId`, `okfConceptId`, `scope+scopeRef`, `trustTier`, `state`, `freshness`, `tags`, `aliases` (text).
**Search indexes:** vectorSearch on `embedding`; Atlas Search compound on `title+summary+body+aliases+tags` with `kind`/`scope`/`trustTier`/`permissions` filters.

---

## 5. OKF Interchange (import + export)

OKF is the interchange format. The internal `wiki_pages` schema is richer than OKF; OKF is a strict-subset projection.

- **Import:** OKF bundle (dir of `concept.md` + YAML frontmatter) → `wiki_pages`. `index.md` → page relationships. `log.md` → maintenance history. Markdown body → `body`. Frontmatter → `frontmatter` + governance fields. Links → `relationships[]`.
- **Export:** `wiki_pages` → OKF bundle. `claims[]` → markdown bullets in body. `contradictions[]` → `## Contradictions` section. `questions[]` → `## Open Questions` section. `personCard` → `## Person Card`. `relationships[]` → markdown links. `backlinks[]` → `## Backlinks`. Frontmatter projected from page metadata.
- **Projection rule:** OKF export is a strict subset. Anything unexpressible in OKF (trust tiers, permissions, embedding, backlinks) stays in MongoDB — the OKF bundle is the portable projection. Export → import round-trips structure.

---

## 6. Self-Maintenance Pipeline (both strategies, unified)

The freshness engine — solves the category's #1 pain (staleness). One pipeline, two strategies by source type.

### Git-diff strategy (code/doc/git sources — OpenWiki pattern)

1. Detect changed source files via `maintenanceHash` (content hash) or git SHA.
2. Send changed snippets + current wiki page state to LLM.
3. LLM regenerates only affected pages (incremental, not full rebuild).
4. New/updated claims pass through governance gates.
5. Triggered by: API call, CLI, or CI webhook.

### Dreamer strategy (event/streaming/conversation sources — mdbrain adapted)

1. Novelty scan over new events/episodes.
2. $vectorSearch similarity to existing wiki pages + claims.
3. Injection classification (wiki-write safety).
4. Entity extraction + claim extraction.
5. Promote to `wiki_pages` (add/update claims, update body, flag contradictions).
6. **Contradiction detection runs BEFORE dedup/near-duplicate gating** (arXIV:2606.24535 pipeline-ordering lesson — a synchronous near-duplicate gate can prematurely reject contradictory writes before the async contradiction detector sees them).

### Shared governance gates (both strategies pass through)

- Injection classifier (safety)
- Contradiction detector (cross-page, before dedup)
- Trust-tier assignment (writer agent's tier)
- Permission check (does the writer have scope access?)
- Supersession lifecycle (old claim → `superseded`, not deleted — preserves audit trail)

---

## 7. Governance + Permissions (arXIV + Memclaw differentiator)

- **Scoped retrieval on EVERY access path:** scope filter (`scope`+`scopeRef`) applied not just in search but in `wiki_get` by slug, `wiki_get` by id, graph traversal, and export. The arXIV paper disclosed an asymmetric scope-enforcement bug on GET-by-id (remediated) — enforce scope on every read path, not just the API edge. <!-- scar: arXIV:2606.24535 GET-by-id scope leak -->
- **Trust tiers:** `restricted` / `standard` / `admin`. Determines write visibility + propagation. A `restricted` agent's claims are visible only within its scope; an `admin` agent's claims can propagate cross-scope. Replaces numeric-only `sourceReliability` with a role-based tier (keeps the numeric as a sub-signal).
- **Permissions:** `permissions.allowedRoles` + `allowedDepartments` + `privacyTier` on every page. Search/get filters by the caller's role+department. (Community suggestion, Dolev: metadata upfront + metadata filtering.)
- **Temporal supersession:** `supersedesClaimId` + `state: "superseded"` (not deleted) — preserves audit trail. Already in mdbrain's `structured_mem`; promoted to claim-level + page-level.

---

## 8. Sync Connectors + Surfaces (v1)

### Connectors

- **Obsidian connector** (bidirectional vault sync): `wiki_pages` ↔ Obsidian `.md` files. A hook watches the vault; changed files → `wiki_pages` (import). Changed `wiki_pages` → vault files (export, OKF format). `wikiSource: "obsidian"`, `vault`, `section` fields already in mdbrain's KB schema — reused.
- **GitHub repo-as-source:** a repo is a source. Git-diff maintenance ingests changed files → wiki pages. Like OpenWiki but the wiki lives in MongoDB, not just markdown.
- **Confluence connector (read-first, v1):** ingest Confluence spaces → KB chunks + wiki pages. Permission-aware (Confluence space permissions → `permissions` on the page). Write-back deferred to v1.1.
- **Notion connector (read-first, v1):** ingest Notion workspaces → KB chunks + wiki pages. Block tree → page structure. Write-back deferred to v1.1.
- **Slack connector (read-first, v1):** ingest Slack channels → events → Dreamer → wiki pages. Channel membership → `permissions`. Write-back (post summaries back) deferred to v1.1.
- **CRM connector (read-first, v1):** ingest CRM records (Salesforce/HubSpot) → entities + wiki pages (person/company pages). Record ownership → `permissions`. Write-back deferred to v1.1.

All four enterprise connectors share a common connector interface (`Connector` ABC: `authenticate`, `discover`, `ingest`, `mapPermissions`) in `@mdbrain/wiki-engine`. Each implements source-specific logic. Ingestion flows through the shared governance gates.

### Surfaces

- **Web console:** wiki browsing (page list by kind, full page render, backlinks, contradictions, questions, search). Next.js — extends existing `apps/web`.
- **MCP server:** `wiki_search`, `wiki_get`, `wiki_apply`, `wiki_export_okf`, `wiki_lint` (contradictions/staleness check). Extends existing `apps/mcp`.
- **API:** `/v1/wiki/*` — CRUD, search, export OKF, import OKF, maintenance trigger, contradiction list, connector management. Extends existing `apps/api`.
- **Map & Pointer** (OpenWiki pattern): `mdbrain init` generates a pointer block in `AGENTS.md`/`CLAUDE.md` telling agents which wiki pages to `read` before tasks. The pointer is generated from `wiki_pages` (the map).

---

## 9. Deferred to v1.1 / v2

- Connector write-back (wiki → Confluence/Notion/Slack/CRM) — v1.1
- Bidirectional wiki→code intent layer (Tal's frontier: change intent in wiki → agent changes code) — v2
- SKILL.md open standard (Caura) — v2
- Company-brain benchmarks (LongMemEval adaptation) — v2
- factory.ai-style CI auto-wiki on every push — v2
- Multi-producer conflict resolution across OKF bundles — v2

---

## 10. Data Flow (end-to-end)

```
Sources (git repo, Obsidian vault, Confluence, Notion, Slack, CRM, conversations, manual)
  │
  ├─ git-tracked ──→ git-diff strategy ──→ LLM regen affected pages ──┐
  ├─ event/stream ─→ Dreamer strategy ──→ novelty→similarity→inject→extract→promote ──┐
  └─ manual/API  ──────────────────────────────────────────────────────────────────→ │
                                                                                        │
              shared governance gates (injection, contradiction-before-dedup,          │
              trust-tier, permission, supersession)  ←────────────────────────────────┘
                                                                                        │
              wiki_pages (Layer 2) ←────────────────────────────────────────────────────┘
                │
                ├─ entities/relations (Layer 1 graph backbone)
                ├─ OKF export → bundle (.md + YAML)
                ├─ Map & Pointer → AGENTS.md/CLAUDE.md
                ├─ Web console render (humans)
                ├─ MCP/API (agents + apps)
                └─ Backlinks (auto-generated from relationships)
```

---

## 11. Testing Strategy

- **Unit:** wiki-engine modules (OKF import/export round-trip, contradiction detector, permission filter, backlink generator, page renderer, each connector's mapper).
- **Integration:** wiki_pages CRUD through API + MCP; Dreamer promotes events → wiki pages; git-diff regenerates pages from changed sources; scoped retrieval on every access path (the arXIV GET-by-id test).
- **E2E:** ingest a Confluence space + a Slack channel + a git repo → wiki pages compile → agent searches via MCP → correct scoped results → OKF export round-trips → import preserves structure.
- **Migration:** existing mdbrain `structured_mem` + `procedures` records → wiki pages (Dreamer migration pass).
- **Governance:** contradiction-before-dedup ordering test (reproduce the arXIV pipeline bug and prove MDBrain doesn't have it); cross-scope leak test; trust-tier propagation test.

---

## 12. Migration Plan (mdbrain → MDBrain)

1. Rename packages `@mdbrain/*` → `@mdbrain/*` across all package.json, imports, docs.
2. Create `@mdbrain/wiki-engine` package with `wiki_pages` schema + collection helpers.
3. Add `wiki_pages` collection + indexes + search indexes to `mongodb-schema.ts`.
4. Refactor `memory-engine` exports to serve `wiki-engine` (graph, retrieval, embeddings, injection classifier exposed as internal APIs).
5. Promote Dreamer to compile `wiki_pages` (not just `structured_mem`).
6. Migration script: `structured_mem` records → claims on wiki pages (matched by entityId/type); `procedures` → wiki pages kind="procedure".
7. Build OKF import/export.
8. Build connectors (Obsidian bidirectional first, then Confluence/Notion/Slack/CRM read-first).
9. Extend API/MCP/web with wiki surfaces.
10. Map & Pointer generator.

---

## 13. Research Artifacts

All research underpinning this design is in `docs/research/llm-wiki/`:

- `raw/01-landscape.out` — category landscape (Karpathy, OpenWiki, OKF, Mem0, Letta, Graphiti, Cognee, GraphRAG, LightRAG, Glean, Notion AI)
- `raw/02-github-code.out` — code-level analysis of 10+ OSS repos
- `raw/03-youtube.out` — YouTube coverage (architectures, pain points, MongoDB perception gap)
- `04-mongodb-why.md` — the one-system MongoDB argument (semantic+structured+temporal in one consistency boundary)
- `05-codebase.md` — mdbrain existing-impl recon
- `06-commercial.md` — Memclaw/Qontext/mybrains.ai/factory.ai verification
- `07-academic.md` — arXiv:2606.24535 governance primitives + trained-embedding claim debunk + bidirectional intent prior art
