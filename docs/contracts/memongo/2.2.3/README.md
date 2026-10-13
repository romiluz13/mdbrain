# Memongo 2.2.3 contract pin

Verified October 13, 2026 against [GitHub latest release](https://github.com/romiluz13/Memongo/releases/tag/v2.2.3) and [npm memory-engine](https://www.npmjs.com/package/@memongo/memory-engine/v/2.2.3). Both report the latest published version as 2.2.3. The annotated release tag resolves to full commit `08d4828d0432f348461f1bed78ce476dad9f31ab`, matching npm's gitHead. The checked memory-engine, memory-bridge, client, tools, lib, memory, and pi-extension packages agree on that release identity.

## Fresh capture

A clean, separate checkout of v2.2.3 was installed with its frozen lockfile and its API dependency closure built. Its Node 22 API ran against an isolated Atlas Local database with an empty Memongo config and explicit local connection settings. The [capture](1cbc1bbe7b60e415a2ee24368f9f5d04ab8f43f2faee1321a1be9a0b65b4d23a/capture.json) records the actual health/readiness/OpenAPI responses; the [served OpenAPI](1cbc1bbe7b60e415a2ee24368f9f5d04ab8f43f2faee1321a1be9a0b65b4d23a/openapi.json) independently matches the document generated from the tagged source. The MongoDB container had its configured Atlas model key; this capture is not keyless evidence.

Canonical SHA-256: `1cbc1bbe7b60e415a2ee24368f9f5d04ab8f43f2faee1321a1be9a0b65b4d23a`.

## Exhaustive comparison with 2.2.2

Recursive comparison against the preserved [2.2.2 capture](../2.2.2/4fce599216558d0c7c1e2a0d03d91703dfc0ec7924fdf16ddcda8d8216f1b03d/openapi.json) found exactly one changed value:

| Document location | Before | After |
| --- | --- | --- |
| `info.version` | `2.2.2` | `2.2.3` |

Route changes: none. Request schema changes: none. Response schema/status changes: none. Parameters, security schemes, component schemas and descriptions: unchanged. All 48 path entries are identical. The 2.2.2 history is retained byte-for-byte.

## Behavioral compatibility

The [upstream change](https://github.com/romiluz13/Memongo/compare/v2.2.2...v2.2.3) preserves explicitly requested scalar/binary automatic-embedding quantization and propagates recognized target rejections instead of retrying with the option omitted. Its default remains `none` (omit the field). Mdbrain's bundle does not configure Memongo quantization, and its wiki engine manages its own index definitions. No relied-on default behavior change or new Mdbrain adaptation was identified. External Memongo deployments explicitly opting into scalar/binary must validate that setting on their target; this capture does not prove those deployments or ANN quality/performance.

Runtime compatibility continues to require **both** exact version 2.2.3 and the canonical digest above. The public full source SHA, README checkout command and CI pinned checkout stay aligned. No compatibility bypass or relaxed digest matching is introduced. The earlier 2.2.2 installation repairs are carried forward unchanged; this patch upgrade adds no new gateway behavior adaptation.

## Compose startup health

The bundle builds the tagged repository's [root Dockerfile](https://github.com/romiluz13/Memongo/blob/08d4828d0432f348461f1bed78ce476dad9f31ab/Dockerfile), which already defines a Node-based `/health` check (10-second interval, 5-second timeout, 20-second start period, 12 retries). Compose inherits that image check; no override disables it. Under [Compose healthcheck semantics](https://docs.docker.com/reference/compose-file/services/#healthcheck), the upgrade rail's bounded `up --wait` therefore waits for both MongoDB and Memongo to become healthy before contract capture. No duplicate service healthcheck is necessary. This startup check establishes HTTP liveness; the separate contract capture and Mdbrain `/ready` checks establish compatibility/readiness.
