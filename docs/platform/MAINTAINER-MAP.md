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

The captured upstream contract is immutable under
`docs/contracts/memongo/2.0.1`. Update it only through the contract capture and
compatibility review workflow.
