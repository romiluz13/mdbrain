# Mdbrain acquisition-readiness remediation plan (kimi-k3)

Goal: make the repo survive a buyer re-run of technical due diligence at the
$200k price point. Every fix below is prioritized by acquisition risk and
grounded in official documentation (see Documentation basis). Plan only: no
application code is modified by this document.

Evidence anchors from DD re-validation (all confirmed against source):

- Quickstart boots `docker/docker-compose.minimal.yml` (`mongo:7`, no mongot),
  so `ensureWikiSearchIndexes` no-ops (packages/wiki-engine/src/wiki-schema.ts:928-942),
  `/ready` fails via `probeWikiSearch` (apps/api/src/wiki-store-runtime.ts:42-45),
  and `/v1/wiki/search` returns 503 SEARCH_UNAVAILABLE (apps/api/src/routes/v1.ts:2832-2837).
- Connectors: 5 shells return `sources: []` / `pagesCreated: 0`
  (packages/wiki-engine/src/wiki-connectors.ts:269/280, 336/345, 392/401, 448/459, 507/516);
  Obsidian ingest also returns `pagesCreated: 0` (:143); no app imports any connector.
- Maintenance: `runGitDiffMaintenance`/`runDreamerPromotion` have zero app callers;
  Dreamer phase 3 voids its classification and phase 4 stores the whole event as
  one claim at 0.7 (packages/wiki-engine/src/wiki-maintenance.ts:347-360).
- Docs drift: README "34 supported tools (6 wiki)" vs 30 registered
  (apps/mcp/src/server.ts:71-860) and 14 SDK tools (packages/tools/src/index.ts:291-452);
  README "Memongo 2.0.1" vs pinned 2.1.0+SHA (packages/memory-bridge/src/memongo-runtime.ts:11-12);
  governance is an app-side ACL post-filter with 4x over-fetch
  (packages/wiki-engine/src/wiki-search.ts:448-474).
- Dead surface: packages/memory-bridge/src/mdbrain-export.ts (only its test imports it,
  package entry is mdbrain-bridge only, packages/memory-bridge/package.json:19-27);
  apps/api/wrangler.jsonc and apps/mcp/wrangler.jsonc are unreferenced
  (no wrangler scripts in either package.json; runtimes are @hono/node-server,
  apps/api/src/server.ts:1,9 and stdio, apps/mcp/src/server.ts:1610).

---

## P0 — Make the quickstart run verbatim (blocks the demo; highest risk)

**D1. Repoint the quickstart database to the Atlas Local Preview compose stack.**
README.md:126 currently boots `docker/docker-compose.minimal.yml` (plain
`mongo:7`, no mongot). Change the quickstart to:

```bash
VOYAGE_API_KEY=al-... docker compose -f docker/mongodb/docker-compose.preview.yml up -d
```

**adapted snippet** (from the official image quickstart
`docker run -p 27017:27017 mongodb/mongodb-atlas-local`, Docker Hub page, and
the repo's own docker/mongodb/docker-compose.preview.yml). The `preview` tag is
the only tag bundling mongot with auto-embedding; per the official image page,
"Provide your Voyage API key through the environment variable `VOYAGE_API_KEY`"
and the key "must be provisioned via the Atlas UI" (the `al-...` Model API key,
routed through `https://ai.mongodb.com/v1/embeddings` by default). The compose
file already passes `VOYAGE_API_KEY` and uses the built-in
`/usr/local/bin/runner healthcheck` (official healthcheck mechanism).

`docker/docker-compose.minimal.yml` is **kept** but relabeled in its header and
in docs as "transactions-only dev mode (no Atlas Search; /ready and
/v1/wiki/search fail closed by design)". Deleting it is rejected: it is the
cheap local harness for non-search CRUD tests.

