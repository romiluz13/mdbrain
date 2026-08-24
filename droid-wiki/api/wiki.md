# Wiki API

Active contributors: Rom Iluz

The wiki API manages scoped, governed pages backed by `@mdbrain/wiki-engine`. It supports revisioned CRUD, rendered reads, transclusion, hybrid search, integrity linting, and Open Knowledge Format interchange without bypassing the caller's governance context.

## Page identity and governance

Active contributors: Rom Iluz

A page is identified by `slug`, `scope`, and `scopeRef`. Slugs may contain `/`, including OKF concept IDs such as `tables/users`; the wildcard handlers in `apps/api/src/routes/v1.ts` preserve the complete remainder of the path. Valid page kinds are `entity`, `concept`, `synthesis`, `source`, `report`, and `procedure`. Trust tiers are `restricted`, `standard`, and `admin`.

Every create requires a title, slug, dense summary, kind, scope, scope reference, trust tier, and `frontmatter.type`. The body is Markdown. Reads build a `GovernanceContext` from the authenticated principal's subject, groups, roles, departments, trust tier, capabilities, and requested scope. This context filters list, get, search, revision, transclusion, and export results.

Creating a page at a different trust tier or with explicit permissions requires `change-permissions`. The same extra capability is required to patch `trustTier` or `permissions`, and all OKF imports require it. See [governed wiki](../features/governed-wiki.md) and [security](../security.md) for the policy model.

## Create, list, and read

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/wiki` | Creates a page and revision record inside a transaction. Returns `201`; duplicate slug identity returns `409 DUPLICATE_SLUG`. |
| `GET /v1/wiki` | Lists governed pages. Requires `scope` and `scopeRef`; supports kind, trust-tier, state, limit, and skip filters. |
| `GET /v1/wiki/{slug}` | Reads one governed page. Requires `scope` and `scopeRef`; returns JSON by default. |

The single-page read accepts `format=markdown` for rendered Markdown or `format=html` for HTML. By default the stored body retains raw `{{page:slug}}` markers so editors see the authored source. `transclude=true` resolves those markers through the same governance context; references the caller cannot read do not leak their content.

List and get are scoped reads rather than global lookups. An optional `agentId` selects the runtime handle but does not replace `scope` and `scopeRef`.

## Update and delete

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `PATCH /v1/wiki/{slug}` | Updates an existing governed page and bumps its revision. Scope and scope reference may be supplied in the body or query. |
| `DELETE /v1/wiki/{slug}` | Soft-deletes by default. `hard=true` permanently deletes and requires `hard-delete`. |

PATCH strips `scope`, `scopeRef`, and `slug` from the patch, so the route identity does not move as a side effect. If frontmatter is supplied, it must still contain a string `type`. The handler first performs a governed read, then updates the page and records a mutation intent in the same transaction.

DELETE follows the same governed-read-before-write pattern. Soft deletion requires normal `write`; permanent deletion is capability-gated. Both return `404 WIKI_NOT_FOUND` when the caller cannot resolve the target in the requested scope.

Create, update, soft delete, hard delete, and OKF import record mutation intents. Their operation ID comes from `Idempotency-Key`, then `X-Request-ID`, then a generated UUID. Supplying a stable header is useful for audit correlation, while slug uniqueness remains the create endpoint's visible duplicate behavior.

## Search and lint

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/wiki/search` | Runs governed wiki search. Requires `query`, `scope`, and `scopeRef`. |
| `GET /v1/wiki/lint` | Returns up to 100 governed pages and unresolved contradictions for a scope. |

Wiki search fuses vector and text retrieval and supports `fast`, `hybrid`, and `deep` recipes. Optional filters include kind, trust tier, state, privacy tier, maximum results, and minimum score. Search never changes the governance boundary: ranking runs over content visible to the principal.

Lint requires scope and scope reference and returns `{ pages, total, unresolvedContradictions }`. It is an inspection surface, not an automatic repair endpoint. The search pipeline is detailed in [wiki search and governance](../packages/wiki-engine/search-and-governance.md), while contradiction maintenance is covered in [maintenance and integrity](../packages/wiki-engine/maintenance-and-integrity.md).

