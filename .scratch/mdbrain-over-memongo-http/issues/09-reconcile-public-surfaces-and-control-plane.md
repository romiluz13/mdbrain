# 09 — Reconcile public surfaces and isolate the control plane

**What to build:** Every retained MDBrain operation has an intentional, tested REST/client/MCP/AI-tool/OpenAPI disposition, while Memongo administration and server-local operations are unreachable through tenant credentials.

**Blocked by:** 05 — Harden connectors, export paths, and OKF; 06 — Expand the bridge with versioned HTTP retrieval; 07 — Migrate writes and lifecycle operations with idempotency.

**Status:** ready-for-agent

- [ ] Generate parity checks from one operation registry covering REST, typed client, MCP, AI tools, and OpenAPI.
- [ ] Add missing scope-reference, extraction, wiki delete, and wiki revision list/detail behavior where the accepted matrix retains it.
- [ ] Remove tenant pass-throughs for admin, benchmark, server-local import/read, sync, probes, jobs, traces, consolidation, novelty, and self-edit.
- [ ] Replace the no-op wiki maintenance success response with a durable private job or an explicit unsupported result.
- [ ] Prove tenant credentials cannot select control-plane credentials or widen scope.
