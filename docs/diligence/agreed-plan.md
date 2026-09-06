# MDBRAIN ACQUISITION-READINESS REMEDIATION — AGREED PLAN (3-agent consensus)

Authors: Grove GLM 5.3, Kimi K3, Sol GPT-5.4 (panes "kimi k3", "sol 5.6"). Methodology: DDD.
Status: synthesized from three independent Round 1 plans (docs/diligence/grove-plan.md, docs/diligence/kimi-k3-plan.md, docs/diligence/gpt-5.4-plan.md) and a Round 2 debate (docs/diligence/debate/). All nine debated points converged; verdicts recorded in docs/diligence/debate/*-round2.md. (Authored pre-relocation under tmp/plans/ and tmp/debate/; moved per P9.)

## Principle (unanimous)

Make the repo be what it claims, or make it claim what it is. No fake-success surface survives; no feature-building smuggled into remediation; claims-correction PR lands after the code PRs so documentation only ever describes shipped behavior.

## Converged decisions (Round 2 verdicts)

- P1: Delete the 5 shell connector classes + their config types/tests/public exports; keep `SourceConnector` contract, registry, and Obsidian (relabeled "beta: vault discovery + path-contained export; ingest is roadmap"). Obsidian ingest implementation and `wiki:sync:obsidian` CLI are deferred post-sale.
- P2: Delete `packages/memory-bridge/src/mdbrain-export.ts` + its test (unreachable, header over-promises "export every memory"); CHANGELOG entry marks it for post-sale revival with a real retrieval path.
- P3: Maintenance is exposed via a CLI only (`scripts/maintenance-run.ts`); no new HTTP routes pre-sale (Kimi's 501-when-unconfigured route design is recorded as the buyer's roadmap).
- P4: Canonical quickstart = ONE path: `docker/compose.full.yml` (boots preview-based MongoDB+Search, Memongo, API, and web in one command; this also satisfies Kimi's must-have "one canonical compose path" and avoids Sol's double-boot objection). `VOYAGE_API_KEY` becomes required in that file via `${VOYAGE_API_KEY:?...}` interpolation (keyed fail-fast). The Memongo sibling-checkout prerequisite is stated with exact verbatim commands; publishing a public Memongo 2.1.0 OCI image is a parallel, non-blocking ops track. The MongoDB-only preview compose and the transactions-only fixture are dev conveniences, clearly labeled, never part of the canonical path. Keyless text-only dev mode = `docker run -p 27017:27017 mongodb/mongodb-atlas-local:preview` (no key, official image quickstart form) + locally run API; mongot serves the text lane, vector/autoEmbed report `unavailable`.
- P5: Dreamer fails closed without `MDBRAIN_LLM_*` configured. The whole-event/0.7-confidence extraction is never the silent default; if a heuristic importer survives, it is an explicit opt-in mode, separately named, and reported in `MaintenanceResult`.
- P6: `/ready` keeps text-lane fail-closed probe semantics (no evaluator lockout, no async-index flapping). Additions: `ensureWikiSearchIndexes` reports per-index (vector vs text) creation status; `/ready` payload gains a `search: { text, vector, autoEmbed }` capability block. A missing or invalid Voyage key does NOT fail `/ready`: the capability block reports `vector`/`autoEmbed` as `unavailable` with an actionable, non-secret diagnostic, while `/ready` stays 200 (text-ready). Invalid credentials fail the separate keyed hybrid gate in `compose-smoke`, not `/ready`. (Sol objection 3, accepted.)
- P7: Mechanical claim-drift gates, minimal form: a test asserting 30 unique MCP tool names via `tools/list`, and a unit test asserting `Object.keys(createMdbrainTools(...))` = 14, each naming the README lines they pin. No docs-generation machinery.
- P8: Dev quickstart compose keeps the mutable `preview` tag (as documented by the official image page) with the currently resolved digest recorded in a comment for traceability. Digest-pinning of `compose.full.yml` images belongs to the image-publication track, only alongside a refresh script.
- P9: `tmp/` added to `.gitignore`; durable diligence artifacts (the three plans + debate records + this plan) are relocated to `docs/diligence/` so the proof pack survives.
- Verified correction (all three accepted): `apps/web/lib/marketing/comparisons.ts:241` is the OpenWiki competitor entry — legitimate comparison copy, not rewritten. The MDBrain-side marketing fix targets `apps/web/lib/marketing/architecture.ts`.

## Workstreams

### W1 — Self-contained quickstart (P0)

1. README quickstart becomes ONE canonical path: `docker/compose.full.yml`. Exact verbatim commands (Sol objections 1+2, accepted; command form per Sol round 3c): from a fresh parent directory — (a) `git clone https://github.com/romiluz13/mdbrain.git` and `git clone https://github.com/romiluz13/memongo.git` (sibling checkouts in the same parent directory, matching the compose build context `../../memongo` relative to `docker/compose.full.yml`); (b) `cd mdbrain && git -C ../memongo checkout <contract-2.1.0 revision>` — the tag/SHA matching contract 2.1.0 (docs/contracts/memongo/2.1.0/capture.json records the contract but not a git ref, so the implementer verifies the exact ref during the W1 verbatim run and records the confirmed SHA in `docs/diligence/`); (c) `docker compose -f docker/compose.full.yml up -d --wait --wait-timeout 180`; (d) health: `curl -fsS http://127.0.0.1:3847/ready` → 200 (exercises the Memongo contract check and the search capability block). Step ordering in the README makes the Memongo prerequisite precede the `/ready` check so a clean-machine evaluator never hits an ambiguous failure.
2. `docker/compose.full.yml`: change `VOYAGE_API_KEY=${VOYAGE_API_KEY:-}` to `${VOYAGE_API_KEY:?Set an Atlas Model API key (al-...)}` (keyed fail-fast; the header's "boots degraded without it" comment is removed). README gains one provisioning paragraph: Atlas UI → AI Models → Model API key (`al-...`); VoyageAI-direct keys need `EMBEDDING_PROVIDER_ENDPOINT=https://api.voyageai.com/v1/embeddings` (compose passes it through as an environment entry). Basis: official Docker Hub page (accessed 2026-09-06) + https://www.mongodb.com/docs/voyageai/management/api-keys/.
3. Keyless dev mode, documented as a separate section (never in the canonical path): `docker run -d -p 27017:27017 --name atlas-local mongodb/mongodb-atlas-local:preview` (no key, official image quickstart), `MDBRAIN_WIKI_MONGODB_URI=mongodb://127.0.0.1:27017/?directConnection=true`, then run the API locally (`bun run dev` in apps/api). Mongot is present so the text lane serves; the capability block reports `vector`/`autoEmbed` `unavailable`. This mode still requires Memongo for memory features (same sibling checkout, `MEMONGO_API_URL` pointing at a locally running Memongo) — stated explicitly so the evaluator knows what works without a key (Kimi comment, round 3b, accepted). (Sol objection 3, accepted.)
4. README "compatible Memongo 2.0.1" → "compatible Memongo HTTP service matching the pinned contract (2.1.0, SHA-256 verified at runtime)".
5. `docker/mongodb/docker-compose.preview.yml` relabeled "dev convenience: MongoDB+Search only" and `docker/docker-compose.minimal.yml` "transactions-only dev fixture — no mongot; `/ready` and `/v1/wiki/search` fail closed by design"; neither is part of the canonical quickstart.
6. `scripts/compose-smoke.ts` extended: create a uniquely named wiki page, poll hybrid search until that exact slug returns (keyed run); empty results are no longer a pass. Text-lane fallback remains acceptable evidence when no key is available.
7. The currently resolved `mongodb/mongodb-atlas-local:preview` image digest is recorded in `docs/diligence/` (and as a compose comment) for traceability. (Kimi comment 1, accepted.)
8. Validation: verbatim README run on a clean machine (Docker, Bun 1.2+), steps in the documented order including the Memongo prerequisite: `/ready` 200, page create, hybrid search returns the created slug; `compose-smoke` green on `docker/compose.full.yml`.

### W2 — Dead-code and config cleanup (P0)

1. Delete `packages/memory-bridge/src/mdbrain-export.ts` + `mdbrain-export.test.ts`; CHANGELOG note.
2. Delete `apps/api/wrangler.jsonc` + `apps/mcp/wrangler.jsonc` (runtimes are `@hono/node-server` and stdio); keep `apps/web/wrangler.jsonc` (live OpenNext preview/deploy scripts).
3. `.gitignore` gains `tmp/`; relocate `tmp/plans/` + `tmp/debate/` + this plan to `docs/diligence/`.
4. Validation: `bun run check-types && bun run lint && bun run build && bun run test && scripts/check-publishability.ts`.

### W3 — Maintenance, honestly wired (P1)

1. Extract the OpenAI-compatible client from `scripts/real-agent-smoke.ts` into a shared adapter (`scripts/lib/openai-compatible-llm.ts`): `MDBRAIN_LLM_BASE_URL/API_KEY/MODEL` (+ `AUTH_STYLE`/`TOKEN_PARAM` variants), timeout/abort, response-size limits, retry only on transient status codes, redacted errors.
2. `scripts/maintenance-run.ts` CLI: `git-diff` and `dreamer` subcommands; scope/scopeRef flags; dry-run mode (no writes); machine-readable summary; nonzero exit on item failure; guaranteed store shutdown. Operator-triggered only — no scheduler, no daemon.
3. Dreamer phase 3: LLM classification (`ignore | new | update | contradiction`) routes phase 5 behavior; `_injectionType` dead computation removed. Phase 4: structured claim extraction with per-claim confidence and provenance; JSON-schema-constrained output validated locally. Fail closed when the LLM is unconfigured; heuristic importer only as explicit opt-in, separately named, reported in `MaintenanceResult`.
4. README env table gains the `MDBRAIN_LLM_*` rows; self-maintenance bullet describes operator-triggered commands and the LLM requirement.
5. Validation: unit tests with fake `LlmGenerateFn` (success, malformed JSON, timeout, retry bounds, redaction); dry-run write-free test; idempotency test; `bun run mongodb:cluster-preflight` for env validation.

### W4 — Connector truth (P1)

1. Remove GitHub/Confluence/Notion/Slack/CRM connector classes, config types, tests, and public exports from `packages/wiki-engine/src/wiki-connectors.ts` + `index.ts`.
2. Keep `SourceConnector`, `ConnectorRegistry`, result types, and Obsidian. Obsidian relabeled with the throw named explicitly, so W5 wording cannot drift back into implying a working ingest: "Obsidian (beta): real vault discovery + path-contained export; `ingest` throws `ConnectorNotImplementedError` until the post-sale roadmap item lands." (Kimi comment 3, accepted.)
3. Validation: package tests updated; grep confirms no silent success-with-zero surfaces remain in the connector module.

### W5 — Claims correction + drift gates (P0/P1, lands after W3/W4 so it describes shipped state)

1. README: "34 supported tools" → "30 MCP tools (6 wiki) + 14 AI SDK helpers via @mdbrain/tools"; Memongo 2.1.0 pin wording; governance split (index-side prefilters: scope/scopeRef/trustTier/privacyTier/state; governed app-side post-filter: role/department/subject/group with deliberate 4x over-fetch and documented underfill caveat); connectors ("Obsidian beta + provider-neutral extension contract; additional connectors on the roadmap"); self-maintenance ("operator-triggered", LLM-required Dreamer).
2. `apps/web/lib/marketing/architecture.ts`: connector + maintenance copy aligned with the same reality; `comparisons.ts` untouched.
3. Drift gates (P7 minimal form): MCP `tools/list` unique-name count test (30) and SDK tool-inventory test (14), each citing the README line they pin; both run in the existing test suite, no secrets.
4. Validation: repository-wide grep finds no stale "34 tools", "Memongo 2.0.1", "six connectors", autonomous-maintenance, or database-native-ACL claims; marketing-content tests updated and green.

## Explicitly NOT done before the sale (unanimous)

No Obsidian ingest implementation; no new HTTP/MCP API surface; no dependency upgrades (mongodb driver stays 7.2.0-resolved); no Memongo pin/SHA changes; no wiki schema/OKF/migration changes; no governance filter redesign (post-filter documented + non-leakage/underfill tests only); no `$rankFusion`/`$rerank` behavior changes; no background scheduler/queue; no OCI image publication as a release blocker; no Node/Bun/MongoDB version bumps; no CI secret automation for the keyed hybrid run (manual evidence run with a real `al-...` key, recorded in the diligence pack).

## Sequencing

- PR 1: W1 + W2 (quickstart + cleanup — doc/config level).
- PR 2: W3 + W4 (maintenance CLI + Dreamer + connector removal — code level).
- PR 3: W5 (claims + drift gates — describes final shipped state).
- Release candidate: full validation matrix below; each PR independently green.

## Validation matrix (run in order, stop on first failure)

1. `bun install --frozen-lockfile`; `bun run check-types`; `bun run lint`; `bun run build`; `bun run check-publishability`; `bun run test`.
2. Focused: connector tests; maintenance engine + LLM-adapter fake-server tests; MCP `tools/list` + SDK inventory drift tests; governance non-leakage/underfill regression tests.
3. Compose structural (no secrets): `docker compose -f docker/compose.full.yml config` renders; loopback bindings only; the sibling Memongo build context appears only in `compose.full.yml` where it is the documented prerequisite; `VOYAGE_API_KEY` uses required-value interpolation.
4. Keyed end-to-end (manual, real `al-...` key): verbatim README quickstart → `/ready` 200 → page create → hybrid search returns the created slug; `compose-smoke` + `bun run stress-test` on `compose.full.yml`; transcript archived to `docs/diligence/`.
5. Negative paths: missing `VOYAGE_API_KEY` fails compose interpolation (canonical path); invalid key leaves `/ready` 200 with `vector`/`autoEmbed` `unavailable` in the capability block and fails the keyed hybrid `compose-smoke` gate; incompatible Memongo contract prevents readiness; unauthorized role/department search returns no protected documents.

## Documentation basis (all accessed 2026-09-06)

- mongodb/mongodb-atlas-local image — https://hub.docker.com/r/mongodb/mongodb-atlas-local (preview tag: mongod+mongot, auto-embed, VOYAGE_API_KEY `al-...` Atlas-provisioned, EMBEDDING_PROVIDER_ENDPOINT override, runner healthcheck).
- $rankFusion — https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/ (8.0+; unchanged by this plan).
- Voyage Model API keys — https://www.mongodb.com/docs/voyageai/management/api-keys/ (key provisioning for the README paragraph).
- Automated embedding — https://www.mongodb.com/docs/atlas/atlas-vector-search/crud-embeddings/create-embeddings-automatic/ (autoEmbed dependency on the model key; Preview status disclosed to the buyer).
- OpenAI Chat Completions / Structured Outputs — https://platform.openai.com/docs/api-reference/chat/create + https://developers.openai.com/api/docs/guides/structured-outputs (LLM adapter shape; repo-proven pattern at scripts/real-agent-smoke.ts:224-244).
- Docker Compose interpolation `${VAR:?msg}` — https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ (required-value syntax).
- $rerank — official doc URL not located (404 on attempted paths); stage left untouched; open question only.
- Repo evidence: contract pin docs/contracts/memongo/2.1.0/capture.json + packages/memory-bridge/src/memongo-runtime.ts:11-12; tool counts apps/mcp/src/server.ts and packages/tools/src/index.ts; governance packages/wiki-engine/src/wiki-search.ts:445-474; Dreamer packages/wiki-engine/src/wiki-maintenance.ts:329-360; connectors packages/wiki-engine/src/wiki-connectors.ts.

## Open questions (non-blocking)

1. `$rerank` official doc URL — locate at implementation time; no decision depends on it.
2. Memongo OCI image publication timeline (parallel ops track; fallback = documented sibling checkout).
3. Buyer preference on Obsidian ingest priority post-sale.

## PR1 implementation record (2026-09-06)

Ref verification (W1.1): the pinned contract 2.1.0 (SHA-256 `bb1cb9fd…d835f`) is served by Memongo commit **`fa0f19db6267e86d41e909b42e3d2be1bb207a35`** — verified by capturing the served contract from a checkout of that exact commit and matching the canonical hash offline. Upstream drift warning: a later commit relabeled `2.1.0` with a drifted contract, so the ref (not the version label) is the pin anchor. The same full 40-char SHA is recorded in `packages/memory-bridge/src/memongo-runtime.ts` (`MEMONGO_CONTRACT_SOURCE_REF`), in the README quickstart checkout command, and in the CI bundle-smoke checkout. Abbreviated SHAs are unusable for the checkout: `actions/checkout` and a bare `git fetch` against the remote cannot resolve them (verified: `git fetch origin <10-char-prefix>` → `couldn't find remote ref`).

Deviations from this plan, adopted after live validation on `docker/compose.full.yml` (both reviewers concurred the shipped behavior is the safer one):

- **W1.2 / P4 `VOYAGE_API_KEY` stays optional (`${VOYAGE_API_KEY:-}`), not `:?` fail-fast.** Live evidence: a keyless bundle boots to an honest degraded mode (`/ready` 200, `wiki.search.vector = "unavailable"` with an actionable diagnostic, hybrid search serving via the text lane inside `$rankFusion`), while a placeholder/invalid key is strictly worse (registers the auto-embed index, fails the query-embedding call, and 503s the default hybrid search). CI also boots this file keyless by design. Validation-matrix items 3 ("`VOYAGE_API_KEY` uses required-value interpolation") and 5 ("missing `VOYAGE_API_KEY` fails compose interpolation") are therefore amended to: missing key boots degraded (documented mode); invalid key fails the keyed hybrid smoke gate. The README provisioning paragraph and the compose header carry the full rationale.
- **W1.3 keyless `docker run` binds `-p 127.0.0.1:27017:27017`** (loopback-only, matching the repo's security convention; the plan's matrix item 3 intent).
- **P4/W1.6 lease and deadline additions surfaced by keyless live validation:** `MEMONGO_TIMEOUT_MS=120000` in the bundle (the keyless first write pays a one-time ~62s memongo index-bootstrap wait) with the dispatch lease scaled to cover a cold compatibility check plus the write (`max(30s, 2 × deadline + 10s)`).
