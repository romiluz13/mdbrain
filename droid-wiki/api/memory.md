# Memory and context API

Active contributors: Rom Iluz

The memory API writes conversation events, retrieves evidence across memory families, manages revision-aware structured memories and procedures, and assembles prompt-ready context. Handlers in `apps/api/src/routes/v1.ts` call the versioned gateway in `packages/memory-bridge` rather than talking to Memongo storage directly.

## Retrieval endpoints

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/search` | General memory search. Requires `query`; accepts limits, minimum score, session key, and scope. Returns `{ results }`. Compatibility aliases are `q` for `query`, `maxResults` for `limit`, and `containerTag` for `sessionKey`. |
| `POST /v1/search-kb` | Searches imported reference documents. Supports score and result limits plus optional tag, category, and source filters. |
| `POST /v1/search-detailed` | Runs the advanced multi-source retrieval pipeline. Search mode, source preference, time range, exact-evidence requirement, pass count, family-specific filters, and named recipes can be supplied. The response includes ranked evidence plus pass, rejection, relaxation, fusion, trust, and optional plan metadata. |
| `POST /v1/recall-conversation` | Recalls canonical conversation events by semantic query or filters. Filters include session, roles, inclusive time bounds, timezone, and tool-message inclusion. The response supplies citations and search-method metadata. |

Conversation recall can run without a query for filter-only retrieval. Date-only boundaries use the supplied IANA timezone; exact timestamps should be ISO 8601. `roles` accepts `user`, `assistant`, `system`, and `tool`. Tool messages are excluded by default unless explicitly requested, and the result limit is capped at 200.

Detailed search accepts `fast`, `hybrid`, `deep`, `temporal`, and `chain-of-thought` recipes. Top-level request fields override recipe defaults. Use the simpler `/v1/search` when ranked snippets are enough; use `/v1/search-detailed` when the caller needs provenance, trust factors, corrective passes, or execution diagnostics. See [hybrid retrieval](../features/hybrid-retrieval.md) for the retrieval model.

## Conversation and direct writes

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/add` | Appends a user message. Requires `content` and `Idempotency-Key`; returns the canonical event ID and whether a chunk was created. |
| `POST /v1/write-event` | Writes a `user`, `assistant`, `system`, or `tool` event. Requires a body and `Idempotency-Key`; accepts session, timestamp, metadata, and scope. |
| `POST /v1/extract` | Schedules extraction from a canonical event ID and returns `202`. |
| `POST /v1/write-structured` | Upserts a structured-memory entry supplied as `entry`. |
| `POST /v1/write-procedure` | Upserts a procedural-memory entry supplied as `entry`. |

`/v1/add` and `/v1/write-event` use durable delivery intents in `apps/api/src/memory-delivery-runtime.ts`. A successful response means the delivery receipt was confirmed. A request may also set `promotionPolicy: "wiki"` and provide a complete `wikiPromotion` page with at least one claim; promotion is gated on the memory receipt rather than racing the memory write. The default policy is `none`.

Both endpoints resolve omitted values to agent ID `default`, scope `agent`, and a scope reference equal to the agent ID. `sessionId` is preferred over the deprecated `containerTag` alias. Reusing an idempotency key with another payload returns `409`; an uncertain or retryable delivery returns `503` for later reconciliation.

Direct structured and procedure writes are unkeyed upserts. Automatic extraction is not implied by `write-event`; call `/v1/extract` when extraction must be explicitly scheduled.

## Stable lifecycle handles

Active contributors: Rom Iluz

Structured memories and procedures return stable handles that carry the family, canonical ID, agent, scope, scope reference, revision, lifecycle state, and family identity. Structured handles identify a `type` and `key`; procedure handles identify a `procedureId`. Callers should pass back the full handle returned by the API rather than reconstructing it.

| Method and path | Semantics |
| --- | --- |
| `POST /v1/lifecycle/get` | Fetches the current structured memory or procedure for a stable handle. |
| `POST /v1/lifecycle/update` | Applies a family-specific patch, creates a new current revision, and preserves the superseded value. |
| `POST /v1/lifecycle/delete` | Invalidates the current item and preserves its history. Despite the endpoint name, this is not a physical hard delete. Requires the `hard-delete` capability. |
| `POST /v1/lifecycle/history` | Returns current and superseded revisions in lifecycle order. The limit is clamped to 1–200. |

Structured patches cover the memory value and context, confidence and source, tags and salience, temporal fields, provenance, source events, source-agent identity, and optional artifacts. Procedure patches cover the procedure name, intent and trigger metadata, steps, success signals, confidence, and provenance. The handle family determines which patch shape is valid.

