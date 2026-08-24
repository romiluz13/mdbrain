# Testing

MDBrain uses Vitest for package and application tests, Playwright for browser behavior, axe for accessibility checks within the browser suite, and explicit scripts for live dependency evidence. Run the narrowest useful test first, then the gates required by the affected surface.

## Run Vitest tests

Tests are colocated with source as `*.test.ts` or `*.test.tsx`. Run one file from the repository root while iterating:

```bash
bunx vitest run packages/memory-bridge/src/memongo-http-client.test.ts
bunx vitest run packages/wiki-engine/src/wiki-search.test.ts
bunx vitest run apps/web/app/landing-page.test.tsx
```

Run a workspace's test script when the change spans several files:

```bash
bun run --cwd apps/api test
bun run --cwd apps/mcp test
bun run --cwd apps/web test
bun run --cwd packages/wiki-engine test
```

Run the repository suite before opening a pull request:

```bash
bun run test
```

The root command runs each workspace `test` task through Turborepo, after building its dependencies, and then runs `scripts/*.test.ts`. Workspaces without a `test` script do not add a test task.

## Use the established mock boundaries

Tests isolate external systems at their owning boundary:

- `apps/api/src/app.test.ts` constructs the Hono application directly and mocks `@mdbrain/memory-bridge` plus `apps/api/src/wiki-store-runtime.ts`.
- `apps/api/src/wiki-routes.test.ts` mocks the wiki engine and memory bridge so it can verify HTTP validation and response shaping.
- `packages/memory-bridge/src/memongo-http-client.test.ts` supplies a fake `fetch` implementation to verify authentication, contract checks, retries, idempotency, and response validation.
- `packages/client/src/client.test.ts` stubs global `fetch` and uses fake timers for retry and deadline behavior.
- Tests under `packages/wiki-engine/src/` use focused MongoDB collection fakes to verify pipeline shapes, transactions, governance, and persistence behavior without requiring a live `mongod` or `mongot`.
- Tests under `apps/web/app/` render pages or inspect content without launching a browser.

Mock the system on the other side of the boundary, not the logic under test. Keep contract-shaped fixtures aligned with `apps/api/src/__fixtures__/contract-fixtures.ts` and the captured Memongo contract under `docs/contracts/memongo/2.0.1/`.

## Run browser and accessibility tests

Run the Playwright suite for changes to web layout, navigation, responsive behavior, keyboard interaction, or browser-side behavior:

```bash
bun run --cwd apps/web test:e2e
```

`apps/web/playwright.config.ts` starts the Next.js development server on `http://127.0.0.1:3040` unless a reusable server is already running. It runs `apps/web/e2e/*.e2e.ts` against desktop Chromium and a Pixel 7 mobile profile. In CI mode, Playwright retries a failed test up to two times and records a trace on the first retry.

`apps/web/e2e/showcase.e2e.ts` also runs `@axe-core/playwright` checks for WCAG 2 A/AA and WCAG 2.1 A/AA tags and fails on serious or critical violations. It checks keyboard interaction, horizontal overflow, console errors on key routes, and the product flows on `/`, `/compare`, and `/demo`.

The root `bun run test` command and `.github/workflows/ci.yml` run the web Vitest script, not `test:e2e`. Run Playwright explicitly when browser or accessibility behavior changes.

## Run static repository gates

The complete local gate matches CI:

```bash
bun run lint
bun run check-types
bun run build
bun run test
bun run check-publishability
```

`bun run check-publishability` validates the public package cohort and catches private workspace-only dependencies or invalid package contents before release work.

## Run live gates

Unit tests use mocks and cannot establish production readiness. With a real Memongo service, transactional wiki MongoDB, and the required credentials configured, run:

```bash
curl -fsS "$MDBRAIN_API_URL/ready"
bun run proof-pack
bun run memory-eval
bun run agent-smoke
```

These checks cover the integrated readiness, retrieval, write, delivery, and agent paths described by `docs/platform/PRODUCTION-READY.md` and `docs/platform/validation-pack.md`. Do not promote a release if readiness, contract compatibility, transaction support, scope isolation, idempotency replay, delivery reconciliation, or redaction checks fail.

For benchmark publication work, run the read-only cluster preflight before writing benchmark data:

```bash
bun run mongodb:cluster-preflight -- --prefix=mdbrain_bench_your_lane_
```

`scripts/mongodb-cluster-preflight.ts` verifies required environment values, the benchmark collection prefix, collection conflicts, and active operations. Add `--verify-atlas-model-key` when the run depends on MongoDB Atlas auto-embedding.

## Match gates to the change

| Change | Minimum focused evidence before the full local gate |
| --- | --- |
| API route or authorization | Relevant tests in `apps/api/src/`; update contract fixtures when the public shape changes. |
| Memongo transport or operation policy | Tests in `packages/memory-bridge/src/`, including contract, retry, and ambiguous-write behavior. |
| Wiki persistence or governance | Relevant tests in `packages/wiki-engine/src/`; use live MongoDB evidence for transaction or search claims. |
| Client or agent adapter | Tests in `packages/client/src/`, `apps/mcp/src/server.test.ts`, or `packages/tools/src/` as applicable. |
| Web rendering only | Relevant Vitest tests under `apps/web/app/`. |
| Web interaction or accessibility | Vitest plus `bun run --cwd apps/web test:e2e`. |
| Release or production readiness | Full local gate plus `/ready`, `proof-pack`, `memory-eval`, and `agent-smoke` against real dependencies. |

See [Debugging](debugging.md) when a live gate fails and [Patterns and conventions](patterns-and-conventions.md) for the invariants each suite protects.
