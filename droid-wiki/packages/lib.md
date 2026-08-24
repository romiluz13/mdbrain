# Shared library

Active contributors: Rom Iluz

## Purpose

`@mdbrain/lib` contains shared TypeScript types and runtime utilities used across MDBrain packages and applications. It exists to keep common behavior and the published dependency graph consistent; most application code should start with [`@mdbrain/client`](client.md), [`@mdbrain/tools`](tools.md), or [`@mdbrain/memory-bridge`](memory-bridge.md).

## Directory layout

```text
packages/lib/
├── src/
│   ├── index.ts          Public exports
│   ├── types.ts          Shared configuration
│   ├── types.memory.ts   Memory configuration and scopes
│   ├── redact.ts         Secret redaction
│   ├── ssrf.ts           Network destination policy
│   ├── auth.ts           Provider key resolution
│   ├── retry.ts          Retry policy
│   ├── logger.ts         Subsystem logging
│   └── errors.ts         Safe error formatting
└── package.json
```

## Export surfaces

The root entry point exports types and utilities. Two subpath exports provide narrower type imports:

- `@mdbrain/lib/types` exports `MdbrainConfig` and `SecretInput`.
- `@mdbrain/lib/types/memory` exports memory scopes and MongoDB-oriented memory configuration types.

`MemoryScope` is the shared `"session" | "user" | "agent" | "workspace" | "tenant" | "global"` vocabulary used by `apps/api` and the memory bridge.

## Key abstractions

| Area | Main exports | Behavior |
| --- | --- | --- |
| Redaction and errors | `redactSensitiveText`, `redactSecrets`, `formatErrorMessage`, `formatUncaughtError` | Masks common credential forms, authorization headers, private keys, and MongoDB URI passwords before presenting errors |
| SSRF controls | `assertAllowedHostOrIp`, `assertPublicHostname`, `SsrFBlockedError`, `defaultSsrfPolicy` | Rejects blocked hostnames and private IP ranges unless policy explicitly allows them |
| Authentication | `resolveApiKeyForProvider`, `requireApiKey`, `ApiKeyRotation`, `normalizeOptionalSecretInput` | Resolves provider keys, supports round-robin key sets, and normalizes literal or environment-referenced secrets |
| Retries | `retryAsync`, `resolveRetryConfig` | Applies bounded exponential backoff, optional jitter, retry predicates, server-directed delay, and retry callbacks |
| Logging | `createSubsystemLogger` | Creates hierarchical console loggers controlled by `MDBRAIN_LOG_LEVEL`, `MDBRAIN_DEBUG`, or `DEBUG` |
| Environment | `isTruthyEnvValue`, `isFalsyEnvValue`, `resolveEnv`, `resolveEnvCascade` | Normalizes common environment conventions |
| Concurrency | `runTasksWithConcurrency` | Runs ordered task arrays with a limit and either stop or continue error handling |
| Paths and MIME | `resolveUserPath`, `mdbrainDataDir`, `detectMime`, `isTextMime`, `isImageMime`, `isAudioMime` | Shares filesystem path and media classification behavior |

## Security behavior

`assertAllowedHostOrIp` performs a synchronous check against localhost-style names and private IPv4 and IPv6 ranges. `assertPublicHostname` additionally resolves DNS and rejects any private result. Hostname allowlists and private-network overrides are explicit policy choices; callers should not enable them from untrusted input.

Redaction recognizes key-value secrets, JSON credential fields, bearer tokens, provider token prefixes, private-key blocks, and passwords embedded in MongoDB connection strings. `formatErrorMessage` and `formatUncaughtError` apply this redaction. `createSubsystemLogger` does not redact its message or metadata automatically, so callers must pass already-sanitized values.

`normalizeOptionalSecretInput` strips line breaks and surrounding whitespace. A `{ secretRef }` value names an environment variable; the returned value is the environment variable's normalized content.

For the broader trust model, see [Security](../security.md). The [Reference](../reference/index.md) pages document environment and configuration surfaces.

## How it works

Consumers import a focused utility from the root or a type from a supported subpath. Security-sensitive callers validate destinations before network access and redact failures before logging. Retry and concurrency helpers remain policy-neutral: their callers decide which errors are safe to retry and whether work should stop after a failure.

## Retry and logging defaults

Object-form `retryAsync` defaults to three total attempts, a 300 ms minimum delay, a 30-second maximum delay, and no jitter. Callers can supply `shouldRetry`, `retryAfterMs`, and `onRetry`. The numeric overload retains a smaller legacy interface with exponential delays from the supplied initial delay.

Subsystem loggers default to `info`. A child logger appends its name with `/`, and output includes a local timestamp, subsystem, level, message, and JSON metadata. The logger writes `warn` and errors to the corresponding console methods and does not provide a file sink despite the `isEnabled` target parameter.

## Integration points

- `apps/api/src/principal.ts`, `apps/api/src/app.ts`, and `apps/api/src/api-context.ts` use `MemoryScope` at the public [API](../api/index.md) authorization boundary.
- `apps/api/src/lib/errors.ts` uses `redactSecrets` before API error handling exposes details.
- [`@mdbrain/memory-bridge`](memory-bridge.md) uses shared memory scopes and configuration types.
- `packages/wiki-engine/src/wiki-search.ts`, `packages/wiki-engine/src/wiki-schema.ts`, and related wiki modules use subsystem logging.

See [Apps](../apps/index.md) for runtime consumers and [Features](../features/index.md) for the product behavior built on these primitives.

## Entry points for modification

- Add root exports in `packages/lib/src/index.ts` only for primitives that are shared across package boundaries.
- Change common memory configuration in `packages/lib/src/types.memory.ts`; then check every API, bridge, and wiki consumer of the affected union or option.
- Add secret patterns in `packages/lib/src/redact.ts` with tests that cover both detection and preservation of non-secret text.
- Change address and hostname policy in `packages/lib/src/ssrf.ts`; test literal IPs, DNS results, allowlists, and explicit private-network policy separately.
- Change backoff semantics in `packages/lib/src/retry.ts` without bypassing attempt and delay clamps.
- Keep logging changes in `packages/lib/src/logger.ts` compatible with the existing `SubsystemLogger` interface and avoid introducing secret-bearing metadata.

## Key source files

| File | Purpose |
| --- | --- |
| `packages/lib/src/index.ts` | Root public export surface |
| `packages/lib/src/types.ts` | Shared MDBrain configuration and secret-input types |
| `packages/lib/src/types.memory.ts` | Memory scopes and MongoDB memory configuration |
| `packages/lib/src/redact.ts` | Secret patterns and masking |
| `packages/lib/src/errors.ts` | Error inspection and redacted formatting |
| `packages/lib/src/ssrf.ts` | Hostname, IP, DNS, and allowlist policy |
| `packages/lib/src/auth.ts` | Provider key resolution and key rotation |
| `packages/lib/src/secrets.ts` | Literal and environment-referenced secret normalization |
| `packages/lib/src/retry.ts` | Retry configuration and exponential backoff |
| `packages/lib/src/logger.ts` | Environment-controlled subsystem logger |
| `packages/lib/src/concurrency.ts` | Bounded async task execution |
