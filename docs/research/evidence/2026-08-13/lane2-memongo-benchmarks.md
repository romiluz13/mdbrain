# LANE 2 — Memongo benchmark evidence vs claims (local audit)

> ⚠️ **Raw research notes — superseded where the synthesis differs.** Authoritative claims live in `../../2026-08-13-memongo-absorb-company-brain.md`; known stale claims are marked SUPERSEDED in place. (Banner added 2026-08-13, v4 remediation.)

Date: 2026-08-13. Repo: `/Users/rom.iluz/Dev/memongo` (HEAD `8833026c0c` "feat(memory): harden parallel evidence retrieval").
Evidence labels: [SUBSTRATE-FACT] verified in code · [BENCHMARK-EVIDENCE] measured artifact exists · [EXTERNAL-SPEC] authoritative external source · [COMPETITOR-CLAIM] self-reported/marketing · UNSUPPORTED = no backing artifact found in-repo.

---

## 1. Claim-vs-evidence table

### 1a. `memongo:docs/benchmarks/BENCHMARKS.md` — the only quantitative public claims

| # | Claim (docs/benchmarks/BENCHMARKS.md:36-43) | Evidence in repo | Verdict |
| --- | --- | --- | --- |
| 1 | LongMemEval raw session full 500: RecallAny@5 Memongo **99.15%** vs MemPalace **96.60%** (session unit) | None. Doc itself states "The public source tree intentionally omits raw benchmark artifacts" (line 19, 49-51) and defers hashes to a future GitHub Release. No raw/predictions/scorer output exists anywhere in the tree. | **UNSUPPORTED in-repo** (by design; externally unverifiable until release bundle is attached) |
| 2 | LongMemEval held-out 450 hybrid no-LLM: RecallAny@5 **99.11%** vs **98.44%** | Same as above. No artifact. | **UNSUPPORTED in-repo** |
| 3 | LoCoMo raw session top-10: average recall **91.71%** vs **60.29%** | No artifact. Additionally, the LoCoMo *dataset* is deliberately not vendored — `memongo:scripts/fetch-benchmark-dataset.ts:120-123` refuses to fetch it (CC BY-NC 4.0). A LoCoMo harness + contract exist (`memongo:scripts/benchmark/benchmark-quality-contracts.ts:23-35`, `mongodb-benchmark-dataset.ts`) but no run output is present. | **UNSUPPORTED in-repo** |
| 4 | LoCoMo hybrid session top-10: **93.30%** vs **88.91%** | Same as #3. | **UNSUPPORTED in-repo** |
| 5 | ConvoMem raw message top-10: **100.00%** vs **92.87%** | No artifact, and **no ConvoMem harness exists in `scripts/` or `packages/memory-engine/src/`** (grep for "convomem" returns zero code hits). | **UNSUPPORTED** — no harness, no artifact |
| 6 | MemBench hybrid turn top-5: hit@5 **88.75%** vs **80.33%** | Same — zero "membench" code hits; no harness, no artifact. | **UNSUPPORTED** — no harness, no artifact |

Contextual note: BENCHMARKS.md is deliberately conservative elsewhere — it explicitly does **not** claim a Mem0 win, retires an old "98.1%" README number (line 17), and forbids comparing retrieval-recall rows to competitor judged-answer rows (line 20). The six rows above are the only numeric claims and all rest on artifacts held outside the public tree ("MemPalace committed artifacts" — a separate, private baseline repo; nothing under `memongo:benchmarks/` backs them).

### 1b. `memongo:README.md` (lines 166-177)

| Claim | Evidence | Verdict |
| --- | --- | --- |
| "Current public evidence supports selected MemPalace P0 retrieval-lane comparisons only" (README.md:168) | Points to BENCHMARKS.md; those rows are UNSUPPORTED in-repo (table 1a) | Policy wording accurate; underlying numbers unverifiable locally |
| "Broader ecosystem benchmarks, including Mem0 LongMemEval judged-answer rows, are still under audit. No Mem0 LongMemEval win is claimed." (README.md:168) | Consistent with BENCHMARKS.md:54-58 and with logs (no mem0 run infrastructure exists) | **[SUBSTRATE-FACT]** — honest disclaimer, verified |
| Rules: "No question-ID tuning. No hidden fallback. Retrieval recall and judged answer quality are reported separately." (README.md:172-176) | Harness enforces shipped-profile-only runs and digest-pinned datasets (`memongo:scripts/run-benchmark.ts:169-186`, contract binding at `:229-234`) | **[SUBSTRATE-FACT]** enforcement exists in code; note "no hidden fallback" is aspirational — the engine *does* have a JS-merge fusion fallback (`mongodb-search.ts:1133-1196` per handoff doc), it is just part of the shipped profile |

