# LANE 5 — Company-Brain / Wiki Competitive Landscape

> ⚠️ **Raw research notes — superseded where the synthesis differs.** Authoritative claims live in `../../2026-08-13-memongo-absorb-company-brain.md`; known stale claims are marked SUPERSEDED in place. (Banner added 2026-08-13, v4 remediation.)

**Date / access date for all external sources:** 2026-08-13
**Scope:** Agentic-wiki implementation evidence (DeepWiki, AutoWiki, OpenWiki, GBrain + origin gist), agent-memory/wiki systems (Mem0, Letta/MemGPT, Zep), product comparables (Glean, Notion AI, Guru, Slite, Outline — labeled, not implementation evidence), company-brain eval dimensions, product journeys, and a challenge pass on the local input doc.
**Evidence labels:** [SUBSTRATE-FACT] verified in local code · [BENCHMARK-EVIDENCE] measured artifact exists · [EXTERNAL-SPEC] authoritative external source (docs/paper/spec) · [COMPETITOR-CLAIM] self-reported/marketing · UNSUPPORTED where no code or benchmark backs a claim.

---

## 0. Local input challenge — mdbrain:docs/2026-07-23-mem0-agent-wiki-article-analysis.md (untracked)

The doc analyzes mem0's "The State of Agent Wikis" (In Context series) and concludes it "validates" mdbrain's architecture. Challenged like any competitor claim:

1. **Article-claim fidelity vs. the Karpathy gist — VERIFIED independently.** I re-fetched the primary source (<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>, accessed 2026-08-13). All eight claims the doc tabulates ("compile at ingest," "~100 sources" scale, qmd as search example, "Obsidian is the IDE…" quote, "you never write the wiki yourself," three layers, ingest/query/lint operations, Memex reference) are verbatim-accurate against the gist. [EXTERNAL-SPEC]
2. **"MDBrain is the only system that ships both layers" — PARTIALLY SUPPORTED, and now stale on the GBrain axis.** mdbrain:packages/wiki-engine/package.json:5 (description: "wiki_pages, OKF interchange, page rendering, maintenance, contradictions, governance, connectors") and mdbrain:packages/wiki-engine/README.md:31-37 (feature list: hybrid search via `$rankFusion`, governance, contradiction detection before dedup, git-diff + Dreamer maintenance) confirm the wiki layer exists in code; mdbrain:packages/wiki-engine/README.md example shows `scope`/`scopeRef`/`trustTier` governance fields on page creation. [SUBSTRATE-FACT] However, GBrain has since shipped "company brain" mode with per-login scoping and a synthesis+graph layer (see §2.4) — the doc's "no governance in any wiki system" row is no longer accurate for GBrain. [COMPETITOR-CLAIM on GBrain's side, but directionally material]
3. **"No funded competitor uses MongoDB" — UNSUPPORTED as stated.** The doc itself admits the article "doesn't mention any database-backed wiki at all"; this is an absence-of-evidence claim, not a verified negative. Treat as UNSUPPORTED marketing adjacency.
4. **Deep verification limits.** Claims about `maintenanceHash`, change-stream restart (commit `42bb60c`), and Dreamer vector search could not be file:line verified under read-only constraints (no grep available; `packages/wiki-engine/src/maintenance.ts` does not exist at that path — the maintenance module lives elsewhere). README-level corroboration only. Flagged for a code-verification pass.
5. **Net verdict on the local doc:** its reading of the mem0 article and the gist is sound; its "we're the only one" framing is now weaker (GBrain company-brain mode, OpenWiki eval harness) and should be re-baselined before reuse in external messaging.

---

## 1. Origin artifact: Karpathy `llm-wiki` gist

