# Patterns and conventions

MDBrain is a strict TypeScript monorepo. Contributors should preserve the separation between the Memongo-owned memory domain and the MDBrain-owned wiki domain, and should keep authorization, idempotency, and redaction decisions close to their boundaries.

## TypeScript and formatting

- Use ESM TypeScript and avoid `any`, as required by `AGENTS.md`.
- Biome is the formatter and linter. `biome.json` uses tabs, double quotes, and semicolons where required.
- Tests are colocated as `*.test.ts` or `*.test.tsx` and run with Vitest. Browser coverage is under `apps/web/e2e/`.
- Keep source files near 500 lines when a useful boundary exists. Several older central files exceed this guideline and are listed in [Cleanup opportunities](../cleanup-opportunities.md).

## Public boundaries

`@mdbrain/memory-bridge` is the only supported server-side path to Memongo. Do not add a local memory engine or direct MongoDB access for memory records. The captured contract lives in `docs/contracts/memongo/2.0.1/`, and `packages/memory-bridge/src/memongo-runtime.ts` pins its version and digest.

The wiki remains independent. `packages/wiki-engine/src/wiki-store.ts` owns its MongoDB client, schema, and transaction boundary.

## Fail closed

Authorization and compatibility checks reject uncertainty:

- `apps/api/src/principal.ts` maps bearer tokens to scoped principals and capabilities.
- `apps/api/src/app.ts` derives the requested scope from query and body values and rejects conflicting inputs.
- `packages/wiki-engine/src/wiki-governance.ts` applies scope, trust, role, department, group, and lifecycle filters to reads.
- `packages/memory-bridge/src/memongo-http-client.ts` rejects incompatible contracts, credentialed URLs, and unsafe plain HTTP.
- `packages/wiki-engine/src/filesystem-containment.ts` rejects paths that escape approved roots.

When adding a read path, route it through the same governance functions as existing reads. When adding a Memongo operation, define its transport, validation, credential, idempotency, and retry policy centrally.

## Omit absent MongoDB fields

MongoDB `$jsonSchema` validators reject JavaScript `undefined` when a field has a concrete BSON type. `normalizeInput` in `packages/wiki-engine/src/wiki-bridge.ts` uses conditional spreads so optional fields are absent rather than set to `undefined`. Preserve this pattern when extending page documents.

```ts
const document = {
	requiredField,
	...(optionalValue ? { optionalField: optionalValue } : {}),
}
```

## Idempotent writes

Memory writes use a stable idempotency key. `packages/memory-bridge/src/memongo-operation-policy.ts` marks which operations may retry with the same key. Ambiguous failures remain `outcome-unknown`; callers must not assume they were not applied.

Wiki mutations record a canonical payload fingerprint through `packages/wiki-engine/src/wiki-mutation-intents.ts`. Memory-to-wiki promotion is modeled separately in `packages/wiki-engine/src/memory-delivery.ts`.

## Error handling and redaction

Use typed errors at subsystem boundaries:

- `MemongoHttpError` in `packages/memory-bridge/src/memongo-http-client.ts`
- `WikiDuplicateSlugError` and `WikiNotFoundError` in `packages/wiki-engine/src/wiki-bridge.ts`
- `MemoryDeliveryConflictError` and `MemoryDeliveryStateError` in `packages/wiki-engine/src/memory-delivery.ts`

Run unexpected messages through `packages/lib/src/errors.ts` or `packages/lib/src/redact.ts` before logging or returning them. Do not include payloads, API keys, idempotency keys, or fingerprints in administrative delivery responses.

## Tests

Tests favor public behavior and boundary invariants:

- API tests construct the Hono app directly in `apps/api/src/app.test.ts`.
- Wiki tests use in-memory collection fakes alongside focused unit tests under `packages/wiki-engine/src/`.
- Memory bridge tests fake `fetch` to verify headers, contract checks, retries, and response adaptation.
- Web tests server-render pages, while `apps/web/e2e/showcase.e2e.ts` covers responsive interactions and axe checks.

Use the narrowest relevant test first, then run the package and monorepo gates described in [Testing](testing.md).

## Source references

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Repository-wide engineering rules and MongoDB validator warning |
| `biome.json` | Lint and format rules |
| `tsconfig.base.json` | Shared strict TypeScript configuration |
| `packages/memory-bridge/src/memongo-operation-policy.ts` | Central memory transport policy |
| `packages/wiki-engine/src/wiki-governance.ts` | Read authorization rules |
| `packages/lib/src/redact.ts` | Secret-redaction patterns |

See [Development workflow](development-workflow.md) for the contribution sequence and [Security](../security.md) for a boundary-oriented threat model.
