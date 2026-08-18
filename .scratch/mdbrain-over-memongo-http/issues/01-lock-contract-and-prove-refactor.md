# 01 — Lock the Memongo contract and prove the in-place refactor

**What to build:** A reproducible compatibility baseline for Memongo API 2.0.1, plus a bounded tracer prototype showing that MDBrain can perform one retrieval, one idempotent write, and one independent wiki transaction without retaining memory-engine internals. Record a read-only inventory proving whether clean-slate cutover remains safe.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Record the exact deployed Memongo artifact, advertised API version, generated OpenAPI SHA-256 digest, and success/error fixtures for `search` and `write-event`.
- [ ] Prove production HTTPS, hostname validation, redirect, credential-class, scope, idempotency, replay, conflict, and ambiguous-timeout semantics for the selected artifact.
- [ ] Run the bounded prototype and report representative API, MCP, client, wiki, and package test retention against the specification thresholds.
- [ ] Stop for explicit approval before any greenfield work if the existing-repository thresholds are falsified.
- [ ] Record a read-only old-engine data, active-client, job, and deployment inventory; stop for a production-data decision if any result is production or unknown.
- [ ] Produce the generated route/contract manifest that later tickets consume.
