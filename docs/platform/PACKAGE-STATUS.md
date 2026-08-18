# Package status

| Package | Status | Role |
|---|---|---|
| `packages/wiki-engine` | supported | MDBrain-owned governed wiki and MongoDB store |
| `packages/memory-bridge` | supported | pinned Memongo HTTP gateway |
| `packages/client` | supported | public MDBrain HTTP client |
| `packages/tools` | supported | AI SDK tools for supported client operations |
| `packages/mdbrain-memory` | supported | aggregate client and gateway exports |
| `packages/lib` | runtime support | shared published types |

MDBrain does not ship or import a memory engine. Memongo owns memory storage and
is consumed only through the captured HTTP contract in `docs/contracts/memongo`.
