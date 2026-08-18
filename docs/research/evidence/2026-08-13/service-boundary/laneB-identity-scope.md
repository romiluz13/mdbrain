# Lane B — Identity, Scope Propagation, Version Negotiation

Audit date: 2026-08-13. mdbrain HEAD 1b7e234. memongo local HEAD 8833026c0c (2.0.1, unpushed); published surface = git tag v2.0.0 = commit bdad0fbf28 = npm @memongo/*@2.0.0.

**Published-vs-HEAD note up front:** the tenant/auth model is *byte-identical in behavior* between published 2.0.0 and HEAD (verified by diff of `apps/api/src/app.ts` auth section and `apps/api/src/scope-identity.ts`). The material deltas are all in version/probe endpoints (§3) and are flagged per-item. Local tags v2.1.0 (commit 674dea5ec2fd, 2026-08-01) and v2.1.1 (commit 3d1cf46efe0d, 2026-08-02) also exist but are NOT the published baseline per the task pin; treated as unpublished local observations. ⚠️ SUPERSEDED 2026-08-13 (amendment v3, evidence finding 3): original text attributed both tags to 3d1cf46ef; corrected — each tag maps to its own commit.

---

## 1. Memongo server-side tenant model over HTTP

### 1.1 API-key policy shape [SUBSTRATE-FACT]

Two credential classes, both Bearer tokens, both configured via env at process start (no runtime key management API):

1. **Root key** — `MEMONGO_API_KEY`. Full access, no constraints.
   - memongo:apps/api/src/app.ts:530-531 (`const token = process.env.MEMONGO_API_KEY?.trim()`), matched at app.ts:560-562.
2. **Scoped keys** — `MEMONGO_API_SCOPED_KEYS`, JSON array or object, parsed at boot:

   ```ts
   type ScopedApiKeyPolicy = {
     token: string
     agentIds?: string[]
     scopes?: string[]
     scopeRefs?: string[]
   }
   ```

   - memongo:apps/api/src/app.ts:184-189 (HEAD); identical at published memongo@2.0.0:apps/api/src/app.ts:167-172.
   - Validation rules (fail closed at boot): at least one policy; every policy must carry ≥1 concrete constraint (non-`"*"`); `"*"` must be the sole value of its list; `scopes` values must be canonical scope strings — memongo:apps/api/src/app.ts:245-295 (HEAD lines; published 2.0.0 same logic at app.ts:223-266).

### 1.2 Canonical identity — scope-identity.ts [SUBSTRATE-FACT]

Canonical scope set is six values: `session, user, agent, workspace, tenant, global`.

- HEAD re-exports from the shared contract: memongo:apps/api/src/scope-identity.ts:1-18 → memongo:packages/lib/src/contract.ts:35-42 (`MEMORY_SCOPE_VALUES`).
- **Published-vs-HEAD delta (cosmetic only):** published 2.0.0 defines the identical six-value array inline — memongo@2.0.0:apps/api/src/scope-identity.ts:12-19 (`VALID_SCOPE_VALUES = ["session","user","agent","workspace","tenant","global"]`). `packages/lib/src/contract.ts` does not exist at v2.0.0. No behavioral delta.

Request identity = the caller-supplied tuple **(agentId, scope, scopeRef)**:

- `resolveScopeInput` merges query params with JSON body (body wins), via Hono's cached `c.req.json()` — memongo:apps/api/src/scope-identity.ts:40-58.
- `resolveScopeField` searches top-level then nested containers `handle`, `entry`, `memory`, `params`, first non-empty string wins — memongo:apps/api/src/scope-identity.ts:64-86.
- `resolveRequestAgentId` — the SAME value auth validates must drive manager/partition selection (issue #57 anti-divergence design) — memongo:apps/api/src/scope-identity.ts:93-98.
- `scopeRef` has an alias: `containerTag` — memongo:apps/api/src/routes/v1-helpers.ts:153-160 (`pickScopeRef`), and auth resolves `scopeRef ?? containerTag` — memongo:apps/api/src/app.ts:347-350.

### 1.3 The 403 tenant floor [SUBSTRATE-FACT]

Auth middleware (memongo:apps/api/src/app.ts:554-650 HEAD; published memongo@2.0.0:apps/api/src/app.ts:548-606, identical logic):

1. Root-key bearer → pass through (no constraints).
2. Unknown bearer → **401** `UNAUTHORIZED` (app.ts:565-570).
3. Scoped key → per-request constraint check `authorizeScopedApiKey`: the request's agentId/scope/scopeRef must each fall inside the policy's allow-lists (or the list is wildcard/absent) — app.ts:335-355. Violation → **403 FORBIDDEN** (`"<label> is required for this API key"` / `"<label> is not allowed for this API key"`).
4. Route policy: `/v1/search-kb` additionally requires a concrete scopeRefs constraint — `routePolicyError`, app.ts:297-301 → 403.
5. Execution-side validation enforces the floor too: `scopeInputError` requires scopeRef for `user`/`tenant` scopes and a session identifier for `session` scope (400 VALIDATION_ERROR) — memongo:apps/api/src/routes/v1-helpers.ts:170-190. Lifecycle routes require a client-supplied stable handle whose agentId/scope/scopeRef **equal the authorized identity**, failing closed — `lifecycleHandleIdentityError`, memongo:apps/api/src/routes/v1-helpers.ts:206-220; present in published 2.0.0 (memongo@2.0.0:apps/api/src/routes/v1.ts:195-208, enforced at :964, :991, :1030, :1070).

### 1.4 Admin vs non-admin routes [SUBSTRATE-FACT]

Two static route classes gated for scoped keys (identical sets at 2.0.0 and HEAD):

- `ADMIN_ONLY_V1_PATHS = { /v1/read-file, /v1/import/conversations }` — any scoped key → 403 "scoped API key cannot access a server-file route". memongo:apps/api/src/app.ts:401-404, 620-630 (published: app.ts:372-375, 579-589).
- `AGENT_GLOBAL_V1_PATHS = { /v1/status, /v1/status/detailed, /v1/stats, /v1/sync, /v1/probes/embedding, /v1/probes/vector, /v1/read-file, /v1/chain-trace, /v1/self-edit }` plus everything under `/v1/admin/*` and `/v1/jobs*` — a **scope-constrained** key (concrete scopes or scopeRefs allow-list) → 403 "scope-restricted API key cannot access an agent-global route" (Class-G fix). memongo:apps/api/src/app.ts:389-414, 632-649 (published: app.ts:360-385, 594-605).
- Note: an **agentId-only** key is NOT scope-constrained (`policyIsScopeConstrained`, app.ts:420-424) and can reach agent-global routes — "agentId scoping is orthogonal to the tenant boundary."

Route inventory: **43 routes at published 2.0.0** (single memongo@2.0.0:apps/api/src/routes/v1.ts, 2221 lines) and **42 at HEAD** (`apps/api/src/routes/v1-*.ts` split files; adds `/write-events`, removes the 2 benchmark routes). ⚠️ SUPERSEDED 2026-08-13 (amendment v2, evidence finding 1): the original "(43 routes) at HEAD" was inverted — verified via tag/HEAD grep. Route set covers the search-kb/admin routes enumerated in §1.5 of the v1.ts route list (extracted: /add, /search, /search-detailed, /search-kb, /state, /lifecycle/*, /write-*, /admin/*, /jobs*, /status*, /stats, /sync, /probes/*, /read-file, /self-edit, /chain-trace, /context-bundle, /profile, /extract, /consolidate, /novelty-scan, /hydrate-active-slate, /discovery-projection, /recall-conversation, /memory/feedback, /procedures/outcome, /import/conversations).

**No auth → fail closed:** if neither `MEMONGO_API_KEY` nor scoped keys are configured, all `/v1/*` return 401 `AUTH_NOT_CONFIGURED` unless `MEMONGO_ALLOW_INSECURE_NO_AUTH=1` — memongo:apps/api/src/app.ts:654-671.

---

## 2. Mapping mdbrain's DECIDED server principal across the boundary

mdbrain's decided principal contract (from the absorb research doc, mdbrain:docs/research/2026-08-13-memongo-absorb-company-brain.md:168): **allowed scopes/scopeRefs + trust tier + roles + departments + subjectId + namespaced external group memberships (e.g. `github:team:platform`, `slack:channel:eng-private`) + explicit read/write/admin capabilities**. Every REST/MCP governance context derives from it; request fields may only narrow authority. mdbrain's current principal is token+agentIds+scopes+scopeRefs only (mdbrain:apps/api/src/app.ts:23-28 — a verbatim fork of memongo's policy type) and `GovernanceContext` today is caller-supplied scope/scopeRef/trustTier/roles/departments/agentId (mdbrain:packages/wiki-engine/src/wiki-governance.ts:23-41).

| mdbrain principal field | Memongo HTTP representation | Verdict |
| --- | --- | --- |
| allowed scopes | `MEMONGO_API_SCOPED_KEYS[].scopes` (canonical six-value set; `"*"`-or-exact-list) | **Maps 1:1** [SUBSTRATE-FACT] memongo:apps/api/src/app.ts:184-189,288-295 |
| allowed scopeRefs | `MEMONGO_API_SCOPED_KEYS[].scopeRefs` (matches `scopeRef`/`containerTag`) | **Maps 1:1** memongo:apps/api/src/app.ts:347-350 |
| (implicit) allowed agents | `agentIds` | Maps 1:1 |
| trust tier (`restricted/standard/admin`, mdbrain:packages/wiki-engine/src/wiki-governance.ts:23) | **NONE.** Closest proxy: root key ≈ admin (reaches admin/agent-global routes), scoped key ≈ non-admin. But memongo's split is about *route classes*, not *data visibility*; a scoped key still reads everything inside its allowed scopeRefs. | **Stays mdbrain-side.** No HTTP field carries it. |
| roles / departments | **NONE.** | **Stays mdbrain-side** (wiki governance only). |
| subjectId | **NONE.** Memongo has no subject/user authentication at all — tenancy is the caller-supplied (agentId, scope, scopeRef) tuple. Per-user partitioning is expressible only by *encoding* the subject into `scopeRef` (e.g. `scope=user, scopeRef=user:<subjectId>`), which mdbrain must generate server-side. | **mdbrain-side adapter** (resolution (a)): mdbrain mints scopeRef from its authenticated subjectId; memongo never sees subjectId. |
| namespaced external groups (`github:team:*`, `slack:channel:*`) | **NONE.** | **Stays mdbrain-side.** Wiki governance concept; memongo memory substrate cannot key on groups. If group-scoped memory is ever wanted, only encoding into scopeRef strings exists — that is a naming-convention adapter, not a memongo feature. |
| read/write/admin capabilities | **Coarse only.** admin = root key (only it reaches `/v1/admin/*`, `/v1/read-file`, `/v1/import/conversations`); scoped keys get **read AND write together** on all remaining routes. There is **no read-only key type** over the published API. | **GAP.** |

### GAP-B1: no read-vs-write capability split in memongo scoped keys [SUBSTRATE-FACT]

Evidence: `ScopedApiKeyPolicy` has no capabilities field (memongo:apps/api/src/app.ts:184-189); scoped keys pass through to every non-admin, non-agent-global route including `/v1/add`, `/v1/write-*`, `/v1/lifecycle/delete` (route list §1.4; published memongo@2.0.0:apps/api/src/routes/v1.ts).
Resolution: **(a) mdbrain-side adapter.** mdbrain's own API gateway is the sole caller of memongo; it enforces read/write/admin capabilities against its DECIDED principal before issuing the memongo call, and provisions memongo keys whose scope/scopeRef allow-lists are the *superset* of what any principal may need. Memongo's 403 floor remains the last-line tenant guard; capability granularity is mdbrain's job. No memongo change required.

### GAP-B2: trust tier, roles, departments, subjectId, external groups have no memongo HTTP representation

Resolution: **(a) mdbrain-side adapter / intentionally stays mdbrain-side.** These are wiki-governance (OKF page) concepts enforced by mdbrain:packages/wiki-engine/src/wiki-governance.ts. Memongo's substrate tenancy (agentId/scope/scopeRef) is a *coarser* floor; mdbrain encodes subject/tenant partitioning into scopeRef values it mints itself. This is consistent with the decided direction: memongo is the memory substrate, wiki governance is mdbrain-owned. **Not a service-boundary blocker** — nothing mdbrain needs from memongo requires these fields.

**Wiki governance stays mdbrain-side** — the wiki engine, its permission model, and connector ACL fidelity (research doc :172) operate on mdbrain-owned `wiki_pages`, never on memongo collections. Clean boundary.

---

## 3. Service-version negotiation (published surface ONLY)

### 3.1 What published 2.0.0 exposes [SUBSTRATE-FACT]

| Endpoint | Published 2.0.0 behavior | Usable as version signal? |
| --- | --- | --- |
| `GET /health` | `{ ok: true, service: "memongo-api" }`, unauthenticated — memongo@2.0.0:apps/api/src/app.ts:632 | Liveness + service identity only; no version |
| `GET /openapi.json` | OpenAPI doc, unauthenticated, `info.version` **hardcoded `"1.0.0"`** — memongo@2.0.0:apps/api/src/openapi-spec.ts:637-638 | **Misleading** — hardcoded, does not track release. Do not use as a version probe. |
| `GET /v1/status` | bridge status; **no `version` field** (published client type confirms: memongo@2.0.0:packages/client/src/types.ts:354-366 has no `version`) | No version |
| `GET /ready` | **DOES NOT EXIST** at 2.0.0 (added at HEAD 2.0.1, P1.7) — memongo:apps/api/src/app.ts:679-682; absent from memongo@2.0.0:apps/api/src/app.ts | Unpublished — must not be depended on |
| `version` in `/v1/status` response | **HEAD-only** (`{ version: MEMONGO_API_VERSION, ...status }`, memongo:apps/api/src/routes/v1-status-routes.ts:73-75; MEMONGO_API_VERSION="2.0.1", memongo:apps/api/src/version.ts:7). `apps/api/src/version.ts` does not exist at v2.0.0. | Unpublished |
| `x-memongo-client-version` request header | **HEAD-only** client behavior (memongo:packages/client/src/client.ts:177, version.ts:7); published 2.0.0 client sends no such header (memongo@2.0.0:packages/client/src/client.ts:98-105) | Unpublished; server never validates it even at HEAD (advisory echo only) |

**Honest conclusion:** published memongo 2.0.0 exposes **no reliable version or capability endpoint**. There is no semver negotiation surface at all; the client-version header is advisory echo (HEAD only) and nothing server-side refuses a mismatched client.

### 3.2 mdbrain startup compatibility policy (published surface only) — recommended

1. **Pin expectation:** mdbrain deployment config declares `MEMONGO_EXPECTED_DEPLOYMENT=2.0.0` (the published npm line).
2. **Probe 1 — liveness/identity:** `GET /health`; require HTTP 200 and body `service === "memongo-api"`. Anything else → refuse startup. (memongo@2.0.0:apps/api/src/app.ts:632)
3. **Probe 2 — published-build fingerprint:** `GET /openapi.json`; require `info.version === "1.0.0"`. Rationale: at published 2.0.0 the value is the hardcoded "1.0.0" (memongo@2.0.0:apps/api/src/openapi-spec.ts:638); at unpushed HEAD it is the real release version "2.0.1" (memongo:apps/api/src/openapi-spec.ts:32-33). **A value other than "1.0.0" therefore means the server is NOT the published 2.0.0 build → refuse** (fail-closed against silently running against unpublished HEAD behavior, which the global rules treat as a blocker).
4. **Probe 3 — credential + functional check:** `GET /v1/status` with the configured mdbrain key. Require 200 (401/403 → key misconfigured; note this route is agent-global, so the mdbrain service key must be the root key or an agentId-only/non-scope-constrained key — see §1.4). Published response must NOT contain a top-level `version` field; presence of `version` ⇒ HEAD deployment ⇒ refuse (same fingerprint logic as probe 2, defense in depth).
5. **Refuse-on-mismatch:** any probe failure or fingerprint deviation → mdbrain refuses to start serving memory-backed traffic and logs the observed fingerprint. No retry-downgrade, no partial mode.

This policy uses only routes that exist at published 2.0.0 and is pinned to the published build's exact (quirky) fingerprints. It will need a one-line update when a new published version ships — that is the correct behavior for a pin policy.

---

## 4. Per-request identity propagation — the honest answer [SUBSTRATE-FACT]

**Memongo tenancy is per-request-(agentId, scope, scopeRef), all caller-supplied strings; there is no end-user authentication, no impersonation token, no subject claim, no on-behalf-of header anywhere in the HTTP surface.**

Evidence:

- Identity is resolved purely from request fields (query/body/nested `handle|entry|memory|params`): memongo:apps/api/src/scope-identity.ts:40-98. Nothing is derived from the bearer token beyond *which static allow-lists constrain those fields* (memongo:apps/api/src/app.ts:335-355).
- The only principal concept is the API key itself (root or scoped policy, app.ts:184-189). Keys are env-configured at boot; there is no per-request principal issuance.
- Therefore "per-agent" is itself a convention: `agentId` is just a string the caller sends. A single key holding `agentIds: ["*"]` (or unconstrained) can act as ANY agent.

**Can mdbrain act on behalf of end users through the memongo API?** Yes — *mechanically*, by minting per-request scope fields mdbrain-side (e.g. `scope: "user", scopeRef: "user:<subjectId>"`) under a service key whose policy permits them. But **the trust is entirely mdbrain-side**: memongo cannot distinguish mdbrain serving end-user Alice from mdbrain serving end-user Mallory except by the static scopeRef allow-list on the key. This is the classic trusted-subsystem model. Corollaries mdbrain must own:

- mdbrain must never forward caller-supplied scope/scopeRef/agentId to memongo; it must mint them from its authenticated DECIDED principal (this is exactly the fix direction in mdbrain:docs/research/2026-08-13-memongo-absorb-company-brain.md:168).
- Dynamic per-user allow-lists cannot be expressed in a static env-var policy; either the mdbrain service key holds a wildcard-within-tenant scopeRef policy (and mdbrain enforces per-user authorization before the call), or mdbrain operates one memongo key per tenant. The wildcard approach makes memongo's 403 floor a per-*tenant* floor only, not per-user.

**Verdict: per-request end-user propagation = mdbrain-side adapter (resolution (a)); memonto provides a static (agentId, scope, scopeRef) floor, nothing more. Not a blocker for the decided architecture.**

---

## Residual risks

1. **R-B1 (medium):** the version fingerprint policy (§3.2) depends on published 2.0.0's hardcoded OpenAPI `info.version: "1.0.0"` quirk. Any future published release that fixes the hardcoding changes the fingerprint — by design the policy then refuses, forcing an explicit re-pin. Safe direction (fail closed), but operationally loud.
2. **R-B2 (medium):** scoped keys have read+write on all non-admin routes; if mdbrain ever exposes a memongo key to a less-trusted component expecting read-only behavior, the floor won't help. Mitigation stays mdbrain-side (never hand the key out; gateway-only access).
3. **R-B3 (low):** `containerTag` is a silent alias for `scopeRef` in both auth and execution (memongo:apps/api/src/app.ts:347-350; v1-helpers.ts:153-160). mdbrain's client must send `scopeRef` consistently; a mixed convention could create partitions mdbrain can't enumerate.
4. **R-B4 (low):** agentId-only keys bypass the Class-G agent-global block (memongo:apps/api/src/app.ts:420-424). If mdbrain provisions a per-tenant key constrained only by agentId, it can still hit `/v1/status`, `/v1/admin/*`, `/v1/jobs` — acceptable for a service key, but don't treat such a key as tenant-confined for analytics surfaces.

## Evidence-quality notes

- All memongo HEAD cites verified by direct file reads on 2026-08-13.
- All published 2.0.0 cites verified via `git show v2.0.0:<path>` on 2026-08-13; auth-section diff HEAD↔v2.0.0 confirmed behavior-identical (deltas limited to CORS dev-defaults, error envelope, request-id, /ready route).
- No external sources used; no competitor claims in this lane.
