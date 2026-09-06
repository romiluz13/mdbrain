# kimi-k3 — Round 2 Debate Response

Position on each of the 9 points, with counter-arguments and resolution proposals.
Decisive per instructions; "can live with" marked explicitly where applicable.

---

## P1 — Connector stubs: delete vs honesty-gate vs Obsidian ingest+CLI

**Position: Delete the 5 shells. Accept Sol's Obsidian ingest + CLI as in-scope, strictly gated.**

My Round 1 plan said delete all six. Sol's argument changed my position on one of
them: a "connector" whose `ingest()` durably writes zero pages is still a false
claim even when relabeled "beta library API." Keeping Obsidian as-is leaves the
DD finding half-fixed. So the honest outcomes for Obsidian are binary: implement
it, or delete it.

Grove's typed `ConnectorNotImplementedError` is a defensible fallback — it is
strictly better than fake success — but it still ships dead exported surface
that DD will ask about ("why is a Notion connector exported if it can never
run?"). Deletion answers that question permanently.

Counter to Sol's scope expansion: new ingest code pre-sale adds risk. Bounded,
though — the primitives (`createWikiPage`, `updateWikiPage`) already exist and
are tested, and `discover()` is already real. The CLI reuses the established
`scripts/maintenance-run.ts` conventions (env fail-closed, `--dry-run`, nonzero
exit). The risk is contained if the gates hold.

**Resolution proposal:**
1. Delete Notion, Confluence, GitHub, GoogleDrive, MemoryBridge connectors and
   their tests; remove the README connector matrix rows.
2. Implement `ObsidianConnector.ingest()` (normalize frontmatter, chunk,
   upsert via `createWikiPage`/`updateWikiPage`, idempotent by stable
   `sourceRef = vault-relative path`) and `scripts/obsidian-sync.ts` (one-shot,
   repo path argument, env fail-closed, `--dry-run`).
3. Gate: colocated tests including a second-run idempotency proof (no
   duplicate pages, stable revision semantics), README updated to "one-shot
   Obsidian import from a repo path with idempotent re-import."
4. If item 2/3 slips past the release cut, Obsidian is deleted with the rest.
   No middle state ships.

Can live with: Grove's fail-closed gate on all six, if the group rejects any
pre-sale feature work. Cannot live with: stubs returning success-with-zeros.

## P2 — `mdbrain-export.ts`: delete vs re-export

**Position: Delete. I verified Sol's claim and it is accurate.**

`packages/memory-bridge/src/mdbrain-export.ts:3` — the header promises "Users
can export every memory scoped to an `agentId` as a signed JSON bundle." The
module does no such thing: it HMAC-signs a bundle the caller constructed. No
store access, no streaming, despite the header's "bundle construction streams
events / episodes / kb documents" narration. The "Provable Property 14"
language invites crypto-protocol DD scrutiny on an unaudited, ad-hoc signature
format for data the caller already holds.

Counter to Grove (re-export through `index.ts`): reachability does not fix the
header overclaim or the audit surface; it makes both more visible. And signed
memory export overlaps the wiki OKF export story, so re-export creates a
"which export is canonical?" question in DD.

**Resolution proposal:** delete `mdbrain-export.ts` and its test, note the
removal in CHANGELOG. If the buyer wants signed export, it returns post-sale
as a designed feature: corrected docs, real store-backed construction, a
round-trip integration test.

Can live with: Grove's re-export ONLY if the header is rewritten to describe
what the code does and a round-trip integration test lands in the same PR.
Default remains delete.

## P3 — Maintenance surface: HTTP routes vs CLI

**Position: I concede to CLI. Grove and Sol converged, and they are right.**

My Round 1 HTTP routes (`POST /v1/wiki/maintenance/*`) expand the API surface,
the OpenAPI spec, and the auth/authorization matrix pre-sale — and they
interfere with P7's tool-count stability argument. The DD complaint was "not
reachable from the running system," and a documented, tested CLI wired to the
real runtime answers it: the buyer can run the pipeline in a terminal and watch
governance gates fire.

Counter to my own Round 1 position, for the record: "API-first product should
demo through HTTP" is a marketing preference, not a correctness requirement,
and it costs more new code than the finding justifies.

**Resolution proposal:** adopt Grove's shape, which subsumes Sol's:
`scripts/wiki-maintenance.ts` with `dry-run | refresh | dreamer` subcommands,
reusing `packages/scripts/maintenance-run.ts` conventions (explicit env
validation, fail closed, human output, exits nonzero on misconfiguration).
README gains an operator section naming the exact commands. HTTP routes are
deferred to the post-sale roadmap and the README says so.

Can live with: my HTTP version if the group overrules — but I withdraw it as
my proposal.

## P4 — Canonical quickstart: preview compose + external Memongo vs compose.full.yml + published image

**Position: Adopt Sol's single-canonical-path, with two amendments.**

Grove's and my "minimal quickstart + external Memongo" leaves a hole: the
evaluator must supply a Memongo instance, and today that means an undocumented
sibling checkout and local build. That recreates the exact DD finding —
"quickstart doesn't work verbatim" — one layer up. Sol is right that
`docker/compose.full.yml` plus a published Memongo image is the only version
that is genuinely one-command for a fresh evaluator, and the same owner
controls the `memongo` repo, so publication is feasible (the
`ghcr.io/romiluz13/memongo` namespace is already referenced in
`docker/compose.full.yml`).

Counter to Sol's "release blocked until done": image publication is ops work
in a different repository; this repo's remediation cannot hard-block on it
without a fallback.

**Resolution proposal:**
1. Canonical quickstart = `docker/compose.full.yml` (atlas-local with
   `VOYAGE_API_KEY`, published digest-pinned Memongo image, api, web).
2. Prerequisite tracked as a checklist item: publish `memongo` OCI image
   (owner's repo, ops task, not this repo's code).
3. Documented fallback: preview MongoDB-only compose + external Memongo
   (`MEMONGO_API_URL`/`MEMONGO_API_KEY`), with the sibling-checkout path
   written out explicitly and tested.
4. Release gate: either the image is published, or the fallback path is
   green in CI. One of the two must be true; the quickstart may not ship
   pointing at an unpublished image without instructions.

Can live with: Grove/my minimal quickstart if the group rules image
publication out of scope — but then step 1 of the README must state the
Memongo prerequisite with an exact, tested command.

## P5 — Dreamer no-LLM behavior: documented fallback vs fail-closed + rename

**Position: Adopt Sol's fail-closed + rename, with an explicit opt-in mode.**

Grove and I both proposed keeping the heuristic fallback with documentation.
Sol's counter is stronger than my original position: the fallback writes
whole-event claims at fixed 0.7 confidence into a governed wiki. A buyer
re-running DD without an LLM key would watch the Dreamer pollute the knowledge
layer with low-quality claims — a worse demo than a clear configuration error,
and arguably a recurrence of the original "silent degradation" finding class.

**Resolution proposal:** `runDreamerPromotion` fails with a descriptive error
when no analyzer is configured and no explicit mode is passed. The heuristic
survives only behind an explicit opt-in (e.g., `mode: "heuristic-import"`),
which existing tests and offline fixtures pass deliberately; the mode is
reported in `MaintenanceResult`. Default path: fail closed. The phase-3 dead
`_injectionType` computation is removed or completed in the same PR.

Can live with: Sol's exact version (delete the heuristic entirely, update
fixtures to inject a stub analyzer). Either beats the status quo and beats my
Round 1 "document the fallback" position, which I withdraw.

