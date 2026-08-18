# Publishing MDBrain 2.0

Publish one coherent `2.0.0` cohort from the same commit:

1. `@mdbrain/lib`
2. `@mdbrain/wiki-engine`
3. `@mdbrain/memory-bridge`
4. `@mdbrain/client`
5. `@mdbrain/tools`
6. `@mdbrain/memory`

Before publishing:

```bash
bun install --frozen-lockfile
bun run lint
bun run check-types
bun run build
bun run test
bun run check-publishability
```

Inspect every packed tarball. It must contain built output and documentation,
must not contain source tests or secrets, and must declare exact `2.0.0`
dependencies on sibling public packages.
