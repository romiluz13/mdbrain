# Mdbrain / Memongo Service-Boundary Handoff

**Date:** 2026-08-13  
**Repository:** `mdbrain`  
**Workflow run:** `0eefcd9d-de9a-45da-8bb4-d3f3f861f3f8`  
**Workflow outcome:** **FAILED SAFELY in PLAN** after the user-mandated three-failure cap.  
**Build status:** **NOT STARTED. No product code was changed.**

## Resume here

After restarting:

1. Open a new Pi session in the `mdbrain` repository.
2. Read this handoff completely.
3. Read `docs/research/2026-08-13-service-boundary-amendment.md`.
4. Read the three final capped review reports:
   - `docs/research/evidence/2026-08-13/service-boundary/final-capped-review-evidence.md`
   - `docs/research/evidence/2026-08-13/service-boundary/final-capped-review-architecture.md`
   - `docs/research/evidence/2026-08-13/service-boundary/final-capped-review-security.md`
5. Inspect the durable failed workflow with `/workflow status` if desired. The run is terminally failed; continuing implementation requires a new planning goal.
6. Do **not** resume remediation automatically. The user imposed a hard three-failure cap. Only continue if the user explicitly starts a new goal or resets that cap.

## Executive summary

The session began by comparing current Memongo with Mdbrain, current Google Cloud Open Knowledge Format v0.2, and company-brain/wiki competitors. The first recommendation was for Mdbrain to consume Memongo packages. The user corrected that assumption: **Memongo and Mdbrain must remain separate projects, and Mdbrain work must not modify Memongo source.**

The architecture was therefore changed to a strict service boundary:

```text
Mdbrain gateway/orchestrator ── authenticated HTTP ──▶ independently deployed Memongo
       │
       └── Mdbrain-owned wiki, governance, connectors, identity, orchestration, and UX
```

The service-boundary thesis survived all adversarial challenges. Security review reached CLEAN. Final approval did not pass before the retry cap because the durable evidence package and two architecture details remained inconsistent.

## Binding decisions

1. **Separate projects and runtimes.** Mdbrain consumes Memongo only through its published HTTP wire contract. No Memongo source changes are authorized by this work.
2. **No local engine fallback.** The long-term design deletes Mdbrain’s copied memory engine rather than maintaining another fork.
3. **No compatibility layer.** Mdbrain has no production users, so the transition is a clean break.
4. **Clean-slate default.** There is no production data to preserve. Legacy local data is archived/dropped unless the user later requests a contingency migration.
5. **OKF is P0.** Mdbrain keeps OKF first-class and must meet pinned v0.2 producer/consumer conformance, path safety, and conformance-fixture gates.
6. **Atomic wiki revisions.** Wiki page mutation, revision record, and local outbox state must commit atomically. Production requires transaction-capable MongoDB; no standalone best-effort fallback.
7. **First production connectors:** GitHub + Slack, with source-ACL preservation, revocation, deletion, and fail-closed identity mapping.
8. **Product model:** fully self-hostable OSS core plus an optional managed control plane for connector operations, identity/ACL synchronization, observability, upgrades, and onboarding.
9. **Mutable-ACL connector content stays wiki-only** under published Memongo v2.0.0 because raw events cannot be invalidated/deleted through the published lifecycle API.
10. **Gateway-only promotion.** Every memory write eligible for company-wiki promotion must pass through the Mdbrain gateway/outbox. Direct Memongo writes are memory-only and cannot be guaranteed to enter the wiki.
11. **Retry cap:** maximum three failed attempts per gate. The final capped review remained blocked, so work stopped.
12. **No publication authority.** Nothing may be pushed, published to npm, or released without explicit user approval.

## Durable research artifacts

### Main research

- `docs/research/2026-08-13-memongo-absorb-company-brain.md`
  - Evidence-backed Memongo/Mdbrain/OKF/company-brain analysis.
  - Its original package-dependency recommendation is explicitly marked superseded.
- `docs/research/2026-08-13-service-boundary-amendment.md`
  - Current service-boundary design, version 4 draft.
  - Security is clean; evidence and architecture still have blockers.

### Main evidence

- `docs/research/evidence/2026-08-13/`
  - Memongo/Mdbrain divergence inventory.
  - OKF v0.2 research.
  - Benchmark evidence audit.
  - Company-brain competitor research.
  - Deterministic Git-tree drift generator and output.
- `docs/research/evidence/2026-08-13/service-boundary/`
  - Published Memongo v2.0.0 source captures.
  - Contract, identity, retrieval/failure, topology, and consistency lanes.
  - npm and registry captures.
  - Final capped review reports.

## What the research established

### Memongo strengths

Memongo has a strong MongoDB-native memory architecture:

- vector, text, graph, episodic, procedural, KB, and temporal retrieval;
- auto-embedding, rank/score fusion, reranking, and graph traversal;
- tenant isolation, durable jobs, capability detection, bitemporal validity, reasoning, and idempotency work on newer local code;
- a disciplined benchmark harness with pinned datasets and evaluator identities.

### Memongo gaps found

Memongo is strong but not perfect as a framework/service:

- public benchmark numbers lack immutable published raw artifacts;
- npm latest is `2.0.0`, local manifests are `2.0.1`, and public `v2.1.x` tags lack corresponding npm/GitHub releases;
- manager startup performs schema/index mutation rather than an explicit inspect/plan/approve/apply/verify migration lifecycle;
- the bridge imports an internal engine surface scheduled for removal;
- published v2.0.0 lacks event idempotency, exact event reconciliation, deep readiness, client deadlines, and an independently published runnable API artifact;
- published event receipts cannot be invalidated/deleted;
- the public service has no generic change feed or exact event-fetch API.

