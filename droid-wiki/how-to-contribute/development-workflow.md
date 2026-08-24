# Development workflow

Use a short branch-to-merge loop: claim one issue, branch from `main`, make the smallest coherent change, run progressively broader checks, and open a focused pull request.

## Prepare the branch

External contributors should fork the repository and clone their fork. All contributors should then:

1. Read the full issue, its comments, labels, and blocking relationships.
2. Assign the issue to yourself.
3. Start from an up-to-date `main`.
4. Create a descriptive branch:

```bash
git checkout -b my-fix
```

5. Install dependencies:

```bash
bun install
```

MDBrain requires Node.js 20.19 or later and declares Bun 1.2.5 in `package.json`.

## Make the change

Keep one logical change per branch and pull request. Locate the owner before editing:

- HTTP orchestration belongs in the [API application](../apps/api.md), primarily under `apps/api/src/`.
- Memongo transport belongs in [`@mdbrain/memory-bridge`](../packages/memory-bridge.md), under `packages/memory-bridge/src/`.
- Wiki storage, retrieval, and governance belong in [`@mdbrain/wiki-engine`](../packages/wiki-engine/index.md), under `packages/wiki-engine/src/`.
- Public HTTP calls belong in [`@mdbrain/client`](../packages/client.md).
- MCP and model-facing adapters belong in [the MCP application](../apps/mcp.md) and [`@mdbrain/tools`](../packages/tools.md).
- Browser behavior belongs in [the web application](../apps/web.md), under `apps/web/`.

Preserve the rules in [Patterns and conventions](patterns-and-conventions.md). In particular, do not bypass `packages/memory-bridge` to access Memongo-owned data, and do not move wiki storage outside `packages/wiki-engine`.

Update every affected public surface together. An HTTP contract change commonly requires aligned edits to `apps/api/src/routes/v1.ts`, `apps/api/src/openapi-spec.ts`, and `packages/client/src/client.ts`. If agents can call the behavior, also inspect `apps/mcp/src/server.ts` and `packages/tools/src/index.ts`.

## Test while coding

Start with the narrowest test that exercises the change. For example:

```bash
bunx vitest run packages/wiki-engine/src/wiki-search.test.ts
bun run --cwd apps/api test
```

Then run the complete local workflow from the repository root:

```bash
bun run lint
bun run check-types
bun run build
bun run test
bun run check-publishability
```

See [Testing](testing.md) for browser, accessibility, and live-dependency gates. A web interaction change should run `bun run --cwd apps/web test:e2e`; a release or production-readiness change should run the integrated proof commands with real dependencies.

## Commit the work

Use a short, action-oriented commit message with an area prefix when useful:

```text
wiki: fix claim dedup
```

Do not combine unrelated cleanup with the issue. Review the diff and working tree before committing so generated output, local configuration, credentials, and unrelated files do not enter the commit.

## Open the pull request

Push the branch and open a pull request against `romiluz13/mdbrain:main`. Fill in the repository pull request template when one is presented, and include:

- The issue and user-visible outcome.
- The implementation boundary that changed.
- The exact checks you ran.
- Any live gate that was not run and why.
- Compatibility, migration, deployment, or release implications.

The GitHub Actions workflow in `.github/workflows/ci.yml` installs with `bun install --frozen-lockfile`, then runs type checking, linting, building, publishability checks, and tests. Keep the pull request current until those checks pass.

## Respond to review and merge

A maintainer reviews the pull request. Address feedback with new commits rather than force-pushing rewritten branch history. Re-run the narrow check after each revision, then re-run every affected broader gate.

Merge only when:

- The issue's acceptance criteria are satisfied.
- Required tests and CI are green.
- Public contracts and documentation agree with the implementation.
- Review threads and requested changes are resolved.
- The pull request contains one coherent change and no secret or unrelated file.

Do not treat a successful merge as permission to publish packages or deploy the web application. Publishing is a separate tagged or manually dispatched workflow in `.github/workflows/publish.yml`, and deployment uses the explicit commands documented in [Tooling](tooling.md).
