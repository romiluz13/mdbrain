# Final Capped Architecture Review — Service-Boundary Amendment v4

**Disposition: BLOCK**

## Correct

- The disposal table represents major script dependencies and prohibits local-engine fallback.
- Promotion has a durable identity rather than slug-based pseudo-idempotency.
- Production proof covers event idempotency, relay crashes, fencing, lost receipts, wiki replay, backup/restore, cross-database denial, transactions, ACL overflow/leakage, and gateway-only ingress.
- Flat wiki storage is conditional on globally namespaced server-minted workspace identity.
- Mutable-ACL connector content remains wiki-only under published Memongo v2.0.0.

## Blocker 1 — Production replay exhaustion has no terminal state

The development table is exact: pre-marker failures remain retryable; post-marker ambiguity becomes terminal `unknown` with no automatic replay.

The production table adds bounded same-key replay, but does not define the resulting state after repeated timeout, process/lease loss, repeated `IDEMPOTENCY_IN_PROGRESS`, or continued unavailability without receipt or conflict. Specify whether exhausted reconciliation becomes terminal unknown, dead-letter, or operator-recoverable, and give the production fixture an exact expected state.

## Blocker 2 — v5 §6.4 benchmark machinery lacks a supersession status

The v5 report’s §6.4 Memongo-side P1 list ends with benchmark machinery. The amendment’s supersession matrix classifies shared-client lifecycle, API/MCP contracts, batch writes, MCP extract, client retries, and temporal/reasoning/typed-edge governance, but omits benchmark machinery. The adjacent §6.5 row covers benchmark evidence publication, which is a different requirement.

Assign benchmark machinery exactly one status: binding, replaced, removed, deferred, or historical evidence only.

## Final disposition

**BLOCK.** The service boundary remains coherent, but the production state machine lacks an exhaustion terminal state and the supposedly complete supersession matrix omits v5 §6.4 benchmark machinery.
