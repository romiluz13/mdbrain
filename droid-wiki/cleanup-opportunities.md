# Cleanup opportunities

This page lists maintenance opportunities verified against the current source tree. It does not infer dead code from names or import counts, and it does not make dependency-freshness claims.

## Split oversized maintained source files

Repository guidance prefers files under about 500 lines. The following maintained source files currently exceed that guideline; generated output, dependencies, build artifacts, and tests are excluded.

| Lines | File | Useful split boundary |
| ---: | --- | --- |
| 2,502 | [`apps/api/src/routes/v1.ts`](../apps/api/src/routes/v1.ts) | Separate memory, wiki, lifecycle, delivery-admin, and route-validation modules. |
| 2,337 | [`apps/api/src/openapi-spec.ts`](../apps/api/src/openapi-spec.ts) | Split schemas and path groups, then assemble one exported document. |
| 1,571 | [`apps/mcp/src/server.ts`](../apps/mcp/src/server.ts) | Separate tool definitions, input schemas, and handlers by domain. |
| 1,417 | [`apps/web/app/demo/demo.module.css`](../apps/web/app/demo/demo.module.css) | Split layout, panels, visualization, and responsive styles. |
| 1,310 | [`apps/web/app/landing.module.css`](../apps/web/app/landing.module.css) | Split section and component styles. |
| 1,220 | [`packages/wiki-engine/src/okf.ts`](../packages/wiki-engine/src/okf.ts) | Separate parsing, normalization, projection, import, and export. |
| 1,078 | [`packages/client/src/client.ts`](../packages/client/src/client.ts) | Separate memory, wiki, lifecycle, and administrative client methods. |
| 941 | [`packages/wiki-engine/src/wiki-schema.ts`](../packages/wiki-engine/src/wiki-schema.ts) | Separate page, revision, mutation-intent, and delivery-intent schemas and indexes. |
| 869 | [`packages/client/src/types.ts`](../packages/client/src/types.ts) | Group public types by the same client domains. |
| 786 | [`packages/wiki-engine/src/wiki-bridge.ts`](../packages/wiki-engine/src/wiki-bridge.ts) | Separate normalization, reads, writes, and rendering-facing conversion. |
| 726 | [`scripts/memory-eval-core.ts`](../scripts/memory-eval-core.ts) | Separate fixture loading, execution, and reporting. |
| 689 | [`apps/web/app/globals.css`](../apps/web/app/globals.css) | Separate tokens, resets, shared primitives, and global utilities. |
| 673 | [`scripts/real-agent-smoke.ts`](../scripts/real-agent-smoke.ts) | Separate scenario setup, execution, and assertions. |
| 656 | [`apps/web/app/console/page.tsx`](../apps/web/app/console/page.tsx) | Extract data hooks and independent console panels. |
| 608 | [`packages/memory-bridge/src/mdbrain-bridge.ts`](../packages/memory-bridge/src/mdbrain-bridge.ts) | Group compatibility facade functions by operation domain. |
| 583 | [`apps/api/src/memory-delivery-runtime.ts`](../apps/api/src/memory-delivery-runtime.ts) | Separate promotion validation, dispatch, and reconciliation. |
| 549 | [`packages/wiki-engine/src/wiki-connectors.ts`](../packages/wiki-engine/src/wiki-connectors.ts) | Give each connector its own module while retaining the common interface and registry. |
| 520 | [`apps/api/src/app.ts`](../apps/api/src/app.ts) | Extract middleware and readiness composition. |
| 518 | [`packages/memory-bridge/src/memongo-http-client.ts`](../packages/memory-bridge/src/memongo-http-client.ts) | Separate URL and transport policy, compatibility caching, and response handling. |

Splitting should preserve public exports and tests. Line count alone is not evidence that a module is incorrect, so each split should follow an existing domain seam rather than create generic helper files.

## Add focused tests where only indirect coverage exists