### Published v2.0.0 versus local HEAD

- Published v2.0.0: 43 HTTP routes ↔ 43 client methods.
- Local unpublished HEAD adds idempotent event writes, batch writes, readiness, timeouts, a version echo, and a Dockerfile, but removes two benchmark routes.
- Mdbrain must not depend on HEAD-only behavior.

### Service-boundary design that survived

- Mdbrain uses an Mdbrain-owned direct `fetch` transport over Memongo’s published wire contract, with real abort signals, runtime response validation, and per-operation retry policy.
- Ordinary tenant traffic uses constrained scoped credentials; root/admin credentials are isolated to a private control-plane path.
- Composite retrieval uses one `/search-detailed` request per permitted immutable-audience partition plus one local wiki search, bounded fanout, RRF, proven-lineage deduplication, governance, and explicit complete/partial/degraded states.
- Production remains blocked until an independently published Memongo artifact provides exact event idempotency/replay, meaningful readiness, signed provenance, and a verifiable contract.
- OSS Mdbrain currently accepts an externally supplied `MEMONGO_API_URL`; no supported integrated production distribution exists yet.

## Final capped review result

### Security/product: CLEAN

Confirmed:

- mutable-ACL connector content remains outside Memongo events;
- database cross-denial includes data, collection, index, schema, database, user, and role administration;
- `/extract` has a conditional policy;
- all mutators have explicit exposure/retry policy;
- production idempotency, admin isolation, signed artifact, and integrated readiness requirements are coherent.

Full report: `docs/research/evidence/2026-08-13/service-boundary/final-capped-review-security.md`.

### Evidence: BLOCK

Open blockers:

1. `npm-memongo-memory-engine-2026-08-13.json` and `npm-memongo-memory-bridge-2026-08-13.json` do not contain the identity/provenance fields claimed for all six packages.
2. Lane A still contains false disposal assertions about engine importers, `ingestToKB`, and the number of required adapter changes.
3. `/extract` is classified inconsistently between the exhaustive tenant-write surface and H6.
4. Lane E still claims lifecycle compensation for raw events, but v2 lifecycle deletion supports only structured/procedure handles.

Full report: `docs/research/evidence/2026-08-13/service-boundary/final-capped-review-evidence.md`.

### Architecture: BLOCK

Open blockers:

1. The production state machine does not specify the terminal state after bounded same-key reconciliation exhausts without receipt or stable conflict.
2. The supposedly complete v5 supersession matrix omits an explicit status for v5 §6.4 benchmark machinery.

Full report: `docs/research/evidence/2026-08-13/service-boundary/final-capped-review-architecture.md`.

## Open human decisions deferred by the stop

These were intentionally not asked because the amendment did not reach CLEAN:

1. **Topology:** one physical cluster/two logical databases versus two clusters; flat shared wiki prefix under globally namespaced `scopeRef` versus per-agent wiki prefixes.
2. **Development timing:** integrate against published v2.0.0 with weak single-dispatch semantics now, or wait for the minimum production contract.
3. **Separate Memongo task:** whether to open an independent Memongo hardening/release effort later. This Mdbrain work does not authorize it.
4. **OSS distribution:** externally supplied Memongo URL versus waiting for an independently published runnable artifact.
5. **Route cuts:** final confirmation of public, control-plane-only, and removed Memongo proxy routes.
6. **Local data:** whether any development-only legacy data should be preserved despite the clean-slate default.

## Exact workflow failure

The plan workflow never advanced to `PLAN_READY` and never entered BUILD.

```text
Workflow 0eefcd9d-de9a-45da-8bb4-d3f3f861f3f8 failed safely.
```

Submitted failure reason:

```text
User-mandated three-failure cap reached. Final capped review remained BLOCKED on evidence consistency/provenance and two architecture exactness gaps; security review was CLEAN. Stop without further remediation or build.
```

Earlier stale-token diagnostic encountered while creating evidence:

```text
Stale workflow state: expected 0eefcd9d-de9a-45da-8bb4-d3f3f861f3f8/plan/0/2eddba6c2411ec00fab69d02d7e6903e9ee4db12dc3a90dc4870049b8c5e020f
```

Reviewer quarantine diagnostic encountered and worked around by running fresh read-only reviewers from `/tmp`:

```text
ls failed (exit 1): Workflow quarantine: Active workflow 0eefcd9d-de9a-45da-8bb4-d3f3f861f3f8 already owns this repository (pid 83270)
```

## Repository state

- No product source files were intentionally modified.
- No build was started.
- No tests for product changes were run because there were no product changes.
- No commit, push, npm publish, GitHub release, or PR was created.
- Research and handoff documents under `docs/research/` and `docs/handoff/` are uncommitted.
- `docs/2026-07-23-mem0-agent-wiki-article-analysis.md` was pre-existing and untouched.
- `.pi/` may contain transient untracked subagent artifacts and can be removed by a future session after verifying no needed evidence exists only there.

## Recommended next session behavior

Because the user’s retry cap was reached, do not silently apply the six remaining fixes. Ask the user whether to:

1. keep the stop and treat the research as advisory; or
2. reset the cap and start a new PLAN goal limited to the six final blockers.

If the user resets the cap, resolve only those six blockers, rerun one fresh three-axis review, then create the accepted spec and dependency-ordered tickets. Do not start BUILD before `PLAN_READY` is satisfied.
