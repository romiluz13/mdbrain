# 11 — Migrate packages, scripts, and release gates to public seams

**What to build:** Public packages and repository tools work through the HTTP gateway or wiki store, with no workspace-only engine dependency and no misleading engine-internal command retained.

**Blocked by:** 03 — Give wiki storage independent ownership and transactions; 06 — Expand the bridge with versioned HTTP retrieval; 09 — Reconcile public surfaces and isolate the control plane.

**Status:** ready-for-agent

- [ ] Convert the aggregate memory package to a documented remote-client compatibility package for the next major release, with no local-engine shim.
- [ ] Keep the wiki package in the coherent publishability cohort and prove reproducible pack plus clean external install.
- [ ] Rewrite initialization, migration, parity, evaluation, stress, and capability commands around public seams or retire them explicitly.
- [ ] Remove the engine-coupled signed memory export; retain governed OKF wiki export and document any future remote-export requirement as deferred.
- [ ] Regenerate dependency and lockfile state and pass release-version/publishability checks.
