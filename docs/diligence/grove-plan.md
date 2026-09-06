# MDBrain Acquisition-Readiness Remediation Plan — Grove GLM 5.3 (Round 1)

Status: independent plan, pre-debate. Methodology: DDD (discover → ground → implement → compare).

## Goal

Close the validated gap between what MDBrain claims and what it is, ranked by acquisition risk, with the smallest safe change set. Principle: **make the repo be what it claims, or make it claim what it is.** No re-architecture before a sale.

## P0 — deal-killers (doc/config level, ship first)

### W1: Quickstart must run verbatim end-to-end

- **Decision:** switch the README quickstart from `docker/docker-compose.minimal.yml` (mongo:7, no mongot) to `docker/mongodb/docker-compose.preview.yml` (`mongodb/mongodb-atlas-local:preview`). Grounding: official Docker Hub page (accessed 2026-09-06) documents the `preview` tag as mongod + mongot single-node replica set with Atlas Search, Vector Search, and auto-embedding; built-in healthcheck every 30s; compose `depends_on: condition: service_healthy`.
- **Decision:** document the embedding key correctly. `VOYAGE_API_KEY` must be an Atlas Model API key (`al-...`) provisioned via the Atlas UI; a key provisioned directly at VoyageAI requires `EMBEDDING_PROVIDER_ENDPOINT=https://api.voyageai.com/v1/embeddings` (both per the official image docs). Today this nuance lives only in `.env.example`.
- **Decision:** keep the minimal stack in the README as an explicitly labeled "transactions-only, no search" variant with a warning that `GET /ready` reports the wiki search dependency as failed and `/v1/wiki/search` returns 503. Do NOT soften fail-closed readiness — it is correct behavior; the README was wrong, not the code.
- **Decision:** fix "Memongo 2.0.1" → 2.1.0 (pin evidence: `docs/contracts/memongo/2.1.0/capture.json`, `packages/memory-bridge/src/memongo-runtime.ts`).
- **Proposed snippet (untested), README quickstart:**
  ```bash
  docker compose -f docker/mongodb/docker-compose.preview.yml up -d
  # wait for healthy: docker inspect -f {{.State.Health.Status}} <container>
  export VOYAGE_API_KEY="al-..."   # Atlas Model API key from the Atlas UI
  export MDBRAIN_WIKI_MONGODB_URI="mongodb://127.0.0.1:27017/?directConnection=true"
  # ... MEMONGO_API_URL/KEY (Memongo 2.1.0), MDBRAIN_API_KEY, then apps/api dev
  ```
- **Validation:** run the README quickstart commands verbatim in a clean environment; `curl /ready` → 200; `POST /v1/wiki` + `POST /v1/wiki/search` succeed; `scripts/compose-smoke.ts` green on `docker/compose.full.yml`.

### W2: Truth-in-advertising (README + shipped marketing)

- README tool count: "34 supported tools" → **30 MCP tools (24 memory + 6 wiki)**; `@mdbrain/tools` exposes 14 (counts from `apps/mcp/src/server.ts` toolList and `packages/tools/src/index.ts`).
- README governance sentence: replace "native to the database query layer, not app-side checks" with an accurate description: scope/scopeRef/trustTier/privacyTier/state are query-level prefilters; role/department ACLs run as a governed post-filter with deliberate 4x over-fetch (documented at `packages/wiki-engine/src/wiki-search.ts:445-474`).
- README connectors section + Comparison table: only Obsidian (vault discovery + path-contained export) is implemented; the other five are config-validation shells → label them "planned", not "6 read-only discovery adapters".
- `apps/web/lib/marketing/comparisons.ts:241` and landing copy: same correction — the console ships to users; claims must match code. Update the colocated marketing-content tests.
- Dreamer copy: README already says "simplified"; extend with "phase 3 injection classification and LLM claim extraction are pending" so it matches the stubbed code.
- **Validation:** `bun run test` (apps/web marketing tests updated), manual README-vs-code count diff.

### W3: Dead-code disposition

