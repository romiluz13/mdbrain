# 03 — Give wiki storage independent ownership and transactions

**What to build:** MDBrain's wiki starts, migrates, reports readiness, performs transactions, and shuts down through its own MongoDB lifecycle without obtaining a database handle from any memory manager.

**Blocked by:** 01 — Lock the Memongo contract and prove the in-place refactor.

**Status:** ready-for-agent

- [ ] Resolve only MDBrain-owned wiki MongoDB configuration and own one deterministic process lifecycle.
- [ ] Initialize and verify only wiki collections and indexes.
- [ ] Expose session propagation and transaction execution to wiki business operations.
- [ ] Require a live transaction-capable readiness probe in production.
- [ ] Repoint API, initialization, migration, preflight, and parity behavior to the wiki store.
- [ ] Pass wiki tests and live replica-set smoke tests with no local memory manager.
