# Design decisions

MDBrain's architecture follows a few boundaries that are more important than individual classes or routes. Changes should preserve these decisions unless a new design explicitly replaces them.

## Keep wiki and memory ownership separate

MDBrain owns the company-wiki domain. Memongo owns long-term memory. The integration boundary is the typed HTTP gateway under `packages/memory-bridge/src/`, not source imports, shared collections, or a shared schema initializer.

This separation exists because the two products answer different questions:

- Memory records what happened and makes raw and consolidated memory retrievable.
- The wiki turns evidence into governed, revisable, linked pages for people and agents.
- Memory delivery can succeed without requesting wiki promotion.
- Wiki promotion requires a confirmed memory receipt so its lineage refers to a durable upstream event.

The boundary also removes the maintenance cost of keeping a copied memory engine aligned with Memongo. MDBrain can preserve its wiki behavior while Memongo evolves its own retrieval, durability, migrations, and operations.

The boundary is intentionally strict:

- `@mdbrain/wiki-engine` owns wiki data and transactions.
- `@mdbrain/memory-bridge` owns the Memongo wire contract and credentials.
- MDBrain does not import Memongo packages or access Memongo collections.
- Memongo outages do not trigger a local-engine fallback.
- Local deployments may share a physical cluster, but the products use separate logical databases and least-privilege principals.

## Pin the HTTP contract, not only a version label

The first supported Memongo contract is version `2.0.1`. [`packages/memory-bridge/src/memongo-runtime.ts`](../../packages/memory-bridge/src/memongo-runtime.ts) also pins the canonical OpenAPI SHA-256 digest. A service that reports the expected version but serves a different contract is incompatible.

[`packages/memory-bridge/src/memongo-operation-policy.ts`](../../packages/memory-bridge/src/memongo-operation-policy.ts) centralizes each retained operation's method, path, credential lane, idempotency mode, and retry class. [`packages/memory-bridge/src/memongo-gateway-contract.ts`](../../packages/memory-bridge/src/memongo-gateway-contract.ts) validates responses before they enter MDBrain. This keeps route drift local to one adapter and prevents callers from gaining a generic authenticated proxy to Memongo.

Tenant and control-plane credentials remain distinct. Production transport requires HTTPS; loopback HTTP requires an explicit development opt-in.

## Use MongoDB for the wiki document and its retrieval graph

A wiki page naturally contains nested claims, evidence, questions, permissions, relationships, backlinks, and revision metadata. MongoDB stores that aggregate as one document while enforcing `$jsonSchema` validation and scoped indexes.

The wiki store also needs an atomic boundary around page mutation, revision history, and local delivery or mutation records. [`packages/wiki-engine/src/wiki-store.ts`](../../packages/wiki-engine/src/wiki-store.ts) owns the process-scoped client and transaction sessions, while [`packages/wiki-engine/src/wiki-schema.ts`](../../packages/wiki-engine/src/wiki-schema.ts) owns only MDBrain collections and indexes.

Atlas Search or Atlas Local adds the retrieval stages used by the wiki:

- `$vectorSearch` finds semantic matches over the page `text` field.
- `$search` finds lexical matches across titles, summaries, bodies, aliases, and tags.
- `$rankFusion` combines vector and text candidates.
- `$rerank` can reorder a bounded candidate set where supported.
- `$graphLookup` expands relationships from the retrieved seed pages.

Keeping page content, graph links, governance metadata, and search fields in MongoDB avoids a separate vector-store synchronization path. Plain MongoDB can still hold validated wiki documents and standard indexes, but the Atlas Search stages require Atlas Search or `mongot`.

The current storage and search details are documented in [Schema and storage](../packages/wiki-engine/schema-and-storage.md) and [Search and governance](../packages/wiki-engine/search-and-governance.md).

## Govern reads before and after expansion

Authorization comes from the server-derived principal in [`apps/api/src/principal.ts`](../../apps/api/src/principal.ts). Request fields may narrow the principal's authority; they must not add roles, groups, trust, scope, or capabilities.

A governed search follows this order:

1. Build exact `scope` and `scopeRef` filters plus indexed page filters.
2. Retrieve vector and text candidates.
3. Fuse and optionally rerank the bounded candidate set.
4. Apply subject, group, role, department, privacy, and trust rules to materialized pages.
5. Expand relationships only within the same scope.
6. Apply governance again to graph-expanded pages before returning them.

Direct reads, revisions, transclusion, contradiction lookup, lint, and export need equivalent checks. Filtering only at the API edge is insufficient because an internal expansion can introduce a page that was not in the original result set.

## Preserve write and audit ordering

Wiki mutation begins with a governed target lookup and capability checks at the API layer. Permission changes and hard deletion require dedicated capabilities. The write path then preserves evidence and lineage while applying the page mutation and revision records in a MongoDB transaction.

For a new claim, [`runWritePipelineGate()`](../../packages/wiki-engine/src/wiki-contradictions.ts) deliberately performs:

1. Cross-page contradiction detection.
2. Contradiction recording.
3. Same-page near-duplicate detection.
4. Rejection only if the deduplication result requires it.

Contradiction detection must run before deduplication. Reversing the order can discard a contradictory claim as textually similar before the system records the conflict.

Optional persisted fields are added conditionally. MongoDB validators distinguish an absent field from a field whose value is `undefined`; writing `embedding: undefined` or another undefined optional property can fail validation.

## Record delivery before crossing the service boundary

A memory write that may promote wiki content follows a durable sequence:

1. Record the local delivery intent and payload fingerprint.
2. Claim the intent for dispatch.
3. Call Memongo with the original idempotency key.
4. Persist the confirmed receipt or an explicit retry, unknown, conflict, or dead-letter state.
5. Promote to the wiki only from a confirmed receipt.
6. Commit the promoted page, revision, mutation evidence, and final promotion state together.

The HTTP request cannot participate in a MongoDB transaction. The intent ledger and stable idempotency key bridge that gap. An ambiguous timeout is `outcome-unknown`, never inferred success. See [Delivery intents](../packages/wiki-engine/delivery-intents.md).

## Keep OKF portable and governance local

Open Knowledge Format is the portable Markdown projection of wiki content. MongoDB remains the richer internal model. Embeddings, backlinks, authorization trust tiers, and permissions do not become portable OKF authority.

OKF provenance and verification fields describe content history. They do not grant MDBrain authorization. Import and export also enforce configured-root and real-path containment because a page slug eventually becomes a filesystem path. See [OKF and connectors](../packages/wiki-engine/okf-and-connectors.md).
