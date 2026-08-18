# Mdbrain ⇄ Memongo: Absorb/Adapt Strategy for the Company Brain

> **⚠️ SUPERSEDED RECOMMENDATION (2026-08-13, post-v5):** §4's chosen Option B (package dependency / exact-pin) and the package-level coupling machinery in §5/§7 are **superseded by user decision** — Memongo and mdbrain are separate projects; mdbrain consumes Memongo as an independently deployed service over its published HTTP/client contract only, with zero Memongo source changes. The agreed successor is `docs/research/2026-08-13-service-boundary-amendment.md`. All research, evidence, security findings, and P0/P1/P2 roadmaps below remain valid historical record; only the integration-boundary recommendation changed.

**Date:** 2026-08-13 (v5 — final; four adversarial review rounds: v1–v3 BLOCK, v4 evidence-only BLOCK, v5 CLEAN)
**Authors:** Founding-engineer research lead + CTO (adversarial co-review)
**Status:** **Agreed synthesis — 3-axis final review CLEAN** (evidence, security/product, architecture). CTO independently reran the snapshot-bound drift generator twice; byte-identical against the checked manifest.
**Read scope:** both repos read-only during research. mdbrain HEAD `1b7e234` (2026-07-30); memongo HEAD `8833026c0c` (2026-08-13, unpushed, 1 ahead of origin/main — verified `git status -sb`).
**Durable evidence:** `docs/research/evidence/2026-08-13/` — lane reports (with superseded-line corrections marked in place), symbol-export diffs, snapshot-bound deterministic drift generator `generate-engine-file-drift.sh` v2.0.0 (explicit full commit IDs, `git ls-tree` tree/blob reads only — no working-tree, wall-clock, or absolute-root volatility) + its machine-checkable output `engine-file-drift-2026-08-13.txt`, captured npm/GitHub API responses.

**Evidence labels:** `[SUBSTRATE-FACT]` verified in code with file:line · `[BENCHMARK-EVIDENCE]` measured run artifact exists · `[EXTERNAL-SPEC]` authoritative external source or implementation source in an external repo (URL + access date) · `[COMPETITOR-CLAIM]` self-reported/marketing, directional only · `UNSUPPORTED` no backing artifact found.

---

## 1. Executive thesis

Mdbrain becomes the world-class company brain **by standing on Memongo, not by out-forking it** — but only after the boundary contracts that make that safe actually exist. This report therefore distinguishes the **strategic direction** (recommended) from the **migration plan** (conditional, gated on preconditions in §5 and §7 that current code does not yet satisfy).

