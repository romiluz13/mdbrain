# Sol Round 2 — Cross-Comparison Debate

## Concession accepted

I accept Grove’s correction. `apps/web/lib/marketing/comparisons.ts:241` describes OpenWiki’s strengths, not MDBrain’s capabilities. It should not be changed for the connector finding. The MDBrain-side correction belongs in `apps/web/lib/marketing/architecture.ts` and the README.

## P1. Shell connector disposition

**Position:** Delete the five shell classes, their configuration types, exports, and placeholder tests. Defer Obsidian page-ingest semantics and a dedicated sync CLI until after the pre-sale honesty pass.

**Strongest counter-argument:** Throwing `ConnectorNotImplementedError` preserves source compatibility, while a working Obsidian ingest/CLI would turn the only real adapter into a stronger buyer demo.

**Resolution:** Prefer the smallest truthful surface. Keep the provider-neutral discovery contract, registry, and tested Obsidian discovery/path-contained export as a beta library API. Remove or narrow the misleading no-op `ingest` contract rather than implementing Markdown-to-wiki policy under sale pressure. Record Obsidian ingest/CLI as the first post-sale feature. Deletion is acceptable because no application imports these classes and git history preserves them.

## P2. `mdbrain-export.ts` disposition

**Position:** Delete `mdbrain-export.ts` and its test.

**Strongest counter-argument:** Its canonicalization and HMAC verification are thoroughly tested, and re-exporting it is a very small change that preserves potentially valuable IP.

**Resolution:** Delete it now and retain the design in git history. Re-exporting would convert unreachable helpers into a supported cryptographic format without a memory retrieval path, format version, key lifecycle, or end-to-end export guarantee. A future signed export should start with the actual data-export contract and receive a security review. Keep the separate, implemented OKF wiki export unchanged.

## P3. Maintenance exposure surface

**Position:** CLI only; do not add HTTP or MCP maintenance endpoints before the sale.

**Strongest counter-argument:** Authenticated HTTP routes are easier to demonstrate remotely, reuse established API governance, and look more product-complete to a buyer.

**Resolution:** Ship one operator-focused CLI with machine-readable output and a scripted demo. It proves production reachability without adding request schemas, authorization decisions, denial-of-service exposure, API compatibility obligations, or MCP tools. A buyer can still run it live from the repository, and the 30-tool MCP claim remains stable.

## P4. Canonical quickstart stack and Memongo source

**Position:** Concede that mandatory publication of a Memongo OCI image is outside this repository’s smallest pre-sale change set. Use `docker/mongodb/docker-compose.preview.yml` for MongoDB and document exact Memongo 2.1.0 sibling/external-service commands.

**Strongest counter-argument:** A quickstart that requires a second checkout is not truly self-contained, and an immutable published image would substantially improve evaluator confidence and reproducibility.

**Resolution:** Do not block this repository’s release on external publication. Make the two-repository prerequisite explicit and executable, including the exact Memongo revision/contract check; keep `docker/compose.full.yml` as the full-stack proof path. If a verified public Memongo 2.1.0 image already exists during implementation, consume it, but treat publishing one as a separately owned follow-up rather than a hard prerequisite.

## P5. Dreamer with no LLM configured

**Position:** Dreamer must fail closed when its LLM is unconfigured. Silent fallback must not be called Dreamer.

**Strongest counter-argument:** The deterministic whole-event heuristic allows offline demos, avoids an external LLM dependency, and preserves existing behavior.

**Resolution:** Preserve the heuristic only as an explicitly selected, separately named event-import mode. Default Dreamer invocation exits nonzero with `MAINTENANCE_UNCONFIGURED`; explicit heuristic invocation reports `mode: "heuristic"` in `MaintenanceResult` and documentation. This preserves an offline path without misrepresenting it as structured five-phase consolidation.

## P6. `/ready` probe depth

**Position:** Keep the current bounded text-search probe as the base readiness gate; do not require a model key for every `/ready` success.

**Strongest counter-argument:** The public default search path is hybrid, so text-only readiness can report healthy while the advertised vector lane fails.

**Resolution:** Keep `/ready` reachable for keyless evaluators, but make its response and documentation explicit about text and vector capability status. Add a separate hybrid preflight in the verbatim keyed quickstart and `compose-smoke` that requires both indexes and a successful known-result hybrid query. Do not silently label text readiness as hybrid readiness. This avoids coupling general service health to an Atlas account while still making the advertised demo fail closed.

## P7. Claim-drift CI gates

**Position:** Adopt a lightweight mechanical gate.

**Strongest counter-argument:** Generated documentation and snapshots add maintenance machinery for two simple counts that can be reviewed manually.

**Resolution:** Test MCP inventory through `tools/list`, test the 14 SDK keys through `Object.keys(createMdbrainTools(...))`, assert uniqueness, and add a small README claim check around stable markers. Do not build a documentation generator. The prior count drift proves that a narrow automated regression test is justified.

## P8. Image pinning style

**Position:** Use the documented `mongodb/mongodb-atlas-local:preview` tag in the developer quickstart; do not hardcode its digest pre-sale.

**Strongest counter-argument:** `preview` is mutable, so a later upstream image can break the diligence replay or introduce supply-chain drift.

**Resolution:** Capture and publish the resolved image digest in the acquisition proof pack and CI logs, and allow an image-reference override for exact replay. Keep the documented tag in the README because this is a preview development dependency whose fixes may move with the tag. Revisit a maintained digest-update rail after the sale rather than freezing an unowned preview digest.

## P9. Add `tmp/` to `.gitignore`

**Position:** Accept, with artifact handling made explicit.

**Strongest counter-argument:** Blanket ignoring `tmp/` can hide requested plans, debate records, or other evidence that should be reviewed and retained.

**Resolution:** Add `/tmp/` to `.gitignore` during cleanup because it currently contains browser-profile debris and generated artifacts. Before that change, move any diligence material intended for source control to a durable location such as `docs/diligence/`; leave Round 1/2 working files ephemeral unless the owner elects to preserve them.

## Top three must-haves for the converged plan

1. **Verbatim proof:** Preview MongoDB plus explicitly versioned Memongo instructions, correct `al-...` key guidance, a known-result hybrid smoke test, and retained transactions-only labeling for the minimal stack.
2. **Truthful surface:** Delete five connector shells, dead signed-export helpers, and API/MCP Wrangler configs; correct README/web architecture claims and protect tool counts with lightweight tests.
3. **Real maintenance semantics:** CLI-only operator exposure, existing `MDBRAIN_LLM_*` contract, structured phase 3/4 behavior, and fail-closed Dreamer with any heuristic path explicitly named and reported.
