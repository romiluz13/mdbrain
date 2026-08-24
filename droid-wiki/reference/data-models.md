# Data models

MDBrain's data contracts span MongoDB wiki records, the remote memory boundary, client responses, and server-owned authorization state. This page summarizes the principal shapes; use the named TypeScript source and MongoDB validator for field-level changes.

## Shared scope and lifecycle vocabulary

Memory and wiki records use the scopes `session`, `user`, `agent`, `workspace`, `tenant`, and `global`. A `scopeRef` identifies the concrete member of that scope. `packages/lib/src/types.memory.ts` defines `MemoryScope`, while `packages/wiki-engine/src/wiki-schema.ts` applies the same values to validated wiki collections.

Memory lifecycle state is `active`, `invalidated`, or `conflicted`. Wiki page state is separate: `active`, `superseded`, or `draft`.

## Wiki page

`WikiPageInput`, `WikiPage`, and the API-safe `WikiPageView` are defined in `packages/wiki-engine/src/wiki-bridge.ts`. MongoDB validation and indexes are defined in `packages/wiki-engine/src/wiki-schema.ts`.

| Area | Fields and behavior |
| --- | --- |
| Identity | `kind`, `title`, `slug`, optional `aliases`, optional `entityId`, optional `okfConceptId`, and optional `okfBundleId`. The allowed kinds are `entity`, `concept`, `synthesis`, `source`, `report`, and `procedure`. A compound unique index makes `slug` unique within `scope` and `scopeRef`. |
| Content | `summary`, Markdown `body`, and `frontmatter`. Frontmatter requires `type` and can preserve titles, descriptions, canonical resources, tags, timestamps, entity types, privacy, migration provenance, maintenance hashes, OKF status, generation or verification records, staleness, and sources. |
| Knowledge | `claims`, `questions`, `relationships`, optional `personCard`, computed `backlinks`, and parsed `transcludes`. Claims carry status, confidence, evidence, provenance, writer identity, derivation, supersession, and validity dates. |
| Governance | `scope`, `scopeRef`, `trustTier`, and optional subject, group, role, department, and privacy permissions. Trust tiers are `restricted`, `standard`, and `admin`; privacy tiers are `public`, `internal`, `confidential`, and `restricted`. |
| Lifecycle | `state`, monotonic `revision`, `validFrom`, optional `validTo`, `freshness`, maintenance metadata, `createdAt`, and `updatedAt`. New pages start at revision `1`, state `active`, and freshness `fresh`. Soft deletion changes the state to `superseded` and sets `validTo`; hard deletion removes the current page. |
| Retrieval | Optional `embedding` stores a caller-generated vector. `text` concatenates title, summary, and body for Atlas auto-embedding. `WikiPageView` omits both fields and serializes dates as ISO strings. |

The validator requires the core identity, content, scope, trust, lifecycle, and timestamp fields. It runs with `validationLevel: "moderate"` and `validationAction: "error"`. Current-page records live in the prefixed `wiki_pages` collection. Full snapshots for create, update, and delete revisions live in `wiki_revisions`; each `(pageSlug, scope, scopeRef, revision)` tuple is unique.

## Governance context

`GovernanceContext` in `packages/wiki-engine/src/wiki-governance.ts` describes the requester for every governed wiki read.

| Field | Meaning |
| --- | --- |
| `scope`, `scopeRef` | Required operating boundary. Current governance filters require an exact pair, including for administrators. |
| `trustTier` | `restricted`, `standard`, or `admin`. Administrators bypass page permission filters but not the exact scope filter. |
| `subjectId` | Optional stable, server-derived identity used by `permissions.allowedSubjects`. |
| `groups` | Optional namespaced, server-derived groups used by `permissions.allowedGroups`. |
| `roles`, `departments` | Optional values matched against page permission arrays. |
| `capabilities` | Optional server-derived operation permissions carried into governance-aware operations. |
| `agentId` | Optional agent identity for audit context. |

For non-administrators, a page is visible when it has no effective restrictions, has `public` or `internal` privacy, or explicitly permits the requester's subject, group, role, or department. `GovernanceContext` is a wiki-engine input; the API derives it from the authenticated [`ApiPrincipal`](#api-principal) rather than trusting client-supplied authority.

## Memory stable handles and lifecycle entries

`packages/memory-bridge/src/memory-contract-types.ts` defines stable handles and lifecycle records returned through the Memongo boundary.

Every `MemoryStableHandle` contains:

- `id`, `agentId`, `scope`, and `scopeRef` for stable identity and partitioning.
- `revision` and lifecycle `state`.
- Optional `validFrom`, `validTo`, and `updatedAt` timestamps.
- A family discriminator. Structured handles use `family: "structured"` plus `{ type, key }`; procedure handles use `family: "procedure"` plus `{ procedureId }`.

`MemoryLifecycleItem` pairs the handle with family-specific data:

| Family | Data |
| --- | --- |
| `structured` | A `StructuredMemoryEntry` without duplicate partition fields. The entry can represent decisions, preferences, people, todos, facts, projects, architecture, contacts, milestones, problems, emotional context, identity, instructions, or custom values. It can carry confidence, source, tags, salience, temporal scope, provenance, source events, review dates, reliability, source-agent identity, and an artifact. |
| `procedure` | A `ProcedureEntry` without duplicate partition fields. It contains a procedure ID, name, steps, optional intent and trigger terms, success signals, confidence, provenance, source events, and source-agent identity. Lifecycle responses may add success and failure counts and timestamps. |

