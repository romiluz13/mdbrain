# HTTP API

Active contributors: Rom Iluz

MDBrain exposes a Hono HTTP API for memory retrieval and writes, lifecycle management, governed wiki operations, and service administration. Product endpoints live under `/v1`; health, readiness, and the generated OpenAPI document are unversioned.

## Entry points

Active contributors: Rom Iluz

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Process liveness. Returns the service name without checking dependencies. |
| `GET /ready` | Checks the Memongo contract and retrieval dependencies plus transactional wiki-store readiness. Returns `503` with failed dependency names when either side is unavailable. |
| `GET /openapi.json` | Returns the OpenAPI 3.0 document assembled in `apps/api/src/openapi-spec.ts`. |
| `/v1/*` | Versioned memory, lifecycle, context, wiki, and administration routes from `apps/api/src/routes/v1.ts`. |

The route details are split between [memory and context](memory.md), [wiki](wiki.md), and the [MCP mapping](mcp.md). The deployable service is described on the [API app](../apps/api.md) page, and typed callers can use the [TypeScript client](../packages/client.md).

## Endpoint groups

Active contributors: Rom Iluz

| Group | Main paths | Notes |
| --- | --- | --- |
| Retrieval | `/v1/search`, `/v1/search-detailed`, `/v1/search-kb`, `/v1/recall-conversation` | Basic, multi-source, knowledge-base, and conversation-specific retrieval |
| Memory writes | `/v1/add`, `/v1/write-event`, `/v1/extract`, `/v1/write-structured`, `/v1/write-procedure` | Conversational ingestion, extraction scheduling, and direct structured or procedural writes |
| Lifecycle and feedback | `/v1/lifecycle/*`, `/v1/procedures/outcome`, `/v1/memory/feedback` | Revision-preserving reads, updates, invalidation, history, and quality signals |
| Context | `/v1/profile`, `/v1/hydrate-active-slate`, `/v1/discovery-projection`, `/v1/context-bundle`, `/v1/state` | Prompt-ready views over durable memory |
| Wiki | `/v1/wiki*` | Governed CRUD, search, lint, revisions, rendering, transclusion, and OKF interchange |
| Administration | `GET /v1/admin/deliveries` | Lists redacted durable delivery intents by state and scope |

The memory routes delegate through `@mdbrain/memory-bridge`; wiki routes use `@mdbrain/wiki-engine` and a separate transactional store. See [memory bridge](../packages/memory-bridge.md), [wiki engine](../packages/wiki-engine/index.md), [hybrid retrieval](../features/hybrid-retrieval.md), and [governed wiki](../features/governed-wiki.md) for implementation details.

## Authentication and authorization

Active contributors: Rom Iluz

All `/v1` routes use bearer authentication when `MDBRAIN_API_KEY` or `MDBRAIN_API_SCOPED_KEYS` is configured. The administrator key receives the administrator principal; scoped keys resolve to policies that can restrict agent IDs, scopes, scope references, and capabilities. Requests send:

```http
Authorization: Bearer <api-key>
```

If neither key setting exists, `apps/api/src/app.ts` installs a development principal and logs a warning. Production startup refuses this unauthenticated mode. The public health, readiness, and OpenAPI routes are outside the `/v1` authentication middleware.

`requiredCapability` in `apps/api/src/app.ts` assigns capabilities by operation:

| Capability | Operations |
| --- | --- |
| `read` | GET/HEAD requests and read-like POST routes such as search, recall, profile, context, and wiki search |
| `write` | Normal POST mutations, PATCH, and soft DELETE |
| `hard-delete` | Lifecycle deletion and wiki deletion with `hard=true` |
| `export` | OKF export |
| `administer` | `/v1/admin/*` and any route not explicitly classified |
| `change-permissions` | An extra check when wiki creation or update changes trust or permission fields, and for OKF import |

The middleware rejects missing or invalid credentials with `401`, policy violations with `403`, and conflicting scope values with `400`. The authorization model and deployment controls are covered in [security](../security.md).

## Scoping rules

Active contributors: Rom Iluz