- **URL:** <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f> (accessed 2026-08-13; content self-dates via a `## [2026-04-02] ingest` log example; secondary sources cite April 2, 2026). [EXTERNAL-SPEC]
- **Content [EXTERNAL-SPEC]:** pattern doc, not software. Three layers (immutable raw sources / LLM-maintained Markdown wiki / schema file à la CLAUDE.md/AGENTS.md); three operations (ingest, query, lint — lint explicitly includes "contradictions between pages, stale claims that newer sources have superseded, orphan pages"); index.md + append-only log.md navigation; honest scale bound: "works surprisingly well at moderate scale (~100 sources, ~hundreds of pages)" before needing search (qmd — hybrid BM25/vector + LLM rerank, on-device, MCP server: <https://github.com/tobi/qmd>).
- **Eval relevance:** the gist *names* staleness and contradiction detection as lint duties but defines no metrics, harness, or pass criteria. Every downstream system inherits this gap.

## 2. Agentic-wiki implementation-evidence systems (CTO amendment (a): all four included)

### 2.1 DeepWiki (Cognition)

- **URLs:** <https://deepwiki.com>, <https://docs.devin.ai/work-with-devin/deepwiki>, <https://cognition.com/blog/deepwiki-mcp-server> (all accessed 2026-08-13). [EXTERNAL-SPEC]
- **What it is [EXTERNAL-SPEC]:** hosted auto-generated wiki for any public GitHub repo (swap `github.com`→`deepwiki.com`); architecture diagrams, code-grounded Q&A with source links; steerable via `.devin/wiki.json`; README badge triggers re-indexing cadence (freshness mechanism = re-crawl schedule, not diff-aware). Remote MCP server (`https://mcp.deepwiki.com/sse`, tools: `ask_question`, `read_wiki_structure`, `read_wiki_contents`) — unauthenticated for public repos; **private repos require a Devin account** [EXTERNAL-SPEC]. This is the only one of the four with a real ACL boundary, and it is binary (public/private via Devin auth), not per-document.
- **Eval dimensions:** provenance = answers "grounded directly in source code with source links" [COMPETITOR-CLAIM — Cognition blog]; staleness = badge-triggered re-index [EXTERNAL-SPEC]; contradiction resolution, abstention behavior, permission granularity beyond repo-level: **no public evidence**.
- **Product journey:** zero-install consumer (URL swap) → optional repo-owner steering (`.devin/wiki.json`) → agent integration via MCP. Journey is read-mostly; users never edit the wiki.

### 2.2 AutoWiki (Factory)

- **URLs:** <https://docs.factory.ai/software-factory/wiki/overview>, <https://factory.ai/news/wiki> (accessed 2026-08-13). [EXTERNAL-SPEC]
- **What it is [EXTERNAL-SPEC]:** docs-as-build-artifact. `/wiki` in Droid CLI generates the initial wiki; `/install-wiki` scaffolds CI (`.github/workflows/autowiki.yml` / GitLab CI) that runs `droid exec "/wiki --refresh"` on push to main or nightly cron; output syncs to Factory App (`app.factory.ai/wiki`) or the repo's native GitHub Wiki with rewritten links/sidebar.
- **Eval dimensions:** freshness = CI-on-push refresh (best-in-class *trigger* story among the four; the wiki is a CI artifact, so staleness is bounded by pipeline runs) [EXTERNAL-SPEC]; provenance, contradiction handling, abstention, ACLs: **no public evidence**. Closed-source; refresh quality unverifiable. [COMPETITOR-CLAIM for "zero doc drift" benefit language.]
- **Product journey:** repo-scoped, CI-native; the consumer is both humans and Factory's own coding Droids (docs double as agent context).

### 2.3 OpenWiki (LangChain)

- **URL:** <https://github.com/langchain-ai/openwiki> (accessed 2026-08-13; MIT license; npm package `openwiki`; built on Deep Agents). [EXTERNAL-SPEC]
- **What it is [EXTERNAL-SPEC]:** CLI that writes/maintains a Markdown wiki for a codebase (`code` mode → `openwiki/` in-repo) or personal knowledge (`personal` mode → `~/.openwiki/wiki`). 12 model providers; connectors for Custom MCP, Notion, Slack, Gmail, X, Web Search, Hacker News, local git; self-updating via GitHub Actions/GitLab CI/Bitbucket Pipelines; **OKF v0.1 output** (<https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md> — same interchange format mdbrain uses); interactive local visualizer (loopback-only); `.openwikiignore`; multilingual wikis; LangSmith trace connector; Copilot-as-provider.
- **Eval dimensions — strongest open evidence of the four [EXTERNAL-SPEC — harness source; no measured run artifact cited]:** the repo ships a real eval harness at `evals/ledger/` with named evaluators: `evals/ledger/evaluator/forgetting.ts` (staleness/forgetting), `precision.ts`, `retrieval.ts`, `evidence-map.ts` (provenance mapping), `evals/ledger/replay/git-replay.ts` (replays wiki maintenance against git history — the only connector-sync/replay analog found in any wiki system), `evals/ledger/metrics/claims.ts`, and `evals/ledger/system/openwiki-system.ts` end-to-end runs. Coverage: staleness ✅ (forgetting), provenance ✅ (evidence-map), retrieval quality ✅, replay ✅. Contradiction resolution and abstention: no dedicated evaluator found. ACL/permission handling: none — file-based, single-tenant.
- **Product journey:** `npm i -g openwiki` → `openwiki --init` (provider/key/model walkthrough) → CI job opens docs PRs on change → humans explore via visualizer; agents read the wiki as memory.

### 2.4 GBrain (Garry Tan)

- **URL:** <https://github.com/garrytan/gbrain> (accessed 2026-08-13). [EXTERNAL-SPEC for existence/code; all performance and security numbers below are [COMPETITOR-CLAIM] from the README.]
- **What it is:** personal/team "brain" daemon — Markdown pages in PGLite, 24/7 cron-driven ingest (meetings, email, tweets, voice), entity-ref extraction creating typed edges (`attended`, `works_at`, `invested_in`…) "with zero LLM calls" [COMPETITOR-CLAIM], synthesis layer returning cited prose plus explicit gap analysis ("what the brain doesn't know yet") — a form of surfaced abstention. Author claims production scale: 155,795 pages, 24,589 people, 5,340 companies, 66 cron jobs [COMPETITOR-CLAIM].
- **Company-brain mode [COMPETITOR-CLAIM]:** per-login slices of a shared brain; "When you query, you only see what you're allowed to see… We fuzz-tested this across every way you can read the brain (search, list, lookup, multi-source reads) and got zero leaks." Fuzz methodology not published in README; positioned explicitly against YC's company-brain RFS (<https://www.ycombinator.com/rfs#company-brain>).
- **Benchmarks [BENCHMARK-EVIDENCE]:** BrainBench scorecards live in a sibling public repo (<https://github.com/garrytan/gbrain-evals>); headline claim P@5 49.1%, R@5 97.9% on a 240-page Opus-generated corpus, +31.4pt P@5 over graph-disabled and BM25/vector-only variants. Numbers are self-run on a small synthetic corpus — treat as directional. Repo also documents `docs/eval/BRAINBENCH.md`, `docs/eval/SEARCH_MODE_METHODOLOGY.md`, `docs/designs/2026_05_EVAL_PLAN.md` [EXTERNAL-SPEC — files exist; content not audited line-by-line].
- **Eval dimensions:** provenance ✅ (per-claim source pages, self-fixing citations [COMPETITOR-CLAIM]); abstention ✅ (gap-analysis "heads up" is the most explicit abstention UX of any system surveyed); ACL ✅-claimed (login-scoped, fuzz-tested, unverified); freshness = dream-cycle consolidation [COMPETITOR-CLAIM]; contradiction handling: `docs/contradictions.md` exists in repo [EXTERNAL-SPEC]; replay/sync: deterministic collectors + queue ops runbook documented, no eval.

### 2.5 Comparative snapshot (the mem0-article four + mdbrain)

| System | Storage | Freshness trigger | Provenance | Contradictions | Abstention | ACL | Eval artifact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DeepWiki | Hosted proprietary | Badge/crawl re-index | Source-linked answers [CC] | none public | none public | Repo-level (Devin auth) | none |
| AutoWiki | Git repo / GitHub Wiki | CI on push [ES] | none public | none public | none public | Repo-level | none |
| OpenWiki | Markdown files | CI self-update | evidence-map evaluator [ES — harness source] | lint only, no evaluator | none found | none (single-tenant) | `evals/ledger` [ES — harness source] |
| GBrain | PGLite + Markdown | Dream-cycle cron | per-claim pages [CC] | docs/contradictions.md [ES] | gap analysis UX [CC] | login-scoped, fuzz claim [CC] | gbrain-evals [BE] |
| mdbrain | MongoDB Atlas | git-diff + change streams + Dreamer | claims/evidence fields [SF: wiki-engine README:31] | pre-dedup detection [SF: README:35] | not evidenced | scope/trustTier fields [SF: README example] | none public |

## 3. Agent-memory implementation-evidence systems

### 3.1 Mem0

- **URLs:** <https://mem0.ai/blog> (accessed 2026-08-13); "The State of Agent Wikis" (In Context series) — exact blog slug not resolvable on 2026-08-13 (two candidate URLs 404); announcement thread: <https://x.com/mem0ai/status/2079585032587694582>. Content characteristics below are from secondary summaries + the local analysis doc — label accordingly.
- **Thesis [COMPETITOR-CLAIM]:** "a wiki is not memory — use both." Wiki = knowledge of a *document set* (compile at ingest); memory = knowledge of a *user* (from interaction). Positions mem0 as the memory layer complementing the four wikis. Identifies shared 4-part architecture (raw sources / compiled Markdown vault / rules+index / maintenance loop) and limits: summary distortion/drift, maintenance cost, ~100-source scale boundary.
- **Implementation evidence:** mem0 OSS is an ADD-only extraction memory layer (per memongo competitive-research memory: no graph DB, no decay/temporal in OSS — platform-only — no committed benchmark numbers). [COMPETITOR-CLAIM territory for benchmark marketing; treat their agent-wiki framing as category-positioning content marketing that happens to be technically accurate about the gist.]
- **Eval dimensions:** user-memory correctness benchmarks (their LoCoMo/LongMemEval marketing) exist but are self-reported [COMPETITOR-CLAIM]; no ACL, contradiction, or abstention evidence in OSS.

### 3.2 Letta / MemGPT

- **URLs:** <https://docs.letta.com/guides/agents/overview> ("Introduction to Stateful Agents"), <https://docs.letta.com/guides/agents/memory> (accessed 2026-08-13). [EXTERNAL-SPEC]
- **Architecture [EXTERNAL-SPEC]:** "LLM-as-OS" — context window as RAM, DB as disk. All state (memories, messages, reasoning, tool calls) persisted server-side; **self-editing memory blocks** pinned to the system prompt, editable via memory tools, attachable/detachable, **shareable across agents ("shared blocks")**; out-of-context messages remain retrievable via API/agent retrieval tools after eviction. Runs → steps execution model; independent threads per agent for concurrent multi-user messaging.
- **Eval dimensions:** provenance = full message/state persistence (replay-able by construction) [EXTERNAL-SPEC]; contradiction resolution = agent-edited (the model rewrites its own blocks — no structural conflict tracking) — weak; staleness = no temporal metadata on blocks [EXTERNAL-SPEC by absence]; abstention, ACL (beyond agent-scoping): none evidenced. Memory-block sharing across agents is a governance surface Letta exposes but does not document ACLs for.
- **Historical note:** MemGPT established the DMR benchmark later used against it by Zep (§3.3).

### 3.3 Zep (Graphiti)

- **URLs:** paper <https://arxiv.org/abs/2501.13956> (v1 submitted 2025-01-20; accessed 2026-08-13) [EXTERNAL-SPEC]; docs <https://help.getzep.com/concepts> (accessed 2026-08-13) [EXTERNAL-SPEC].
- **Architecture [EXTERNAL-SPEC]:** temporal knowledge graph ("Context Graph") — nodes are entities, edges are facts/relationships; **bi-temporal fact invalidation**: "when new data invalidates a prior fact, the time the fact became invalid is stored on that fact's edge" — history preserved, not overwritten. Ingests JSON/text/messages (chat, business data, docs, email); produces facts, entities, episodes, thread summaries, observations, user summary; Context Block carries fact valid/invalid dates into the prompt; sub-200ms retrieval [COMPETITOR-CLAIM]; governance features ("who manages the account and what context each agent can reach") at platform level [EXTERNAL-SPEC — docs list a Governance section; depth unaudited].
- **Benchmarks [BENCHMARK-EVIDENCE — peer-reviewable artifact exists]:** DMR 94.8% vs MemGPT 93.4% (on MemGPT's own benchmark); LongMemEval accuracy improvements "up to 18.5%" with 90% latency reduction vs baselines (arXiv:2501.13956 abstract). Caveat: vendor-run benchmarks, 12-page paper, not independently replicated.
- **Eval dimensions:** **staleness/freshness = strongest formal model in the survey** (invalidation intervals are first-class) [EXTERNAL-SPEC]; contradiction resolution = implicit via invalidation (no explicit contradiction-surfacing UX); provenance = episodes→edges lineage [EXTERNAL-SPEC]; abstention = none evidenced; ACL = project/graph-scoped multi-tenancy, no document-level ACL propagation from source systems.

## 4. Product comparables (CTO amendment (b): labeled PRODUCT COMPARABLES — not agentic-wiki implementation evidence)

These are enterprise knowledge *products*; none publishes agentic-wiki implementation detail. Included for product-journey and eval-dimension benchmarking only. [COMPETITOR-CLAIM] throughout unless noted.

| Product | Journey / deployment | ACL model | Citations | Freshness | Source (accessed 2026-08-13) |
| --- | --- | --- | --- | --- | --- |
| **Glean** | Enterprise federated search + assistant across 100+ SaaS apps; per-user answers | Native real-time mirroring of source-app permissions (the industry reference for ACL propagation) | Deep links to specific docs/threads | Continuous connector re-sync | <https://www.glean.com>, docs.glean.com (permissions page moved; exact URL gap) |
| **Notion AI** | AI inside an all-in-one workspace; Q&A over pages + connected apps | Workspace/teamspace RBAC + connector OAuth scopes | Links to Notion pages/blocks | Live (same-store) for native content | <https://www.notion.com/product/ai> |
| **Guru** | Card-based wiki + browser-overlay enterprise search | Group/collection RBAC + connected-app scopes | Card links **+ SME verification date** — the only product with explicit human-attestation freshness | Verification workflow with expiry | <https://www.getguru.com> |
| **Slite** | Lightweight team wiki with "Ask" AI | Channel/doc-level public/private | Doc-section links with snippet preview | Manual/doc-driven | <https://slite.com> |
| **Outline** | **EXCLUDED from evidence rows** — open-source team wiki (<https://github.com/outline/outline>) with no published agentic-wiki/AI-answer implementation evidence found in this pass; its AI features are thin. Mention only as an open-source wiki-hosting comparable. | — | — | — | <https://github.com/outline/outline> |

**Why they matter anyway:** Glean defines the enterprise expectation for **permission leakage / ACL propagation** (answers must be built only from docs the asker can see, mirroring source ACLs in near-real-time); Guru defines the expectation for **freshness via human verification loops**; Notion AI defines the **same-store zero-sync baseline**. Any company-brain eval suite will be compared against these product behaviors even though they are not agentic wikis.

## 5. Company-brain EVAL dimensions (CTO amendment (c)) — cross-system evidence matrix

LongMemEval/LoCoMo measure *user-memory recall*, not company-brain behavior. The dimensions that actually differentiate, and who has evidence:

1. **Permission leakage / ACL propagation.** Evidence: Glean (product, real-time source-ACL mirroring [COMPETITOR-CLAIM but enterprise-validated]); GBrain (login-scoped slices + zero-leak fuzz claim, methodology unpublished [COMPETITOR-CLAIM]); DeepWiki (binary public/Devin-private [EXTERNAL-SPEC]); mdbrain (scope/scopeRef/trustTier fields in code [SUBSTRATE-FACT: wiki-engine README example], no published leak test). Academic framing exists: "Integrating Access Control with RAG" (Chen & Tackman, <https://www.semanticscholar.org/paper/cb665b552ff4b2e7cf00d5c19f21b7e6b89c8ed8>, accessed 2026-08-13) [EXTERNAL-SPEC]. **No system publishes a quantitative cross-tenant leak-rate benchmark.** Gap = opportunity.
2. **Provenance / citations.** Best implementation evidence: OpenWiki `evals/ledger/evaluator/evidence-map.ts` + `metrics/claims.ts` [EXTERNAL-SPEC — harness source]; Zep episode→edge lineage [EXTERNAL-SPEC]; GBrain per-claim source pages [COMPETITOR-CLAIM]; mdbrain wiki_pages claims/evidence schema [SUBSTRATE-FACT: README:31]. Citation-accuracy measurement methodology exists externally (ALCE benchmark) [EXTERNAL-SPEC].
3. **Freshness / staleness.** Formal model: Zep bi-temporal invalidation [EXTERNAL-SPEC/BENCHMARK-EVIDENCE]. Trigger engineering: AutoWiki CI-on-push, OpenWiki CI self-update [EXTERNAL-SPEC]; mdbrain git-diff maintenance [SUBSTRATE-FACT: README:36]; OpenWiki `forgetting.ts` evaluator is the only *staleness metric* code found anywhere in the survey [EXTERNAL-SPEC — harness source]. Guru's SME verification expiry is the product-side reference [COMPETITOR-CLAIM].
4. **Contradiction resolution.** Weakest dimension industry-wide. Karpathy gist names it as lint duty (no metric) [EXTERNAL-SPEC]; mdbrain: pre-dedup contradiction detection [SUBSTRATE-FACT: README:35]; GBrain `docs/contradictions.md` exists [EXTERNAL-SPEC]; Letta delegates to model self-editing (no structural tracking); Zep handles it implicitly via invalidation. **No contradiction-detection benchmark exists in any surveyed system.**
5. **Abstention behavior.** GBrain's gap-analysis "heads up" is the only explicit abstention UX in a wiki/brain system [COMPETITOR-CLAIM]; enterprise-RAG practice literature (RAGAS/TruLens/DeepEval pipelines; "prefer false abstention over false answer") is the eval reference [EXTERNAL-SPEC]. No wiki system ships an abstention evaluator.
6. **Connector sync / replay.** OpenWiki `evals/ledger/replay/git-replay.ts` replays maintenance against git history — the only replay-harness code found [EXTERNAL-SPEC — harness source]; Glean connector re-sync is the product reference [COMPETITOR-CLAIM]; AutoWiki/DeepWiki re-run whole pipelines (rebuild, not replay); mdbrain change-stream watcher + connectors (Obsidian/GitHub/Confluence/Notion/Slack/CRM listed, README:37) [SUBSTRATE-FACT for listing; connector depth not verified — local doc admits "connector stubs" were qualified in a README honesty pass, so treat connector maturity as partially stubbed pending code audit].

## 6. Product journeys (condensed)

- **DeepWiki:** anonymous URL swap → read/ask → repo owner adds `.devin/wiki.json` + badge → agents consume via MCP. Zero-commitment entry is its moat.
- **AutoWiki:** `/wiki` in Droid CLI → `/install-wiki` scaffolds CI → docs PRs/sync on every push. Docs exist because the pipeline forces them to.
- **OpenWiki:** `npm i -g openwiki` → `--init` walkthrough → CI docs PRs → visualizer for humans, wiki-as-memory for agents. Only journey with an OSS eval loop the user can run themselves.
- **GBrain:** 30-min install (PGLite, no server) → daemon ingests 24/7 → cron dream-cycle consolidates → ask, get cited synthesis + gaps. Journey is ambient, not session-based.
- **Letta:** developer API — create agent with memory blocks → agent self-edits → blocks shared across agents. Platform journey, no end-user wiki UX.
- **Zep:** platform API — add messages/data → graph builds with temporal invalidation → retrieve Context Block with fact validity dates.
- **Glean/Guru/Notion AI/Slite:** connect sources → per-user Q&A with citations → (Guru only) SME verification loop. The enterprise bar: setup measured in connector-OAuth hours, value measured in answer trust.

## 7. UNSUPPORTED / challenged claims register

| Claim | Source | Verdict |
| --- | --- | --- |
| "MDBrain is the only system with both layers + governance" | mdbrain local doc | UNSUPPORTED as of 2026-08-13 — GBrain company-brain mode + OpenWiki eval harness erode "only" |
| "No funded competitor uses MongoDB" | mdbrain local doc | UNSUPPORTED (absence-of-evidence) |
| GBrain "zero leaks" fuzz across all read paths | GBrain README | UNSUPPORTED pending published methodology (gbrain-evals may contain it; not audited) |
| GBrain P@5 49.1 / R@5 97.9 | gbrain-evals repo | [BENCHMARK-EVIDENCE] exists but self-run, 240-page synthetic corpus — directional only |
| Zep LongMemEval +18.5%, -90% latency | arXiv:2501.13956 | [BENCHMARK-EVIDENCE] vendor-run, unreplicated |
| DeepWiki answers "grounded with source links" | Cognition blog | [COMPETITOR-CLAIM], no citation-accuracy eval published |
| AutoWiki "zero doc drift" | Factory marketing | [COMPETITOR-CLAIM], closed-source |
| mdbrain connector maturity (5 connectors listed) | wiki-engine README:37 | PARTIALLY SUPPORTED — local doc concedes stubs; needs code audit |

## 8. Sources (kept)

- Karpathy llm-wiki gist — <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f> (2026-08-13) — primary origin artifact, verified against local doc's claims
- OpenWiki repo — <https://github.com/langchain-ai/openwiki> (2026-08-13) — only wiki system with a shipped eval/replay harness
- GBrain repo — <https://github.com/garrytan/gbrain> (2026-08-13); evals <https://github.com/garrytan/gbrain-evals> — only system with company-brain ACL claim + abstention UX + public scorecards
- DeepWiki — <https://deepwiki.com>, <https://docs.devin.ai/work-with-devin/deepwiki>, <https://cognition.com/blog/deepwiki-mcp-server> (2026-08-13)
- AutoWiki — <https://docs.factory.ai/software-factory/wiki/overview>, <https://factory.ai/news/wiki> (2026-08-13)
- Zep paper — <https://arxiv.org/abs/2501.13956> (v1 2025-01-20; accessed 2026-08-13); docs <https://help.getzep.com/concepts> (2026-08-13)
- Letta docs — <https://docs.letta.com/guides/agents/overview>, /guides/agents/memory (2026-08-13)
- Mem0 — <https://mem0.ai/blog> (2026-08-13); article announcement <https://x.com/mem0ai/status/2079585032587694582> (2026-08-13)
- ACL-in-RAG academic framing — <https://www.semanticscholar.org/paper/cb665b552ff4b2e7cf00d5c19f21b7e6b89c8ed8> (2026-08-13)
- OKF spec — <https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md> (2026-08-13)
- qmd — <https://github.com/tobi/qmd> (2026-08-13)
- Local: mdbrain:docs/2026-07-23-mem0-agent-wiki-article-analysis.md; mdbrain:packages/wiki-engine/README.md:31-37; mdbrain:packages/wiki-engine/package.json:5

**Dropped:** deepwiki.sh and repowise.dev comparison pages (SEO/derivative); tencent/163.com reposts (secondary); note.com/dev.to AutoWiki posts (derivative of Factory docs); random "awesome-llm-wiki" lists (no evidence value).

## 9. Gaps

1. **Exact mem0 article URL** — two slug candidates 404; content captured via announcement thread + secondary summaries + local doc (which quoted it directly). Re-resolve before external citation.
2. **mdbrain code-level verification** of `maintenanceHash`, change-stream restart (`42bb60c`), Dreamer vector search, and connector stub depth — blocked by read-only/no-grep constraint. Recommend a verification pass with file:line citations before the local doc's §3 table is reused externally.
3. **Glean permissions doc URL** moved (404 on old path); ACL-mirroring claim is enterprise-corroborated but the exact doc page needs re-resolution.
4. **gbrain-evals repo content not audited line-by-line** — BrainBench methodology (corpus, judges, leak fuzzing) deserves a dedicated pass; it's the closest public analog to a company-brain eval suite.
5. **No contradiction-detection or abstention benchmark exists anywhere in the surveyed landscape** — both dimensions are greenfield for a company-brain eval suite.
