# MDBrain platform

MDBrain 2.0 is a governed wiki and orchestration gateway over Memongo HTTP.

```text
apps/api -> packages/memory-bridge -> Memongo HTTP
        \-> packages/wiki-engine -> wiki MongoDB
```

The two storage domains are separate. MDBrain never accesses Memongo
collections and Memongo never owns wiki collections. Use `/health` for process
liveness and `/ready` for dependency and contract readiness.

See:

- `docs/platform/self-host.md`
- `docs/platform/validation-pack.md`
- `docs/platform/capability-matrix.md`
- `docs/platform/publish.md`
