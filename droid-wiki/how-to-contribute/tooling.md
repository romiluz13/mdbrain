# Tooling

MDBrain is a Bun-managed TypeScript monorepo. Turborepo schedules workspace tasks, Biome checks formatting and lint rules, Vitest runs code tests, and package-specific TypeScript configurations enforce the shared strict baseline.

## Runtime and package manager

`package.json` requires Node.js 20.19 or later and declares Bun 1.2.5 as the package manager. Install dependencies from the repository root:

```bash
bun install
```

CI and release workflows use the lockfile-preserving form:

```bash
bun install --frozen-lockfile
```

Run a workspace script without changing directories:

```bash
bun run --cwd apps/web test
bun run --cwd packages/wiki-engine check-types
```

## Turborepo task graph

The root scripts in `package.json` delegate `build`, `dev`, `test`, and `check-types` to Turborepo. `turbo.json` defines the scheduling rules:

- `build` runs upstream workspace builds first and caches `.next/**`, `dist/**`, and the docs integrity marker while excluding `.next/cache/**`.
- `test` runs after upstream builds and does not declare cached output.
- `check-types` runs after upstream builds and type checks.
- `dev` is persistent and uncached.

Use the root commands for cross-workspace validation:

```bash
bun run dev
bun run build
bun run check-types
bun run test
```

The root test script also runs `scripts/*.test.ts` after Turborepo finishes.

## Biome formatting and linting

`biome.json` is the formatting and linting source of truth. It uses tabs, double quotes in JavaScript and TypeScript, semicolons as needed, and the recommended lint rules. Import organization is intentionally disabled.

Check the repository without modifying files:

```bash
bun run lint
bun run format
```

Apply fixes deliberately:

```bash
bun run lint:fix
bun run format:fix
```

Biome excludes generated and dependency directories such as `node_modules`, `.next`, `.output`, `.turbo`, `dist`, `build`, and coverage output. Do not hand-format generated artifacts to make a check pass.

## TypeScript

`tsconfig.base.json` establishes strict ESM-oriented TypeScript with `module` and `moduleResolution` set to `NodeNext`, an ES2023 target, isolated modules, declaration output support, and no emit by default.

Each buildable workspace owns its output configuration. Most packages compile with `tsc`; `apps/api` and `apps/mcp` emit from `src/` to `dist/`. The web type check runs `next typegen` before `tsc`, and `packages/client` also checks `packages/client/tsconfig.type-tests.json`.

Use explicit `.js` extensions in TypeScript imports where the existing NodeNext source does so. Avoid `any`, preserve strict types, and keep files near 500 lines when a meaningful split exists. See [Patterns and conventions](patterns-and-conventions.md) for repository-specific boundary and error-handling rules.

## Repository scripts

Run these scripts from the repository root.

| Command | Implementation | Purpose |
| --- | --- | --- |
| `bun run check-publishability` | `scripts/check-publishability.ts` | Validate the publishable package cohort and dependency boundaries. |
| `bun run contract:capture` | `scripts/capture-memongo-contract.ts` | Capture immutable Memongo health, readiness, OpenAPI, digest, and route evidence. |
| `bun run proof-pack` | `scripts/proof-pack.ts` | Produce integrated release evidence against configured dependencies. |
| `bun run mongodb:cluster-preflight` | `scripts/mongodb-cluster-preflight.ts` | Check environment, collection conflicts, and active operations before benchmark publication. |
| `bun run memory-eval` | `scripts/real-memory-eval.ts` | Run the real memory evaluation lane. |
| `bun run compare-memory-eval` | `scripts/compare-memory-eval.ts` | Compare memory evaluation results. |
| `bun run agent-smoke` | `scripts/real-agent-smoke.ts` | Exercise the real agent integration path. |
| `bun run wiki:init` | `scripts/mdbrain-init.ts` | Initialize MDBrain wiki state. |
| `bun run stress-test` | `scripts/stress-test.ts` | Run the configured stress test. |

Scripts with real services depend on environment variables. Start with `.env.example`, keep real keys out of Git, and read the script before running a write or publication-oriented lane.

## Web and documentation tools

The web application uses Next.js 15, React 19, OpenNext, Wrangler, Vitest, Playwright, and axe:

```bash
bun run --cwd apps/web dev
bun run --cwd apps/web build
bun run --cwd apps/web test
bun run --cwd apps/web test:e2e
bun run web:preview
```

`bun run web:deploy` performs a real Cloudflare deployment and should be run only when deployment is intended and the required Wrangler authentication is configured.

The documentation application uses Mintlify. Its build script runs `scripts/check-docs-integrity.mjs`, and `bun run --cwd apps/docs validate:mintlify` runs `scripts/validate-mintlify-build.mjs`.

See the [web application](../apps/web.md), [documentation application](../apps/docs.md), and [Agent integrations](../features/agent-integrations.md) for the surfaces these tools build.

## Automation

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. It installs with the frozen Bun lockfile, then runs type checking, linting, building, publishability validation, and tests.

`.github/workflows/publish.yml` runs for `v*` tags or manual dispatch. It builds, tests, checks publishability, resolves the package cohort through `scripts/publish-package-cohort.ts`, and publishes packages in dependency order. Do not use the publish workflow as a substitute for the pull request gates.
