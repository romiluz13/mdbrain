# 07 — Migrate writes and lifecycle operations with idempotency

**What to build:** MDBrain users can add events, batch events, extract, write structured memories/procedures, update lifecycle, and submit feedback through Memongo HTTP with safe retries and explicit outcomes.

**Blocked by:** 06 — Expand the bridge with versioned HTTP retrieval.

**Status:** ready-for-agent

- [ ] Propagate server-derived agent, scope, scope reference, timestamp, metadata, and operation identity across every retained write surface.
- [ ] Require stable idempotency keys and payload fingerprints for write and batch delivery.
- [ ] Retry only operations whose selected contract proves safe; preserve rate-limit timing and caller cancellation.
- [ ] Report `not-applied`, `applied`, or `unknown` outcomes and never infer success from an ambiguous timeout.
- [ ] Pass replay, payload-conflict, malformed-response, 429, unavailable, 503, known-timeout, and ambiguous-timeout contract tests.
