# 08 — Deliver and promote only from confirmed receipts

**What to build:** Explicit memory-to-wiki promotion survives crashes and retries without duplicate page mutations or false lineage, using a durable MDBrain intent and a confirmed Memongo receipt.

**Blocked by:** 04 — Authorize and atomically audit wiki mutations; 07 — Migrate writes and lifecycle operations with idempotency.

**Status:** ready-for-agent

- [ ] Persist operation identity, payload fingerprint, principal/scope, and promotion policy before network delivery.
- [ ] Implement recorded, delivering, retryable, outcome-unknown, confirmed, promotion-pending, promoted, conflict, and dead-letter states with bounded transitions.
- [ ] Reconcile ambiguous outcomes with the same idempotency key and fingerprint before promotion.
- [ ] Commit promotion identity, page/revision state, and wiki lineage atomically.
- [ ] Return existing results for exact replay and reject key reuse with a different fingerprint.
- [ ] Pass crash/failpoint tests proving no duplicate mutation, no false lineage, and visible unknown/dead-letter states.