## P6 — /ready probe depth: keep text probe vs require auto-embed + hybrid proof

**Position: Two-tier compromise. Keep text-lane readiness; add capability reporting.**

Sol's strict probe makes `/ready` unreachable for evaluators without an Atlas
Model API key — the quickstart's target audience — and can flap during
mongodb's async index builds right after boot. That trades one DD finding for
a quickstart regression.

But Grove's and my "keep the probe, document the gap" leaves ready=200 while
the advertised hybrid lane is dead — the same misleading-claims class as the
original findings.

**Resolution proposal:**
1. `/ready` keeps the text-lane probe (subsystem liveness).
2. The `/ready` payload gains a capability block:
   `search: { text: bool, vector: bool, autoEmbed: bool }`, sourced from
   per-index status reporting added to `ensureWikiSearchIndexes` (adopt
   Grove's reporting suggestion).
3. README states the contract: ready green = text lane live; hybrid search
   returns 503 `SEARCH_UNAVAILABLE` when the vector lane is absent; the
   capability block tells you which.

Can live with: probe exactly as-is plus documentation, if the group rejects
payload changes. Cannot live with: Sol's hard `al-...` requirement for
readiness.

## P7 — Claim-drift CI: snapshot/inventory tests vs manual diff

**Position: Adopt Sol's inventory tests in minimal form. Skip doc generation.**

The original DD finding (README says 34, real is 30) is exactly the class a
mechanical gate prevents. Manual diff-discipline (my Round 1 answer) has
already failed once — that is how we got here.

Counter to Sol's full version: generated-docs machinery is over-engineering
pre-sale and adds a build-time dependency chain DD will also inspect.

**Resolution proposal:** two vitest assertions:
- MCP: `toolList.length === 30` in `apps/mcp`.
- SDK: `Object.keys(createMdbrainTools(createMdbrainToolsClient({ fetch: stub }))).length === 14`
  in `packages/tools`.
Failure messages name the README lines to update. README numbers stay manual;
CI now fails when they drift. Doc generation deferred post-sale.

Can live with: Sol's full version if the group wants it; I consider the
minimal form sufficient for the sale gate.

## P8 — Image pinning: preview tag vs digest pin

**Position: Split. Digest-pin the canonical stack; tag the dev compose.**

Counter to tag-everywhere (my/Grove's Round 1): `compose.full.yml` is the DD
artifact under P4; a mutable tag there is a legitimate supply-chain/drift
objection, and "the contract gate is semantic" answers version drift but not
image tampering.

Counter to digest-everything (Sol): the `preview` tag moves frequently;
pinning it makes the dev quickstart bit-rot between refreshes, and there is
no refresh automation today.

**Resolution proposal:** digest-pin the Memongo image (and atlas-local) in
`compose.full.yml`; keep the mutable `preview` tag in the dev quickstart
compose with a comment that it tracks latest preview. Add a monthly
pin-refresh note to the README or a `bun run docker:refresh-pins` script if
the group wants it automated.

Can live with: Sol's digest-everything if a refresh script ships in the same
PR.

## P9 — `tmp/` in `.gitignore`

**Position: Adopt Grove's addition verbatim.** One line; prevents plan/debate
artifacts (like this file) from leaking into the published tree. Neither other
plan covers it; no downside.

---

## Grove concession — `apps/web/lib/marketing/comparisons.ts:241`

**Accepted.** I verified: line 241 is the `strengths` field of the `openwiki`
competitor entry ("Fast local wiki generation, source connectors, maintenance
workflows, and OKF output."). It describes OpenWiki's product, not MDBrain's.
My validation-round wording misread it as an MDBrain claim.

Scope adjustment: my plan's marketing sweep drops that specific line as a
false-claim instance. The sweep itself stays — its method is audit-every-claim,
not trust-the-line-list, so it will confirm or clear each remaining connector/
maintenance marketing statement on its own merits.

---

## Verdicts (one line each)

- P1: Delete 5 shells; implement Obsidian ingest + CLI behind idempotency tests, else Obsidian dies with the rest.
- P2: Delete `mdbrain-export.ts` (Sol's header claim verified accurate); re-export only with rewritten docs + integration test.
- P3: Concede to CLI (`scripts/wiki-maintenance.ts`, dry-run, fail-closed, README-documented); HTTP deferred post-sale.
- P4: Adopt `compose.full.yml` canonical path with published digest-pinned Memongo; documented tested fallback, never hard-blocked.
- P5: Fail closed + rename; heuristic survives only as explicit opt-in mode reported in `MaintenanceResult`.
- P6: Keep text-lane readiness; add `search: {text, vector, autoEmbed}` capability block; document the contract.
- P7: Adopt minimal inventory tests (30 MCP / 14 SDK) with README-referencing failure messages; skip doc generation.
- P8: Digest-pin `compose.full.yml`; mutable preview tag in dev compose with refresh note.
- P9: Adopt Grove's `tmp/` `.gitignore` line verbatim.

## Top-3 must-haves (non-negotiable for the final plan)

1. **Quickstart-verbatim proof.** One canonical compose path; fresh-clone
   end-to-end green on a clean Docker host; the `/ready` contract documented
   and honest at whatever depth the group lands.
2. **Claim honesty plus drift prevention.** README/marketing corrected
   (30 MCP tools, 14 SDK tools, connector truth, governance post-filter
   wording, Memongo 2.1.0 pin) AND the P7 inventory tests so the next drift
   fails CI instead of reaching a buyer.
3. **No fake-success surface.** The 5 shell connectors gone (or fail-closed
   at absolute minimum), `mdbrain-export` gone (or header-fixed and
   integration-tested), and the Dreamer never silently writes heuristic
   claims from its default path — including removal or completion of the
   phase-3 dead `_injectionType` computation.
