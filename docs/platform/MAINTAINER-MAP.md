# Maintainer map

| Area | Primary code |
|---|---|
| Memongo contract and gateway | `packages/memory-bridge/src/memongo-*` |
| API orchestration and security | `apps/api/src` |
| Durable delivery | `apps/api/src/memory-delivery-runtime.ts`, `packages/wiki-engine/src/memory-delivery.ts` |
| Wiki storage and governance | `packages/wiki-engine/src` |
| Public client | `packages/client/src` |
| MCP and AI tools | `apps/mcp/src`, `packages/tools/src` |
| Integrated proof | `scripts/proof-pack.ts`, `scripts/memory-eval-core.ts`, `scripts/real-agent-smoke.ts` |

The current Memongo contract is pinned by version, canonical SHA-256, and source
revision in `packages/memory-bridge/src/memongo-runtime.ts`. New captures are
immutable snapshots under `docs/contracts/memongo/<version>/<canonicalSha256>/`;
the original version-only capture is retained as historical evidence. Use the
contract capture and pin-bump scripts, then review compatibility and run the
integration tests. The nightly rail proposes draft updates; merging and
redeploying remain explicit steps. The rail stages the README checkout command
with the source pin so the quickstart and CI use the same upstream revision.

Search and KB responses retain Memongo's optional `degradation` marker. A
throttled empty response is not evidence that no memory exists; clients should
honor `retryAfterMs`. Detailed search and conversation recall retain
`metadata.throttled`. Explicit constraints stay hard by default; callers may opt
in to relaxation with `searchConfig.allowConstraintRelaxation: true`. Agent
erasure conflicts remain nonretryable `ERASURE_GATE_CONFLICT` failures; resolve
the upstream erasure before explicitly redriving a dead-lettered delivery.