- **Decision:** re-export `mdbrain-export.ts` (canonicalize/sign/verify) from the `mdbrain-bridge.ts` package entry. It is fully tested and is the only signed-export capability; deleting tested, working code before due diligence is worse than wiring it. Add a one-line README mention.
- **Decision:** delete `apps/api/wrangler.jsonc` and `apps/mcp/wrangler.jsonc` (dead config; runtimes are `@hono/node-server` and stdio). Keep `apps/web/wrangler.jsonc` — it is live (OpenNext preview/deploy scripts in `apps/web/package.json`).
- **Validation:** `bun run check-types && bun run lint && bun run build && bun run test`; `scripts/check-publishability.ts` re-packs and smoke-imports (mdbrain-export joins the public surface via the entry).

## P1 — substance (code level, separate PRs)

### W4: Wire maintenance honestly

- Add a CLI, `scripts/maintenance-run.ts`, invoking `runGitDiffMaintenance` with an LLM adapter over the env vars already expected by `scripts/mongodb-cluster-preflight.ts` (`MDBRAIN_LLM_BASE_URL`/`API_KEY`/`MODEL`), reusing the chat-completions client pattern from `scripts/real-agent-smoke.ts:223-224`. CLI-first: no new API routes before the sale.
- Dreamer: fix phase 3 (either implement injection classification via the LLM callback or delete the dead `_injectionType` computation) and route phase 4 claim extraction through `LlmGenerateFn` when available, keeping the current whole-event-claim heuristic as fallback. Expose `runDreamerPromotion` via the same CLI.
- **Validation:** unit tests with a fake `LlmGenerateFn`; optional live run against the preview stack.

### W5: Connector honesty gate

- **Decision:** do NOT build five integrations pre-sale. Change GitHub/Confluence/Notion/Slack/CRM `discover()`/`ingest()` to throw a typed `ConnectorNotImplementedError` instead of silently returning empty sources / `pagesCreated: 0`. Fail loud, never fake success. Obsidian unchanged.
- **Proposed snippet (untested):** `export class ConnectorNotImplementedError extends Error { constructor(c: string) { super(\`connector ${c} is not implemented\`); } }` thrown at the top of each stub method.
- **Validation:** unit tests asserting each stub throws; grep confirms no silent empty returns remain.

## P2 — explicitly NOT done before the sale

No real connector integrations; no MongoDB schema/collection changes; no new runtime dependencies; no changes to the delivery ledger, pin rail, or CAS/governance machinery; no `$rankFusion`/`$rerank` behavior changes; no apps/web redesign; no Node/Bun/MongoDB version bumps; no new public API routes.

## Sequencing and effort

W1 → W2 → W3 (one PR each, ~1 day total, doc/config only) → W4, W5 (code, ~2-3 days). Every PR gated on the repo's own checks: `bun run check-types`, `lint`, `build`, `test`, `check-publishability`; W1 additionally on `compose-smoke`.

## Documentation basis

- **mongodb/mongodb-atlas-local image** — official Docker Hub page, accessed 2026-09-06: `preview` tag (mongod+mongot, Atlas Search/Vector Search, auto-embed), `VOYAGE_API_KEY` must be Atlas-UI-provisioned (`al-...`), `EMBEDDING_PROVIDER_ENDPOINT` override, healthcheck + `service_healthy`. <https://hub.docker.com/r/mongodb/mongodb-atlas-local>
- **$rankFusion** — MongoDB Manual, accessed 2026-09-06: 8.0+ (support case needed on 8.0.X), RRF weights, `scoreDetails` — matches `wiki-search.ts` usage; no change planned. <https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/>
- **Auto-embeddings ("create embeddings automatically")** — <https://www.mongodb.com/docs/atlas/atlas-vector-search/crud-embeddings/create-embeddings-automatic/> — cited from the official Docker Hub page; re-verify at implementation time.
- **$rerank** — official doc URL not located (manual-reference and search-docs paths tried, 404, 2026-09-06); behavior pinned to MongoDB 8.3+ by repo code with a tested no-rerank fallback (`wiki-search.ts:234-262`). Open question only; no plan decision depends on it.
- **Memongo contract pin 2.1.0 + SHA** — repo evidence `docs/contracts/memongo/2.1.0/capture.json`, enforced in `packages/memory-bridge/src/memongo-http-client.ts:373-383`.
- **Docker Compose `depends_on: condition: service_healthy`** — documented on the official atlas-local Docker Hub page (used by `docker/compose.full.yml` already).

Open questions: none blocking. Optional phrasing choice for the tool count ("30 tools" vs "24 memory + 6 wiki").
