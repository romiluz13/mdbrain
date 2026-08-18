# 05 — Harden connectors, export paths, and OKF conformance

**What to build:** Connector and export workflows do not leak credentials, bypass ACLs, escape configured roots, or overstate conformance. GitHub becomes the first connector with a truthful production ACL and revocation model; incomplete connectors are labeled preview.

**Blocked by:** 02 — Establish a server-owned principal and govern wiki reads; 03 — Give wiki storage independent ownership and transactions.

**Status:** ready-for-agent

- [ ] Keep connector secrets inside server-side providers and return/log only redacted identity and capability metadata.
- [ ] Map GitHub users and teams to namespaced subjects/groups and prove revocation, stale-membership, unknown-identity, and replay behavior.
- [ ] Mark incomplete discovery connectors preview/unavailable rather than successful production integrations.
- [ ] Reject absolute, traversal, separator, symlink-component, and final real-path escapes for Obsidian and OKF operations.
- [ ] Revalidate and pin the OKF external contract; pass extension, link, source, heading, path, and trust round-trip fixtures.
