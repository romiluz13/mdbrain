# Configuration

MDBrain reads configuration from environment variables at process startup. `.env.example` is the copyable local-development template; the source files named in each section define actual defaults and validation.

Do not commit populated environment files, connection strings, or API keys. Browser-visible variables beginning with `NEXT_PUBLIC_` are public configuration and must never contain secrets.

## API

The HTTP server and TypeScript client use related but distinct settings.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MDBRAIN_API_HOST` | No | `127.0.0.1` | Address used by the Node HTTP server. |
| `MDBRAIN_API_PORT` | No | `3847` | Port used by the Node HTTP server. |
| `MDBRAIN_API_URL` | No | `http://127.0.0.1:3847` | API base URL used by `@mdbrain/client`, the MCP server, and operational scripts. |
| `MDBRAIN_API_KEY` | Production: one authentication source is required | Unset | Administrator bearer token for `/v1/*`; it also supplies the client or MCP bearer token when no constructor option is provided. |
| `MDBRAIN_API_ADMIN_SUBJECT_ID` | No | `api-key:admin` | Stable subject ID assigned to the administrator principal. |
| `MDBRAIN_API_SCOPED_KEYS` | Production: one authentication source is required | Empty | JSON array or object of constrained API-key policies. It can be used with or instead of the administrator key. |
| `MDBRAIN_API_CORS_ORIGINS` | No | No explicit origin list | Comma-separated allowed origins passed to Hono CORS middleware. |
| `MDBRAIN_API_RATE_LIMIT_MAX` | No | `100` | Maximum requests per in-memory, per-IP window. Set `0` or a negative value to disable the limiter. |
| `MDBRAIN_API_RATE_LIMIT_WINDOW_MS` | No | `60000` | Sliding rate-limit window in milliseconds. |
| `MDBRAIN_API_TRUST_PROXY` | No | `false` | When exactly `true`, use the first `X-Forwarded-For` address. Otherwise, use `X-Real-IP` or `unknown`. Enable it only behind a proxy that overwrites forwarding headers. |
| `MDBRAIN_DELIVERY_RECONCILE_MS` | No | `5000` | Interval in milliseconds for the memory-delivery reconciler. |
| `MDBRAIN_ENV` | No | Unset | Setting it to `production`, like `NODE_ENV=production`, prevents startup without an API key source. |

`apps/api/src/server.ts` defines the listen address and reconciliation interval. `apps/api/src/app.ts` defines CORS, rate limiting, authentication, and production startup checks. `packages/client/src/transport.ts` defines the client URL fallback and bearer-token lookup.

When both `MDBRAIN_API_KEY` and `MDBRAIN_API_SCOPED_KEYS` are absent, development starts with a standard-tier, unrestricted in-process principal and logs a warning. Production startup fails closed.

### Scoped API-key policy

Each `MDBRAIN_API_SCOPED_KEYS` entry requires `token` and at least one of `agentIds`, `scopes`, or `scopeRefs`. The parser in `apps/api/src/principal.ts` accepts an array of policy objects or an object keyed by token.

| Policy field | Default | Rules |
| --- | --- | --- |
| `subjectId` | A non-secret SHA-256-derived key fingerprint | Must be unique across policies. |
| `displayName` | Unset | Non-empty string when supplied. |
| `agentIds` | `["*"]` | Non-empty string array. |
| `scopes` | `["*"]` | Values are `session`, `user`, `agent`, `workspace`, `tenant`, `global`, or `*`. |
| `scopeRefs` | `["*"]` | Non-empty string array. Scope and scope-reference grants are paired. |
| `groups` | `[]` | Each group must be namespaced, such as `team:platform`. |
| `roles` | `[]` | Non-empty string array when supplied. |
| `departments` | `[]` | Non-empty string array when supplied. |
| `trustTier` | `standard` | `restricted`, `standard`, or `admin`. |
| `capabilities` | `["read", "write"]` | Any subset of `read`, `write`, `administer`, `change-permissions`, `hard-delete`, `export`, and `manage-connectors`. |
| `membershipValidUntil` | Unset | A parseable date-time; expired identities are rejected. |
| `active` | `true` | Exactly `false` marks the identity as stale. |

Keep tokens out of documentation and source control. A shape-only example is:

```json
[
  {
    "token": "replace-with-a-secret",
    "subjectId": "service:example-agent",
    "agentIds": ["agent-1"],
    "scopes": ["tenant"],
    "scopeRefs": ["tenant-1"],
    "capabilities": ["read", "write"]
  }
]
```

## Wiki