`MemoryLifecycleHistoryEntry` adds `historyKind: "revision" | "current"` and optional `supersededAt`. Patch types intentionally allow only mutable family data; stable identity and partition fields are not patchable.

## Context bundle

`MdbrainContextBundleInput` is defined in `packages/client/src/types.ts`. `MdbrainContextBundleResponse` and `MdbrainContextBundleSectionItem` are defined in `packages/client/src/client.ts`. The bridge-side equivalent in `packages/memory-bridge/src/mdbrain-bridge.ts` uses `Date` values before HTTP serialization.

### Request

The request can select `agentId`, query text, `scope`, `scopeRef`, `sessionId`, a token budget, per-section item limits, discovery projection and kind, profile inclusion, and a preset or explicit time range. `mode` is `full` by default or `wake-up` for a compact session-start projection.

### Response

| Area | Fields |
| --- | --- |
| Identity | `agentId`, optional `query`, `scope`, `scopeRef`, and optional `sessionId`. |
| Prompt output | `rendered`, a prompt-ready string assembled from the included sections. |
| Sections | Ordered entries of kind `active-slate`, `query-evidence`, `summary`, `recent-events`, `discovery-projection`, or `profile`. Each section has a title, optional summary, items, estimated token count, and `truncated` or `partial` flags. |
| Items | Title and summary, with optional path, source, canonical ID, timestamp, scope, scope reference, source event IDs, metadata, and trust assessment. |
| Trust | Score, confidence, exactness, freshness, contradiction state, scope match, provenance density, source diversity, and explanatory factors. |
| Metadata | Token budget and estimated use, partial and truncation state, executed paths, included sections, and optional aggregate trust summary. |
| Time | `builtAt`, serialized as an ISO string by the client-facing contract. |

## Memory delivery intent

`MemoryDeliveryIntent` and its transitions are defined in `packages/wiki-engine/src/memory-delivery.ts`; `packages/wiki-engine/src/wiki-schema.ts` validates the persisted collection.

A delivery intent durably coordinates an API memory write and optional wiki promotion:

| Area | Fields |
| --- | --- |
| Operation | Unique `operationId`, operation `add` or `write-event`, `idempotencyKey`, original `payload`, and canonical SHA-256 `payloadFingerprint`. |
| Authority and partition | `principalSubjectId`, `agentId`, `scope`, and `scopeRef`. |
| Promotion | `promotionPolicy` is `none` or `wiki`; optional `promotionKey`, `promotionAttempts`, and `promotedAt` track promotion. |
| Delivery | `state`, `attempts`, `reconciliationAttempts`, optional receipt and error code, dispatch, confirmation, and update timestamps. |
| Replay audit | Optional conflict count, conflict fields, and last conflict timestamp record attempts to reuse an operation ID with different immutable input. |

The state set is `recorded`, `delivering`, `retryable`, `outcome-unknown`, `confirmed`, `promotion-pending`, `promoted`, `dead-letter`, and `conflict`. A unique `operationId` index provides idempotency. Exact replays return the existing intent; changed payload or identity fields are recorded as replay conflicts.

Records live in the prefixed `memory_delivery_intents` collection. An index on `(state, updatedAt)` supports reconciliation, and `(scope, scopeRef, createdAt)` supports scoped audit listing.

## Wiki mutation intent

`WikiMutationIntent` is defined in `packages/wiki-engine/src/wiki-mutation-intents.ts` and validated in `packages/wiki-engine/src/wiki-schema.ts`.

Each record contains `operationId`, mutation `kind`, `pageSlug`, `scope`, `scopeRef`, `principalSubjectId`, a canonical SHA-256 `payloadFingerprint`, fixed state `recorded`, and creation or update timestamps. Mutation kinds are `create`, `update`, `soft-delete`, `hard-delete`, and `okf-import`.

Records live in the prefixed `wiki_mutation_intents` collection. `operationId` is unique, and `(state, updatedAt)` is indexed. The intent records who authorized a mutation and which canonical payload was requested; page revision snapshots are stored separately in `wiki_revisions`.

## API principal

`ApiPrincipal` and scoped-key parsing are defined in `apps/api/src/principal.ts`. The principal is server-owned authorization state and never contains the bearer token.

| Field | Meaning |
| --- | --- |
| `subjectId`, `displayName` | Stable identity and optional human-readable name. |
| `groups`, `roles`, `departments` | Membership attributes used by wiki permissions. |
| `trustTier` | `restricted`, `standard`, or `admin`. |
| `allowedAgentIds` | Exact agent IDs or `*`. |
| `allowedScopes` | Pairs of a memory scope or `*` and a `scopeRef` or `*`. A request must satisfy one complete pair. |
| `capabilities` | Any of `read`, `write`, `administer`, `change-permissions`, `hard-delete`, `export`, and `manage-connectors`. |
| `identityState`, `identityValidUntil` | `active`, `stale`, or `unknown`, plus an optional expiry date-time. Non-active and expired identities are rejected. |

The administrator principal has wildcard agent and scope grants, admin trust, and every capability. The unauthenticated development principal retains wildcard grants and all capabilities but uses standard trust. Scoped-key principals default to standard trust and `read` plus `write`, then narrow authority according to the configured policy.

See [Configuration](configuration.md) for principal policy input and [API](../api/index.md) for the routes that consume these models.
