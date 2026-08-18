# 12 — Contract and delete the copied memory engine

**What to build:** MDBrain has one memory implementation—the versioned Memongo HTTP gateway—and no production package, script, test helper, documentation claim, or wiki path can instantiate or fall back to the copied engine.

**Blocked by:** 08 — Deliver and promote only from confirmed receipts; 09 — Reconcile public surfaces and isolate the control plane; 10 — Harden the API, readiness, and runtime topology; 11 — Migrate packages, scripts, and release gates to public seams.

**Status:** ready-for-agent

- [ ] Re-run and archive the clean-slate inventory immediately before contraction; stop if production or unknown data appears.
- [ ] Remove the copied engine package, dependencies, re-exports, package tests, relative source imports, and manager-derived wiki handle.
- [ ] Prove zero production references to the removed package/source and zero fallback behavior.
- [ ] Pass the regenerated workspace dependency graph, lockfile, package builds, tests, types, and lint after deletion.
- [ ] Preserve historical documentation only when clearly labeled as historical/superseded.
