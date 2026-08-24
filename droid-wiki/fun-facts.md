# Fun facts

These facts are measured from the 54 commits and tracked files on `origin/main` through 2026-08-23. Counts describe that Git snapshot, not untracked workspace files.

## The name took a detour

The imported repository was named Memongo on 2026-07-08. On 2026-07-09, commit `b177c8e` changed the product and package namespace to MBrain and `@mbrain/*`. Later that day, commit `f0674dd` intended to rename MBrain to MDBrain but left the transposed spelling `mdbrian` across 658 exact text matches and paths such as `packages/mdbrian-memory/`. Commit `483cf3a` corrected `mdbrian` to `mdbrain` on 2026-07-12.

That makes the supported chronology Memongo → MBrain → the accidental `mdbrian` spelling → MDBrain. The shorter `mdbrian` → `mdbrain` repair is still visible through Git rename detection.

## The largest tracked source is historical evidence

Counting lines in every tracked `.ts`, `.tsx`, `.js`, `.mjs`, and `.cjs` blob, the largest files are:

1. `docs/research/evidence/2026-08-13/service-boundary/openapi-spec-v200.ts` at 2,803 lines.
2. `apps/api/src/app.test.ts` at 2,681 lines.
3. `apps/api/src/routes/v1.ts` at 2,502 lines.
4. `apps/api/src/openapi-spec.ts` at 2,337 lines.
5. `docs/research/evidence/2026-08-13/service-boundary/laneC-v1-v200.ts` and `docs/research/evidence/2026-08-13/service-boundary/v1-v200.ts`, tied at 2,221 lines each.

The first entry is a captured service-boundary artifact, not live runtime code. Among current non-test application and package sources, `apps/api/src/routes/v1.ts`, `apps/api/src/openapi-spec.ts`, and `apps/mcp/src/server.ts` are the three largest at 2,502, 2,337, and 1,571 lines.

## Some 2026-07-08 code is unchanged

Several current source blobs are byte-for-byte identical to the initial import. The surviving shared-library set includes `packages/lib/src/concurrency.ts`, `packages/lib/src/env.ts`, `packages/lib/src/errors.ts`, `packages/lib/src/mime.ts`, `packages/lib/src/retry.ts`, `packages/lib/src/secrets.ts`, and `packages/lib/src/types.memory.ts`.

Other foundational paths, including `apps/api/src/app.ts`, `apps/api/src/routes/v1.ts`, `apps/mcp/src/server.ts`, `packages/client/src/client.ts`, `packages/tools/src/index.ts`, and `packages/memory-bridge/src/memory-config.ts`, also date to 2026-07-08, but their contents have evolved.

## There are no uppercase debt markers

An exact search of tracked text files finds zero `TODO` markers and zero `FIXME` markers. A case-insensitive search finds six uses of `todo` or `todos`, but all six are domain vocabulary in memory categories, client types, research evidence, or a test fixture rather than code-debt annotations.

## The biggest deletion was an architectural boundary

The 2026-08-19 Memongo HTTP cutover deleted 200 files from `packages/memory-engine/`. In the same commit, `packages/memory-bridge/` grew from 10 tracked files to 22. The repository therefore became smaller while acquiring a stricter service contract and a clearer ownership boundary.

## One day accounts for ten commits

The busiest date in the recorded history is 2026-07-30, with ten commits. That single day added wiki revisions and transclusion, adopted OKF 0.2 vocabulary, hardened imports and exports, expanded MCP maintenance tools, and applied several memory-engine fixes shortly before the engine was removed from the repository.

For how these facts map to the current runtime, read [`overview/architecture.md`](overview/architecture.md). The dated narrative is in the companion background page, [`lore.md`](lore.md).
