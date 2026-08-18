# 06 — Expand the bridge with versioned HTTP retrieval

**What to build:** Existing MDBrain retrieval experiences cross one MDBrain-owned HTTP gateway that validates the pinned Memongo contract, derives scope server-side, supports deadlines/cancellation, and reports complete, partial, degraded, or failed results explicitly.

**Blocked by:** 01 — Lock the Memongo contract and prove the in-place refactor; 02 — Establish a server-owned principal and govern wiki reads.

**Status:** ready-for-agent

- [ ] Implement domain retrieval/context operations without exporting a generic upstream proxy.
- [ ] Validate runtime responses and enforce API version plus contract digest compatibility.
- [ ] Enforce production TLS/hostname/redirect rules, credential separation, request deadlines, caller cancellation, request correlation, and redaction.
- [ ] Map validation, authentication, authorization, not-found, rate-limit, unavailable, timeout, incompatible, malformed-response, and internal failures to one sanitized contract.
- [ ] Run bridge/API tests against contract-conforming fixtures and live smoke tests against the selected Memongo deployment.
- [ ] Prove that failure of every required retrieval leg is not returned as an empty success.