Mdbrain is an early-July 2026 import of Memongo (~v1.x) plus a genuinely new wiki-engine; most post-baseline Memongo hardening (the 2.0.0 security/correctness wave and later) is absent on the mdbrain side (§2.1). The fork has materially diverged: of 167 engine source files sharing a relative path, 39 are byte-identical and 128 diverge, with a further 29 mdbrain-only and 113 memongo-only files (machine-checkable manifest keyed on relative path with git blob object IDs for both sides, generated from explicit full commit IDs by `generate-engine-file-drift.sh` v2.0.0: `docs/research/evidence/2026-08-13/engine-file-drift-2026-08-13.txt`; v2's basename-based 35/160 count is superseded — relative-path semantics plus subdirectory coverage changed the numbers. **Reproducibility scope:** byte-for-byte rerunnable locally with both commits present; the memongo commit `8833026c0ccb820384a73419ac2a90b3b466b2c4` is unpushed, so the artifact is **not externally reproducible** until that commit is pushed or archived — no stronger claim is made). Perpetual copy-porting of Memongo fixes into mdbrain is rejected as strategy: it is unbounded toil that compounds drift and has already failed to keep pace.

The strategy: **Memongo becomes the sole memory source of truth**, after publishing a coherent tested release (npm/GitHub state is currently incoherent — §2.4). Mdbrain then exact-pins `@memongo/memory-engine` behind a brand-preserving boundary; wiki-engine depends on an mdbrain-owned `WikiStorageProvider` contract, never on Memongo internals. A temporary `@mdbrain/memory-engine` compatibility layer survives one mdbrain major release maximum, with a removal date. Extraction into a third shared core is deferred unless measurable contract failures fire (§4).

Two rules govern everything below:

1. **Never dual-write, never dual schema initializers.** Old mdbrain engine and Memongo 2.x must never run against the same mutable database (§7).
2. **The security gate is independent and ordered first.** Adopting Memongo 2.x fixes *memory-substrate* invariants; it does not fix mdbrain's wiki/auth/product-layer P0s (§6.1), which are exploitable today and whose gates run **before** cutover (§7.5).

## 2. Evidence ledger

### 2.1 Provenance `[SUBSTRATE-FACT]`

- Memongo is the original: first commit `65d193dbdf` (2026-05-06). Mdbrain's first commit `3695cfe` (2026-07-08) imported blobs identical to Memongo commit `a162a3daa958e021b7186bf83179cdc475a758f6` (2026-06-25). Git histories share zero commit objects (import, not fork-clone).
- Mdbrain deliberately backported one subset at `4364a8e9b17f5e445e2382be0106ab945049b524` ("port tenant-isolation, search-scoring, and memory-quality fixes from memongo"). Therefore: **most** post-baseline hardening is absent — not "none."
- Version state 2026-08-13: `@mdbrain/memory-engine@1.1.0` vs local `@memongo/memory-engine@2.0.1`. Memongo CHANGELOG "2.0.0 - 2026-07-31": tenant-isolation floor, bitemporal recall fixes, durable job leases, idempotent writes, transactions (corroborated by the v2.0.0 GitHub release body, captured in `docs/research/evidence/2026-08-13/github-memongo-releases-tags-2026-08-13.txt`).

### 2.2 What the Memongo engine actually is (lane 1, all `[SUBSTRATE-FACT]`)

- Single MongoDB backend stores events, structured_mem, procedures, kb/kb_chunks, episodes, entities/relations/entity_links (memongo:packages/lib/src/types.memory.ts:1).
- Retrieval orchestrated by `searchV2()` (memongo:packages/memory-engine/src/mongodb-search-v2.ts:217): 8 retrieval paths (memongo:packages/memory-engine/src/mongodb-retrieval-planner.ts:14-22), 17 timed phases, deterministic budget `{maxAggregations: 12, maxEmbeds: 5}` with atomic reservation (memongo:packages/memory-engine/src/mongodb-search-budget.ts:55-58,218-290).
- Server-side fusion waterfall `$scoreFusion` → `$rankFusion` → client `js-merge` → vector-only → text-only → BSON `$text` last resort (memongo:packages/memory-engine/src/mongodb-kb-search.ts:204-207,272-278,442-514).
- Consolidation ("Dreamer"): pipeline phases 0–5 plus extended subphases (3.7, 4.6). Regex extraction (8 categories), vector ADD/NOOP at 0.85, prune at 0.92. **LLM deduction and induction are implemented** (issue #31): `deduceFactsFromMemories` / `induceFactsFromMemories` run tenant-grouped per scope, reason over observed facts only (inference-on-inference excluded), persist inferred facts flagged `origin: "llm-inference"` with low confidence, and degrade to a skip only when no LLM provider is configured (memongo:packages/memory-engine/src/mongodb-consolidator.ts:1032-1139; the "stubs" header comment at lines 8-12 is stale).
- Novelty: surprisal = 1 − avg k-NN similarity (memongo:packages/memory-engine/src/mongodb-novelty.ts:1-19). Reasoning chains: `$graphLookup` over `sourceEventIds`, depth ≤ 3 (memongo:packages/memory-engine/src/mongodb-reasoning-chain.ts:35-43).
- Apps go through the `@memongo/memory-bridge` facade — with the caveat that the bridge itself currently imports from `@memongo/memory-engine/internal` (§5.3, finding on stable-facade dependency).

### 2.3 Unpushed Memongo HEAD `8833026c0c` "harden parallel evidence retrieval" `[SUBSTRATE-FACT]`

48 files, +2544/−368. Adds: configurable read-path query embedding model (default flipped `voyage-4-large` → `voyage-4-lite`, memongo:packages/memory-engine/src/backend-config.ts:168-169,296-299); conversation-evidence mode (`parallel|serial|disabled`, memongo:packages/memory-engine/src/mongodb-conversation-evidence-mode.ts:1-20) with parallel overlap + budget reservation; cache-identity hardening (memongo:packages/memory-engine/src/mongodb-query-cache.ts:42-60); lifecycle filtering on the evidence lane; corrected text-fallback index gating; 17-phase latency accounting; benchmark harness checkpoint/retry/fail-closed hardening. **Mdbrain must not pin this until it is inside a published, tested release (§5.3).**

### 2.4 Benchmark evidence and release state (lane 2 + durable captures)

- Only quantitative public claims: six rows in memongo:docs/benchmarks/BENCHMARKS.md:36-43. **All six are unsupported by public repo/release evidence** (the doc itself states raw artifacts are intentionally omitted, lines 19,49-51). Two rows (ConvoMem, MemBench) have **no harness code anywhere in the tree**.
- Release-state snapshot (durable captures: `docs/research/evidence/2026-08-13/npm-memongo-memory-engine-2026-08-13.json`, `npm-memongo-memory-bridge-2026-08-13.json`, `github-memongo-releases-tags-2026-08-13.txt`; endpoints `https://registry.npmjs.org/@memongo%2Fmemory-engine`, `GET /repos/romiluz13/memongo/releases`, `GET /repos/romiluz13/memongo/tags`, all accessed 2026-08-13): npm `latest` = **2.0.0** for engine + bridge; local manifests = 2.0.1 (memongo:packages/memory-engine/package.json:3); GitHub releases v1.1.0 and v2.0.0 exist with **`"assets":[]`** (zero assets); tags v2.1.0/v2.1.1 exist with **no matching releases**; sibling deps use caret ranges (memongo:packages/memory-engine/package.json:48-51, packages/memory-bridge/package.json:41-44).
- Measured evidence: two **git-tracked** LongMemEval_S sample logs (n=1, n=5) show hitRate/RecallAny@5 = 1.0000 on their samples `[BENCHMARK-EVIDENCE]`. All finer-grained numbers — p95 observations of 850–3410 ms across fusion/cluster configs, the 850 ms js-merge sample as the only one meeting the `maxP95LatencyMs: 1000` release gate (memongo:scripts/benchmark/benchmark-quality-contracts.ts:14), and the incomplete full run (63/500) — derive from **untracked local logs: local untracked observations, not durable benchmark evidence** (lane2 §2a–2b; sanitized immutable run artifacts are not preserved). Durable conclusion: tracked n≤5 samples exist; **no completed 500-case run artifact was found in the audited repo, releases, or local result set** (bounded to audited locations — absence of evidence, not evidence of absence).
- Harness rigor `[SUBSTRATE-FACT]`: dataset SHA-256 pinned, evaluator pinned to upstream commit/blob, shipped-profile-only enforcement (memongo:scripts/run-benchmark.ts:169-186,229-234), LoCoMo fetch refused on licensing grounds (memongo:scripts/fetch-benchmark-dataset.ts:120-123). No mem0/Zep runner exists; `compare-memory-eval.ts` is Memongo-vs-Memongo.
- **Exact distinction for all downstream wording: the harness is rigorous; the public quantitative evidence is incomplete.** Claims are unsupported by public repo/release evidence — not proven false.

### 2.5 Delta map (lane 3, `[SUBSTRATE-FACT]`)

- **Mdbrain-only:** wiki-engine (11,725 LOC, 30 files; mdbrain:packages/wiki-engine/src/), 12 wiki HTTP routes + 7 wiki MCP tools (per `docs/research/evidence/2026-08-13/mdbrain-routes.txt` / `mdbrain-mcp-tools.txt`; live registrations mdbrain:apps/api/src/routes/v1.ts:2133-2667, mdbrain:apps/mcp/src/server.ts:1013-1207), Voyage batch-embedding modules, in-package benchmark harness, HMAC-signed export bundles with BSON canonicalization (mdbrain:packages/memory-bridge/src/mdbrain-export.ts:116-153 — **mdbrain is ahead of Memongo here**), web console wiki tab.
- **Memongo-only:** contradiction detection, LLM relation extraction, temporal extraction + bitemporal promotion e2e, idempotency fingerprint + partial unique index, TTL on events/structured_mem, capability + client registries, search-v2 lanes, manager split (**9 production split modules** — admin/host/jobs/lifecycle/read/relevance/search/sync/write; 10 files counting the root `mongodb-manager.ts` — vs mdbrain's ~8k-LOC monolith), `scope-identity.ts` canonical tenant identity (memongo:apps/api/src/scope-identity.ts:28), batch write-events route/tool, MCP HTTP transport, contract-conformance tests, ~20k more engine test LOC (137 files / ~74k vs 89 / ~54k — counts, `docs/research/evidence/2026-08-13/lane3-mdbrain-delta.md` §5).
- **Topology divergence (blocking for migration):** mdbrain defaults to database `mdbrain` with **per-agent** collection prefix ``mdbrain_<agent>_`` (mdbrain:packages/memory-engine/src/backend-config.ts:221-227); Memongo defaults to database `memongo` with one **shared** prefix `memongo_` (memongo:packages/memory-engine/src/backend-config.ts:175,278-293), with a Memongo-side migration utility for existing deployments (memongo:scripts/migrate-to-shared-prefix.ts:4-30,74-103). Identical collection suffixes do **not** imply the pinned build reads the existing mdbrain dataset — under defaults it opens a different database with different collection names. See §7.1.
- **Schema compatibility (necessary, not sufficient):** shared/core memory collection suffixes align; mdbrain additionally owns `embedding_cache`, `wiki_pages`, `wiki_revisions` (mdbrain-only, per lane3 §8); `$jsonSchema` validators are loose supersets both ways; embedding provider/dims identical (`voyage-4-large` default both sides). Hazards: Memongo renamed unique indexes (`uq_kb_hash` → `uq_kb_scope_hash`, memongo:packages/memory-engine/src/mongodb-schema-standard-indexes-core.ts:96-109) with migration code only in Memongo; Memongo's event TTL would silently expire data under an old mdbrain engine.
- **Migration-ledger drift:** mdbrain records `backfill-events-from-chunks` in a migrations collection and refuses rerun (mdbrain:packages/memory-engine/src/mongodb-migration.ts:13-46,68-75,167-170); Memongo derives event IDs including `agentId` and its own comment warns rerunning an old migration "produces NEW eventIds" (memongo:packages/memory-engine/src/mongodb-migration.ts:15-33,113-119). See §7.3.

### 2.6 OKF verification (lane 4, `[EXTERNAL-SPEC]`, all accessed 2026-08-13)

- Canonical repo: <https://github.com/GoogleCloudPlatform/knowledge-catalog>, spec `okf/SPEC.md` **v0.2**. Org GoogleCloudPlatform (verified, id 2810941); Apache-2.0; Google CLA; authors Amir Hormati + Sam McVeety (Google Cloud Data Cloud). Repo created 2026-05-04; v0.2 migration commit `780fe9d3` (2026-07-24); **spec last changed commit `3fcbb9f8`, 2026-07-24**; no tags, no releases; active, pre-1.0.
- "Google OKF" attribution is **essentially correct with two caveats**: (1) the repo's own README disclaims "not an official Google product" — any "Google's official format" wording is UNSUPPORTED; (2) mdbrain's README links (README.md:223,284) point to groundingpage.com, a third-party directory documenting **outdated v0.1**; mdbrain's code header (mdbrain:packages/wiki-engine/src/okf.ts:3) already cites the correct target.

### 2.7 Competitive landscape (lane 5; bounded to surveyed systems)

- Agentic-wiki implementation evidence: **OpenWiki** (LangChain; MIT; ships an eval/replay harness — `evals/ledger/` incl. `forgetting.ts`, `evidence-map.ts`, `replay/git-replay.ts`; harness source is `[EXTERNAL-SPEC]`/implementation evidence — no measured run artifact was cited, so it is not `[BENCHMARK-EVIDENCE]`; OKF v0.1 output; <https://github.com/langchain-ai/openwiki>, accessed 2026-08-13), **GBrain** (garrytan/gbrain; per-login company-brain scoping and gap-analysis abstention UX are self-reported `[COMPETITOR-CLAIM]`; BrainBench scorecards exist in a sibling repo but are self-run on a 240-page synthetic corpus — directional only; <https://github.com/garrytan/gbrain> + <https://github.com/garrytan/gbrain-evals>, accessed 2026-08-13), **DeepWiki** (Cognition; binary public/Devin-private ACL only; <https://deepwiki.com>, <https://docs.devin.ai/work-with-devin/deepwiki>, accessed 2026-08-13), **AutoWiki** (Factory; CI-on-push freshness trigger, closed-source; <https://docs.factory.ai/software-factory/wiki/overview>, accessed 2026-08-13).
- Agent-memory systems: **Zep** (bi-temporal invalidation is the strongest formal freshness model among surveyed systems; vendor-run benchmarks, <https://arxiv.org/abs/2501.13956> v1 2025-01-20, accessed 2026-08-13), **Letta** (self-editing memory blocks; weak contradiction structure; <https://docs.letta.com/guides/agents/memory>, accessed 2026-08-13), **Mem0** ("wiki is not memory — use both" category thesis [COMPETITOR-CLAIM]; <https://mem0.ai/blog>, accessed 2026-08-13).
- Product comparables (NOT implementation evidence): **Glean** = industry reference for ACL propagation (<https://www.glean.com>, accessed 2026-08-13); **Guru** = human-verification freshness loops (<https://www.getguru.com>, accessed 2026-08-13); **Notion AI** = same-store baseline (<https://www.notion.com/product/ai>, accessed 2026-08-13); **Slite** (<https://slite.com>, accessed 2026-08-13); **Outline excluded** (no agentic-wiki implementation evidence found).
- Cross-system finding (bounded): among the surveyed systems, **none was found to publish** a quantitative cross-tenant leak-rate benchmark, a contradiction-detection benchmark, or an abstention evaluator. This is "none found among surveyed systems" — not a universal industry negative.

## 3. Corrected claims

### 3.1 Provenance wording

Wrong: "mdbrain has not absorbed any of Memongo 2.0." Right: mdbrain imported the 2026-06-25 baseline (`a162a3daa958`) and deliberately backported one subset at `4364a8e9`; **most** post-baseline hardening is absent (§2.1).

### 3.2 Benchmark wording

Wrong: "honest but hollow." Right: **"harness rigorous, public quantitative evidence incomplete"** — unsupported by public repo/release evidence, not proven false (§2.4).

### 3.3 OKF attribution

README links imply a groundingpage.com authority and document outdated v0.1; any "official Google standard" reading is UNSUPPORTED. Canonical reference is `okf/SPEC.md` at commit `3fcbb9f8` (2026-07-24); README links must be re-pointed (§2.6).

### 3.4 "Only system" claim

The untracked analysis doc (mdbrain:docs/2026-07-23-mem0-agent-wiki-article-analysis.md) concludes mdbrain is "the only system that ships both layers + governance" and that "no funded competitor uses MongoDB." Its reading of the primary source (Karpathy gist, <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>, accessed 2026-08-13) was independently re-verified as accurate. The competitive conclusions, however, are **no longer substantiated by the current survey and must be revalidated or removed** before external reuse: GBrain publicly claims per-login company-brain scoping (self-reported, unverified) and OpenWiki ships a wiki eval harness — neither proves the full wiki-plus-memory layering the doc asserts, but both erode a categorical "only," and "no funded competitor uses MongoDB" is UNSUPPORTED (absence-of-evidence).

## 4. Architecture options

### Option A — Perpetual copy-porting (status quo direction)

**Tradeoffs:** full control, no release coupling — but unbounded toil, compounding drift (128/167 same-relative-path files diverged; 113 memongo-only files mdbrain has never seen — per the generated manifest), and every future Memongo invariant must be re-derived. **Rejected.**

### Option B — Memongo as sole memory source of truth (CHOSEN — as a conditional target)

**Tradeoffs:** avoids reimplementing future substrate invariants; in exchange mdbrain accepts release-cadence, migration, and upstream-governance risk. The controls that bound that risk (exact pins, adapter conformance tests failing mdbrain CI, automated upgrade PRs, compatibility matrix, migration contracts) are **future work, not existing code** — one falsification condition ("Memongo cannot expose stable config/migration contracts") is arguably already live against current sources (§5.3, §7.2). Option B is therefore approved as **strategic direction**, and the migration plan becomes executable only when §5/§7 preconditions are met.
**Steelman considered:** direct dependency is product coupling; extraction would be cleaner. It survives conditionally because the adapter seam bounds the coupling and extraction has exactly one consumer pair today.

### Option C — Extract a third shared core

**Tradeoffs:** cleanest ownership in theory; a third versioning surface and new release machinery in practice, with no second independent consumer. **Deferred.**

### Falsification triggers (revisit Option B → Option C)

Numeric proxies from v1 (>10 symbols / 3 upgrades / 2 SLA misses) are retained only as heuristics. The operative triggers are **measurable contract failures**, each with an owner and review clock:

1. Memongo ships no stable config-injection contract (§5.4) within one mdbrain release cycle — owner: Memongo maintainer; evidence: published API + mdbrain conformance tests.
2. Memongo ships no inspect→plan→approve→apply→verify migration contract (§7.2) before the planned cutover date — owner: Memongo maintainer; evidence: migration API + rehearsal log.
3. A critical patch two-hop (Memongo fix → mdbrain pin bump) exceeds its SLA twice. SLA definition required: severity classes, clock start (upstream release published) / end (mdbrain pinned release published), owner, escalation. Until defined, this trigger is not evaluatable — defining it is an open decision (§12).
4. The mdbrain adapter depends on any private/unstable Memongo symbol that Memongo refuses to promote to a supported contract (count is not the metric; criticality is — one private storage handle can be decisive).

## 5. Chosen boundary and ownership map

### 5.1 Compatibility layer rules (replaces any barrel re-export)

The temporary `@mdbrain/memory-engine` must be an **explicit inventory** of wrappers and type aliases over **public** Memongo APIs only — including indirect dependencies (§5.3). **`export * from @memongo/memory-engine/internal` is forbidden.** Helpers with no public equivalent get deprecation errors with migration guidance, not silent shims. Lifetime: **one mdbrain major release maximum, with a removal date** (§12).

### 5.2 Wiki storage seam — `WikiStorageProvider` contract

Today `getWikiDbHandle()` duck-types **private** memory-manager fields (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:217-241; the Memongo manager keeps `Db`/prefix/`MongoClient` private, memongo:packages/memory-engine/src/mongodb-manager.ts:474-478). Declaring an interface is insufficient; the contract must specify:

- `Db` handle + collection prefix;
- transactional client/session access (wiki multi-write paths need it, §6.1.8);
- readiness state (schema/index ensured by the wiki side);
- lifecycle/shutdown ownership (who creates and closes the client);
- immutable config identity (URI, database, prefix — comparable for equality, §7.1 fail-closed check).

Two acceptable sources: (a) a **generic public storage-handle API** on the Memongo manager (not wiki-specific), or (b) an **mdbrain-owned client** with conformance tests proving it resolves the identical URI/database/prefix. Duck-typing private fields is not acceptable in the target state.

### 5.3 Release preconditions (before mdbrain pins anything)

**Memongo cohort:** publish lib + engine + bridge **from one pushed commit** with **exact sibling versions** (current caret ranges: memongo:packages/memory-engine/package.json:48-51, packages/memory-bridge/package.json:41-44); verified packed tarballs (gitHead, integrity), supported MongoDB versions, migration notes, npm provenance if available; reconcile the npm 2.0.0 / local 2.0.1 / tags v2.1.x drift (§2.4). **Bridge internal dependency:** the bridge currently imports types + `materializeBlocks` from `@memongo/memory-engine/internal` (memongo:packages/memory-bridge/src/memongo-bridge.ts:22-52), a surface the engine itself marks temporary, slated for removal next major (memongo:packages/memory-engine/src/index.ts:1-10). The coherent release must **promote those to a supported contract with compatibility tests, or remove the dependency** — mdbrain's "public APIs only" rule includes indirect dependencies.

**Mdbrain DAG:** compat engine → wiki-engine → bridge → aggregate (`mdbrain-memory`), published dependencies-before-dependents; current `workspace:*` links (mdbrain:packages/memory-bridge/package.json:36-40, packages/wiki-engine/package.json:25-29, packages/mdbrain-memory/package.json:35-38) must resolve to exact published versions. Publishing from one commit is not atomic across npm packages — a partial cohort can be visible; ordering and verification are required. **Clean-consumer gate:** external install from registry/tarballs with no workspace links; exactly one Memongo lib/engine/bridge cohort in the resolved lockfile; API type-compatibility, exports, provenance, integrity, and deprecation metadata verified before tagging.

**Mdbrain never pins a git URL or an unpushed HEAD** (including `8833026c0c`).

### 5.4 Config boundary (brand-preserving)

Nesting `@memongo/memory-bridge` inside `@mdbrain/memory-bridge` cannot preserve mdbrain configuration semantics today: the Memongo bridge has no config injection (`memongoBridgeGetManager` always calls its own `resolveBridgeConfig`, memongo:packages/memory-bridge/src/memongo-bridge.ts:77-89), reads `MEMONGO_AGENT_ID` / `~/.memongo/memongo.json` / `MEMONGO_CONFIG_PATH` (memongo:packages/memory-bridge/src/memory-config.ts:10-29) where mdbrain uses `MDBRAIN_*` / `~/.mdbrain/mdbrain.json` (mdbrain:packages/memory-bridge/src/memory-config.ts:6-25), and resolves URI env-first where mdbrain resolves file-first (memongo:packages/memory-bridge/src/memory-config.ts:56-64 vs mdbrain:packages/memory-bridge/src/memory-config.ts:50-55). **Current public engine/bridge paths are not acceptable as-is.** Even the direct-engine option routes through environment-aware resolution: the public manager factory calls Memongo's resolver (memongo:packages/memory-engine/src/search-manager.ts:286-299); `MEMONGO_FORCE_MONGODB_URI`/`MEMONGO_MONGODB_URI` participate in URI resolution even when a complete config object is supplied (memongo:packages/memory-engine/src/backend-config.ts:192-204); ambient `MEMONGO_*` variables override the injected database, collection prefix, query model, conversation mode, fusion method, and recall profile (memongo:packages/memory-engine/src/backend-config.ts:274-309); manager creation then bootstraps schema against that resolved target (memongo:packages/memory-engine/src/mongodb-manager.ts:566-638,659-764).

Required: a **new transitively environment-free factory** accepting an already-resolved immutable config (or an explicitly injected environment source), which validates the approved §7.1 manifest identity **before any connection or bootstrap**. Concretely, one of:

- upstream `createMemongoBridge({ config, agentIdResolver })` provider API with **no direct environment reads after construction**; or
- `@mdbrain/memory-bridge` translates `MdbrainConfig` into fully-resolved engine config and passes it to that environment-free factory, dropping the nested-bridge dependency.

**Environment-variable aliasing is forbidden.** mdbrain conformance tests must prove ambient `MEMONGO_*` variables are **inert** on the mdbrain path, and table-driven tests must cover every branded variable, file location, precedence rule, default database, prefix, agent, scope, embedding model, and TTL option.

### 5.5 Ownership map

| Surface | Owner | Notes |
| --- | --- | --- |
| Memory engine, search, jobs, idempotency, transactions, tenant guard | Memongo | Consumed via exact pin |
| Memongo benchmark harness + raw benchmark artifacts | Memongo | incl. proof-pack extension to emit immutable artifacts (§6.5) |
| Mdbrain bridge facade | mdbrain | Keeps mdbrain-only additions (signed-export canonicalizer — port UP to Memongo or keep mdbrain-only) |
| Wiki schema, governance, OKF, connectors, maintenance | mdbrain wiki-engine | Via `WikiStorageProvider` (§5.2) |
| Company-brain eval suite + mdbrain proof reports | mdbrain | §8; eval methodology may later upstream |

## 6. Roadmap

### 6.1 P0 — mdbrain security/correctness (exploitable today; gates run pre-cutover)

1. **Server-side principal with real identity, not caller-supplied trust.** `buildWikiGovContext` casts request `trustTier` into the governance context (mdbrain:apps/api/src/routes/v1.ts:2121-2131); `admin` yields match-all `{}` (mdbrain:packages/wiki-engine/src/wiki-governance.ts:67-86). Fixing the request field alone is insufficient: the API principal currently carries only `token`, `agentIds`, `scopes`, `scopeRefs` (mdbrain:apps/api/src/app.ts:23-28) — no server-owned trust tier, roles, or departments; and `GovernanceContext` has no authenticated subject id or external-group claims (mdbrain:packages/wiki-engine/src/wiki-governance.ts:24-41). Required principal contract: allowed scopes/scopeRefs + trust tier + roles + departments + **`subjectId` + namespaced external group memberships** (e.g. `github:team:platform`, `slack:channel:eng-private`) + explicit **read/write/admin capabilities**. Every REST/MCP governance context derives from it; request fields may only **narrow** authority. Also covers the other REST wiki read routes that independently construct governance contexts — list, and the **revision list + revision detail endpoints** (mdbrain:apps/api/src/routes/v1.ts:2199-2235,2280-2379; both revision handlers accept caller-controlled `trustTier` today and use it to authorize history access — they are live attack surface, not an implementation detail).
2. **Ungoverned lint/contradiction read (NEW in v3).** `GET /v1/wiki/lint` calls `listWikiPages` and `listUnresolvedContradictions` with scope only — no governance context (mdbrain:apps/api/src/routes/v1.ts:2243-2269); governance is optional in `listWikiPages` so its omission returns all pages in scope incl. confidential/restricted (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:463-499); contradiction listing filters scope+resolution only (mdbrain:packages/wiki-engine/src/wiki-contradictions.ts:264-286); the route is also exposed as `mdbrain_wiki_lint` over MCP (mdbrain:apps/mcp/src/server.ts:1207-1215,2244-2250). A same-scope caller who cannot read a protected page via governed list/get retrieves it via lint. Required: governance is **mandatory, not optional, on every externally reachable wiki read primitive**; lint fixtures (REST + MCP) join the §8 matrix.
3. **Graph-expanded pages skip governance.** Governance post-filter runs before expansion (mdbrain:packages/wiki-engine/src/wiki-search.ts:418-424); expanded pages merge unfiltered (wiki-search.ts:455-468); `buildPrefilter` (wiki-search.ts:124-138) never calls `buildPermissionsFilter`.
4. **OKF path escape — slug AND symlink.** Unsanitized DB slug joined into the export path (mdbrain:packages/wiki-engine/src/okf.ts:1010); additionally `validateOkfPath` performs lexical `path.resolve`/`path.relative` containment only (okf.ts:67-108) — a symlinked bundle root escapes import (`readdir` at okf.ts:388-403) and export (okf.ts:1003-1013). Required: realpath containment for existing roots, rejection of symlink components, containment re-checked after joining each slug-derived target.
5. **Connector source-ACL fidelity (elevated to P0).** `mapPermissions()` exists in the connector contract (mdbrain:packages/wiki-engine/src/wiki-connectors.ts:78-79) and GitHub classifies visibility (wiki-connectors.ts:364-370), but GitHub ingestion does not apply it (wiki-connectors.ts:308-360), git-diff maintenance creates pages with no `permissions` (mdbrain:packages/wiki-engine/src/wiki-maintenance.ts:198-225), normalization stores `{}` (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:323-326), and governance treats absent privacyTier as visible (mdbrain:packages/wiki-engine/src/wiki-governance.ts:73-82) — a private source becomes an effectively open page. The model is also underpowered: connector mapping returns only a `privacyTier` (wiki-connectors.ts:61-63), stored permissions support only roles/departments/privacyTier (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:84-88), and `internal` is visible to every non-admin caller in scope — `private GitHub repo → internal` is not fidelity; repo collaborators, GitHub teams, and Slack private-channel members are unrepresentable. Required: page permissions gain **allowed subjects/groups**; connector **identity linking** maps external principals to mdbrain `subjectId`s; membership refresh/revocation behavior defined; **unknown/unmapped identity fails closed**. Gates: ACL mapping on create **and** update, permission revocation, source deletion, membership changes, unknown-ACL fail-closed, zero disclosure during replay/maintenance. The normalized source ACL — never caller-provided trust metadata — drives page permissions.
6. **Mutation authorization (NEW in v3).** Wiki patch passes caller fields directly to `updateWikiPage` with no governed target lookup or authorization check; delete — including `hard=true` — does the same (mdbrain:apps/api/src/routes/v1.ts:2438-2524); the update primitive permits changing both `trustTier` and `permissions` (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:537-538); scoped API-key policies constrain only agent/scope/scopeRef, no read/write/admin capabilities (mdbrain:apps/api/src/app.ts:23-28,181-200). Any scoped key can edit protected pages, replace their permissions/trust metadata, or permanently delete them. Required: principal capabilities from item 1 enforced on mutations; **governed target lookup before write**; **field-level authorization** for permission/trust changes; **separate hard-delete authority**; generated create/update/delete/import/maintenance tests in the §8 matrix.
7. **Existing claim provenance destroyed on append** (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:625-659; contrast the safe conditional construction in `normalizeInput`, wiki-bridge.ts:281-297).
8. **Wiki transaction orchestration (corrected diagnosis).** mdbrain's 1.1.0 engine **already has** `withTransaction` with majority write concern (mdbrain:packages/memory-engine/src/mongodb-sync.ts:254-311 area, mongodb-kb.ts:203-316); OKF import already starts a transaction (mdbrain:packages/wiki-engine/src/okf.ts:530-558). The defect is **session propagation in wiki-engine**: backlink/contradiction/revision writes don't receive the session (mdbrain:packages/wiki-engine/src/wiki-bridge.ts:374-411,614-681), their APIs lack session parameters, and revision recording deliberately swallows failures (mdbrain:packages/wiki-engine/src/wiki-revisions.ts:31-65). Decide whether revisions are an atomic invariant or explicitly best-effort (§12); add fault-injection tests at every write boundary. Pinning Memongo does not fix this — it is mdbrain-owned.
9. **Undefined-valued nested fields violate the known MongoDB `$jsonSchema` invariant** (repo scar in mdbrain/AGENTS.md; conditional-spread only).

### 6.2 P0 — Memongo invariants to consume (via the pinned release, not manual forks)

Canonical tenant identity/global-route guard · tenant-complete tool cache + prompt quarantine · idempotency fingerprint/index/replay receipts · durable job lease/retry/fencing · deterministic search budget + parallel lanes + normalization · capability registry/probe-adopt/readiness · real-Mongo CI · production image/Compose/readiness.

### 6.3 P0 — OKF conformance blockers (release gates if OKF stays advertised)

CTO independent audit pinned to spec commit `3fcbb9f8` (v0.2, 2026-07-24; §11 consumer rules); blockers spot-verified in this pass:

- **BLOCKER:** export writes `type: index` frontmatter into reserved `index.md` (mdbrain:packages/wiki-engine/src/okf.ts:1222-1230) — v0.2 allows index.md frontmatter only for bundle-root `okf_version`.
- **BLOCKER:** import rejects unknown `$`/`.` extension keys (okf.ts:682-708) despite consumer MUST-NOT-reject (spec §4.1, §11).
- **HIGH:** relative-link base loss (okf.ts:856-917); footnote/source attribution loss (okf.ts:864-889); destructive interpretation of arbitrary headings (okf.ts:778-837).
- **HIGH — trust semantics (corrected):** OKF `unverified | machine-confirmed | human-reviewed` (spec §5.3) is **derived advisory content credibility, not access control**. mdbrain `TrustTier = restricted | standard | admin` drives authorization (mdbrain:packages/wiki-engine/src/wiki-governance.ts:24-41,67-86). There is no safe mapping ("human-reviewed" ≠ "admin"). Required: a separate advisory field, e.g. `okfTrustAssessment`, which may affect ranking/display/review workflows but **must never populate** `GovernanceContext.trustTier`, roles, departments, scope, or permissions; `stale_after` stays freshness metadata. The existing warning at okf.ts:23-27 is correct and must be preserved.
- Remedy: pinned-v0.2 conformance test suite citing commit `3fcbb9f8`; re-point README OKF links (§3.3).

### 6.4 P1 — product truth

- Maintenance HTTP route is a no-op acknowledgment (mdbrain:apps/api/src/routes/v1.ts:2666-2698) — wire real execution or relabel.
- Connectors: only Obsidian performs discovery; GitHub/Confluence/Notion/Slack/CRM return empty source lists (mdbrain:packages/wiki-engine/src/wiki-connectors.ts:308-317,409-414,511-515,605-612,682-687) — ship Obsidian + GitHub for real first, **with §6.1.5 ACL gates**.
- **Connector credential exposure:** connector auth results return raw tokens/API keys in `context` (mdbrain:packages/wiki-engine/src/wiki-connectors.ts:33-37,295-305,498-508,595-602,669-679). Required: auth results return non-secret identity/capability metadata only; credentials stay private to the connector or a secret provider; add redaction tests.
- Web console is get/list, not search/editor.
- App reranker assigns scores by index **without reordering** (mdbrain:packages/wiki-engine/src/wiki-search.ts:440-446) — fix.
- `minScore` not applied to results; search errors swallowed into empty results (mdbrain:packages/wiki-engine/src/wiki-search.ts:312-333,407-410) — surface errors.
- GraphRAG/rerank library-only; no live Atlas/wiki E2E.
- Memongo-side P1 inherited with the release: shared-client lifecycle/single-flight/shutdown; executable API/MCP contracts; batch writes + MCP extract + client retries; temporal/reasoning/typed edges only through wiki governance; benchmark machinery.

### 6.5 P1 — benchmark evidence discipline

- **Extend proof-pack** (memongo:scripts/proof-pack.ts) to **emit immutable benchmark artifacts** — it does not publish them today; this is new work, not existing capability. Owner: Memongo (harness + artifacts), per §5.5.
- Every public benchmark row: artifact attached or marked internal-only. Complete the full 500-question LongMemEval publication run before any headline number ships (§2.4).

### 6.6 P2

Batch-embedding modules port/retire decision · contradiction-detection and abstention evaluators (none found among surveyed systems — §8) · GBrain-style gap-analysis abstention UX in wiki answers · extraction re-evaluation via §4 triggers.

## 7. Migration / cutover / rollback

**Hard rules:** never dual-write; never dual schema initializers; live shadow-read prohibited until a public no-bootstrap read path exists (§7.4).

### 7.1 Topology decision gate (blocking)

Defaults diverge: mdbrain `mdbrain` DB + per-agent `mdbrain_<agent>_` prefixes vs Memongo `memongo` DB + shared `memongo_` prefix (§2.5). Required before cutover:

1. Decide and approve the target topology: preserve per-agent prefixes via injected per-agent config, or migrate every tenant into the verified shared target.
2. Inventory every source database/prefix/tenant ID.
3. Verify per-collection counts, tenant ownership, unique-key conflicts, search-index targets, and sampled content hashes on a restored copy.
4. Startup **fails closed** if the resolved database/prefix differs from the approved manifest.
5. Database + prefix resolution are part of the compatibility matrix — not just schemas.

### 7.2 Migration API precondition (blocking)

Memongo manager startup currently ensures collections/search/standard indexes and **unconditionally drops legacy indexes** on first acquisition (memongo:packages/memory-engine/src/mongodb-manager.ts:566-638,659-764; memongo:packages/memory-engine/src/mongodb-schema-standard-indexes-core.ts:94-172), catching drop failures indiscriminately (lines 98-102,137-141,161-170) — a permission error can masquerade as absence. There is no public dry-run/no-bootstrap path. Before pinning, Memongo must expose a stable contract separating: **inspect** (read-only) → **plan** (immutable before/after index definitions) → **approve** (explicit authorization) → **apply** (create replacements before drops where feasible; distinguish `IndexNotFound` from authorization/network failures) → **verify** (post-application), with a durable migration version recorded and ordinary startup **refusing** unapplied or unexpected schema drift. Normal application startup must not be the approval mechanism.

### 7.3 Data-migration ledger reconciliation (blocking)

Reconcile all applied mdbrain migration IDs (mdbrain:packages/memory-engine/src/mongodb-migration.ts:13-46) against Memongo's; define a canonical ID mapping for the event-ID derivation change (memongo:packages/memory-engine/src/mongodb-migration.ts:15-33,113-119); count logical duplicates before and after rehearsal; prohibit the Memongo backfill on already-migrated data unless a dedupe/rekey procedure is proven idempotent.

### 7.4 Shadow evaluation

Live production shadow-read is **prohibited** until a public no-bootstrap read client exists (manager bootstrap mutates schema, §7.2). Default route: **restored production copy or isolated canary database**, time-boxed. Restored-copy parity must pin **all** retrieval settings (including the HEAD default flip to `voyage-4-lite`, §2.3) and define thresholds: query corpus, tenant coverage, expected-result/ranking deltas, latency bands, error/timeout limits, and mandatory investigation of every unexplained mismatch. Enforce no-dual-write mechanically: production lockfile contains no legacy engine implementation; only one deployment principal holds write/schema privileges.

### 7.5 Cutover procedure (security gates first)

1. **Pre-cutover gates green:** §6.1 security fixes + tests (permission-leakage fuzz, trusted-identity, lint/contradiction governance, mutation authorization, graph-expansion, OKF export incl. symlink, connector ACL, adapter conformance, config-resolution table tests proving ambient `MEMONGO_*` inert), §7.1 topology manifest approved, §7.2 migration contract available, §7.3 ledger reconciled, rollback artifact drilled (§7.6), **§7.4 restored-copy parity artifact green against approved thresholds with every mismatch explained**, and **all applicable §8 generated read-path/security gates green** under the separately approved versioned eval spec (§8).
2. Backup + production-sized rehearsal on a restored copy.
3. Migration via the §7.2 contract (inspect→plan→approve→apply→verify) — never via first boot.
4. One-way write cutover to the Memongo-pinned build — **prohibited while any unexplained parity mismatch, failed threshold, or open §8 gate remains**.
5. **Post-cutover rerun** of the same security/eval gates (§8) on the migrated DB.

### 7.6 Rollback (executable, not a label)

"Schema-forward adapter rollback" is **not currently implemented** — it must be built and tested before cutover: state exactly which application binary runs on the forward schema without initializing legacy indexes (the old engine still creates `uq_kb_hash`, mdbrain:packages/memory-engine/src/mongodb-schema.ts:1607-1620). The rollback artifact must define: write freeze/drain, post-snapshot write replay or explicit accepted-data-loss policy, RPO/RTO, TTL consequences, decision owner and deadline, and post-restore reconciliation. **Acceptance gate: a timed rollback drill including writes made after the snapshot.** Snapshot restore alone discards post-snapshot writes. Never "switch the package back" (§2.5 index/TTL hazards).

## 8. Company-brain eval gate specification requirements

LongMemEval/LoCoMo measure user-memory recall, not company-brain behavior. **This report defines requirements for the gates, not the gates themselves.** No baseline exists to set honest numeric thresholds from, so none are invented here: calibration and publication of a **separately approved, versioned eval spec** — versioned fixtures, metric formulas, numeric thresholds, confidence method, artifact schema, and the command/CI job that produces each result — is a **blocking pre-cutover deliverable**. Cutover is impossible until that spec exists and its gates run green. Structural requirements that ARE specified here: the read-path matrix is **generated from the registered REST routes and MCP tools** (not hand-maintained — a hand list can omit a leaking route and stay green), and must include REST list/get, **revision list + revision detail**, **lint (REST + MCP)**, create/update/delete/import/maintenance mutation paths, connector ACL mutation/revocation, transaction fault injection, and search-index outage/error semantics.

**Route registration alone is insufficient: the matrix must also expand security-relevant semantic modes** — branches not visible as separate routes. Required minimum: `transclude=true` on `GET /v1/wiki/*` (mdbrain:apps/api/src/routes/v1.ts:2384-2426 — readable parent → denied child, nested/cyclic transclusions, subject/group denial), OKF `returnContent`, hard delete, MCP apply create-vs-update behavior, and graphExpansion/rerank where exposed. The deliverable is a generated route/tool inventory **plus** a security-relevant semantic-mode registry with fixtures per mode.

| Dimension | Gate specification requirement (values deferred to the versioned eval spec) | Reference evidence |
| --- | --- | --- |
| Permission leakage | Zero leaks across every axis — scope, trust tier, role, department, **subjectId**, **namespaced external group** — across the generated route+tool matrix **with semantic-mode expansion** (transclusion, OKF `returnContent`, hard delete, MCP apply create-vs-update), graph expansion, OKF export. Fixtures per applicable REST/MCP path: private/restricted pages per cell; allowed/denied subject; allowed/denied external group; **same-name/different-provider namespace collision**; unlinked subject and unknown group **fail-closed**; membership addition/removal/**stale-cache revocation**; connector ACL mutation + revocation cases | Glean product behavior [COMPETITOR-CLAIM]; GBrain fuzz claim, methodology unpublished [COMPETITOR-CLAIM]; mdbrain §6.1.1–§6.1.6 are the live failures |
| Provenance | Citation-accuracy dataset with per-claim expected sources; footnote→`sources[].id` keyed joins survive OKF round-trip; threshold + confidence bound | OpenWiki `evals/ledger/evaluator/evidence-map.ts` [EXTERNAL-SPEC — harness source]; ALCE [EXTERNAL-SPEC]; OKF §5.1 (commit `3fcbb9f8`) |
| Freshness | Staleness fixtures vs `stale_after`; change-stream/connector lag budgets with measured p95 | Zep bi-temporal invalidation (<https://arxiv.org/abs/2501.13956>) [EXTERNAL-SPEC]; OpenWiki `forgetting.ts` [EXTERNAL-SPEC — harness source] |
| Contradiction resolution | Seeded-contradiction dataset; detection recall/precision thresholds; no silent overwrite | mdbrain pre-dedup detection [SUBSTRATE-FACT wiki-engine]; none found among surveyed systems |
| Abstention | Unanswerable-probe set; false-answer rate prioritized over coverage; calibrated abstention threshold | GBrain gap analysis [COMPETITOR-CLAIM]; no evaluator found among surveyed systems |
| Connector replay | Recorded connector-history fixtures; replay must produce diff-equivalent pages **and zero permission disclosure** (replay equivalence alone cannot detect ACL loss, §6.1.5) | OpenWiki `evals/ledger/replay/git-replay.ts` [EXTERNAL-SPEC — the only replay harness found among surveyed systems] |

## 9. OKF conformance matrix (spec v0.2, commit `3fcbb9f8`, 2026-07-24)

| Spec requirement (§) | mdbrain status | Verdict |
| --- | --- | --- |
| Bundle = Markdown + YAML frontmatter (§3) | Implemented (okf.ts import/export, round-trip tests okf.test.ts:1-5) | CONFORMANT |
| Reserved `index.md`/`log.md` not concept docs (§3.1); index frontmatter only for `okf_version` (§12) | Export writes `type: index` frontmatter (okf.ts:1222-1230) | **BLOCKER** |
| `type` required, unregistered, unknown types tolerated (§4.1, §11) | Required in `OkfFrontmatter` (okf.ts:137-151) | CONFORMANT (producer); consumer tolerance untested |
| Extensions preserved, MUST NOT reject (§4.1, §11) | Rejects unknown `$`/`.` keys (okf.ts:682-708) | **BLOCKER** |
| Relations = Markdown links; broken links tolerated (§6.1) | Relative-link base lost on round-trip (okf.ts:856-917) | HIGH |
| Claims attributed via footnotes keyed to `sources[].id` (§5.1) | Attribution loss (okf.ts:864-889) | HIGH |
| Conventional headings not required (§4.2) | Arbitrary headings destructively interpreted (okf.ts:778-837) | HIGH |
| `generated`/`verified` → derived **advisory** credibility tiers (§5.3); `stale_after` freshness (§5.5) | Stored losslessly, never derived (okf.ts:23-27 documents the gap). Fix = separate `okfTrustAssessment` advisory field; **never** map to `GovernanceContext`/permissions (§6.3) | HIGH |
| `status: draft\|stable\|deprecated` (§5.4) | Supported in frontmatter interface | CONFORMANT |
| v0.1 fallback grace (§13) | Legacy `timestamp` field retained (okf.ts:~143) — minor doc drift | PARTIAL |

## 10. Product journeys (target state vs today)

- **Ingest → compile:** connectors (Obsidian/GitHub first) feed real change events into wiki maintenance **with source-ACL fidelity** (§6.1.5); today 5/6 connectors return empty discovery and the maintenance route is a no-op ack (§6.4). Reference journeys: AutoWiki CI-on-push, OpenWiki CI self-update [EXTERNAL-SPEC].
- **Ask → cited answer with abstention:** the entire surface is missing, not just abstention — wiki search returns only ranked pages/scores/recipe/mode (mdbrain:packages/wiki-engine/src/wiki-search.ts:106-117) and the API returns it directly (mdbrain:apps/api/src/routes/v1.ts:2633-2659). Deliverables: answer synthesis, per-claim citation map with validation, source-inspection contract, explicit gap states, failure behavior, and UI/MCP/API contracts — each with release gates. Reference: GBrain gap analysis [COMPETITOR-CLAIM].
- **Govern → no leaks, no unauthorized mutations:** every read path (generated matrix, §8) passes the permission-leakage gate and every mutation path passes capability + field-level authorization; today **five P0 read-disclosure paths plus unrestricted mutation** are open (§6.1.1–§6.1.6).
- **Interoperate → OKF round-trip:** import any conformant v0.2 bundle without rejection; export bundles external tools can consume; today both directions hit the §9 blockers.
- **Trust → evidence:** every public benchmark/eval row ships with an immutable artifact via the extended proof-pack (§6.5); today zero public rows have artifacts.

## 11. Explicit non-goals

- Memongo does not become a wiki/company-brain product; it stays the focused memory framework. Wiki internals never move into Memongo (§5.2).
- No third shared-core package until a §4 measurable contract failure fires.
- No dual-engine migration window, dual-write, or dual schema initialization — ever (§7).
- No public benchmark claims without artifacts; no ConvoMem/MemBench rows until harnesses exist (§2.4, §6.5).
- Not claiming OKF is an "official Google standard"; the "only system with both layers" claim is revalidated or removed before external reuse (§3.3, §3.4).
- This report changes no product code. All P0/P1 items route through the normal build workflow.

## 12. Open human decisions

1. **OKF scope for next release:** fix the §9 blockers as P0 gates, or label OKF experimental and de-scope? (Recommendation: fix — blockers are on the default path.)
2. **Topology decision (§7.1):** preserve per-agent `mdbrain_<agent>_` prefixes via injected config, or migrate all tenants into the shared `memongo_` target? This determines rehearsal scope and the compatibility matrix.
3. **Compat-layer removal date:** concrete date/major for `@mdbrain/memory-engine` retirement (§5.1).
4. **Connector priority:** confirm Obsidian + GitHub as the first two real connectors, with §6.1.5 ACL gates as acceptance (§6.4).
5. **Benchmark publication:** approve proof-pack extension work and the full-500 run budget on Atlas M30 (§6.5).
6. **Memongo release ownership:** who cuts the §5.3 coherent release (one pushed commit, exact siblings, tarball verification, bridge-internal promotion) and on what date.
7. **Critical-patch SLA definition (§4 falsification trigger 3):** severity classes, clock start/end, owner, escalation — until defined, the trigger is unevaluatable.
8. **Revision atomicity (§6.1.8):** are wiki revisions an atomic invariant or explicitly best-effort? Current code is deliberately best-effort (mdbrain:packages/wiki-engine/src/wiki-revisions.ts:31-65).
9. **Config boundary choice (§5.4):** upstream `createMemongoBridge({config})` vs mdbrain-side translation into public engine config.
10. **mdbrain README re-pointing** of OKF links and re-baselining of the untracked mem0 analysis doc's competitive claims (§3.3, §3.4) — docs-only, external-facing.
11. **Eval spec ownership (§8):** who authors, calibrates, and approves the versioned company-brain eval spec, and on what deadline — it blocks cutover.

---

*Durable evidence: `docs/research/evidence/2026-08-13/` — lane1–lane5 reports, symbol-export diffs, `engine-file-drift-2026-08-13.txt` (deterministic, tree-bound Git blob object IDs; locally rerunnable, externally reproducible only once the unpushed memongo commit is pushed/archived), `npm-*.json` and `github-*.txt` release-state captures. External access dates 2026-08-13 throughout.*
