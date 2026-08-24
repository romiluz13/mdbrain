# Background

MDBrain is a governed company wiki backed by MongoDB and paired with Memongo for long-term agent memory. Wiki pages are the durable, browsable product artifact; Memongo supplies memory ingestion, lifecycle, and retrieval through a versioned HTTP service.

## How the product took shape

The July 2026 design moved the repository from a memory-first framework toward an LLM-maintained wiki. Its three-layer model separated raw evidence and graph data, synthesized `wiki_pages`, and the schemas and policies that govern those pages. Claims, evidence, contradictions, questions, relationships, backlinks, revisions, and maintenance metadata became first-class wiki data rather than incidental retrieval output.

That first design still assumed a local copied memory engine. The August 2026 architecture review found that the copy had diverged from Memongo in correctness, durability, retrieval, and operations. The accepted replacement kept MDBrain's wiki and product work while moving memory operations behind authenticated HTTP. The source cutover landed in commit `09ca531` on August 19, 2026.

The current boundary is:

```text
Applications, agents, and operators
                 |
                 v
          MDBrain API
          /           \
         v             v
MDBrain wiki store   Memory bridge
         |             |
         v             v
  wiki MongoDB      Memongo HTTP
                       |
                       v
                memory MongoDB
```

MDBrain and Memongo may use one physical MongoDB cluster in local or OSS deployments, but they use separate logical databases and credentials. They never share collection ownership or schema initialization.

## Why the wiki is separate from memory

Wiki and memory have different responsibilities and lifecycles.

- Memongo owns events, structured and procedural memory, episodes, graph data, knowledge-base chunks, memory jobs, and retrieval state.
- MDBrain owns wiki pages, revisions, governance, connectors, OKF interchange, delivery intents, promotion policy, and user-facing product surfaces.
- The boundary lets Memongo improve independently without forcing MDBrain to copy source or synchronize an internal fork.
- Separate databases, credentials, migrations, backups, and release cadences limit failure and compromise scope.
- An unavailable Memongo dependency remains visible as a dependency failure or degraded result. MDBrain does not silently fall back to a stale local engine.

See [Design decisions](design-decisions.md) for the reasons behind this split and [Migration context](migration-context.md) for how the August 2026 cutover happened.

## Where to continue

- [Design decisions](design-decisions.md) explains ownership, MongoDB and Atlas, governance ordering, and durable delivery.
- [Migration context](migration-context.md) records the transition from the copied engine to the Memongo HTTP contract.
- [Pitfalls](pitfalls.md) lists invariants that are easy to break.
- [Architecture](../overview/architecture.md) traces current runtime requests.
- [Wiki engine](../packages/wiki-engine/index.md) documents the MDBrain-owned knowledge layer.
- [Memory bridge](../packages/memory-bridge.md) documents the Memongo boundary.
- [Cleanup opportunities](../cleanup-opportunities.md) lists verified maintenance work in the current tree.

The original rationale is preserved in [`docs/specs/2026-07-08-mdbrain-llm-wiki-design.md`](../../docs/specs/2026-07-08-mdbrain-llm-wiki-design.md). The accepted service-boundary specification is [`docs/specs/2026-08-16-mdbrain-refactor-over-memongo-http.md`](../../docs/specs/2026-08-16-mdbrain-refactor-over-memongo-http.md).
