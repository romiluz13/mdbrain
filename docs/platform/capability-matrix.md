# Capability matrix

## Tenant product operations

| Capability | API | Client | MCP / AI tools |
|---|---|---|---|
| Search and KB search | `/v1/search`, `/v1/search-detailed`, `/v1/search-kb` | yes | yes |
| Conversation recall | `/v1/recall-conversation` | yes | yes |
| Idempotent event writes | `/v1/add`, `/v1/write-event` | yes | yes |
| Structured and procedure writes | `/v1/write-structured`, `/v1/write-procedure` | yes | yes |
| State and context | `/v1/state`, `/v1/hydrate-active-slate`, `/v1/discovery-projection`, `/v1/context-bundle` | yes | yes |
| Lifecycle and feedback | `/v1/lifecycle/*`, `/v1/procedures/outcome`, `/v1/memory/feedback` | yes | yes |

Provider status, embedding/vector probes, filesystem reads, sync, raw stats,
relevance diagnostics, benchmarks, imports, traces, jobs, novelty,
consolidation, and self-edit are intentionally absent from tenant REST,
OpenAPI, client, MCP, AI tools, and web surfaces.

## Server-local operations

| Capability | Surface | Product SDK / agent tools |
|---|---|---|
| Process liveness | `GET /health` | no |
| Dependency and contract readiness | `GET /ready` | no |
| API discovery | `GET /openapi.json` | no |
| Memongo status and embedding/vector probes | `@mdbrain/memory-bridge` control operations used by server/operator composition | no |

`GET /ready` remains the application readiness endpoint and composes Memongo
bridge readiness with wiki-store readiness. Low-level Memongo status and probe
operations remain classified as control operations for trusted server-local
operator workflows; they are not tenant product capabilities.

## MDBrain-owned wiki

CRUD, revisions, governed search, lint, OKF import/export, and maintenance run
through `WikiStore`. Connector ingestion is read-only discovery. Durable
delivery state is visible through redacted `GET /v1/admin/deliveries`.