Memory and wiki data use one of `session`, `user`, `agent`, `workspace`, `tenant`, or `global`, paired with a concrete `scopeRef`. The middleware searches query parameters and common body containers, including stable lifecycle handles and structured entries, so a caller cannot hide an unauthorized scope in a nested object. Multiple distinct `agentId`, `scope`, or `scopeRef` values in one request are rejected.

For memory requests, `containerTag` is a deprecated compatibility alias for session or scope references. A supplied `session` scope needs a session identifier or reference; `user` and `tenant` scopes require `scopeRef`. Conversational writes default to agent scope with the resolved agent ID as `scopeRef` when scope fields are omitted. Wiki operations require explicit `scope` and `scopeRef`, and governed reads filter results using the principal's subject, groups, roles, departments, trust tier, and capabilities.

## Idempotency

Active contributors: Rom Iluz

`POST /v1/add` and `POST /v1/write-event` require a non-empty `Idempotency-Key` header. The API combines that key with the principal and resolved scope to identify a durable delivery operation. Reusing a key with a different payload returns `409 IDEMPOTENCY_CONFLICT`; a write whose outcome still needs reconciliation returns `503 MEMORY_DELIVERY_PENDING`. `X-Request-ID` is optional and is forwarded to the memory gateway for tracing.

Wiki mutations record an operation ID inside the same transaction as the page change. They use `Idempotency-Key` first, then `X-Request-ID`, then a generated UUID. Callers that need stable operation correlation should supply one of those headers, but wiki creation still uses slug uniqueness as its visible duplicate guard and returns `409 DUPLICATE_SLUG`.

Other lifecycle and direct structured writes do not require an idempotency key. The TypeScript transport in `packages/client/src/transport.ts` therefore retries reads and the two same-key conversational writes, but does not automatically retry unkeyed mutations.

## Request and error conventions

Active contributors: Rom Iluz

Non-GET `/v1` requests with a body must use `Content-Type: application/json`; otherwise the API returns `415 UNSUPPORTED_MEDIA_TYPE`. An in-memory per-IP limiter returns `429 RATE_LIMITED` with `Retry-After`. Its default is 100 requests per 60 seconds, and it can be tuned or disabled with API environment settings described in [configuration reference](../reference/configuration.md).

Errors use one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "query is required",
    "retryable": false,
    "outcome": "rejected",
    "retryAfterMs": 1000
  }
}
```

Only `code` and `message` are always present. Classified memory-gateway failures may add `retryable`, `outcome`, and `retryAfterMs`; when a delay is available the API also emits `Retry-After`. `jsonError` in `apps/api/src/lib/errors.ts` redacts connection strings, API keys, and bearer tokens before returning a message.

Common statuses are `400` for request validation, `401` for authentication, `403` for capability or governance denial, `404` for missing resources, `409` for duplicate or idempotency conflicts, `429` for rate limiting, and `500` or `502`–`504` for dependency failures. `MdbrainClientError` from `packages/client/src/transport.ts` retains the status and raw response body. The client defaults to a 10-second total deadline and two retries for eligible `429` and `503` responses.

## Key source files

Active contributors: Rom Iluz

| File | Purpose |
| --- | --- |
| `apps/api/src/app.ts` | Hono composition, media-type checks, rate limiting, authentication, scoped authorization, probes, and route mounting |
| `apps/api/src/routes/v1.ts` | Runtime endpoint validation and dispatch |
| `apps/api/src/openapi-spec.ts` | Published OpenAPI 3.0 contract |
| `apps/api/src/lib/errors.ts` | Standard error envelope and secret redaction |
| `apps/api/src/principal.ts` | Principal, scoped-key, grant, and capability model |
| `apps/api/src/memory-delivery-runtime.ts` | Durable idempotent memory delivery and optional wiki promotion |
| `packages/client/src/client.ts` | Typed HTTP method mapping |
| `packages/client/src/transport.ts` | Bearer headers, deadlines, cancellation, retries, and client errors |

## Related pages

Active contributors: Rom Iluz

- [API app](../apps/api.md)
- [MCP app](../apps/mcp.md)
- [TypeScript client](../packages/client.md)
- [Context delivery](../features/context-delivery.md)
- [Security](../security.md)
- [Reference](../reference/index.md)
