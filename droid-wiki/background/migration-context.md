# Migration context

MDBrain moved from a copied local memory engine to a strict Memongo HTTP boundary in August 2026. The migration preserved the wiki and product shell while deleting the source fork that had begun to diverge from Memongo.

## Before the migration

The July 8 wiki design made `wiki_pages` the product center but kept a local `@mdbrain/memory-engine`. The bridge constructed a local memory manager, the wiki engine duck-typed that manager to obtain a MongoDB handle, and the API obtained wiki storage through the bridge.

This coupling created three ownership problems:

1. MDBrain and Memongo both contained memory-engine code that could evolve differently.
2. Starting the memory manager could initialize wiki schema as a side effect.
3. Applications could not distinguish wiki storage failures from memory dependency failures cleanly.

The copied engine also lagged newer Memongo durability, job execution, retrieval, configuration, and operational work. Repeated source copying would have preserved the divergence rather than removed it.

## Decision sequence

### August 13: service boundary selected

The first investigation considered consuming Memongo packages. The user rejected that direction and required separate products and repositories. The resulting handoff established authenticated HTTP as the only memory boundary and ruled out source imports, collection sharing, dual writes, and a local fallback.

That planning run stopped safely after its review retry cap. Its unresolved evidence details were not treated as approval to implement. See [`docs/handoff/2026-08-13-mdbrain-memongo-service-boundary-handoff.md`](../../docs/handoff/2026-08-13-mdbrain-memongo-service-boundary-handoff.md).

### August 14–16: refactor approved and specified

The August 14 handoff approved an in-place refactor rather than a greenfield repository. The narrow choice favored the existing repository because its wiki engine, API, MCP server, client, tools, and web console were substantial working product code.

The accepted August 16 specification fixed the first supported upstream baseline at Memongo API `2.0.1` and audited commit `2398cf13902aa2f66deb6c38a28579c90746da8b`. Compatibility required both the semantic version and the canonical OpenAPI digest.

The migration plan also chose a clean-slate cutover based on the recorded absence of production users and data. That historical assumption was a deletion gate, not a reusable permission to discard data in another environment.

Sources:

- [`docs/handoff/2026-08-14-mdbrain-refactor-over-memongo-http.md`](../../docs/handoff/2026-08-14-mdbrain-refactor-over-memongo-http.md)
- [`docs/specs/2026-08-16-mdbrain-refactor-over-memongo-http.md`](../../docs/specs/2026-08-16-mdbrain-refactor-over-memongo-http.md)

### August 19: source cutover landed

Commit `09ca531` (`refactor(memory): move runtime behind Memongo HTTP (#32)`) landed the governed HTTP cutover. It removed `packages/memory-engine`, added the typed Memongo client and gateway, gave the wiki its own store, added principal and capability handling, introduced durable delivery records, reconciled product surfaces, and hardened readiness and release checks.

This repository now treats the migration as completed source architecture, not as an active dual-running phase.

## Before and after

| Concern | Before | After |
| --- | --- | --- |
| Memory runtime | Copied `packages/memory-engine` inside MDBrain | Independently deployed Memongo |
| Memory integration | Local manager and package calls | Versioned authenticated HTTP |
| Wiki database handle | Derived from the memory manager | Owned by `WikiStore` |
| Schema lifecycle | Memory startup could initialize wiki schema | Each product initializes only its own database |
| Failure behavior | Local coupling could obscure dependency boundaries | Memongo failures are explicit and typed |
| Compatibility | Source-level drift | Version plus OpenAPI digest |
| Retry safety | Mixed local call semantics | Per-operation policy and idempotency metadata |
| Promotion | Could be coupled to an in-process write | Confirmed receipt followed by transactional wiki promotion |
| Fallback | Copied engine remained available | No local memory-engine fallback |

## Current ownership map

[`packages/memory-bridge/src/memongo-http-client.ts`](../../packages/memory-bridge/src/memongo-http-client.ts) owns transport security, deadlines, credentials, contract checks, and sanitized failures. [`packages/memory-bridge/src/memongo-memory-gateway.ts`](../../packages/memory-bridge/src/memongo-memory-gateway.ts) exposes typed memory operations and readiness. [`packages/memory-bridge/src/mdbrain-bridge.ts`](../../packages/memory-bridge/src/mdbrain-bridge.ts) preserves the MDBrain-facing facade.

[`packages/wiki-engine/src/wiki-store.ts`](../../packages/wiki-engine/src/wiki-store.ts) owns wiki connections and transactions. [`packages/wiki-engine/src/wiki-schema.ts`](../../packages/wiki-engine/src/wiki-schema.ts) owns wiki collections and indexes. [`apps/api/src/memory-delivery-runtime.ts`](../../apps/api/src/memory-delivery-runtime.ts) coordinates durable memory dispatch and receipt-based wiki promotion.

The convenience package [`packages/mdbrain-memory/src/index.ts`](../../packages/mdbrain-memory/src/index.ts) re-exports the remote client and bridge surfaces. It does not restore direct engine access.

## Rules for future migration work

- Treat old documents that recommend Memongo package coupling as superseded.
- Reconfirm data ownership before any destructive migration; the 2026 clean-slate assumption is historical.
- Upgrade the Memongo contract by capturing and reviewing a new OpenAPI artifact, not by changing only the version string.
- Keep MDBrain and Memongo backups and restores independent. Reconcile cross-product references through receipts rather than shared database snapshots.
- Do not reintroduce a copied engine for rollback. Roll back to a known-good HTTP-gateway release while leaving Memongo data intact.
- Historical references to `packages/memory-engine` explain the migration; current production code must not depend on that path.

See [Design decisions](design-decisions.md) for the enduring architecture and [Pitfalls](pitfalls.md) for the invariants that protect it.
