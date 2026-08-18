# 04 — Authorize and atomically audit wiki mutations

**What to build:** Every wiki create, update, soft delete, and hard delete is authorized against the governed target and commits its page state, audit revision, and related local intent atomically without losing claim provenance.

**Blocked by:** 02 — Establish a server-owned principal and govern wiki reads; 03 — Give wiki storage independent ownership and transactions.

**Status:** ready-for-agent

- [ ] Require write capability for mutations, dedicated permission-change capability for ACL/trust changes, and dedicated hard-delete capability.
- [ ] Perform a governed target lookup before update or delete across REST, client, and MCP paths.
- [ ] Commit page mutation, revision, and same-action local outbox state in one transaction; surface failures instead of suppressing revision errors.
- [ ] Preserve complete existing claim evidence, writer, derivation, supersession, and source identity on unrelated updates.
- [ ] Pass failure-injection tests proving no partial page/revision/outbox commit.