The wiki has its own MongoDB connection and collection namespace.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MDBRAIN_WIKI_MONGODB_URI` | Yes for wiki initialization | None | MongoDB URI used only by `WikiStore`. Use a replica set or sharded cluster for transaction-backed operations. |
| `MDBRAIN_WIKI_DATABASE` | No | `mdbrain_wiki` | Wiki database name. |
| `MDBRAIN_WIKI_COLLECTION_PREFIX` | No | `mdbrain_` | Prefix for `wiki_pages`, `wiki_revisions`, `wiki_mutation_intents`, and `memory_delivery_intents`. |
| `MDBRAIN_OKF_ALLOWED_ROOTS` | Required by default for filesystem OKF import/export | None | Comma-separated allowed root directories. Candidate paths must remain under one of these roots. |
| `MDBRAIN_OKF_ALLOW_UNRESTRICTED` | No | `false` | Exactly `true` bypasses the OKF root restriction. This is an explicit local-development escape hatch. |

`packages/wiki-engine/src/wiki-store.ts` resolves the connection settings. `packages/wiki-engine/src/okf.ts` enforces the OKF filesystem boundary.

For local storage, `docker/docker-compose.minimal.yml` starts MongoDB 7 as a single-node replica set on port `27017`. `docker/mongodb/docker-compose.preview.yml` starts Atlas Local Preview with search and auto-embedding support. `docker/mongodb/docker-compose.mongodb.yml` provides `standalone`, `replicaset`, and `fullstack` profiles; standalone mode does not provide transactions or vector search.

## Memongo and memory identity

MDBrain uses Memongo through a version-pinned HTTP gateway. The API runtime requires the upstream URL and tenant credential.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MEMONGO_API_URL` | Yes | None | Base URL for the Memongo HTTP service. Credential-bearing URLs are rejected. |
| `MEMONGO_API_KEY` | Yes | None | Tenant credential sent to Memongo. |
| `MEMONGO_CONTROL_API_KEY` | When control readiness lanes are configured | Unset | Credential for control, embedding, and vector probes. |
| `MEMONGO_READINESS_CONTROL_LANES` | No | Empty | Comma-separated unique values from `control`, `embedding`, and `vector`. |
| `MEMONGO_TIMEOUT_MS` | No | `10000` | Positive request timeout in milliseconds. |
| `MEMONGO_COMPATIBILITY_TTL_MS` | No | `60000` | Compatibility-check cache lifetime in milliseconds; `0` disables caching. |
| `MEMONGO_ALLOW_INSECURE_LOCAL` | No | `false` | Exactly `1` permits plain HTTP only for loopback hosts. |
| `MDBRAIN_AGENT_ID` | No | `main` | Default logical memory partition when a call omits `agentId`. |

`packages/memory-bridge/src/memongo-runtime.ts` defines these requirements and pins the accepted Memongo contract version and digest. `packages/memory-bridge/src/mdbrain-bridge.ts` applies the default agent ID.

`packages/memory-bridge/src/memory-config.ts` also contains a standalone configuration-file helper retained inside the package:

| Variable | Default | Resolution |
| --- | --- | --- |
| `MDBRAIN_CONFIG_PATH` | `~/.mdbrain/mdbrain.json` | JSON configuration file path. |
| `MDBRAIN_WORKSPACE_DIR` | `~/.mdbrain/workspace` | Default agent workspace path. |
| `MDBRAIN_FORCE_MONGODB_URI` | Unset | Highest-precedence MongoDB URI in this helper. |
| `MDBRAIN_MONGODB_URI` | Unset | Fallback URI after the forced value and file value. |
| `MDBRAIN_MONGODB_COLLECTION_PREFIX` | File value or unset | Overrides the file's collection prefix when non-empty. |

The current API memory path uses the Memongo HTTP variables, not this MongoDB helper.

## Logging

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MDBRAIN_LOG_LEVEL` | No | `info` | Minimum shared logger level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. Invalid values continue to the debug-flag checks and then fall back to `info`. |
| `MDBRAIN_DEBUG` | No | Unset | Exactly `1` selects `debug` when `MDBRAIN_LOG_LEVEL` is absent or invalid. |
| `DEBUG` | No | Unset | Exactly `1` has the same debug fallback behavior as `MDBRAIN_DEBUG`. |

`packages/lib/src/logger.ts` resolves the level on each log decision and writes structured metadata as JSON on the console line.

## Embeddings and reranking

The local search stack consumes Atlas Model API keys. Do not use direct Voyage `pa-...` keys with the default `https://ai.mongodb.com` endpoint; `docker/mongodb/setup-generator.sh` requires `al-...` keys there.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VOYAGE_API_KEY` | For auto-embedding unless both lane-specific keys are supplied | Unset | Generic Atlas Model API key used as the fallback for indexing and query embeddings. |
| `VOYAGE_API_INDEXING_KEY` | No | `VOYAGE_API_KEY` | Separate key for indexing-time embeddings in the community-search stack. |
| `VOYAGE_API_QUERY_KEY` | No | `VOYAGE_API_KEY` | Separate key for query-time embeddings in the community-search stack. |
| `VOYAGE_RERANK_API_KEY` | No | Unset | Reserved in `.env.example`; current repository runtime code does not read it. |
| `MONGOT_EMBEDDING_PROVIDER_ENDPOINT` | No | `https://ai.mongodb.com/v1/embeddings` | Embedding endpoint written into generated `mongot` configuration. |

