# Pitfalls

The highest-risk MDBrain changes cross storage, authorization, or service boundaries. Preserve these invariants when changing the wiki, memory gateway, connectors, or search pipeline.

## Do not persist optional fields as `undefined`

MongoDB `$jsonSchema` validators reject an optional field when the field exists with the wrong BSON type. In [`normalizeInput()`](../../packages/wiki-engine/src/wiki-bridge.ts), add optional values with conditional spreads rather than assigning `undefined`.

For example, omitting `embedding` is valid when no embedding exists. Persisting `embedding: undefined` can fail every insert because the schema accepts an array, not the BSON representation of an undefined-valued field. This applies to all optional schema fields, not only embeddings.

## Do not reconstruct existing claims

Unrelated page edits must preserve each claim's evidence, writer, derivation chain, supersession link, source memory ID, and validity interval. Treat the existing claim object as the source of truth and append accepted claims or change only fields named by the operation.

Rebuilding claims from a smaller input shape can silently erase provenance while leaving the page apparently valid.

## Do not move deduplication before contradiction detection

The write gate in [`packages/wiki-engine/src/wiki-contradictions.ts`](../../packages/wiki-engine/src/wiki-contradictions.ts) detects and records cross-page contradictions before checking same-page near-duplicates. Similar wording can still carry opposite polarity. A deduplication-first pipeline can reject the incoming claim before the contradiction becomes visible.

Keep tests that assert this ordering whenever claim matching changes.

## Do not authorize only the first read

Scope and permission checks must cover direct lookup, search, revisions, transclusion, graph expansion, contradiction records, lint, and export. Apply governance before retrieval and again after an operation introduces additional pages.

An `admin` trust tier bypasses page permission predicates in the current governance module, but it does not remove exact `scope` and `scopeRef` filtering. Do not treat trust tier as global scope authority.

Request bodies are not an authority source. Roles, departments, groups, trust tier, capabilities, and allowed scopes come from [`ApiPrincipal`](../../apps/api/src/principal.ts). Request parameters may only select within those grants.

## Do not assume an empty search means no knowledge exists

[`packages/wiki-engine/src/wiki-search.ts`](../../packages/wiki-engine/src/wiki-search.ts) currently returns an empty list when Atlas search indexes are unavailable and keeps seed results when graph expansion fails. Callers therefore cannot infer from `[]` alone that no matching page exists.

Other current search edges matter during maintenance:

- `minScore` is accepted but is not applied to final results.
- Application-side reranking replaces scores by array position; it does not reliably reorder by result identity.
- Native `$rerank` failure falls back to the non-reranked pipeline.
- `$vectorSearch`, `$search`, `$rankFusion`, and `$rerank` require Atlas Search or Atlas Local, not plain MongoDB Community.

Do not document these paths as complete failure-state reporting until the return contract distinguishes complete, partial, degraded, and failed retrieval.

## Do not retry ambiguous writes as ordinary requests

Memongo write retries are safe only where the operation policy and idempotency key make them safe. A timeout or network failure after dispatch can leave the intent in `outcome-unknown`.

Use the delivery intent state machine in [`packages/wiki-engine/src/memory-delivery.ts`](../../packages/wiki-engine/src/memory-delivery.ts). Reconcile with the same operation identity, payload fingerprint, scope, and idempotency key. Never invent a new key for a retry, infer success from a timeout, or promote wiki content before a confirmed receipt.

## Do not bypass the wiki transaction owner

[`WikiStore`](../../packages/wiki-engine/src/wiki-store.ts) owns the client and transaction boundary. API mutations use [`apps/api/src/wiki-store-runtime.ts`](../../apps/api/src/wiki-store-runtime.ts) to pass one session through the page write, revision, audit intent, and promotion state.

The MongoDB transaction cannot include the remote Memongo HTTP request. Record intent before dispatch and commit the result in a later transaction. Production also needs a replica set or compatible MongoDB deployment; a ping alone does not prove transaction readiness.

## Do not weaken the Memongo boundary

MDBrain accepts only the pinned Memongo version and OpenAPI digest in [`packages/memory-bridge/src/memongo-runtime.ts`](../../packages/memory-bridge/src/memongo-runtime.ts). Do not:

- import Memongo packages or source;
- read Memongo collections directly;
- restore `packages/memory-engine` as a fallback;
- share database credentials or schema initialization;
- expose a generic authenticated proxy;
- send control-plane credentials through tenant operations;
- silently downgrade a dependency failure to an empty success.

Contract upgrades require a new captured contract, digest, validators, fixtures, and readiness evidence.

## Do not advertise connector shells as synchronization

The GitHub, Confluence, Notion, Slack, and CRM classes in [`packages/wiki-engine/src/wiki-connectors.ts`](../../packages/wiki-engine/src/wiki-connectors.ts) validate configuration and map some permissions, but discovery returns no live sources and ingestion writes no wiki pages. Obsidian discovers and exports files, but its `ingest()` method also does not create pages.

Treat these adapters as read-first or preview seams. Production claims require source API access, durable cursors, replay behavior, ACL mapping, revocation, deletion, and governed wiki writes.

## Do not expose secrets through connector results

Connector credentials and Memongo keys belong in server-side configuration or a secret provider. Authentication results, logs, errors, public route responses, and delivery administration responses must contain only non-secret metadata.

Keep tenant and control credentials separate. Reject credential-bearing URLs and preserve log redaction when changing transport code.

## Do not trust lexical path checks alone

OKF and Obsidian exports turn slugs into paths. Reject absolute paths, drive-qualified paths, parent traversal, backslash separator tricks, and symlink escapes. Validate all targets before writing any file, then prove real-path containment under the configured root.

Use [`packages/wiki-engine/src/filesystem-containment.ts`](../../packages/wiki-engine/src/filesystem-containment.ts) rather than adding another path-joining implementation.

## Do not confuse content trust with authorization trust

OKF `generated`, `verified`, and related provenance fields describe the content. MDBrain `trustTier`, capabilities, subjects, groups, roles, departments, and privacy tiers determine access. Importing a document that claims human verification must not elevate its authorization.
