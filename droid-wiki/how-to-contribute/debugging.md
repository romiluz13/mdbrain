# Debugging

Start with the narrowest observable boundary. Separate process health from dependency readiness, then inspect the dependency named by the failed check.

## Distinguish health from readiness

The API exposes two different probes:

```bash
curl -fsS "$MDBRAIN_API_URL/health"
curl -fsS "$MDBRAIN_API_URL/ready"
```

`/health` only confirms that `apps/api` is serving requests. `/ready` verifies the Memongo contract and required readiness lanes, pings the wiki database, and executes a wiki transaction. A failed `/ready` response returns HTTP 503 with `DEPENDENCY_NOT_READY` and identifies `memongo`, a more specific `memongo.contract`, `memongo.retrieval`, `memongo.control`, `memongo.embedding`, or `memongo.vector` dependency, or `wiki`.

Readiness probes are coalesced and cached for one second in `apps/api/src/app.ts`. Wait longer than one second before using a new response to confirm a configuration change.

## Diagnose Memongo configuration and contract failures

`packages/memory-bridge/src/memongo-runtime.ts` requires `MEMONGO_API_URL` and `MEMONGO_API_KEY`. If `MEMONGO_READINESS_CONTROL_LANES` includes `control`, `embedding`, or `vector`, it also requires `MEMONGO_CONTROL_API_KEY`. Lane names must be unique.

Check these conditions in order:

1. Confirm that the endpoint responds at `/health`, `/ready`, and `/openapi.json`.
2. Use HTTPS for non-loopback endpoints. Plain HTTP is accepted only for loopback development when `MEMONGO_ALLOW_INSECURE_LOCAL=1`.
3. Keep credentials out of `MEMONGO_API_URL`; pass them through the key variables.
4. Compare the advertised OpenAPI version and canonical digest with `MEMONGO_CONTRACT_VERSION` and `MEMONGO_CONTRACT_SHA256` in `packages/memory-bridge/src/memongo-runtime.ts`.
5. Inspect `packages/memory-bridge/src/memongo-http-client.test.ts` when changing status mapping, retries, redirects, or malformed-response handling.

MDBrain fails closed before a scoped request when the advertised contract is incompatible. Do not bypass that check to restore traffic.

`bun run contract:capture` runs `scripts/capture-memongo-contract.ts` against `MEMONGO_API_URL`. It reads Memongo's health, readiness, and OpenAPI endpoints, writes versioned evidence under `docs/contracts/memongo/`, and refuses to overwrite existing evidence. Run it only as part of an intentional contract capture and compatibility review.

## Diagnose wiki transaction failures

The wiki requires `MDBRAIN_WIKI_MONGODB_URI`. `MDBRAIN_WIKI_DATABASE` defaults to `mdbrain_wiki`, and `MDBRAIN_WIKI_COLLECTION_PREFIX` defaults to `mdbrain_`.

The readiness path in `apps/api/src/wiki-store-runtime.ts` does more than ping MongoDB: it starts a transaction and reads from the wiki pages collection. A standalone `mongod` can answer a ping but still fail with an error such as:

```text
Transaction numbers are only allowed on a replica set member or mongos
```

Use a replica set or sharded cluster. For local development, the canonical stack is the single-container Atlas Local preview:

```bash
./docker/mongodb/start-preview.sh
```

The connection settings are documented in `docker/mongodb/README.md`; `.env.example` shows the wiki variables expected by the API. The standalone tier in `docker/mongodb/docker-compose.mongodb.yml` does not support transactions and is not sufficient for integrated wiki mutation tests.

## Diagnose empty or failing wiki search

`packages/wiki-engine/src/wiki-schema.ts` creates ordinary MongoDB indexes separately from the `wiki_pages_vector` and `wiki_pages_text` search indexes. Search-index management requires `mongot`, available through Atlas or the Atlas Local preview stack. On plain Community Server without `mongot`, schema initialization logs that search-index management is unavailable and continues.

This graceful initialization does not make hybrid search available. `packages/wiki-engine/src/wiki-search.ts` returns an empty result when the search aggregation cannot use its indexes. If search unexpectedly returns no results:

1. Confirm that the deployment includes `mongot`, not only `mongod`.
2. Inspect the MongoDB startup and `mongot` logs described in `docker/mongodb/README.md`.
3. Confirm that both `wiki_pages_vector` and `wiki_pages_text` exist for the configured collection prefix.
4. For auto-embedding, use a MongoDB Atlas Model API key with an `al-` prefix. A direct Voyage `pa-` key is not accepted by the local `mongot` path.
5. Start Atlas Local preview with `VOYAGE_API_KEY` already set; it enables auto-embedding at container startup.

Native `$rerank` is optional. If the server rejects that stage, `packages/wiki-engine/src/wiki-search.ts` retries without reranking. A failure after that retry returns no search results, so inspect the underlying search-index availability rather than treating an empty array as proof that no page matches.

See [Hybrid retrieval](../features/hybrid-retrieval.md) and the [wiki search and governance package guide](../packages/wiki-engine/search-and-governance.md) for the complete retrieval path.

## Diagnose web build and deployment failures

Use the package-local commands to isolate the web application:

```bash
bun run --cwd apps/web check-types
bun run --cwd apps/web build
bun run --cwd apps/web test
bun run --cwd apps/web test:e2e
```

The type check runs Next.js type generation before TypeScript. The build transpiles `@mdbrain/client` and traces files from the monorepo root as configured in `apps/web/next.config.ts`.

For the Cloudflare path:

```bash
bun run web:preview
bun run web:deploy
```

Both commands build the OpenNext worker. Preview then starts Wrangler locally; deploy publishes through OpenNext. `apps/web/wrangler.jsonc` expects `.open-next/worker.js`, serves `.open-next/assets`, and names the Worker `mdbrain`. If preview or deploy cannot find those paths, inspect the OpenNext build step before changing Wrangler bindings.

Set `MDBRAIN_WEB_STATIC_EXPORT=true` only when you intend a Next.js static export. That setting changes `output` to `export` and disables Next.js image optimization in `apps/web/next.config.ts`; it is not the normal OpenNext Worker build.

Browser tests expect port 3040. If Playwright cannot start its server, check for an existing process on `http://127.0.0.1:3040` and run the package build separately to distinguish a Next.js compilation failure from a browser-test failure.

## Failure lookup

| Symptom | Check | Next action |
| --- | --- | --- |
| `/health` passes and `/ready` returns 503 | The `dependencies` field in the response | Follow the named Memongo or wiki section above. |
| `INCOMPATIBLE_CONTRACT` | Memongo `/openapi.json` version and canonical digest | Restore the pinned service version or perform the contract review and capture workflow. |
| Wiki ping works but readiness fails | Transaction support on the configured MongoDB topology | Use a replica set or sharded cluster. |
| Wiki search returns an empty result for known content | `mongot`, search indexes, and the Atlas model key | Restore the full search stack and allow indexes to initialize. |
| Vitest passes but web interaction is broken | `apps/web/e2e/showcase.e2e.ts` | Run `bun run --cwd apps/web test:e2e` on desktop and mobile projects. |
| Root build fails only in the web workspace | `apps/web` type generation and Next.js build output | Run the package-local check and build commands to expose the first web error. |

See the [API application](../apps/api.md), [web application](../apps/web.md), and [Context delivery](../features/context-delivery.md) for the boundaries behind these checks.