## Revision history

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `GET /v1/wiki/revisions?slug=...` | Lists revisions for a page. Requires slug, scope, and scope reference; defaults to a 50-entry limit. |
| `GET /v1/wiki/revisions/{revision}?slug=...` | Returns one positive-numbered revision for the same identity. |

Revision access is gated by a governed read of the current page before history is queried. A caller who cannot read the live page therefore cannot use revision history as a side channel. Missing live pages return `WIKI_NOT_FOUND`; missing revision numbers return `WIKI_REVISION_NOT_FOUND`.

Updates create history automatically. The API does not expose a revision-restore route; a caller can read an old revision and issue a normal PATCH if policy permits.

## OKF interchange

Active contributors: Rom Iluz

| Method and path | Semantics |
| --- | --- |
| `POST /v1/wiki/okf-import` | Imports an OKF bundle directory into pages. Requires `bundleDir`, scope, scope reference, trust tier, and bundle ID. |
| `POST /v1/wiki/okf-export` | Exports governed pages for a scope to `outDir`; accepts an optional bundle ID and `returnContent`. |

Both directory arguments refer to the API server's filesystem, not the caller's local machine. Import runs transactionally, records the imported concept IDs in its mutation intent, and requires both normal write authorization and `change-permissions`. Export requires the `export` capability and applies the same governance filter as a list or get operation. `returnContent=true` includes exported file contents for remote callers that cannot access the server filesystem.

The OKF representation and connector boundary are documented in [OKF and connectors](../packages/wiki-engine/okf-and-connectors.md).

## Client behavior

Active contributors: Rom Iluz

`MdbrainClient` in `packages/client/src/client.ts` exposes `wikiSearch`, `wikiGet`, `wikiApply`, `wikiDelete`, `wikiLint`, `wikiExportOkf`, and `wikiImportOkf`. `wikiApply` implements create-or-update behavior by attempting POST, then issuing PATCH when creation returns HTTP 409. Both attempts share the original total deadline.

The client does not currently expose list or revision methods, and its wiki result types are `unknown`. Direct HTTP callers should use `apps/api/src/openapi-spec.ts` as the published contract and the route implementation for supported options such as transclusion and returned OKF content. MCP exposes only a subset, described in [MCP tools](mcp.md).

## Errors and content types

Active contributors: Rom Iluz

Wiki validation failures return `400`; authorization or governance failures return `403` or a not-found response where appropriate; duplicate creates return `409`; missing pages and revisions return `404`; store failures use operation-specific `5xx` codes such as `WIKI_SEARCH_FAILED` or `OKF_EXPORT_FAILED`. Responses follow the standard error envelope from the [HTTP API](index.md).

JSON is required for POST and PATCH bodies. A successful rendered get is the exception to JSON responses: Markdown uses `text/markdown; charset=utf-8`, and HTML is returned as HTML.

## Key source files

Active contributors: Rom Iluz

| File | Purpose |
| --- | --- |
| `apps/api/src/routes/v1.ts` | Wiki validation, governance context, transactions, rendering, revisions, search, lint, and OKF handlers |
| `apps/api/src/openapi-spec.ts` | Published wiki endpoint contract |
| `apps/api/src/app.ts` | Read, write, export, hard-delete, and administration capability assignment |
| `apps/api/src/wiki-store-runtime.ts` | Wiki store lifecycle, readiness, and transaction helper |
| `packages/wiki-engine/src/index.ts` | Public page, search, revision, rendering, governance, and OKF operations |
| `packages/client/src/client.ts` | Wiki client methods and create-or-update fallback |
| `apps/mcp/src/server.ts` | Agent-facing wiki tool schemas and HTTP-client dispatch |

## Related pages

Active contributors: Rom Iluz

- [API app](../apps/api.md)
- [MCP app](../apps/mcp.md)
- [Wiki engine](../packages/wiki-engine/index.md)
- [Governed wiki](../features/governed-wiki.md)
- [Security](../security.md)
- [Data model reference](../reference/data-models.md)