The API returns `404` when no current item or history exists. Updates and invalidations are not automatically retried by `@mdbrain/client`, because these mutations do not carry required idempotency keys. The lifecycle types exported from `packages/client/src/types.ts` model wire dates as strings.

## Feedback and procedure outcomes

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/procedures/outcome` | Records success or failure against a procedure handle, with an optional note and `user`, `assistant`, or `system` actor role. |
| `POST /v1/memory/feedback` | Applies `confirm`, `correct`, or `irrelevant` feedback to a structured-memory handle. |

`confirm` reinforces the current memory. `correct` requires a valid structured patch and goes through the same revision-preserving update path. `irrelevant` invalidates the current memory and may include `invalidatedBy` provenance. Procedure outcomes update the canonical procedure's success or failure record rather than creating a detached event.

## Context endpoints

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/profile` | Synthesizes preferences, decisions, facts, todos, top entities, recent episodes, and activity patterns for a scope. |
| `POST /v1/hydrate-active-slate` | Returns a small high-salience active-memory set for the current turn or a debugging surface. The requested size is capped at six items. |
| `POST /v1/discovery-projection` | Builds an `entity-brief`, `topic-brief`, `what-changed`, or `contradiction-report` from provenance-backed evidence. Entity and topic briefs require a query. |
| `POST /v1/context-bundle` | Builds rendered, token-budgeted context from active memory, query evidence, summaries, recent events, an optional discovery projection, and an optional profile. |
| `GET /v1/state` | Returns profile, labeled memory blocks, and a context bundle as one unified state family. |

`/v1/context-bundle` accepts section limits, a total token budget, session and time-range filters, and optional discovery and profile sections. `mode: "wake-up"` produces a compact session-start projection and skips query evidence; omitted or `full` mode builds the normal bundle. Responses report token estimates, truncation, partial results, executed paths, and included sections. The corresponding feature flow is documented in [context delivery](../features/context-delivery.md).

## Scoping and authorization

Active contributors: Rom Iluz

Memory scopes are `session`, `user`, `agent`, `workspace`, `tenant`, and `global`. Session scope needs `sessionId`, `sessionKey`, `scopeRef`, or the deprecated `containerTag`; user and tenant scopes need `scopeRef`. Scoped API keys are checked before route dispatch, including values nested inside lifecycle handles and entries.

Most retrieval and context POSTs require `read`. Writes, updates, feedback, outcomes, and extraction require `write`. Lifecycle invalidation is deliberately classified as `hard-delete` even though storage preserves history. Full authentication, rate-limit, and error behavior is described in the [HTTP API](index.md) and [security](../security.md) pages.

## Client methods

Active contributors: Rom Iluz

`MdbrainClient` in `packages/client/src/client.ts` maps the HTTP operations to `search`, `searchDetailed`, `searchKB`, `recallConversation`, `add`, `writeEvent`, `extract`, `writeStructured`, `writeProcedure`, `getLifecycleItem`, `updateLifecycleItem`, `deleteLifecycleItem`, `getLifecycleHistory`, `reportProcedureOutcome`, `applyMemoryFeedback`, `profile`, `hydrateActiveSlate`, `buildDiscoveryProjection`, `buildContextBundle`, and `state`.

Read-like methods use the safe retry policy. `add` and `writeEvent` use the same-key retry policy and preserve the caller's idempotency key. Unkeyed mutations use no automatic retries. See the [TypeScript client](../packages/client.md) for deadline and cancellation behavior and [MCP tools](mcp.md) for agent-facing names.

## Key source files

Active contributors: Rom Iluz

| File | Purpose |
| --- | --- |
| `apps/api/src/routes/v1.ts` | Memory, lifecycle, feedback, retrieval, and context handlers |
| `apps/api/src/openapi-spec.ts` | Public request and response descriptions |
| `apps/api/src/app.ts` | Scope-aware authorization and capability classification |
| `apps/api/src/memory-delivery-runtime.ts` | Durable keyed writes and receipt-gated wiki promotion |
| `packages/client/src/client.ts` | Typed client method implementations |
| `packages/client/src/types.ts` | Stable handles, lifecycle unions, input types, and wire response types |
| `packages/client/src/transport.ts` | Retry classes and total-deadline enforcement |
| `packages/memory-bridge/src/mdbrain-bridge.ts` | Public bridge operations used by the API |

## Related pages

Active contributors: Rom Iluz

- [API app](../apps/api.md)
- [Memory bridge](../packages/memory-bridge.md)
- [Hybrid retrieval](../features/hybrid-retrieval.md)
- [Context delivery](../features/context-delivery.md)
- [Security](../security.md)
- [Data model reference](../reference/data-models.md)
