# Reference

These pages collect MDBrain's configuration, public data shapes, and direct dependencies. They describe the current repository rather than a proposed deployment.

## Reference pages

| Page | Use it to |
| --- | --- |
| [Configuration](configuration.md) | Set API, wiki, Memongo, logging, embedding, LLM, and web environment variables. |
| [Data models](data-models.md) | Understand the wiki, governance, memory lifecycle, context bundle, delivery, mutation, and principal records. |
| [Dependencies](dependencies.md) | Trace workspace package edges, external libraries, infrastructure, and development tooling. |

## Source map

| Subject | Authoritative source |
| --- | --- |
| Environment template | `.env.example` |
| Workspace and scripts | `package.json` and package-level `package.json` files |
| API runtime | `apps/api/src/app.ts`, `apps/api/src/server.ts`, and `apps/api/src/principal.ts` |
| Memongo boundary | `packages/memory-bridge/src/memongo-runtime.ts` and `packages/memory-bridge/src/memongo-http-client.ts` |
| Wiki storage | `packages/wiki-engine/src/wiki-store.ts` and `packages/wiki-engine/src/wiki-schema.ts` |
| Public client models | `packages/client/src/client.ts` and `packages/client/src/types.ts` |
| Local MongoDB | `docker/docker-compose.minimal.yml` and `docker/mongodb/` |
| Continuous integration | `.github/workflows/ci.yml` and `.github/workflows/publish.yml` |

For system boundaries and request flow, see [Architecture](../overview/architecture.md). For the shortest local setup, see [Getting started](../overview/getting-started.md).