### 1c. `memongo:benchmarks/README.md` — methodology + competitor claims

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Pinned LongMemEval_S SHA-256 `d6f21ea9…c3a442` verified on fetch, `.partial` promotion, mismatch aborts | `memongo:scripts/benchmark/benchmark-quality-contracts.ts:4-5` (digest constant), `memongo:scripts/fetch-benchmark-dataset.ts:89-110` (download→digest→promote), `memongo:scripts/run-benchmark.ts:169-186` (run aborts on mismatch) | **[SUBSTRATE-FACT]** |
| Zep published 84% on LoCoMo, conceded numerator/denominator error, revised to 75.14% ± 0.17; mem0 rerun reported 58.44% ± 0.20 (benchmarks/README.md:14-16) | External history; matches the public mem0/Zep dispute record | **[COMPETITOR-CLAIM]** (both sides self-reported; not verified here) |
| mem0 harness downloads dataset with no checksum/pinned revision; reproducibility complaint on tracker | External | **[COMPETITOR-CLAIM]** — plausible, unverified locally |
| Publication gates: shipped profile only, digest-bound contract, repeated runs (mean ± stddev), pinned judge, recorded config, competitors re-run in-house | Gates 1, 2, 5 enforced in code: profile flag (`run-benchmark.ts:188`), contract binding (`run-benchmark.ts:229-234`), measurement-pass machinery with per-pass p95 band (`run-benchmark.ts:265-279`). Gate 3 (mean±stddev of *runs*) and gate 6 (competitor reruns) have **no implementation** — `scripts/compare-memory-eval.ts` compares Memongo deployment vs Memongo deployment, not vs mem0/Zep | **[SUBSTRATE-FACT]** partially enforced; gates 3 & 6 are policy-only, **no code** |
| "autoEmbed indexes resolve to `quantization: \"scalar\"` on Atlas" | Capability gate `autoembed-quantization: true` observed in run logs (e.g. b16 logs `ready:` line) | **[SUBSTRATE-FACT]** gate observed; actual index quantization not independently verified |

### 1d. `memongo:CHANGELOG.md`

No quantitative performance claims. Benchmark-integrity section (lines 34-40) describes harness behavior — all backed by code above ([SUBSTRATE-FACT]). "Validated against real MongoDB Atlas clusters (8.3+) in CI" (line 8) — Atlas-backed test suites exist (`scripts/mongodb-e2e-qa*.ts`, research docs) but CI evidence not inspected; treat as plausible **[SUBSTRATE-FACT]** (scripts exist) / CI-run claim unverified.

---

## 2. Measured numbers from result logs (b16-2026-08-04 + prebenchmark-2026-08-09)

Tracking status: `benchmark-sample-5-attempt8.log`, `benchmark-sample-1-attempt9.log`, and `real-capability-stress/2026-08-04T14-26-28-792Z.json` are **git-tracked**. All other logs below are **UNTRACKED/UNPUBLISHED**. `benchmarks/results/checkpoints/` and `benchmarks/data/` are gitignored (`.gitignore:52,55`).

