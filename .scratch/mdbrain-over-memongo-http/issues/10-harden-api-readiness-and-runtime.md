# 10 — Harden the API, readiness, and runtime topology

**What to build:** MDBrain starts and serves traffic only when its wiki transaction path and required Memongo contract/lanes are ready, and its HTTP/runtime defaults are safe for local and production use.

**Blocked by:** 03 — Give wiki storage independent ownership and transactions; 06 — Expand the bridge with versioned HTTP retrieval; 09 — Reconcile public surfaces and isolate the control plane.

**Status:** ready-for-agent

- [ ] Add request IDs, secure headers, bounded request bodies, fail-closed CORS defaults, sanitized errors, and redacted structured telemetry.
- [ ] Compose readiness from wiki ping, live wiki transaction, accepted Memongo version/digest, and required upstream capabilities.
- [ ] Test TLS certificate, hostname, redirect, timeout, malformed response, and incompatible-version failures.
- [ ] Pin container inputs, bind local ports to loopback, remove default passwords, generate credentials, and initialize replica-set/transactions explicitly.
- [ ] Document and test independent database credentials, backup ownership, and restore/reconciliation behavior.
