# 02 — Establish a server-owned principal and govern wiki reads

**What to build:** Authenticated MDBrain users can read only wiki content allowed by their server-derived subject, groups, roles, departments, trust tier, scopes, and capabilities, including indirect and composed reads.

**Blocked by:** 01 — Lock the Memongo contract and prove the in-place refactor.

**Status:** ready-for-agent

- [ ] Derive the principal and capabilities from server authentication; request values can only narrow its authority.
- [ ] Apply governance to direct get/list, lint, revision list/detail, transclusion, backlinks, maps, graph expansion, contradiction reads, search/reranking, export, and maintenance reads.
- [ ] Reapply governance after expansion/composition and prevent protected claim text from leaking through secondary records.
- [ ] Fail closed for unknown subjects/groups and stale membership.
- [ ] Pass generated REST and MCP fixtures covering cross-scope, role, department, subject, group, trust, capability, and stale-identity denial.
