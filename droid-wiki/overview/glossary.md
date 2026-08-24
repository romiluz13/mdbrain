# Glossary

MDBrain uses a small set of terms consistently across its API, packages, and storage model.

| Term | Meaning | Source |
| --- | --- | --- |
| Active slate | A bounded set of currently useful memory items prepared for an agent. | `packages/memory-bridge/src/mdbrain-bridge.ts` |
| Agent ID | Logical identity used to partition memory operations. It defaults to `MDBRAIN_AGENT_ID` or `main` in the bridge. | `packages/memory-bridge/src/mdbrain-bridge.ts` |
| Backlink | A reverse edge derived from another page’s relationship target. Superseded pages are excluded. | `packages/wiki-engine/src/wiki-backlinks.ts` |
| Context bundle | Prompt-ready, token-budgeted memory sections plus provenance and trust metadata. | `packages/client/src/client.ts` |
| Contradiction | A claim pair detected as conflicting and stored for resolution rather than silently discarded. | `packages/wiki-engine/src/wiki-contradictions.ts` |
| Delivery intent | Durable record of a memory write and optional wiki promotion. | `packages/wiki-engine/src/memory-delivery.ts` |
| Discovery projection | Structured brief for an entity, topic, change set, or contradiction report. | `packages/memory-bridge/src/mdbrain-bridge.ts` |
| Dreamer | Five-phase maintenance path that scans novelty, similarity, injection risk, extraction, and promotion. | `packages/wiki-engine/src/wiki-maintenance.ts` |
| Governance context | Scope, trust tier, roles, departments, groups, capabilities, and agent identity used to filter reads. | `packages/wiki-engine/src/wiki-governance.ts` |
| Hybrid search | Server-side fusion of semantic and lexical retrieval, optionally followed by reranking and graph expansion. | `packages/wiki-engine/src/wiki-search.ts` |
| Memongo | Separate HTTP service that owns long-term memory storage and retrieval. MDBrain pins its contract. | `packages/memory-bridge/src/memongo-runtime.ts` |
| Mutation intent | Idempotency and audit record for a wiki create, update, delete, or OKF import. | `packages/wiki-engine/src/wiki-mutation-intents.ts` |
| OKF | Open Knowledge Format, a concept-per-page interchange format imported and exported by the wiki engine. | `packages/wiki-engine/src/okf.ts` |
| Receipt-gated promotion | Rule that wiki promotion can begin only after the memory service returns a durable write receipt. | `apps/api/src/memory-delivery-runtime.ts` |
| Recall profile | Retrieval tuning preset such as latency, balanced, or proof. | `packages/client/src/types.ts` |
| Scope | Isolation boundary: session, user, agent, workspace, tenant, or global. | `packages/lib/src/types.memory.ts` |
| Scope reference | Identifier within a scope, such as a tenant, workspace, or session key. | `packages/client/src/types.ts` |
| Stable handle | Revision-aware locator for a structured memory or procedure lifecycle item. | `packages/memory-bridge/src/memory-contract-types.ts` |
| Superseded | Lifecycle state that retains historical data while excluding it from ordinary active reads. | `packages/wiki-engine/src/wiki-schema.ts` |
| Transclusion | Inline inclusion of another wiki page or section using `{{page:slug}}` syntax. | `packages/wiki-engine/src/wiki-transclusion.ts` |
| Trust tier | Wiki access tier: restricted, standard, or admin. | `packages/wiki-engine/src/wiki-governance.ts` |
| Wiki page | Structured MongoDB document containing content, claims, evidence, relationships, questions, lifecycle, and governance fields. | `packages/wiki-engine/src/wiki-bridge.ts` |

For the component relationships behind these terms, see [Architecture](architecture.md). Data shapes are collected in [Data models](../reference/data-models.md).
