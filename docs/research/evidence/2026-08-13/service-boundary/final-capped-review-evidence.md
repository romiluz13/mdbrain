# Final Capped Evidence Review — Service-Boundary Amendment v4

**Verdict: BLOCK**

**Scope:** `docs/research/2026-08-13-service-boundary-amendment.md` and retained service-boundary evidence.  
**Method:** Read-only absolute-path file reads/searches. No shell, Git, tests, or edits.

## Correct

- Published route and bridge arithmetic is sound: 43 published routes ↔ 43 client methods; 46 bridge exports = 43 route adapters + 3 local helpers; 38 retained after five cuts.
- Raw-lane redispatch language was substantially corrected to pre-marker retry only and post-marker terminal `unknown`.
- Lane D distribution language is bounded: source-build compose is rejected/non-production; production requires an independently published artifact.
- The disposal table includes `real-capability-stress`, `memory-eval-core`, `mdbrain-init`, and `mdbrain-migrate`.

## Blocker 1 — Two npm captures lack the claimed identity/provenance

The amendment claims complete captures for all six packages with uniform `gitHead`, but these captures contain only dist-tags, versions, and timestamps:

- `docs/research/evidence/2026-08-13/service-boundary/npm-memongo-memory-engine-2026-08-13.json`
- `docs/research/evidence/2026-08-13/service-boundary/npm-memongo-memory-bridge-2026-08-13.json`

Neither includes `name`, top-level `version`, `gitHead`, integrity, attestation, or provenance. Uniform provenance is proven only for lib, memory, client, and tools. Narrow the claim or replace both captures with complete npm metadata.

## Blocker 2 — Lane A raw inventory remains false

`laneA-contract-matrix.md` still claims:

- only two runtime engine importers;
- no `ingestToKB` call;
- deletion requires only three adapter items;
- the wiki handle is the only runtime dependency outside bridge/re-export framing.

Contradicting source:

- `scripts/real-capability-stress.ts` imports `@mdbrain/memory-engine` and relative engine modules and calls `ingestToKB`.
- `scripts/memory-eval-core.ts` imports engine-owned fixtures.
- `scripts/prepare-mongodb-runtime.ts` and `scripts/check-mongodb-runtime-parity.ts` import engine schema code.
- `scripts/mdbrain-init.ts` and `scripts/mdbrain-migrate.ts` consume the engine-backed manager helper.

The amendment recognizes these dependencies, making Lane A internally inconsistent. It also leaves `stress-test.ts` “to be confirmed HTTP-only” despite its visible `@mdbrain/client` transport.

## Blocker 3 — `/extract` has contradictory tenant classification

The amendment says the tenant write surface is limited to `/write-event`, keyed structured/procedure writes, and governed lifecycle operations, while H6 enables `/extract` as a tenant write. `/extract` is a mutating async POST returning 202. Decide whether it is tenant-facing or internal/control-plane and make §7.2/H6 agree.

## Blocker 4 — Lane E promises impossible event compensation

Lane E says lifecycle invalidation is the published “un-write” mechanism for duplicate event promotion and uses `invalidatedBy` as event compensation. The tagged route accepts only structured/procedure handles. The amendment correctly says v2 events cannot be invalidated/deleted. Correct Lane E so compensation applies only to structured/procedure items.

## Final disposition

**BLOCK.** Route arithmetic, single-dispatch language, and bounded distribution claims are correct. Evidence remains inconsistent because two npm captures lack provenance, Lane A retains false disposal claims, `/extract` classification conflicts, and Lane E promises unsupported event compensation.
