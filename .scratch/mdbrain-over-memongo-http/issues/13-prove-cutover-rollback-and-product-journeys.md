# 13 — Prove cutover, rollback, and complete product journeys

**What to build:** A release candidate demonstrates live, secure, recoverable MDBrain behavior across Memongo HTTP and MDBrain wiki MongoDB, with a rehearsed no-dual-write rollout and rollback plan.

**Blocked by:** 05 — Harden connectors, export paths, and OKF; 08 — Deliver and promote only from confirmed receipts; 10 — Harden the API, readiness, and runtime topology; 11 — Migrate packages, scripts, and release gates; 12 — Contract and delete the copied memory engine.

**Status:** ready-for-agent

- [ ] Pass all unit, integration, non-web and web type, lint, package, live MongoDB transaction, live Memongo contract, security, and failure-injection checks.
- [ ] Pass end-to-end ingest, retrieve, promote, cite, revise, soft/hard delete authorization, export, backup/restore, and reconciliation journeys.
- [ ] Rehearse dark deployment, canary enable/disable, promotion pause, gateway rollback, and independent data restore without dual write.
- [ ] Produce a proof matrix linking every specification gate to exact command output and artifact.
- [ ] Update business, technical, operator, compatibility, and audit documentation without claiming unsupported connectors, OKF conformance, or production readiness.
