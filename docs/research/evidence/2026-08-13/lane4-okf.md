# LANE 4 — Google Open Knowledge Format (OKF): External Verification

> ⚠️ **Raw research notes — superseded where the synthesis differs.** Authoritative claims live in `../../2026-08-13-memongo-absorb-company-brain.md`; known stale claims are marked SUPERSEDED in place. (Banner added 2026-08-13, v4 remediation.)

**Access date for all external claims: 2026-08-13.**
**Scope:** (1) verify whether "Google OKF" is genuinely Google-owned/maintained; (2) document OKF spec v0.2 for later mapping; (3) anchor mdbrain's current OKF references with file:line.

---

## 1. Verdict on Attribution

**"Google OKF" is essentially CORRECT but must be stated with two caveats.**

- OKF lives in the **`GoogleCloudPlatform`** GitHub organization (verified org, id 2810941), repo `knowledge-catalog`, subdirectory `okf/`. [EXTERNAL-SPEC]
- Contributions require the **Google CLA** (cla.developers.google.com), i.e., Google-governed. [EXTERNAL-SPEC]
- Authors named by third-party directory and confirmed by commit history: **Amir Hormati** (`amir.hormati`, <ahhormati@gmail.com> — the same `human:ahormati` actor used throughout the spec's examples) and **Sam McVeety**, Google Cloud Data Cloud team. [EXTERNAL-SPEC]
- **Caveat 1:** The repo README carries the explicit disclaimer: *"This repository and its contents are not an official Google product."* So: Google-owned and Google-maintained, but **not an official Google product/standard**. Any mdbrain wording like "Google's official knowledge format" would be UNSUPPORTED. [EXTERNAL-SPEC]
- **Caveat 2:** mdbrain's README does not link the canonical repo at all — both README OKF links point to **groundingpage.com** (a third-party "Technical Standard" directory), which documents **outdated v0.1**. The attribution target is murky/wrong-link, though the underlying "Google" claim is right. See §4.

## 2. Canonical Repository Facts

| Fact | Value | Source |
| --- | --- | --- |
| Canonical repo URL | <https://github.com/GoogleCloudPlatform/knowledge-catalog> (OKF under `okf/`) | GitHub API, 2026-08-13 |
| Spec file | `okf/SPEC.md` — **Open Knowledge Format v0.2** | raw.githubusercontent.com, 2026-08-13 |
| Owning org | `GoogleCloudPlatform` (GitHub Organization, id 2810941) | GitHub API, 2026-08-13 |
| License | **Apache-2.0** (GitHub license field; root `LICENSE.md` and `okf/LICENSE.md` both Apache-2.0 text) | GitHub API + raw file, 2026-08-13 |
| Repo created | **2026-05-04**T16:36:24Z | GitHub API, 2026-08-13 |
| OKF initial import | commit `ee67a5ca`, **2026-06-12** ("Import Open Knowledge Format reference enrichment agent (#28) — OKF initial commit", author amir.hormati) | GitHub API commits?path=okf/SPEC.md, 2026-08-13 |
| v0.2 migration | commit `780fe9d3`, **2026-07-24** ("okf: migrate format and tooling to Open Knowledge Format v0.2 (#227)") | GitHub API, 2026-08-13 |
| Latest SPEC.md change | commit `3fcbb9f8`, **2026-07-24**T16:45:43Z ("Update SPEC.md") | GitHub API, 2026-08-13 |
| Latest repo commit | `374e0bc4`, **2026-08-08**T03:33:57Z ("mdcode: add Knowledge Catalog push for the semantic model"); repo `pushed_at` 2026-08-12T20:38:04Z | GitHub API, 2026-08-13 |
| Tags / Releases | **None** — `GET /tags` and `GET /releases` return empty arrays | GitHub API, 2026-08-13 |
| Status | **Active, not archived, pre-1.0.** Commits within 5 days of access; spec is v0.2 with no tagged releases; 8,580 stars / 735 forks / 174 open issues | GitHub API, 2026-08-13 |
| Official-product status | README disclaimer: "not an official Google product" | repo README.md, 2026-08-13 |
| Product context | Repo describes Knowledge Catalog ("formerly Dataplex") as Google Cloud's data catalog; OKF is positioned as vendor-neutral, "not tied to any particular agent, framework, model provider, or serving system" | repo README.md + okf/README.md, 2026-08-13 |

**Name collision warning:** OKF ≠ Open Knowledge Foundation (OKFN, the non-profit). The groundingpage entry explicitly disclaims the relationship. [EXTERNAL-SPEC]

## 3. The OKF v0.2 Spec (mapping-ready summary)

Source: `okf/SPEC.md` at commit state of 2026-08-13 (spec last modified 2026-07-24). All items [EXTERNAL-SPEC].

### 3.1 Serialization & structure

- A **bundle** = a directory tree of UTF-8 Markdown files with **YAML frontmatter**. No schema registry, no central authority, no required tooling. Distributable as git repo (recommended), tarball, or subdirectory of a larger repo. (§3)
- **Reserved filenames:** `index.md` (directory listing, §8) and `log.md` (chronological update history, §9). MUST NOT be used for concept documents. (§3.1)
- **Concept document** = YAML frontmatter block (delimited by `---`) + free-form Markdown body. (§4)

### 3.2 Schema model (frontmatter)

- **Required:** `type` — a short, *unregistered* string (`BigQuery Table`, `Metric`, `Playbook`, `Attested Computation`, …). Consumers MUST tolerate unknown types. A concept with only `type` is fully conformant. (§4.1, §11)
- **Recommended:** `title`, `description`, `resource` (canonical URI of the underlying asset), `tags[]`.
- **Extensions:** arbitrary extra keys allowed; consumers SHOULD preserve them, MUST NOT reject them. (§4.1)
- **Conventional body headings** (not required): `# Schema`, `# Examples`, `# Computation`. (§4.2)

### 3.3 Entity / relation / claim model

- **"Entities" = concepts.** One concept per `.md` file; concept ID is the bundle-relative file path minus `.md`. Typing is the free-form `type` string — there is no formal entity schema or registry.
- **Relations = plain Markdown links** between concepts. Absolute bundle-root-relative form (`/tables/users.md`) recommended. Links assert an *untyped* directed relationship; the kind (joins-with, depends-on, …) is conveyed by surrounding prose. Consumers MUST tolerate broken links (they may denote not-yet-written knowledge). (§6.1) A `references/` subdirectory convention mirrors external material/code as first-class concepts. (§6.3)
- **Claims = body prose with per-claim attribution via footnotes.** A footnote label is a join key into `sources[].id` (keyed, not positional, so list reordering cannot silently misattribute). (§5.1)

### 3.4 Provenance, trust, lifecycle (v0.2's core addition, §5/§7)

- `sources[]`: `{ resource (REQUIRED), id?, title?, author?, usage_count?, last_modified? }` + sibling `usage_window: {from, to}`. Credibility signals (`author`, `usage_count`, `last_modified`) are stored as **objective signals, not scores** — credibility is inferred by consumers. Lineage is expressed through links, not a dedicated field; deep external lineage is out of scope for v0.2. (§5.1)
- `generated: { by, at }` — who/what produced the content + ISO 8601 last-meaningful-change time. (§5.2)
- `verified: [{ by, at }] | { by, at }` — independent confirmation events; a bare mapping MUST be treated as a one-element list. Distinct from `generated`: writing ≠ confirming. (§5.2)
- **Trust tiers (derived, advisory, not access control):** no `verified` → *unverified*; non-human verifiers only → *machine-confirmed*; a `human:<id>` verifier → *human-reviewed*. (§5.3)
- `status: draft | stable | deprecated` (absent ⇒ `stable`); `stale_after: YYYY-MM-DD` (absolute date, stale when `today >= stale_after`). (§5.4–5.5)
- **Actor convention (§7):** `<producer>/<version>` for agents/tools (e.g. `reference_agent/gemini-2.5-pro`), `human:<id>`, `process:<id>`. Trust classification keys off the `human:` prefix.

### 3.5 Attested Computation (§10) — the closest thing to a "claim with executable proof"

- Standalone concept `type: Attested Computation`. Frontmatter contract: `runtime` (REQUIRED; e.g. `bigquery`, `dbt`, `python`), `parameters[]` `{name, type, required}`, `computation` (path; absent ⇒ inline body fence under `# Computation`), `executor: { resource, receipt[] }`, `attester: { resource }` (deterministic, no-LLM code returning a verdict).
- Agent may only supply **parameter values** — it MUST NOT author/edit the computation. Attestation compares the expanded/compiled artifact carried in the receipt. (§10.3)
- **Verification vs attestation:** `verified` = doc-level, slow, stored in bundle; attestation = per-run, runtime, **not stored**. Both coexist. (§10.6)

### 3.6 Versioning (§12–13)

- Spec versions `<major>.<minor>`; current = **0.2**. Bundles MAY declare `okf_version: "0.2"` in bundle-root `index.md` frontmatter (the only place index frontmatter is allowed).
- **v0.1 → v0.2 breaking changes:** `timestamp` superseded by `generated.at`; body `# Citations` list superseded by frontmatter `sources`. v0.2 consumers SHOULD fall back gracefully.
- Deferred to future: receipt/verdict wire formats, attester ABI/sandboxing, attestation caching, semantic-layer templates.
- **Conformance (§11):** parseable frontmatter + non-empty `type` + reserved-filename structure. Consumers MUST NOT reject bundles for missing optional fields, unknown types/keys, broken links, or missing `index.md`.

## 4. How mdbrain References OKF Today (anchors)

All local claims [SUBSTRATE-FACT], verified 2026-08-13 in the working tree.

| Anchor | What it says |
| --- | --- |
| `mdbrain:packages/wiki-engine/src/okf.ts:1-34` | Header comment with **correct canonical attribution**: "OKF spec (GoogleCloudPlatform/knowledge-catalog, v0.2 — okf/SPEC.md)" (line 3). Documents bundle/concept-ID/reserved-files model, spec-form link export with legacy `[[wikilink]]` import-only parsing (lines 8-13), and v0.2 provenance vocabulary round-tripping (lines 14-27) |
| `mdbrain:packages/wiki-engine/src/okf.ts:23-27` | Explicit non-mapping: OKF `generated`/`verified`/`sources` "round-trip losslessly but are NOT currently mapped into mdbrain's own trustTier … a judgment call left for a future pass" |
| `mdbrain:packages/wiki-engine/src/okf.ts:30-32` | "MBrain internal wiki_pages schema is a strict SUPERSET of OKF. OKF is the portable projection…" |
| `mdbrain:packages/wiki-engine/src/okf.ts:66-110` | Path-safety gate for import/export (`MDBRAIN_OKF_ALLOWED_ROOTS`, `MDBRAIN_OKF_ALLOW_UNRESTRICTED`, fails closed) |
| `mdbrain:packages/wiki-engine/src/okf.ts:122-135` | `OkfActorEvent`, `OkfSource` interfaces mirroring spec §5/§7 |
| `mdbrain:packages/wiki-engine/src/okf.ts:137-151` | `OkfFrontmatter` interface: `type` required; `status`, `generated`, `verified` (single-or-list per §5.2), `stale_after`, `sources`, extension passthrough. Note: still carries legacy v0.1 `timestamp?: string` (line ~143) and the header comment at line 6 still lists `timestamp` as "recommended" — minor doc drift vs v0.2, which superseded `timestamp` |
| `mdbrain:packages/wiki-engine/src/okf.test.ts:1-5` | Round-trip tests: import bundle → wiki_pages (mocked bridge) → export → re-import, structure preserved |
| `mdbrain:packages/wiki-engine/src/okf.test.ts:13` | imports `importOkfBundle, exportOkfBundle` from `./okf.js` |
| `mdbrain:packages/wiki-engine/README.md` | Package self-description: "wiki pages, OKF interchange…"; feature bullet "OKF interchange — import/export Open Knowledge Format bundles" |
| `mdbrain:README.md:112` | Comparison table row: "OKF interchange … **Import + export round-trip**" |
| `mdbrain:README.md:223` | Feature bullet: "Import and export [Google's Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/) bundles" — **third-party link, not canonical repo** |
| `mdbrain:README.md:264` | Packages table: wiki-engine "Wiki pages schema, CRUD, OKF, search, …" |
| `mdbrain:README.md:284` | Acknowledgment: "[Google Open Knowledge Format](https://groundingpage.com/facts/open-knowledge-format/) — Vendor-neutral concept-per-page interchange format" — same third-party link |
| `mdbrain:docs/specs/2026-07-08-mdbrain-llm-wiki-design.md:7` | Design spec lists "Google Open Knowledge Format / OKF (vendor-neutral concept-per-page interchange spec)" as an inspiration |

### Attribution assessment of mdbrain's claims

- "Google Open Knowledge Format" as a label: **SUPPORTED** — GoogleCloudPlatform org, Google CLA, Google Cloud Data Cloud authors. [EXTERNAL-SPEC]
- README link targets (README.md:223, :284): **MURKY/OUTDATED** — point to groundingpage.com, a third-party directory whose entry documents **OKF v0.1** (published 2026-06-12 per that page) while the canonical spec has been v0.2 since 2026-07-24. The canonical link should be `https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md`. mdbrain's own code header (okf.ts:3) already cites the correct target.
- "Vendor-neutral": **SUPPORTED** by okf/README.md ("not tied to any particular agent, framework, model provider, or serving system") — but note this is a self-description by the producing team; no independent governance body exists. [COMPETITOR-CLAIM] for the "vendor-neutral" framing, though Apache-2.0 + Google CLA make it factually open.
- "Import + export round-trip" (README.md:112): code and tests exist (`okf.ts` export/import + `okf.test.ts:1-5` round-trip assertions) → **[SUBSTRATE-FACT]** backed; benchmark-grade evidence of fidelity not assessed in this lane.
- Any implied claim that OKF is an *official* Google standard/product: **UNSUPPORTED** — contradicted by the repo's own disclaimer.

## 5. Sources

**Kept:**

- GitHub API repo metadata — <https://api.github.com/repos/GoogleCloudPlatform/knowledge-catalog> — dates, license, org, archive status, stars (accessed 2026-08-13)
- GitHub API commits (repo + `path=okf/SPEC.md`), tags, releases — commit/tag/release chronology (accessed 2026-08-13)
- `okf/SPEC.md` (raw, main branch) — the normative v0.2 spec (accessed 2026-08-13; spec last modified 2026-07-24)
- Repo `README.md`, `okf/README.md`, `CONTRIBUTING.md`, `LICENSE.md` (cloned 2026-08-13) — disclaimer, positioning, Google CLA, Apache-2.0
- groundingpage.com/facts/open-knowledge-format/ — only to assess what mdbrain's README links to (accessed 2026-08-13)

**Dropped:**

- gitbook.com "What is OKF" blog, Medium posts — secondary commentary, no evidence beyond the canonical repo.
- Open Knowledge Foundation (okfn.org) material — name collision only; unrelated entity.

## 6. Gaps

- Did not enumerate every OKF mention in `apps/api` / `apps/mcp` (no grep tool available in this lane; `apps/mcp/src/tools.ts` does not exist under that name). The `wiki_export_okf` MCP tool is documented at README.md:231-area but its implementation file:line is unverified here. Next step: `rg -n "okf" apps/ packages/` in a lane with shell access.
- Whether mdbrain's export emits `okf_version` or the `Attested Computation` type: not verified (okf.ts is 1,229 lines; only header/interfaces/path-safety were read). Relevant for the mapping pass.
- groundingpage.com's publisher credibility is unknown; it is quoted only as the target of mdbrain's README links, not as an authority.
