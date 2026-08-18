# Production-ready checklist

## Dependencies

- Memongo exposes the pinned contract version and SHA-256.
- `MDBRAIN_WIKI_MONGODB_URI` targets a replica set or sharded cluster.
- MDBrain and Memongo credentials are separate and least-privileged.
- `MDBRAIN_API_KEY` or scoped keys protect every network deployment.

## Gates

```bash
bun install --frozen-lockfile
bun run lint
bun run check-types
bun run build
bun run test
bun run check-publishability
```

With real dependencies configured:

```bash
curl -fsS "$MDBRAIN_API_URL/ready"
bun run proof-pack
bun run memory-eval
bun run agent-smoke
```

Do not promote if readiness, contract compatibility, transaction support,
scope isolation, idempotency replay, delivery reconciliation, or redaction
checks fail.