All runs: LongMemEval_S, shipped profile, Atlas (M30, `memongo.suw50.mongodb.net`), Atlas autoEmbed (Voyage), evaluator pinned to `xiaowu0162/LongMemEval@9e0b455f`, `eval_utils.py` blob `9c43a835` (evaluator identity embedded in each log's `official` JSON).

### 2a. Sample runs that completed (all explicitly marked "⚠ sample run — no quality contract applied. Do not publish this number.")

| Artifact (memongo:benchmarks/results/…) | Cases | hitRate | R@5 | nDCG@10 | p95 ms | Fusion config | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b16-2026-08-04/benchmark-sample-1-attempt9.log **(tracked)** | 1 | 1.0000 | 1.0000 | 1.0000 | 1796 | rankFusion | clean; 53 conv / 550 turns ingested, 550/550 extraction jobs completed |
| b16-2026-08-04/benchmark-sample-5-attempt8.log **(tracked)** | 5 | 1.0000 | 1.0000 | 0.9262 | 2146 | rankFusion | clean; session recallAny@5=1.0, turn-level=0.6 |
| b16…/benchmark-sample-5-voyage-lite-parallel.log (untracked) | 5 | 1.0000 | 1.0000 | 1.0000 | **3410** | rankFusion | clean |
| b16…/benchmark-sample-5-voyage-lite-parallel-m30.log (untracked) | 5 | 1.0000 | 1.0000 | 1.0000 | 1396 | rankFusion, M30 | clean |
| b16…/benchmark-sample-5-voyage-lite-parallel-no-rerank-m30.log (untracked) | 5 | 1.0000 | 1.0000 | 1.0000 | 1021 | rankFusion, no CE rerank | clean; turn-level recall drops to 0.8 |
| b16…/benchmark-sample-5-voyage-lite-parallel-js-merge-m30.log (untracked) | 5 | 1.0000 | 1.0000 | 1.0000 | **850** | JS-merge fusion | clean; all session+turn cutoffs 1.0 |
| prebenchmark-2026-08-09/sample-5-attempt5.log (untracked) | 5 | 1.0000 | 1.0000 | 1.0000 | 2501 | rankFusion | clean; pass-band median 1780 / min 1681 / max 2501, stddev 365 |
| prebenchmark-2026-08-09/sample-5-attempt7.log (untracked) | 5 | 1.0000 | 1.0000 | 1.0000 | 2475 | rankFusion | clean |

### 2b. Failed/incomplete runs (the majority)

- **No completed full 500-question run artifact found in the audited repo, releases, or local result set.** `b16…/benchmark-full-voyage-lite-parallel-js-merge-m30.log` (untracked, 17,979 lines): 63 of 500 scenarios completed, then `MongoNetworkTimeoutError: Socket 'secureConnect' timed out` → exit 1. Gitignored checkpoint `longmemeval-full-js-merge-no-vpn.json` shows **62/500 completed, updatedAt 2026-08-13T20:06:51Z** — i.e. a full run was still in flight (or stalled) as of today; no full-run metrics exist anywhere.
- b16 attempts 1–7 (untracked): attempt1/2 died on cluster `ECONNREFUSED`/`ENOTFOUND`; attempt3/4 truncated mid-ingest; attempt5/6/7 crashed (exit 1) — settle timeout at `mongodb-manager-benchmark-scenario.ts:211`, failures in `mongodb-manager-benchmark.ts:345/:474`.
- prebenchmark attempts 2/3/4/6, sample-5.log: connection failures (wrong/unset URI, server-selection timeout) or exit 1.

### 2c. Non-benchmark measured evidence

- `b16…/real-capability-stress/2026-08-04T14-26-28-792Z.json` (tracked): overall `ok: true`; query-cache probe 0.33 hit rate; real-agent check skipped (no LLM provider). Cited by `docs/research/b16-release-readiness-evidence-2026-08-04.md` (untracked).
- b16 evidence doc also reports: Evaluation E2E 33/33 passed (score 99.3/100), production-readiness 96/96, conversation-recall regression 6/6 — the 6/6 regression gate is corroborated by every run log's `recall gate : passed … Tests 6 passed (6)` line; the 33/33 and 96/96 suites have **no preserved output artifacts** in-repo → [BENCHMARK-EVIDENCE] for recall gate; UNSUPPORTED (artifact-wise) for the two suite counts.

---

## 3. Methodology assessment

- **Datasets:** LongMemEval_S (500 questions, ICLR 2025, MIT) is the only dataset with an enforced pipeline — digest-pinned, evaluator pinned to upstream commit/blob. LoCoMo harness exists but dataset fetch is deliberately refused on CC BY-NC 4.0 licensing grounds (`fetch-benchmark-dataset.ts:120-123`) — an unusually scrupulous stance. ConvoMem and MemBench appear only in BENCHMARKS.md rows; **no harness code exists** for either.
- **Baselines:** The only comparative baseline ever run is **MemPalace** (the author's prior system) against "committed artifacts" held outside this repo. There is **no mem0, no Zep runner** anywhere in the tree; `scripts/compare-memory-eval.ts` is Memongo-vs-Memongo (baseline vs candidate deployment). The README/benchmarks policy *requires* in-house competitor reruns before any comparison is published, and none exist — consistent with the explicit "No Mem0 win is claimed."
- **Sample sizes:** All completed quality runs are n=1 or n=5. No completed n=500 publication-run artifact was found in the audited locations (untracked local log shows 63/500 max). p95 latency on n=5 is effectively max-latency — the handoff doc itself flags this (docs/handoff/2026-08-12-deep-research-synthesis-v2.md:216). Release contract gate `maxP95LatencyMs: 1000` (`benchmark-quality-contracts.ts:14`) was met only by the js-merge n=5 sample (850ms); rankFusion samples run 1396–3410ms.
- **Repeated-run gate:** policy demands mean ± stddev across runs; the harness implements measurement *passes* within one run (per-pass p95 band), not across-run aggregation. No multi-run aggregate exists.
- **External scrutiny verdict:** The *harness* would survive scrutiny unusually well (digest pinning, evaluator pinning, shipped-profile enforcement, non-publishable sample labeling, honest disclaimers, scar-documented competitor disputes). The *published numbers* would not: six headline rows have zero in-repo artifacts, two of them reference datasets with no harness, and the strongest internal quality result (hitRate/R@5 = 1.0) rests on n≤5 samples with turn-level recall as low as 0.6–0.8 in some configs.

---

## 4. Untracked docs scan (docs/handoff/, docs/research/)

- `docs/handoff/2026-08-09-latency-fix-handoff.md` (corrected 2026-08-12): per-phase p95 breakdown from `prebenchmark…/sample-5-attempt5.log` — total 2222ms, rerank 833ms, lanes 790ms, unaccounted 494ms, plan 299ms. Concludes <1000ms reachability is an **open question**; explicitly warns per-phase p95s are non-additive and the cold/warm 820ms gap may be n=5 noise. Contains 7 corrected factual errors from the original handoff — healthy self-audit trail.
- `docs/handoff/2026-08-12-deep-research-synthesis-v2.md`: competitor figures — Mem0 v3 p50 0.88–1.09s / p95 1.44s end-to-end, search-only p95 0.20s, LoCoMo 92.5 / LongMemEval 94.4 with reranking OFF by default **[COMPETITOR-CLAIM]**; TSM LongMemEval temporal 69.92% vs Mem0 40.15% / Zep 36.50% **[EXTERNAL-SPEC]** (arXiv:2601.07468, cited); OpenAI "Dreaming V3" recall 41.5%→82.8% **[COMPETITOR-CLAIM]**. Also correctly reframes the 1000ms p95 as a *release gate*, not a benchmark requirement (line 276-279).
- `docs/research/b16-release-readiness-evidence-2026-08-04.md`: summarized in §2c; explicitly states the sample "does not replace the full 500-case release-contract run" and lists unestablished items (full 500, 10k-turn throughput, stored-source parity, fresh-machine compose, LLM real-agent run). Honest.
- `docs/research/handoff-2026-08-04.md` + `.tmp-review/competitor-comparison.md`: code-level competitor analysis (mem0 fork, zep legacy, hindsight, mempalace at `/Users/rom.iluz/Dev/memongo-competitors/`); flags 3 fabricated/misrepresented external survey claims (Generative Agents "collapse" refuted, Voyager 15x misattributed, MemoryArena framing). No new Memongo numbers.
- `docs/handoff/2026-08-05-master-plan.md` + `2026-08-05-prebenchmark-builder-master.md`: restate the b16 sample metrics; no new measurements.

## 5. Bottom line

~~Memongo's public benchmark posture is *honest but hollow*~~ **SUPERSEDED 2026-08-13 (v4):** the correct formulation is *harness rigorous, public quantitative evidence incomplete*. Every quantitative claim in BENCHMARKS.md is UNSUPPORTED by public repo/release artifacts (admitted on its face); the durable measured evidence is two git-tracked n≤5 LongMemEval samples — the 850–3410 ms p95 figures and 63/500 partial run above are untracked local observations, not durable evidence. No completed 500-case run artifact was found in the audited repo, releases, or local result set. Methodology infrastructure (digest pinning, evaluator pinning, shipped-profile gates, licensing refusal) is genuinely best-in-class for the space — the missing piece is finished runs, not rigor.