The following gaps are based on current test filenames and symbol searches:

- [`apps/api/src/wiki-store-runtime.ts`](../apps/api/src/wiki-store-runtime.ts) has no dedicated test. API and delivery tests mock its exports, so they do not exercise singleton initialization, transaction forwarding, readiness transaction behavior, or shutdown.
- [`apps/api/src/openapi-spec.ts`](../apps/api/src/openapi-spec.ts) has no dedicated test. `apps/api/src/app.test.ts` checks selected paths and properties through `/openapi.json`, but a focused contract test could compare all registered public routes and intentional omissions.
- [`packages/tools/src/write-event.ts`](../packages/tools/src/write-event.ts) has no dedicated test. OpenAI and Vercel adapter tests exercise its effects indirectly; a focused suite could pin retry counts, idempotency-key reuse, callback failure handling, and non-retryable responses.
- `packages/lib` has only [`packages/lib/src/redact.test.ts`](../packages/lib/src/redact.test.ts). Security- and reliability-sensitive helpers in [`packages/lib/src/ssrf.ts`](../packages/lib/src/ssrf.ts), [`packages/lib/src/secrets.ts`](../packages/lib/src/secrets.ts), [`packages/lib/src/retry.ts`](../packages/lib/src/retry.ts), and [`packages/lib/src/auth.ts`](../packages/lib/src/auth.ts) have no direct test references. Parameterized tests would make hostname edge cases, secret normalization, retry bounds, and provider-key resolution explicit.

Not every file without a matching `*.test.ts` is untested. For example, [`packages/wiki-engine/src/wiki-renderer.ts`](../packages/wiki-engine/src/wiki-renderer.ts) is covered in `packages/wiki-engine/src/wiki-bridge.test.ts`, and filesystem containment is exercised through OKF and connector tests.

## Finish or clearly gate connector stubs

[`packages/wiki-engine/src/wiki-connectors.ts`](../packages/wiki-engine/src/wiki-connectors.ts) contains valid interfaces and permission-mapping seams, but several implementations stop before live ingestion:

| Connector | Verified current limit |
| --- | --- |
| Obsidian | Discovers and exports Markdown, but `ingest()` reports counts without creating or updating wiki pages. |
| GitHub | `discover()` returns an empty source list, and `ingest()` performs no wiki write. |
| Confluence | Validates configuration and maps space restrictions; discovery returns no sources, and ingestion performs no wiki write. |
| Notion | Validates the integration token and maps sharing metadata; discovery and ingestion are stubs. |
| Slack | Validates bot-token shape and maps channel privacy; discovery and ingestion are stubs. |
| CRM | Validates provider credentials and maps record ownership; discovery and ingestion are stubs. |

The practical cleanup is either to implement source access, durable cursors, governed writes, ACL revocation, deletion, and replay for a connector or to keep it explicitly labeled preview/read-first. Registration alone must not imply production synchronization.

## Preserve the zero-marker baseline

A case-sensitive search for `TODO`, `FIXME`, and `HACK` across active TypeScript and JavaScript under `apps/`, `packages/`, and `scripts/` returns zero matches. There is no marker-cleanup backlog in active code.

Keep this baseline by linking deferred work to an issue or this page instead of leaving unactionable markers. This result does not prove that all cleanup work is complete; the concrete opportunities above come from file size, test structure, and implemented connector behavior.

## Suggested order

1. Add direct tests for wiki-store runtime behavior and the security-sensitive shared helpers.
2. Split the API router and OpenAPI document around the same route domains, with parity tests in place first.
3. Split the MCP server and client along those domains.
4. Split wiki schema, OKF, bridge, and connector modules without changing their public package surface.
5. Implement one connector end to end before expanding additional connector shells.

See [By the numbers](by-the-numbers.md) for the broader source inventory and [Background pitfalls](background/pitfalls.md) for invariants that cleanup must preserve.
