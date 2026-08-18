# Validation pack

## Local gates

```bash
bun install --frozen-lockfile
bun run lint
bun run check-types
bun run build
bun run test
bun run check-publishability
```

## Integrated gates

Against live Memongo and wiki MongoDB:

1. `/ready` returns the pinned contract version and SHA-256.
2. Replaying an identical idempotent write returns the same receipt.
3. Reusing the key with another payload returns a conflict.
4. Ambiguous upstream outcomes remain `outcome-unknown`.
5. Explicit wiki promotion occurs only after a receipt and is replay-safe.
6. Governed wiki reads cannot cross scope or permissions.
7. Admin delivery output contains no payload, key, fingerprint, or principal.
8. OKF import and all wiki mutations fail closed without transactions.

Run:

```bash
bun run proof-pack
bun run memory-eval
bun run agent-smoke
```
