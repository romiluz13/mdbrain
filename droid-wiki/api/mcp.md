# MCP tools

Active contributors: Rom Iluz

The MCP server is a stdio adapter over `@mdbrain/client`. It publishes agent-friendly tool schemas, validates selected enum inputs, calls the HTTP API, and serializes each result as JSON text rather than accessing memory or wiki storage directly.

## Runtime and configuration

Active contributors: Rom Iluz

`apps/mcp/src/server.ts` creates an MCP `Server` named `mdbrain` at version `2.0.0` and connects it to `StdioServerTransport`. Its `MdbrainClient` reads `MDBRAIN_API_URL` and `MDBRAIN_API_KEY`, so authentication, scoping, rate limits, governance, and server errors are the same as direct HTTP calls.

The default client URL is `http://127.0.0.1:3847` when `MDBRAIN_API_URL` is absent. The bearer token is optional only when the API itself is running in trusted development mode. Deployment and environment details are covered by the [MCP app](../apps/mcp.md), [HTTP API](index.md), and [configuration reference](../reference/configuration.md).

## Memory tool mapping

Active contributors: Rom Iluz

| MCP tool | Client method | HTTP endpoint | Notes |
| --- | --- | --- | --- |
| `mdbrain_search` | `search` | `POST /v1/search` | General scoped memory search |
| `mdbrain_search_kb` | `searchKB` | `POST /v1/search-kb` | Knowledge-base search |
| `mdbrain_search_detailed` | `searchDetailed` | `POST /v1/search-detailed` | Advanced recipes and retrieval diagnostics |
| `mdbrain_add` | `add` | `POST /v1/add` | Requires `content` and `idempotencyKey` tool arguments |
| `mdbrain_write_event` | `writeEvent` | `POST /v1/write-event` | Requires role, body, and idempotency key |
| `mdbrain_write_structured` | `writeStructured` | `POST /v1/write-structured` | Direct structured-memory upsert |
| `mdbrain_write_procedure` | `writeProcedure` | `POST /v1/write-procedure` | Direct procedure upsert |
| `mdbrain_profile` | `profile` | `POST /v1/profile` | Profile synthesis |
| `mdbrain_state_unified` | `state` | `GET /v1/state` | Profile, blocks, and bundle in one call |
| `mdbrain_hydrate_active_slate` | `hydrateActiveSlate` | `POST /v1/hydrate-active-slate` | Small high-salience memory set |
| `mdbrain_discovery_projection` | `buildDiscoveryProjection` | `POST /v1/discovery-projection` | Entity, topic, change, or contradiction projection |
| `mdbrain_build_context_bundle` | `buildContextBundle` | `POST /v1/context-bundle` | Full or wake-up prompt context |

`mdbrain_search_detailed` exposes the named search recipe and execution overrides but not every family-specific HTTP filter. `mdbrain_build_context_bundle` is the broadest prompt-assembly tool and can include profile and discovery sections. For endpoint semantics, see [memory and context](memory.md), [hybrid retrieval](../features/hybrid-retrieval.md), and [context delivery](../features/context-delivery.md).

## Recall and lifecycle aliases

Active contributors: Rom Iluz

Several tools have semantic aliases so agents can discover the same operation under either lifecycle or memory language. Aliases call the same client method and endpoint; they do not create separate data paths.

| MCP tools | Client method | HTTP endpoint |
| --- | --- | --- |
| `mdbrain_recall_conversation`, `mdbrain_recall_messages` | `recallConversation` | `POST /v1/recall-conversation` |
| `mdbrain_lifecycle_get`, `mdbrain_memory_get` | `getLifecycleItem` | `POST /v1/lifecycle/get` |
| `mdbrain_lifecycle_update`, `mdbrain_memory_update` | `updateLifecycleItem` | `POST /v1/lifecycle/update` |
| `mdbrain_lifecycle_delete`, `mdbrain_memory_delete` | `deleteLifecycleItem` | `POST /v1/lifecycle/delete` |
| `mdbrain_lifecycle_history`, `mdbrain_memory_history` | `getLifecycleHistory` | `POST /v1/lifecycle/history` |

Conversation recall supports semantic or filter-only lookup, exact time boundaries, role filters, session filtering, and optional tool messages. Lifecycle tools require the full stable handle returned by get or history. The server clamps recall and history limits to 1–200 before dispatch.

Two additional mutation tools use lifecycle handles:

