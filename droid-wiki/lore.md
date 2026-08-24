# Project lore

MDBrain's `origin/main` history runs from a large Memongo import on 2026-07-08 to the retrieval autopsy demo on 2026-08-23. The project did not grow in a straight line: it added a governed wiki beside the imported memory system, hardened both surfaces, and later removed the repository's copied memory engine in favor of a version-pinned Memongo HTTP boundary.

## 2026-07-08: The Memongo inheritance

Commit `3695cfe` imported 365 files and 133,325 lines under the Memongo name, along with LLM-wiki research. The first tree already contained the API, MCP server, web app, client, tools, shared library, memory bridge, and a large local `packages/memory-engine/`. Those inherited surfaces explain why `apps/api/src/app.ts`, `apps/api/src/routes/v1.ts`, `apps/mcp/src/server.ts`, `packages/client/src/client.ts`, `packages/tools/src/index.ts`, and `packages/memory-bridge/src/memory-config.ts` have the longest continuous lineages in the current repository.

At this point, `packages/memory-engine/` owned MongoDB memory storage and retrieval inside the monorepo. That architecture is historical, not current. The modern request path is described in [`overview/architecture.md`](overview/architecture.md).

## 2026-07-09 to 2026-07-12: A wiki and a name emerge

The 2026-07-09 commits first renamed the repository-wide `@memongo/*` namespace to `@mbrain/*` and created `packages/wiki-engine/`. During the same day, the wiki gained its MongoDB schema, CRUD and rendering path, OKF interchange, hybrid search, MCP tools, and an initialization generator. On 2026-07-10, migration from structured memory and procedures, governance, contradiction detection, self-maintenance, and source connectors followed. A web wiki browser landed on 2026-07-11.

The naming trail is unusually visible in file history. `mbrain` replaced `memongo` on 2026-07-09; a later rename intended to produce MDBrain instead produced the transposed spelling `mdbrian` in paths such as the then-current bridge and package; commit `483cf3a` corrected `mdbrian` to `mdbrain` on 2026-07-12. The commit subjects establish the sequence, but they do not explain every naming consideration.

These days also contain three repo-wide rewrites: 234 files changed for the Memongo-to-MBrain transition, 231 for the attempted MDBrain rename, and 238 for the spelling correction. The churn was mostly systematic renaming around a rapidly expanding wiki rather than three independent product rebuilds.

## 2026-07-10 to 2026-07-14: The wiki becomes governed retrieval

The first wiki slice quickly became more than page storage. `packages/wiki-engine/src/wiki-governance.ts` added scope, trust-tier, and permission filtering. `packages/wiki-engine/src/wiki-contradictions.ts` put contradiction checks before deduplication. Maintenance paths and connectors brought Git diffs, Dreamer promotion, Obsidian, GitHub, Confluence, Notion, Slack, and CRM material into the design.

On 2026-07-13, Voyage AI auto-embeddings and publish-readiness work arrived. On 2026-07-14, reranking and graph expansion were wired into `packages/wiki-engine/src/wiki-search.ts`, then rewritten around native `$graphLookup` and `$rerank`. The commit sequence suggests a move from a basic wiki search feature toward retrieval that preserved provenance and access rules, although the history alone cannot establish every product motivation.

## 2026-07-16 to 2026-07-18: Hardening the edges

The middle of July concentrated on failure boundaries. Wiki reads began enforcing governance and excluding soft-deleted pages. `apps/api/src/app.ts` gained stricter authentication, CORS, rate limiting, and error redaction. OKF paths and input sizes were constrained, SSRF checks became fail-closed, and API, client, and OpenAPI surfaces were aligned.

Operational work on 2026-07-18 added change-stream restart behavior, atomic self-editing, migration version records, and telemetry batching. These changes strengthened both the inherited memory runtime and the new wiki rather than replacing either architecture yet.

## 2026-07-30: Maturation before the boundary change

Ten commits on 2026-07-30 form a compact maturation pass. The local memory engine received tenant-isolation, scoring, quantization, and episode-materialization fixes. The wiki adopted OKF 0.2 provenance and trust vocabulary, page revisions, transclusion, safer import behavior, remote OKF export, and more MCP maintenance operations.

This was the last date on which `packages/memory-engine/` was advanced on `origin/main`. Its removal in August therefore replaced active code, not an already-abandoned shell.

## 2026-08-19: Memory moves behind Memongo HTTP

Commit `09ca531` made the largest architectural rewrite after the import: 403 files changed, with 34,852 insertions and 113,081 deletions. It deleted all 200 tracked files under `packages/memory-engine/`, expanded `packages/memory-bridge/` from 10 files to 22, and added the captured Memongo 2.0.1 contract under `docs/contracts/memongo/2.0.1/`.

The replacement boundary lives in `packages/memory-bridge/src/memongo-http-client.ts`, `packages/memory-bridge/src/memongo-gateway-contract.ts`, and `packages/memory-bridge/src/memongo-runtime.ts`. `apps/api/` retained orchestration, principal handling, and durable delivery; `packages/wiki-engine/` retained wiki ownership; and the separate Memongo service became responsible for long-term memory storage and retrieval. In other words, the local memory engine is deprecated and gone; the bridge is now an HTTP gateway rather than an adapter to an in-repo engine.

The rewrite made growth look like contraction. The tree moved from 365 files at import to 313 files by 2026-08-23, and tracked TypeScript/JavaScript files fell from 256 to 152, even as `packages/wiki-engine/`, the delivery state machine, contract evidence, and public product surfaces were added.

## 2026-08-22 to 2026-08-23: The architecture becomes visible

The living system atlas showcase landed on 2026-08-22 in `apps/web/app/components/system-atlas.tsx` and related comparison and scenario pages. The retrieval autopsy followed on 2026-08-23 under `apps/web/app/demo/`, exposing a staged view of query analysis, retrieval results, and the assembled context bundle.

These commits did not introduce another storage architecture. They turned the post-cutover system into a product narrative and an inspectable demo. For the current component map, continue to [`overview/architecture.md`](overview/architecture.md); for compact historical measurements and oddities, see the companion background page, [`fun-facts.md`](fun-facts.md).