**D2. Make VOYAGE_API_KEY a first-class quickstart step, with honest degraded
mode.** The quickstart env block gains `export VOYAGE_API_KEY="al-..."` with the
provisioning link (cloud.mongodb.com -> AI Models -> Create model API key;
https://www.mongodb.com/docs/voyageai/management/api-keys/). One sentence states
the degraded path: without the key, mongot boots but auto-embedding is absent,
so vector/hybrid lanes 503 (fail-closed is the repo's deliberate design,
packages/wiki-engine/src/wiki-search.ts:351-360) while text search still works —
mirroring scripts/compose-smoke.ts's documented "search falls back to the text
lane" behavior. Official basis: Automated Embedding docs confirm embeddings are
generated only when the key is supplied at mongot deployment time, and
`.env.example:28-32` already defines the key family (VOYAGE_API_KEY plus
indexing/query/rerank sub-keys).

**D3. Fix the Memongo version claim.** README.md:128 "compatible Memongo 2.0.1
HTTP service" -> "compatible Memongo HTTP service matching the pinned contract
(2.1.0, SHA-256 verified at runtime)". Evidence: packages/memory-bridge/src/memongo-runtime.ts:11-12
and the hard mismatch rejection in packages/memory-bridge/src/memongo-http-client.ts:376-380.
Keep the pin gate unchanged — it is a DD asset, not a bug.

**D4. Add a verification block to the quickstart.** After `curl -fsS .../ready`
(which now passes because probeWikiSearch has mongot), keep the create-page and
hybrid-search curl demos, and add: "End-to-end proof: `bun scripts/compose-smoke.ts`
against `docker/compose.full.yml`". Note in the README that compose.full.yml
builds memongo from a sibling checkout (header comment, docker/compose.full.yml:9-15)
until an image is published. Snippet status: **proposed (untested)** until the
verbatim run in Validation is executed.

## P1 — Connector strategy: remove the shells, keep the real one (honesty fix)

**D5. Remove the 5 shell connectors** (GitHubConnector, ConfluenceConnector,
NotionConnector, SlackConnector, CrmConnector) and their registry entries from
packages/wiki-engine/src/wiki-connectors.ts, plus their tests. Keep the
`SourceConnector` interface and `ObsidianConnector` (real discovery at
wiki-connectors.ts:117-139 and real path-contained export), documented as
"beta, library API only — not exposed over HTTP or MCP yet". Justify:

- Zero coupling: no app imports any connector (grep across apps confirms only
  a permission string at apps/api/src/principal.ts:12 and marketing copy), so
  removal cannot break runtime behavior; package tests are adjusted.
- Alternatives rejected: *stub-gating* behind a flag still ships dead code and
  false marketing that DD already flagged once; *wiring all six honestly* means
  five external API integrations (new secrets, pagination, permission mapping)
  — multi-week scope and new failure modes before a $200k sale.
- Reversal cost is one git revert; the interface survives for the buyer's
  roadmap. README.md:112 (comparison row) and README.md:236 (features bullet)
  change from "Six read-only discovery adapters" to "Obsidian vault connector
  (beta, library API); additional connectors on the roadmap".

**D6. Sync the web marketing surface.** apps/web/lib/marketing/comparisons.ts:241
and apps/web/lib/marketing/architecture.ts:43-44 are rewritten to the same
post-removal wording (the architecture.ts link target survives: it points at
wiki-connectors.ts, which still exists with Obsidian). This removes the
product-level truth-in-advertising gap DD flagged.

## P1 — Maintenance wiring: real LLM adapter behind existing env vars

**D7. Add an OpenAI-compatible LLM adapter in @mdbrain/wiki-engine.**
`createChatCompletionsLlm(env)` returns `LlmGenerateFn` using the env contract
that already exists in scripts/mongodb-cluster-preflight.ts:41-43 and is fully
implemented in scripts/real-agent-smoke.ts:39-46,224-244
(MDBRAIN_LLM_BASE_URL / MDBRAIN_LLM_API_KEY / MDBRAIN_LLM_MODEL, plus the
proven MDBRAIN_LLM_AUTH_STYLE and MDBRAIN_LLM_TOKEN_PARAM variants). No new
dependency: global `fetch`, Node 20+. **adapted snippet** (pattern proven in
scripts/real-agent-smoke.ts:224-244, minus tool calling):

```ts
const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, temperature: 0, max_tokens: 2048, messages }),
})
// parse choices[0].message.content as JSON -> { summary, body, claims }
```

Grounded in the OpenAI Chat Completions reference (POST /chat/completions;
response `choices[0].message.content`; error envelope `{error: {message}}`),
which the repo script already implements verbatim.

**D8. Expose maintenance over HTTP, fail-closed when unconfigured.**
Two routes in apps/api/src/routes/v1.ts: `POST /v1/wiki/maintenance/git-diff`
and `POST /v1/wiki/maintenance/dreamer`, behind the existing bearer auth and
`buildWikiGovContext` governance pattern, returning `501 MAINTENANCE_UNCONFIGURED`
when MDBRAIN_LLM_* is unset (mirrors the 503 SEARCH_UNAVAILABLE fail-closed
pattern at v1.ts:2832-2837). MCP surface is **not** expanded pre-sale (keeps the
corrected "30 tools" claim stable; noted as post-sale work). README env table
gains the three MDBRAIN_LLM_* rows (currently absent from README.md:288-295
despite preflight requiring them).

**D9. Make Dreamer phases 3-4 real when an LLM is configured.** Phase 3 sends
event text + matched page state to the adapter and uses the returned
classification (new / update / contradiction) to route promotion; phase 4 uses
the adapter to extract typed claims with confidence instead of storing the whole
event at 0.7. When no LLM is configured, the current heuristic path stays as an
explicitly documented "degraded mode". **proposed code (untested)** — prompts
and JSON-schema coercion are net-new; unit tests mock the adapter exactly as
wiki-maintenance.test.ts already mocks LlmGenerateFn. README.md self-maintenance
bullet (README.md:230) is rewritten to describe the real phases and the
MDBRAIN_LLM_* requirement, dropping implied "always-on LLM" claims.

## P2 — Documentation and marketing corrections (finding 4 sweep)

- README.md:112 and :234: "34 supported tools (6 wiki)" -> "30 supported tools
  (6 wiki)"; add one line: "@mdbrain/tools exposes 14 AI SDK tools".
- README.md:228 governance: replace "native to the database query layer, not
  app-side checks" with the true split — scope/scopeRef/trustTier/privacyTier/state
  are pre-filtered inside the search pipeline (wiki-search.ts:128-147);
  role/department visibility is a governed post-filter over a deliberately
  4x over-fetched pool (wiki-search.ts:448-474), with the residual under-fill
  caveat the code already documents.
- README.md:128 Memongo 2.0.1 -> pinned 2.1.0 wording (D3).
- Connectors and self-maintenance bullets per D5/D9; env table per D8.
- Keep the README's existing mongot requirement note (README.md:83-85) — it is
  accurate and becomes consistent once the quickstart actually provides mongot.

## P2 — Dead-code disposition (finding 5)

- **mdbrain-export.ts: delete** (with its colocated test). It is unreferenced
  by the package entry (packages/memory-bridge/package.json:19-27 points only at
  mdbrain-bridge) and its canonicalize/sign/verify bundle surface overlaps the
  shipped OKF export path (mdbrain_wiki_export_okf). Deletion over re-export:
  an unreferenced signing format is a liability in DD (unaudited crypto surface);
  git history preserves it for post-sale revival. Pre-deletion check: repo-wide
  grep for `mdbrain-export` shows only the test import (already verified).
- **apps/api/wrangler.jsonc and apps/mcp/wrangler.jsonc: delete.** Neither
  package.json has a wrangler/opennext script; runtimes are @hono/node-server
  (apps/api/src/server.ts:1,9, port 3847) and MCP stdio
  (apps/mcp/src/server.ts:2,1610). apps/web/wrangler.jsonc **stays** — it is live
  via `opennextjs-cloudflare` preview/deploy scripts (apps/web/package.json).
- **tmp/ junk**: already untracked; add `tmp/` to .gitignore so DD does not trip
  on browser-profile debris.

## P3 — Explicitly NOT changing before the sale

1. No dependency upgrades: mongodb driver stays at resolved 7.2.0 (bun.lock);
   Biome/Turbo/Vitest/Next/Hono/MCP SDK versions untouched.
2. No Memongo pin bump and no weakening of the SHA-256 contract gate.
3. No wiki schema/validator changes, no migration tooling, no OKF format changes.
4. No new connectors, no MCP tool additions/removals (30 stays), no API route
   renames — surface stability beats feature growth pre-sale.
5. No $rerank default-on and no MongoDB version floor changes; $rankFusion's
   8.0+ requirement is satisfied by the preview image and already documented
   (README.md:83-85).
6. No changes to the docker/mongodb multi-container fullstack profile beyond
   doc pointers; no auth-model redesign; no renames/relicensing.
7. No new CI automation for README-verbatim testing (manual runbook in
   Validation suffices pre-sale; automation is post-sale hardening).

## Validation strategy (repo gates first, live proof second)

1. Static gates, in order: `bun run check-types`, `bun run lint`
   (`biome check . --diagnostic-level=error`), `bun run build`,
   `bun run test` (turbo + `bunx vitest run scripts/*.test.ts`),
   `bun scripts/check-publishability.ts` — all must be green post-change.
2. Verbatim quickstart proof: copy-paste the corrected README quickstart into a
   clean shell — preview compose up, `/ready` 200, page create, hybrid search
   returns results (requires a real `al-...` key; recorded as a manual evidence
   run, not CI).
3. Full-stack smoke: `docker compose -f docker/compose.full.yml up -d` then
   `MDBRAIN_API_KEY=... bun scripts/compose-smoke.ts` (text-lane fallback is
   acceptable evidence when no Voyage key is available; key-present run covers
   the vector lane).
4. Load: `bun run stress-test` before/after to show no regression from connector
   removal and maintenance routes.
5. Maintenance lanes: `bun run mongodb:cluster-preflight` (validates
   MDBRAIN_LLM_* + Voyage key shape) and `bun run agent-smoke` against the new
   maintenance routes with the LLM adapter configured.
6. DD regression checklist: re-run the five validated findings as
   pass/fail checks after remediation.

## Documentation basis

| Technology | Version in use | Official source (accessed 2026-09-06) | Used for |
| --- | --- | --- | --- |
| mongodb-atlas-local image, `preview` tag | preview (tracks latest MongoDB) | https://hub.docker.com/r/mongodb/mongodb-atlas-local | D1/D2: preview bundles mongod+mongot, auto-embedding via `VOYAGE_API_KEY`, `al-...` Atlas-provisioned keys, default endpoint ai.mongodb.com, runner healthcheck |
| MongoDB Automated Embedding (autoEmbed) | Preview feature | https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/ | D2: `autoEmbed` index type, query-time `query.text` + `model`; matches wiki-schema.ts:857 and wiki-search.ts:176 (voyage-4-large). Note: official docs mark this Preview/"do not use in production" — disclose to buyer |
| $rankFusion | MongoDB 8.0+ (8.0.X needs support case) | https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/ | Confirms the hybrid pipeline shape in wiki-search.ts:278-297 and the server floor for the preview image |
| Voyage Model API keys | unversioned service, accessed 2026-09-06 | https://www.mongodb.com/docs/voyageai/management/api-keys/ (also cited in docker/mongodb/docker-compose.preview.yml header) | D2 key provisioning instructions |
| OpenAI Chat Completions | unversioned REST, accessed 2026-09-06 | https://platform.openai.com/docs/api-reference/chat/create | D7/D9 adapter: POST /chat/completions, `choices[0].message.content`, error envelope; repo-proven pattern at scripts/real-agent-smoke.ts:224-244 |
| MongoDB Node driver | 7.2.0 resolved (bun.lock; declared ^7.0.0) | https://mongodb.github.io/node-mongodb-native/ (7.x API) | createSearchIndex/listSearchIndexes used by wiki-schema.ts:913-922; unchanged by plan |
| Repo gates | turbo ^2.5.0, Biome (biome.json), Vitest, Bun 1.2+ | package.json:14-34 | Validation strategy |

Open questions:
1. Removal vs retain-as-experimental for the 5 shell connectors is a product
   call — this plan recommends removal; flipping to gating is low-cost.
2. No CI secret holds an `al-...` Voyage key; the key-present quickstart proof
   is a manual evidence run. Acceptable pre-sale?
3. `$rerank` manual page 404s (stage is 8.3+ Preview per code comments); plan
   leaves rerank untouched, so this stays an unverified doc link, not a
   blocker.
4. compose.full.yml still builds memongo from a sibling checkout
   (docker/compose.full.yml:9-15); publishing a pinned image is post-sale.

Final comparison and check results: **pending** (plan-only task; per DDD phase
4, compare the implemented diff against the cited sections above and record
actual gate results before claiming completion).