| MCP tool | Client method | HTTP endpoint | Semantics |
| --- | --- | --- | --- |
| `mdbrain_procedure_outcome` | `reportProcedureOutcome` | `POST /v1/procedures/outcome` | Records success or failure on a canonical procedure |
| `mdbrain_memory_feedback` | `applyMemoryFeedback` | `POST /v1/memory/feedback` | Confirms, corrects, or invalidates a structured memory |

`correct` feedback requires a structured patch. `irrelevant` can carry invalidation provenance. Lifecycle deletion uses invalidate-with-history semantics even though its authorization capability is `hard-delete`.

## Wiki tool mapping

Active contributors: Rom Iluz

| MCP tool | Client method | HTTP behavior | Notes |
| --- | --- | --- | --- |
| `mdbrain_wiki_search` | `wikiSearch` | `POST /v1/wiki/search` | Governed hybrid search with kind, trust, recipe, and result filters |
| `mdbrain_wiki_get` | `wikiGet` | `GET /v1/wiki/{slug}` | Gets JSON, rendered Markdown, or HTML; slugs may contain `/` |
| `mdbrain_wiki_apply` | `wikiApply` | `POST /v1/wiki`, then PATCH on 409 | Create-or-update operation that bumps revision on update |
| `mdbrain_wiki_export_okf` | `wikiExportOkf` | `POST /v1/wiki/okf-export` | Governed filesystem export; can return file content |
| `mdbrain_wiki_import_okf` | `wikiImportOkf` | `POST /v1/wiki/okf-import` | Transactional bundle import |
| `mdbrain_wiki_lint` | `wikiLint` | `GET /v1/wiki/lint` | Pages and unresolved contradictions for review |

The MCP surface does not expose wiki list, delete, or revision-history tools. It also does not expose the memory extraction endpoint or delivery-administration endpoint. Call the [wiki HTTP API](wiki.md) or [TypeScript client](../packages/client.md) when those operations are needed.

`mdbrain_wiki_apply` requires a complete page shape because it may need to create the page. The client first tries create; only `409` triggers the PATCH fallback. Import requires a valid trust tier and the API's `change-permissions` authorization. Export is governance-filtered and requires the API's `export` capability.

## Result and error behavior

Active contributors: Rom Iluz

Every tool response includes JSON serialized into an MCP text content item. Recall, lifecycle, outcome, and feedback paths also use `structuredContent`, wrapping array payloads as `{ items }` and scalar payloads as `{ value }`. Consumers should treat the text JSON as the common representation across all tools.

`handleToolCall` catches validation, transport, and API errors and returns:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":\"message\"}"
    }
  ],
  "structuredContent": {
    "error": "message"
  },
  "isError": true
}
```

Because the MCP process uses `MdbrainClient`, safe reads may retry transient transport failures and HTTP `429` or `503` responses within one total deadline. `mdbrain_add` and `mdbrain_write_event` use their caller-supplied idempotency keys for same-key retries. Lifecycle, feedback, wiki mutation, and direct-write tools are not automatically retried.

Unknown tool names return an MCP error result rather than throwing out of the request handler. Input schemas catch required fields for tool discovery, while `handleToolCall` performs selected runtime checks and the HTTP API remains the authoritative validator.

## Scope and security

Active contributors: Rom Iluz

Tool callers can pass the same six memory scopes as HTTP callers: `session`, `user`, `agent`, `workspace`, `tenant`, and `global`. The API key's grants still constrain these values. Wiki tools require explicit scope identity where the corresponding endpoint requires it, and all wiki reads remain subject to trust and permission governance.

The MCP server never receives a privileged storage handle. Its only authority is the bearer credential supplied to `MdbrainClient`, which keeps the trust boundary at the HTTP API. See [security](../security.md) for key policy and [governed wiki](../features/governed-wiki.md) for page visibility.

## Key source files

Active contributors: Rom Iluz

| File | Purpose |
| --- | --- |
| `apps/mcp/src/server.ts` | MCP tool declarations, aliases, argument normalization, dispatch, and result serialization |
| `packages/client/src/client.ts` | MCP-to-HTTP method implementations |
| `packages/client/src/types.ts` | Public memory, lifecycle, recall, and context request types |
| `packages/client/src/transport.ts` | API URL, bearer header, deadlines, retries, and transport errors |
| `apps/api/src/routes/v1.ts` | Authoritative runtime validation and endpoint semantics |
| `apps/api/src/app.ts` | Authentication, scope authorization, and capability checks |

## Related pages

Active contributors: Rom Iluz

- [MCP app](../apps/mcp.md)
- [API app](../apps/api.md)
- [TypeScript client](../packages/client.md)
- [Agent integrations](../features/agent-integrations.md)
- [Security](../security.md)
- [Reference](../reference/index.md)
