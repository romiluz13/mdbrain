# Memongo 2.2.2 compatibility

Mdbrain pins public release `v2.2.2` at commit `6a0c4958db0e2e7f0945eade983dfa2d2f773193`. The full commit SHA is used by the README checkout command and CI; the release tag identifies its origin. An isolated public checkout successfully fetched this exact SHA on October 13, 2026.

The [captured contract](4fce599216558d0c7c1e2a0d03d91703dfc0ec7924fdf16ddcda8d8216f1b03d/openapi.json) has canonical SHA-256 `4fce599216558d0c7c1e2a0d03d91703dfc0ec7924fdf16ddcda8d8216f1b03d`. It was served by an image built from that frozen public checkout and matches the source-generated document. The [capture](4fce599216558d0c7c1e2a0d03d91703dfc0ec7924fdf16ddcda8d8216f1b03d/capture.json) preserves the actual endpoint observations; earlier 2.1.0 evidence is retained unchanged.

Compared with the previously pinned 2.1.0 document:

- No routes or existing successful response schemas were removed. Search degradation and throttling envelopes already match Mdbrain's accepted gateway contract.
- Lifecycle updates/deletes, memory feedback, and structured writes can return `MEMORY_LIFECYCLE_CONFLICT` or `STRUCTURED_MEMORY_REVISION_CONFLICT` with HTTP 409. The bridge preserves these codes with a sanitized message, `retryable: false`, and `outcome: "not-applied"`; callers must fetch current state before retrying. It continues to distinguish erasure gates and idempotency conflicts.
- Lifecycle and feedback patches now explicitly constrain confidence/source reliability to 0–1. Existing valid payloads remain valid; out-of-range values must be rejected. Optional structured-write timestamps are documented with timezone offsets; the existing bridge serializes dates to ISO strings.
- Write admission documents HTTP 429 with nothing written. Existing operation-aware retry policy and Retry-After handling remain in force. Unified state adds dependency-unavailable HTTP 503, handled by the existing read failure policy.
- Admin/quarantine, erase, novelty scan and sync documentation changes do not expose new Mdbrain tenant operations. The private operator boundary remains intact.

Verification on October 13, 2026: a clean source-only Mdbrain copy failed before building its workspace dependencies, then the API dependency-closure build succeeded and the repaired API returned HTTP 200 from `/ready` against this Memongo revision and a fresh Atlas Local instance. The wiki text lane was ready; vector and auto-embedding were unavailable without a model key. The capture's upstream `/ready` is 503 because its vector/embedding lanes are unavailable, while `/health` is 200. Mdbrain checks the contract and required retrieval lane instead of requiring unconfigured optional lanes.

The upgrade rail waits for container health before contract capture, with a 180-second ceiling and logs on boot failure. CI's pinned checkout fails if this public source ref cannot be fetched. Runtime compatibility still requires both the exact version and canonical digest; this change does not disable or relax the pin.