The Atlas Local Preview compose file passes `VOYAGE_API_KEY` directly. The community-search setup in `docker/mongodb/docker-compose.mongodb.yml` generates protected query and indexing key files before starting `mongot`.

The Docker profiles also accept operational port and bootstrap settings: `MONGODB_PORT` defaults to `27017`; `MONGOT_GRPC_PORT`, `MONGOT_HEALTH_PORT`, and `MONGOT_METRICS_PORT` default to `27028`, `8080`, and `9946`; `ADMIN_PASSWORD` and `MONGOT_PASSWORD` have development defaults in the compose file and must be replaced outside disposable local environments.

## LLM and provider credentials

The real-agent smoke script uses an OpenAI-compatible chat-completions endpoint.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MDBRAIN_LLM_API_KEY` | For `bun run agent-smoke` | None | Credential for the smoke-test LLM endpoint. |
| `MDBRAIN_LLM_BASE_URL` | For `bun run agent-smoke` | Template: `https://api.openai.com/v1`; script: none | Base URL for the OpenAI-compatible provider. |
| `MDBRAIN_LLM_MODEL` | For `bun run agent-smoke` | Template: `gpt-4o-mini`; script: none | Provider model identifier. |
| `MDBRAIN_LLM_AUTH_STYLE` | No | `authorization-bearer` | `authorization-bearer`, `api-key`, or `x-api-key`. |
| `MDBRAIN_LLM_TOKEN_PARAM` | No | `max_tokens` | `max_tokens` or `max_completion_tokens`. |
| `MDBRAIN_ENRICHMENT_API_KEY` | No | Unset | Reserved enrichment credential in `.env.example`; current repository runtime code does not read it. |
| `MDBRAIN_ENRICHMENT_BASE_URL` | No | `https://api.openai.com/v1` in `.env.example` | Reserved enrichment endpoint; current repository runtime code does not read it. |
| `MDBRAIN_ENRICHMENT_MODEL` | No | `gpt-4o-mini` in `.env.example` | Reserved enrichment model; current repository runtime code does not read it. |
| `MDBRAIN_ENRICHMENT_AUTH_STYLE` | No | `authorization-bearer` in `.env.example` | Reserved enrichment authentication style; current repository runtime code does not read it. |
| `MDBRAIN_ENRICHMENT_TOKEN_PARAM` | No | `max_tokens` in `.env.example` | Reserved enrichment token parameter; current repository runtime code does not read it. |

`scripts/real-agent-smoke.ts` validates the `MDBRAIN_LLM_*` values. `packages/lib/src/auth.ts` provides generic provider-key lookup for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Google or Gemini variants, `VOYAGE_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, Together variants, `FIREWORKS_API_KEY`, Perplexity variants, Cohere variants, `XAI_API_KEY`, and generic `<PROVIDER>_API_KEY` or `MDBRAIN_<PROVIDER>_API_KEY` names. Those keys are required only when a caller selects the corresponding helper and provider.

## Web

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MDBRAIN_WEB_STATIC_EXPORT` | No | `false` | Exactly `true` selects Next.js static export and unoptimized images. |
| `NEXT_PUBLIC_SITE_URL` | No | `https://mdbrain.dev` | Public metadata base and Open Graph URL. |
| `NEXT_PUBLIC_MDBRAIN_API_URL` | No | `http://127.0.0.1:3847` | Browser-visible default API URL in the operator console. |

`apps/web/next.config.ts` controls the export mode. `apps/web/app/layout.tsx` and `apps/web/app/console/page.tsx` read the two public values. For Cloudflare deployment, `apps/web/wrangler.jsonc` defines the Worker name, assets binding, self-reference service binding, Node.js compatibility flags, and observability; it does not declare additional environment variables.

See [Getting started](../overview/getting-started.md) for a minimal local environment and [Data models](data-models.md) for the records governed by these settings.
