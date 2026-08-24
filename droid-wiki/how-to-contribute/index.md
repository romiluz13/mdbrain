# Contribute to MDBrain

Contributions should preserve MDBrain's supported product surface and the boundary between Memongo-backed memory and the MDBrain-owned wiki. Use this section to choose work, make a focused change, verify it, and prepare it for review.

## Pick up work

Issues and specifications live in the `romiluz13/mdbrain` GitHub repository. Before starting:

1. Choose an issue whose scope and expected behavior are clear. The `ready-for-agent` label means an issue is fully specified for agent implementation; `ready-for-human` identifies work that requires a person.
2. Check the issue's dependencies. An issue is unblocked only when every issue it depends on is closed.
3. Assign the issue to yourself before implementation.
4. Confirm that the work belongs to a supported application or package rather than expanding historical or experimental material.

The supported applications are `apps/api`, `apps/mcp`, `apps/web`, and `apps/docs`. The supported public packages are `packages/memory-bridge`, `packages/wiki-engine`, `packages/mdbrain-memory`, `packages/client`, and `packages/tools`. `packages/lib` is shared runtime support rather than the primary public integration surface.

Use the [application map](../apps/index.md), [package map](../packages/index.md), and [feature map](../features/index.md) to find the owner of a behavior before editing code.

## Follow the contribution path

1. Read [Patterns and conventions](patterns-and-conventions.md) before changing a subsystem boundary.
2. Follow [Development workflow](development-workflow.md) from branch creation through merge.
3. Use [Testing](testing.md) to select the narrow test loop and the required repository or live gates.
4. Use [Debugging](debugging.md) when readiness, contract, MongoDB, search, or web deployment checks fail.
5. Consult [Tooling](tooling.md) for the Bun, Turborepo, Biome, TypeScript, and repository script behavior behind each command.

## Definition of done

A contribution is ready for merge when:

- The change implements one coherent issue without adding unrelated product scope.
- Tests cover the changed behavior and its important boundary or failure case.
- `bun run lint`, `bun run check-types`, `bun run build`, `bun run test`, and `bun run check-publishability` pass.
- Relevant browser, accessibility, or live-dependency gates pass when the change affects those surfaces.
- Public behavior is reflected in the appropriate docs, `apps/api/src/openapi-spec.ts`, client, MCP, or tool surface.
- The pull request explains the change and its verification, contains no secrets, and has resolved review feedback.

Production-readiness claims require more than unit tests. Readiness, Memongo contract compatibility, MongoDB transaction support, scope isolation, idempotency replay, delivery reconciliation, and redaction checks must all remain green.
