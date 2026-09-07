# Mdbrain benchmark operating contract

Mdbrain benchmark work has one rule: **numbers are product claims only when the
run proves the product path being claimed**. Internal diagnostics are valuable,
but they must not be presented as official benchmark wins.

## Benchmark lanes

| Lane | Purpose | Required trigger | Publishable? |
| --- | --- | --- | --- |
| Official retrieval | LongMemEval / LoCoMo retrieval quality | release candidate, retrieval algorithm changes, benchmark corpus changes | Yes, when dataset, build, MongoDB topology, embeddings, and command are recorded |
| Diagnostic retrieval | Fast regression signal over legacy or custom query sets | every retrieval/search/scoring change | No, unless labeled as non-comparable diagnostics |
| Conversation recall regression | Protect user-visible recall behavior | conversation recall, event schema, session/time filter, citation, or recall-plane changes | No, regression gate only |
| Query governance | Surface candidate MongoDB query-shape settings | benchmark or operator query review | Advisory only |
| Proof pack | Confirm build, tests, and live smoke readiness | release candidate | Yes, as release evidence |

## Required commands

Use the narrowest relevant lane while developing, then run the full gate before
release.

```bash
bun run check-types
bun run test
bun run build
```

Run `bun run build` after source edits and before starting a local API-backed
canary. The API loads workspace packages through their built `dist` entrypoints,
so a stale build can hide or invent benchmark behavior.

Benchmark and evaluation scripts are human-run evidence tools. Choose the
existing script that matches the work and record its prerequisites and output:

```bash
bun run proof-pack
bun run memory-eval
bun run compare-memory-eval
bun run agent-smoke
```

## Publishable benchmark claims

A claim may be published only when all are true:

1. The selected script and its output demonstrate the retrieval lane being
   claimed.
2. The complete dataset is scored; partial or missing case coverage is a
   warning, not a publishable official win.
3. The commit/build id, dataset name/version, MongoDB topology, embedding model,
   and benchmark command are recorded.
4. Warnings and degradations are reviewed and disclosed when material.
5. A conversation recall regression is recorded for any recall-plane change.

Legacy or custom query-set results are internal diagnostics unless they are
clearly labeled as non-comparable.

## Query governance policy

Benchmark output may recommend query-shape governance candidates, but it must
not apply MongoDB query settings automatically.

MongoDB query settings are cluster-scoped and persistent. Treat any
`consider-setQuerySettings` candidate as an operator review item:

1. Inspect query stats and explain output.
2. Apply the setting manually in the intended environment.
3. Record the setting and rollback command.
4. Remove it with `removeQuerySettings` if it degrades behavior.

Query-governance recommendations remain advisory-only.

## PR and release delta recording

For every benchmark-affecting PR or release candidate, record:

- base commit and candidate commit
- commands run
- dataset and corpus version
- raw script output and generated artifact paths
- deltas for `hitRate`, `emptyRate`, `p95LatencyMs`, `rAt5`, `rAt10`,
  `ndcgAt10`
- any warnings, degradations, or skipped cases

Do not compare numbers from different corpora, embedding models, or MongoDB
topologies without labeling the comparison as non-equivalent.
