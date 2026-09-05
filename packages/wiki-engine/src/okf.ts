// @mdbrain/wiki-engine — OKF (Open Knowledge Format) interchange.
//
// OKF spec (GoogleCloudPlatform/knowledge-catalog, v0.2 — okf/SPEC.md):
//   - Knowledge Bundle = directory of concept .md files
//   - Concept ID = file path with .md removed (tables/users.md → "tables/users")
//   - Frontmatter: required `type`; recommended title/description/resource/tags/timestamp
//   - Reserved files: index.md (directory listing), log.md (update history)
//   - Links = standard markdown links between concepts → relationships. The
//     spec's recommended form is a bundle-root-relative absolute link
//     (`/tables/users.md`); mdbrain previously exported its own [[wikilink]]
//     syntax, which only mdbrain's own parser understood — export now emits
//     spec-form links, with [[wikilink]] parsing kept on import only for
//     backward compatibility with bundles exported before that fix.
//   - Provenance/trust vocabulary (§5, §7 — v0.2's core addition over v0.1):
//     `status` (draft|stable|deprecated, default stable), `generated` (single
//     {by, at} — by is an Actor Convention string, at is ISO 8601),
//     `verified` (one or a list of {by, at} — normalized to a list
//     internally per spec §5.2, "consumers MUST treat a bare mapping as a
//     one-element list"), `stale_after` (YYYY-MM-DD), `sources` (array of
//     {resource, id?, title?, author?, usage_count?, last_modified?,
//     usage_window?}). Actor Convention: `<producer>/<version>` for
//     agents/tools, `human:<id>` for a person, `process:<id>` for an
//     automated process. These fields round-trip losslessly but are NOT
//     currently mapped into mdbrain's own trustTier — the spec notes trust
//     classification keys off the `human:` prefix (§5.3), which is a
//     judgment call left for a future pass rather than an automatic mapping
//     here.
//   - Extensions: producers MAY add extra frontmatter keys; consumers preserve them
//
// MBrain internal wiki_pages schema is a strict SUPERSET of OKF. OKF is the
// portable projection: export → import round-trips structure, but unexpressible
// fields (embedding, backlinks, trustTier, permissions) stay in MongoDB.

import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"
import { createSubsystemLogger } from "@mdbrain/lib"
import type { ClientSession, Document } from "mongodb"
import {
	createWikiPage,
	getWikiPage,
	updateWikiPage,
	listWikiPages,
	type WikiDbHandle,
	type WikiPageInput,
	type WikiPageView,
	type WikiClaimInput,
	type WikiRelationshipInput,
	type WikiQuestionInput,
} from "./wiki-bridge.js"
import {
	filterPagesByGovernance,
	type GovernanceContext,
} from "./wiki-governance.js"
import { WIKI_PRIVACY_TIER_VALUES as PRIVACY_TIER_VALUES } from "./wiki-schema.js"
import {
	type ContainedFile,
	writeContainedFiles,
} from "./filesystem-containment.js"

const log = createSubsystemLogger("wiki:okf")

// ---------------------------------------------------------------------------
// Path safety — prevent directory traversal in OKF import/export
// ---------------------------------------------------------------------------

/** Validates that a directory path is within an allowed root. Mirrors the
 *  isPathWithinRoot pattern from memory-engine's benchmark dataset resolver. */
function isPathWithinRoot(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate)
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	)
}

/** Resolves symlinks for a path that may not exist yet (export outDir):
 *  realpath the nearest existing ancestor, then re-join the not-yet-created
 *  remainder. Mirrors nearestExistingPath in filesystem-containment.ts. */
function realpathOfNearestExisting(candidate: string): string {
	let current = candidate
	const pending: string[] = []
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current)
		if (parent === current) break
		pending.unshift(path.basename(current))
		current = parent
	}
	const real = fs.realpathSync(current)
	return pending.length > 0 ? path.join(real, ...pending) : real
}

/** Parses MDBRAIN_OKF_ALLOWED_ROOTS into allowed root entries. Rejects empty
 *  entries: a stray or trailing comma ("a,,b", "a,") must not silently yield
 *  an empty-string root, because path.resolve("") is process.cwd() — the
 *  server's working directory would become an allowed import (read) or
 *  export (write) root without anyone configuring it. */
export function parseOkfAllowedRoots(
	raw = process.env.MDBRAIN_OKF_ALLOWED_ROOTS,
): string[] {
	if (!raw) return []
	const entries = raw.split(",").map((entry) => entry.trim())
	if (entries.some((entry) => !entry)) {
		throw new Error(
			"MDBRAIN_OKF_ALLOWED_ROOTS must not contain empty entries " +
				"(check for stray or trailing commas)",
		)
	}
	return entries
}

/** Resolves and validates a directory path against allowed roots. Throws if
 *  the path escapes all allowed roots or contains parent-directory traversal.
 *
 *  Fails closed by default: with no MDBRAIN_OKF_ALLOWED_ROOTS configured, any
 *  absolute path (including outside the deployment) would otherwise be a
 *  valid import/export target — an arbitrary filesystem read (import) or
 *  write (export) reachable by any authenticated API caller. Local-first dev
 *  can opt back into the old unrestricted behavior explicitly via
 *  MDBRAIN_OKF_ALLOW_UNRESTRICTED=true; production deployments must set
 *  MDBRAIN_OKF_ALLOWED_ROOTS.
 *
 *  Containment is checked on realpath-resolved paths on BOTH sides: the
 *  candidate and the configured roots. path.resolve() is purely lexical, so
 *  a symlink inside an allowed root pointing outside it (or a symlinked
 *  root) would pass the lexical check and hand an arbitrary directory to
 *  import (read) or export (write). Same realpath-based containment as
 *  filesystem-containment.ts. */
function validateOkfPath(dir: string, allowedRoots: string[]): string {
	if (!dir.trim()) {
		throw new Error("directory path is required")
	}
	// Reject obvious traversal attempts early
	if (dir.split(/[\\/]+/).includes("..")) {
		throw new Error(
			"directory path must not contain parent-directory traversal (..)",
		)
	}
	const resolved = path.resolve(dir)
	if (allowedRoots.length === 0) {
		if (process.env.MDBRAIN_OKF_ALLOW_UNRESTRICTED === "true") {
			return realpathOfNearestExisting(resolved)
		}
		throw new Error(
			"OKF import/export requires MDBRAIN_OKF_ALLOWED_ROOTS to be configured " +
				"(comma-separated allowed directory roots), or explicit opt-in via " +
				"MDBRAIN_OKF_ALLOW_UNRESTRICTED=true for local-first dev. Refusing " +
				"to resolve an unrestricted filesystem path.",
		)
	}
	const realDir = realpathOfNearestExisting(resolved)
	const allowed = allowedRoots.some((root) =>
		isPathWithinRoot(realDir, realpathOfNearestExisting(path.resolve(root))),
	)
	if (!allowed) {
		throw new Error(
			"directory path must resolve inside the workspace or a configured OKF root",
		)
	}
	return realDir
}

// ---------------------------------------------------------------------------
// Frontmatter shape
// ---------------------------------------------------------------------------

interface OkfActorEvent {
	by: string // Actor Convention: <producer>/<version> | human:<id> | process:<id>
	at?: string // ISO 8601 — only `by` is spec-required within this object
}

interface OkfSource {
	resource: string // required — absolute URL, bundle-relative path, or scope descriptor
	id?: string
	title?: string
	author?: string // Actor Convention string
	usage_count?: number
	last_modified?: string // YYYY-MM-DD
	usage_window?: { from: string; to: string }
}

interface OkfFrontmatter {
	type: string // required
	title?: string
	description?: string
	resource?: string
	tags?: string[]
	timestamp?: string // ISO 8601
	// v0.2 provenance/trust vocabulary (§5, §7)
	status?: "draft" | "stable" | "deprecated"
	generated?: OkfActorEvent
	verified?: OkfActorEvent | OkfActorEvent[]
	stale_after?: string // YYYY-MM-DD
	sources?: OkfSource[]
	// Extensions (preserved on round-trip)
	[key: string]: unknown
}

interface OkfConcept {
	conceptId: string // file path without .md
	filePath: string // relative path within bundle
	frontmatter: OkfFrontmatter
	body: string // markdown body (after frontmatter)
}

const OKF_STATUS_VALUES = ["draft", "stable", "deprecated"] as const

/** Validates + normalizes an OKF actor-event object ({by, at}). `at` is
 *  spec'd as an ISO 8601 string, but js-yaml's default schema auto-parses
 *  unquoted ISO-looking values into JS Date objects (YAML 1.1 timestamp
 *  type) — coerced back to a string here so it matches the `bsonType:
 *  "string"` the field is validated against, and so export re-emits a plain
 *  ISO string rather than a YAML-dumped Date representation. */
function coerceOkfActorEvent(value: unknown): OkfActorEvent | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const by = (value as Record<string, unknown>).by
	if (typeof by !== "string") return undefined
	const rawAt = (value as Record<string, unknown>).at
	const at =
		rawAt instanceof Date
			? rawAt.toISOString()
			: typeof rawAt === "string"
				? rawAt
				: undefined
	return at !== undefined ? { by, at } : { by }
}

/** Coerces an OKF date-only field (e.g. `stale_after`, spec format YYYY-MM-DD)
 *  back to a plain string. js-yaml's default schema also auto-parses bare
 *  YYYY-MM-DD scalars as Date objects (YAML 1.1 date type), same issue as
 *  the actor-event `at` field. */
function coerceOkfDateOnly(value: unknown): string | undefined {
	if (value instanceof Date) return value.toISOString().slice(0, 10)
	if (typeof value === "string") return value
	return undefined
}

/** Validates + normalizes an OKF `sources[]` entry, coercing its date-like
 *  fields (last_modified, usage_window.from/to) the same way as
 *  coerceOkfDateOnly/coerceOkfActorEvent. Returns undefined for an entry
 *  missing the spec-required `resource` field. */
function coerceOkfSource(value: unknown): OkfSource | undefined {
	if (typeof value !== "object" || value === null) return undefined
	const v = value as Record<string, unknown>
	if (typeof v.resource !== "string") return undefined
	const source: OkfSource = { resource: v.resource }
	if (typeof v.id === "string") source.id = v.id
	if (typeof v.title === "string") source.title = v.title
	if (typeof v.author === "string") source.author = v.author
	if (typeof v.usage_count === "number") source.usage_count = v.usage_count
	const lastModified = coerceOkfDateOnly(v.last_modified)
	if (lastModified) source.last_modified = lastModified
	if (typeof v.usage_window === "object" && v.usage_window !== null) {
		const w = v.usage_window as Record<string, unknown>
		const from = coerceOkfDateOnly(w.from)
		const to = coerceOkfDateOnly(w.to)
		if (from && to) source.usage_window = { from, to }
	}
	return source
}

function isOkfStatus(
	value: unknown,
): value is (typeof OKF_STATUS_VALUES)[number] {
	return (
		typeof value === "string" &&
		(OKF_STATUS_VALUES as readonly string[]).includes(value)
	)
}

/** Normalizes OKF `verified` frontmatter to a list per spec §5.2: consumers
 *  MUST treat a bare {by, at} mapping as a one-element list, since content
 *  may accumulate multiple independent verification events over time. */
function normalizeOkfVerified(value: unknown): OkfActorEvent[] | undefined {
	if (Array.isArray(value)) {
		const items = value
			.map(coerceOkfActorEvent)
			.filter((v): v is OkfActorEvent => v !== undefined)
		return items.length > 0 ? items : undefined
	}
	const single = coerceOkfActorEvent(value)
	return single ? [single] : undefined
}

// ---------------------------------------------------------------------------
// Bundle reading (filesystem → OkfConcept[])
// ---------------------------------------------------------------------------

const FRONTMATTER_DELIMITER = "---"

/** Iterates regex matches without assignment-in-condition (biome lint). */
function* iterateMatches(
	re: RegExp,
	input: string,
): Generator<RegExpExecArray> {
	for (;;) {
		const m = re.exec(input)
		if (!m) break
		yield m
	}
}

// Cap file size to prevent DoS via oversized concept files.
const MAX_CONCEPT_BYTES = 1024 * 1024 // 1 MiB

// Bundle-level DoS caps, enforced DURING the walk (readBundleConcepts), not
// per-file: a bundle of millions of individually-small files, or a bundle
// whose files cumulatively add up to an enormous size, would otherwise block
// the whole import (and the synchronous-FS-turned-async event loop) for an
// unbounded amount of time. Exceeding either aborts the WHOLE import with a
// single clear error — a partial/truncated import would be a worse failure
// mode than refusing outright.
const MAX_BUNDLE_FILES = 10_000
const MAX_BUNDLE_TOTAL_BYTES = 200 * 1024 * 1024 // 200 MiB

/** Parses a single .md file into frontmatter + body. Returns a diagnostic
 *  reason on skip instead of a bare null, so a caller can record WHY a
 *  concept was dropped rather than have it silently vanish from the import
 *  result. `stat` is passed in by the caller (readBundleConcepts), which
 *  already needs it for the bundle-level cumulative-byte cap, to avoid
 *  stat'ing each file twice. */
async function parseConceptFile(
	filePath: string,
	relativePath: string,
	stat: { size: number },
): Promise<{ concept: OkfConcept | null; skipReason: string | null }> {
	if (stat.size > MAX_CONCEPT_BYTES) {
		return {
			concept: null,
			skipReason: `file exceeds ${MAX_CONCEPT_BYTES} byte limit (${stat.size} bytes)`,
		}
	}
	const raw = await fsp.readFile(filePath, "utf-8")
	const { frontmatter, body, error } = splitFrontmatter(raw)
	if (error) {
		return { concept: null, skipReason: error }
	}
	if (!frontmatter || !frontmatter.type) {
		return {
			concept: null,
			skipReason: "missing required frontmatter field `type`",
		}
	}
	const conceptId = relativePath.replace(/\.md$/, "").replace(/\\/g, "/")
	return {
		concept: { conceptId, filePath: relativePath, frontmatter, body },
		skipReason: null,
	}
}

/** Splits a markdown file into YAML frontmatter + body. `error` is set when a
 *  frontmatter block was present but unparseable (malformed YAML, oversized),
 *  as distinct from a document that legitimately has no frontmatter at all. */
function splitFrontmatter(raw: string): {
	frontmatter: OkfFrontmatter | null
	body: string
	error: string | null
} {
	const lines = raw.split("\n")
	if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
		return { frontmatter: null, body: raw, error: null }
	}
	const end = lines.findIndex(
		(l, i) => i > 0 && l.trim() === FRONTMATTER_DELIMITER,
	)
	if (end === -1) {
		return {
			frontmatter: null,
			body: raw,
			error: "unterminated frontmatter block (no closing ---)",
		}
	}
	const yamlBlock = lines.slice(1, end).join("\n")
	const body = lines
		.slice(end + 1)
		.join("\n")
		.replace(/^\n/, "")
	// Cap YAML block size to prevent DoS via oversized frontmatter.
	const MAX_YAML_BYTES = 256 * 1024 // 256 KiB
	if (Buffer.byteLength(yamlBlock, "utf8") > MAX_YAML_BYTES) {
		return {
			frontmatter: null,
			body,
			error: `frontmatter exceeds ${MAX_YAML_BYTES} byte limit`,
		}
	}
	// Use js-yaml's DEFAULT_SCHEMA (safe schema) to prevent unsafe tag
	// execution (e.g. !!js/function). The 256 KiB size cap above prevents
	// resource exhaustion. Note: js-yaml v4 uses references for aliases (not
	// deep copies), so the "billion laughs" exponential-expansion attack is
	// not viable — memory growth is linear, not exponential.
	try {
		const parsed = yaml.load(yamlBlock, {
			schema: yaml.DEFAULT_SCHEMA,
		}) as OkfFrontmatter | null
		return { frontmatter: parsed ?? null, body, error: null }
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		return {
			frontmatter: null,
			body,
			error: `invalid YAML frontmatter: ${msg}`,
		}
	}
}

/** Walks a bundle directory and returns all concept .md files (excluding
 *  index.md and log.md, which are handled separately), plus a diagnostic
 *  entry for every file that was skipped and why.
 *
 *  Uses the async fs/promises API rather than fs.*Sync so the walk yields
 *  control back to the Node event loop between files instead of blocking it
 *  (and every other concurrent request) for the whole import. Enforces
 *  bundle-level file-count and cumulative-byte caps during the walk — see
 *  MAX_BUNDLE_FILES/MAX_BUNDLE_TOTAL_BYTES above.
 *
 *  `limits` is an internal override for testability (exercising the caps
 *  without actually writing 10k+ files or 200 MiB to disk in a test) — not
 *  exposed via importOkfBundle's public options. */
export async function readBundleConcepts(
	bundleDir: string,
	limits: { maxFiles?: number; maxTotalBytes?: number } = {},
): Promise<{
	concepts: OkfConcept[]
	skipped: Array<{ path: string; reason: string }>
}> {
	const maxFiles = limits.maxFiles ?? MAX_BUNDLE_FILES
	const maxTotalBytes = limits.maxTotalBytes ?? MAX_BUNDLE_TOTAL_BYTES
	const concepts: OkfConcept[] = []
	const skipped: Array<{ path: string; reason: string }> = []
	let fileCount = 0
	let totalBytes = 0
	async function walk(dir: string): Promise<void> {
		const entries = await fsp.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				await walk(full)
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				if (entry.name === "index.md" || entry.name === "log.md") continue
				fileCount++
				if (fileCount > maxFiles) {
					throw new Error(
						`bundle exceeds maximum file count (${maxFiles}) — refusing to import`,
					)
				}
				const relative = path.relative(bundleDir, full)
				const stat = await fsp.stat(full)
				totalBytes += stat.size
				if (totalBytes > maxTotalBytes) {
					throw new Error(
						`bundle exceeds maximum total size (${maxTotalBytes} bytes) — refusing to import`,
					)
				}
				const { concept, skipReason } = await parseConceptFile(
					full,
					relative,
					stat,
				)
				if (concept) {
					concepts.push(concept)
				} else if (skipReason) {
					skipped.push({ path: relative, reason: skipReason })
				}
			}
		}
	}
	await walk(bundleDir)
	return { concepts, skipped }
}

// ---------------------------------------------------------------------------
// Import (bundle → wiki_pages)
// ---------------------------------------------------------------------------

export interface OkfImportResult {
	imported: number
	skipped: number
	conceptIds: string[]
	errors: Array<{ conceptId: string; error: string }>
}

/** Imports an OKF bundle directory into wiki_pages. Each concept .md becomes a
 *  wiki page. index.md relationships are parsed into relationships[]. */
export async function importOkfBundle(
	handle: WikiDbHandle,
	bundleDir: string,
	opts: {
		scope: WikiPageInput["scope"]
		scopeRef: string
		trustTier: WikiPageInput["trustTier"]
		okfBundleId: string
		embed?: (text: string) => Promise<number[]>
		session?: ClientSession
	},
): Promise<OkfImportResult> {
	const allowedRoots = parseOkfAllowedRoots()
	const safeBundleDir = validateOkfPath(bundleDir, allowedRoots)
	const { concepts, skipped } = await readBundleConcepts(safeBundleDir)
	const indexRelationships = parseIndexRelationships(safeBundleDir)
	const result: OkfImportResult = {
		imported: 0,
		skipped: skipped.length,
		conceptIds: [],
		errors: skipped.map((s) => ({ conceptId: s.path, error: s.reason })),
	}

	// A crash mid-bundle (process crash, dropped DB connection, unhandled
	// error partway through a large bundle) must not leave the wiki in a
	// half-imported state. `runImportLoop` always receives the caller's
	// transaction or one created here for direct library callers.
	const runImportLoop = async (session: ClientSession | undefined) => {
		for (const concept of concepts) {
			let mutationStarted = false
			try {
				const input = conceptToWikiInput(concept, opts, indexRelationships)
				// Upsert by slug+scope: if the page exists, update; else create.
				const existing = await getWikiPage(
					handle,
					input.slug,
					input.scope,
					input.scopeRef,
					undefined,
					session,
				)
				if (existing) {
					// Only allow overwrite of pages that were themselves produced by a
					// prior OKF import. A page authored manually through the wiki UI (no
					// okfConceptId) never had its content sourced from a bundle, so a
					// slug collision there is far more likely a naming accident than an
					// intentional re-import — refuse rather than silently clobbering it.
					if (!existing.okfConceptId) {
						throw new Error(
							`slug "${input.slug}" already exists as a manually-authored page ` +
								"(not previously OKF-imported) — refusing to overwrite",
						)
					}
					mutationStarted = true
					await updateWikiPage(
						handle,
						input.slug,
						input.scope,
						input.scopeRef,
						{
							title: input.title,
							aliases: input.aliases,
							summary: input.summary,
							body: input.body,
							frontmatter: input.frontmatter,
							okfConceptId: input.okfConceptId,
							okfBundleId: input.okfBundleId,
							relationships: input.relationships,
							// Keep the governance SSOT in step with the imported
							// frontmatter tier on re-import; without this, a
							// restricted bundle re-imported over an old open-access
							// page would stay open access.
							...(input.permissions ? { permissions: input.permissions } : {}),
						},
						{ session },
					)
				} else {
					mutationStarted = true
					await createWikiPage(handle, input, { embed: opts.embed, session })
				}
				result.imported++
				result.conceptIds.push(concept.conceptId)
			} catch (err) {
				// Parse and concept-validation failures before mutation remain
				// reportable per concept. Once a transactional page mutation begins,
				// every failure is strict: swallowing a revision or other post-write
				// failure would commit a page without its required evidence.
				if (session && (mutationStarted || isTransactionNotSupported(err))) {
					throw err
				}
				const msg = err instanceof Error ? err.message : String(err)
				result.errors.push({ conceptId: concept.conceptId, error: msg })
				result.skipped++
			}
		}
	}

	if (opts.session) {
		await runImportLoop(opts.session)
	} else if (handle.client) {
		const session = handle.client.startSession()
		try {
			await session.withTransaction(async () => {
				await runImportLoop(session)
			})
		} finally {
			await session.endSession()
		}
	} else {
		await runImportLoop(undefined)
	}
	return result
}

/** Detects the MongoDB driver's "transactions not supported" error, thrown
 *  when session.withTransaction() is used against a standalone server (no
 *  replica set). Mirrors the same detection in memory-engine's
 *  mongodb-kb.ts/mongodb-sync.ts — 20 = IllegalOperation (standalone), 263 =
 *  NoSuchTransaction; the message check covers driver versions/paths that
 *  don't set `code`. */
export function isTransactionNotSupported(err: unknown): boolean {
	if (err instanceof Error && "code" in err) {
		const code = (err as { code: number }).code
		if (code === 20 || code === 263) return true
	}
	const msg = err instanceof Error ? err.message : String(err)
	return msg.includes("Transaction numbers are only allowed on a replica set")
}

/** Parses index.md for relationships. OKF index.md is a directory listing
 *  with markdown links to concepts, typically grouped under headings. We
 *  treat concepts listed under the same heading as siblings (relates_to) —
 *  this derives relationships from the common single-link-per-line pattern
 *  (the prior ≥2-links-per-line rule never fired for normal bundles). */
function parseIndexRelationships(
	bundleDir: string,
): Map<string, WikiRelationshipInput[]> {
	const rels = new Map<string, WikiRelationshipInput[]>()
	const indexPath = path.join(bundleDir, "index.md")
	if (!fs.existsSync(indexPath)) return rels
	const raw = fs.readFileSync(indexPath, "utf-8")
	const { body } = splitFrontmatter(raw)
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
	const wikiLinkRegex = /\[\[([^\]]+)\]\]/g
	// Group concept links by the nearest preceding heading.
	const groups: Array<{
		heading: string
		links: Array<{ text: string; target: string }>
	}> = []
	let current: Array<{ text: string; target: string }> = []
	let currentHeading = "root"
	for (const line of body.split("\n")) {
		if (/^#\s+/.test(line)) {
			if (current.length)
				groups.push({ heading: currentHeading, links: current })
			currentHeading = line.replace(/^#\s+/, "").trim()
			current = []
			continue
		}
		linkRegex.lastIndex = 0
		for (const m of iterateMatches(linkRegex, line)) {
			current.push({ text: m[1], target: normalizeLinkTarget(m[2]) })
		}
		wikiLinkRegex.lastIndex = 0
		for (const m of iterateMatches(wikiLinkRegex, line)) {
			current.push({ text: m[1], target: m[1] })
		}
	}
	if (current.length) groups.push({ heading: currentHeading, links: current })
	// Siblings under the same heading relate to each other.
	for (const group of groups) {
		for (let i = 0; i < group.links.length; i++) {
			const src = group.links[i]
			for (let j = 0; j < group.links.length; j++) {
				if (i === j) continue
				const tgt = group.links[j]
				const existing = rels.get(src.target) ?? []
				existing.push({
					targetPageSlug: tgt.target,
					targetTitle: tgt.text,
					kind: "relates_to",
					weight: 0.4,
					confidence: 0.6,
				})
				rels.set(src.target, existing)
			}
		}
	}
	return rels
}

function conceptToWikiInput(
	concept: OkfConcept,
	opts: {
		scope: WikiPageInput["scope"]
		scopeRef: string
		trustTier: WikiPageInput["trustTier"]
		okfBundleId: string
	},
	indexRelationships: Map<string, WikiRelationshipInput[]>,
): WikiPageInput {
	const fm = concept.frontmatter
	// Extract relationships from markdown links in the body — BEFORE stripping
	// reference-link definition lines, since those lines are exactly what
	// resolves [text][ref] targets.
	const bodyRelationships = extractRelationshipsFromLinks(concept.body)
	// Extract claims/questions from conventional body sections. Reference-link
	// definitions are metadata, not content, so they must not survive into the
	// stored body (mirrors ## Relationships etc. being stripped below).
	const {
		body: cleanBody,
		claims,
		questions,
	} = extractBodySections(stripLinkDefinitionLines(concept.body))
	const indexRels = indexRelationships.get(concept.conceptId) ?? []
	const known = new Set([
		"type",
		"title",
		"description",
		"resource",
		"tags",
		"timestamp",
		"entityTypes",
		"privacyTier",
		"status",
		"generated",
		"verified",
		"stale_after",
		"sources",
	])
	// Preserve OKF extensions: unknown frontmatter keys are passed through.
	// Reject keys that would be unpredictable or unsafe as a MongoDB field
	// name: a leading "$" is interpreted as a query/update operator in some
	// contexts, and "." is nested-path notation — neither is a valid literal
	// field name, and a bundle (a potentially untrusted import source) with a
	// key like `$where` or `a.b` must not inject one straight into the stored
	// document. Fail the whole concept loudly rather than silently drop the
	// key: malformed input should be visible in the import result.
	const extensions: Record<string, unknown> = {}
	const rejectedExtensionKeys: string[] = []
	for (const [k, v] of Object.entries(fm)) {
		if (known.has(k) || v === undefined || v === null) continue
		if (k.startsWith("$") || k.includes(".")) {
			rejectedExtensionKeys.push(k)
			continue
		}
		extensions[k] = v
	}
	if (rejectedExtensionKeys.length > 0) {
		throw new Error(
			`frontmatter contains invalid MongoDB field name(s): ${rejectedExtensionKeys.join(", ")} ` +
				`(keys may not start with "$" or contain ".")`,
		)
	}
	// permissions is the governance SSOT: privacy tiers gate reads via
	// filterPagesByGovernance / buildPermissionsFilter, which look ONLY at
	// page.permissions — a frontmatter-only privacyTier would silently import
	// as open access. Import maps frontmatter.privacyTier into permissions so
	// an imported "restricted" bundle is actually restricted. Unknown tier
	// values fail the concept loudly rather than degrading to open access.
	const fmPrivacyTier =
		typeof fm.privacyTier === "string" ? fm.privacyTier.trim() : undefined
	if (fmPrivacyTier) {
		if (
			!PRIVACY_TIER_VALUES.includes(
				fmPrivacyTier as (typeof PRIVACY_TIER_VALUES)[number],
			)
		) {
			throw new Error(
				`frontmatter.privacyTier "${fmPrivacyTier}" must be one of ` +
					`${PRIVACY_TIER_VALUES.join("|")}`,
			)
		}
	}
	return {
		kind: okfTypeToKind(fm.type),
		title: fm.title ?? concept.conceptId.split("/").pop() ?? concept.conceptId,
		slug: concept.conceptId,
		aliases: [],
		summary: fm.description ?? cleanBody.split("\n")[0]?.slice(0, 200) ?? "",
		body: cleanBody,
		frontmatter: {
			type: fm.type,
			title: fm.title,
			description: fm.description,
			resource: fm.resource,
			// A malformed bundle can send a bare string instead of a YAML list —
			// validate array-ness the same way entityTypes is validated below, so
			// it degrades to "no tags" instead of corrupting the stored shape or
			// failing confusingly against wiki-schema.ts's tags validator.
			tags: Array.isArray(fm.tags)
				? fm.tags.filter((t): t is string => typeof t === "string")
				: undefined,
			timestamp: fm.timestamp ? new Date(fm.timestamp) : undefined,
			entityTypes: Array.isArray(fm.entityTypes)
				? (fm.entityTypes as string[])
				: undefined,
			privacyTier: fmPrivacyTier
				? (fmPrivacyTier as WikiPageInput["frontmatter"]["privacyTier"])
				: undefined,
			status: isOkfStatus(fm.status) ? fm.status : undefined,
			generated: coerceOkfActorEvent(fm.generated),
			// Spec §5.2: consumers MUST treat a bare mapping as a one-element list.
			verified: normalizeOkfVerified(fm.verified),
			stale_after: coerceOkfDateOnly(fm.stale_after),
			sources: Array.isArray(fm.sources)
				? (() => {
						const coerced = fm.sources
							.map(coerceOkfSource)
							.filter((s): s is OkfSource => s !== undefined)
						return coerced.length > 0 ? coerced : undefined
					})()
				: undefined,
			...extensions,
		},
		claims,
		questions,
		relationships: [...bodyRelationships, ...indexRels],
		personCard: null,
		okfConceptId: concept.conceptId,
		okfBundleId: opts.okfBundleId,
		scope: opts.scope,
		scopeRef: opts.scopeRef,
		trustTier: opts.trustTier,
		// Map the OKF interchange privacy tier into the governance SSOT. Never
		// set optional fields to undefined (MongoDB $jsonSchema rejects
		// undefined-valued fields) — conditional spread only.
		...(fmPrivacyTier
			? {
					permissions: {
						privacyTier: fmPrivacyTier as NonNullable<
							WikiPageInput["permissions"]
						>["privacyTier"],
					},
				}
			: {}),
	}
}

/** Maps an OKF `type` to a wiki page kind. OKF types are free-form; we use a
 *  heuristic fallback to "concept". */
function okfTypeToKind(type: string): WikiPageInput["kind"] {
	const t = type.toLowerCase()
	if (t.includes("table") || t.includes("api") || t.includes("asset"))
		return "source"
	if (
		t.includes("playbook") ||
		t.includes("procedure") ||
		t.includes("runbook")
	)
		return "procedure"
	if (t.includes("person") || t.includes("entity")) return "entity"
	if (t.includes("report")) return "report"
	if (t.includes("synthesis") || t.includes("summary")) return "synthesis"
	return "concept"
}

/** Extracts claims/questions from conventional body sections
 *  (## Claims / ## Open Questions / ## Relationships / ## Person Card).
 *  These sections are STRIPPED from the body on import so export can re-emit
 *  them from the structured fields without duplication (round-trip safety). */
function extractBodySections(body: string): {
	body: string
	claims: WikiClaimInput[]
	questions: WikiQuestionInput[]
} {
	const claims: WikiClaimInput[] = []
	const questions: WikiQuestionInput[] = []
	const lines = body.split("\n")
	const out: string[] = []
	let section: "claims" | "questions" | "relationships" | "person" | null = null
	for (const line of lines) {
		if (/^##\s+Claims\b/i.test(line)) {
			section = "claims"
			continue
		}
		if (/^##\s+Open Questions\b/i.test(line)) {
			section = "questions"
			continue
		}
		if (/^##\s+Relationships\b/i.test(line)) {
			section = "relationships"
			continue
		}
		if (/^##\s+Person Card\b/i.test(line)) {
			section = "person"
			continue
		}
		if (/^##\s+/.test(line) && section) {
			// A new non-extracted section ends the current extracted section.
			section = null
		}
		if (section === "claims" && /^[-*]\s+/.test(line)) {
			// Strip the status emphasis marker if present so it isn't doubled on
			// export (round-trip safety). Status is captured separately below.
			const text = line
				.replace(/^[-*]\s+/, "")
				.replace(/\s*_\[([^\]]+)\]_\s*$/, "") // strip trailing _[status]_
				.trim()
			claims.push({ id: `claim-${claims.length}`, text })
		} else if (section === "questions" && /^[-*]\s+/.test(line)) {
			const text = line
				.replace(/^[-*]\s+/, "")
				.replace(/^[?✓]\s*/, "")
				.trim()
			questions.push({ id: `q-${questions.length}`, text })
		} else if (!section) {
			out.push(line)
		}
		// Lines in an extracted section that aren't list items are dropped
		// (they're prose under ## Claims etc., not body content).
	}
	return {
		body: out.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""),
		claims,
		questions,
	}
}

/** Removes fenced (```) code blocks so markdown links inside example code are
 *  never mistaken for real relationships. Replaces each fence's content with
 *  blank lines (preserving line count) rather than deleting it outright, so
 *  callers that report line numbers on the original text stay aligned. */
function stripCodeFences(text: string): string {
	const lines = text.split("\n")
	let inFence = false
	return lines
		.map((line) => {
			if (/^\s*```/.test(line)) {
				inFence = !inFence
				return ""
			}
			return inFence ? "" : line
		})
		.join("\n")
}

/** Normalizes a markdown link target to a bare OKF concept ID: strips a
 *  trailing .md and a leading "/" (the OKF spec's recommended bundle-root-
 *  relative absolute link form, e.g. `/tables/users.md` → `tables/users`). */
function normalizeLinkTarget(target: string): string {
	return target.replace(/\.md$/, "").replace(/^\//, "")
}

/** Matches a CommonMark reference-link definition line: `[ref]: target
 *  "optional title"`. The quoted title (if present) is part of the syntax,
 *  not the target, and must be stripped rather than folded into it. */
const REFERENCE_DEFINITION_RE = /^\[([^\]]+)\]:\s*(\S+)(?:\s+"[^"]*")?\s*$/

/** Builds a label → normalized-target map from `[ref]: target` definitions,
 *  which per CommonMark can appear anywhere in the body (not confined to a
 *  specific section), matched case-insensitively. */
function extractLinkDefinitions(body: string): Map<string, string> {
	const defs = new Map<string, string>()
	for (const line of body.split("\n")) {
		const m = REFERENCE_DEFINITION_RE.exec(line.trim())
		if (m) defs.set(m[1].toLowerCase(), normalizeLinkTarget(m[2]))
	}
	return defs
}

/** Strips reference-link definition lines from a body. These are link
 *  metadata (resolved into relationships by extractRelationshipsFromLinks),
 *  not content — same reasoning as extractBodySections stripping
 *  ## Relationships etc. — so they must not leak into the stored page body. */
function stripLinkDefinitionLines(body: string): string {
	return body
		.split("\n")
		.filter((line) => !REFERENCE_DEFINITION_RE.test(line.trim()))
		.join("\n")
}

/** Extracts relationships from markdown links in the body. Recognizes inline
 *  links, [[wikilinks]], and CommonMark reference-style links (`[text][ref]`
 *  and the shorthand `[ref][]`) resolved against `[ref]: target` definitions
 *  found anywhere in the body. */
function extractRelationshipsFromLinks(body: string): WikiRelationshipInput[] {
	const rels: WikiRelationshipInput[] = []
	const seen = new Set<string>()
	const scanned = stripCodeFences(body)
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
	for (const m of iterateMatches(linkRegex, scanned)) {
		if (m[2].startsWith("http") || m[2].startsWith("#")) continue
		const target = normalizeLinkTarget(m[2])
		if (seen.has(target)) continue
		seen.add(target)
		rels.push({
			targetPageSlug: target,
			targetTitle: m[1],
			kind: "relates_to",
			weight: 0.5,
			confidence: 0.6,
		})
	}
	// [[wikilink]] parsing kept for backward compatibility with bundles
	// mdbrain exported before it switched to spec-form links — no longer
	// produced on export (see wikiPageToOkfMarkdown).
	const wikiLinkRegex = /\[\[([^\]]+)\]\]/g
	for (const m of iterateMatches(wikiLinkRegex, scanned)) {
		const target = m[1]
		if (seen.has(target)) continue
		seen.add(target)
		rels.push({
			targetPageSlug: target,
			targetTitle: target,
			kind: "relates_to",
			weight: 0.5,
			confidence: 0.6,
		})
	}
	// Reference-style links: [text][ref] and the shorthand [ref][] (label ==
	// link text). Unlike inline links/wikilinks, these need a second pass to
	// resolve against definitions collected from the whole (fence-stripped)
	// body — a definition may appear anywhere, not just near its usage.
	const definitions = extractLinkDefinitions(scanned)
	const refLinkRegex = /\[([^\]]+)\]\[([^\]]*)\]/g
	for (const m of iterateMatches(refLinkRegex, scanned)) {
		const label = (m[2] || m[1]).toLowerCase()
		const target = definitions.get(label)
		if (!target) continue // no matching definition — nothing to resolve
		if (seen.has(target)) continue
		seen.add(target)
		rels.push({
			targetPageSlug: target,
			targetTitle: m[1],
			kind: "relates_to",
			weight: 0.5,
			confidence: 0.6,
		})
	}
	return rels
}

// ---------------------------------------------------------------------------
// Export (wiki_pages → bundle on disk)
// ---------------------------------------------------------------------------

export interface OkfExportResult {
	dir: string
	exported: number
	files: string[]
	// Populated only when opts.returnContent is true. Lets a remote HTTP/MCP
	// caller (not on the same filesystem as the API server) actually read
	// the exported bundle without shell access to the server.
	fileContents?: Record<string, string>
}

/** Exports wiki_pages (matching the filter) to an OKF bundle directory on disk.
 *  Strict-subset projection: embedding/backlinks/trustTier/permissions stay in
 *  MongoDB; only OKF-expressible fields are written. */
export async function exportOkfBundle(
	handle: WikiDbHandle,
	opts: {
		scope: string
		scopeRef: string
		okfBundleId?: string
		outDir: string
		/** Requester's governance context. Required — export must never surface
		 *  a page the requester couldn't otherwise read via a governed GET, so
		 *  exported pages are filtered exactly as a governed read would be
		 *  (scope + role/department/privacyTier permissions). There is no
		 *  supported "export everything, ungoverned" mode. */
		governance: GovernanceContext
		/** When true, also returns each exported file's content inline (in
		 *  addition to still writing to disk) so a caller without filesystem
		 *  access to the API server can read the bundle. Default false. */
		returnContent?: boolean
	},
): Promise<OkfExportResult> {
	const { pages: allPages } = await listAllWikiPages(
		handle,
		opts.scope,
		opts.scopeRef,
		opts.okfBundleId,
	)
	const pages = filterPagesByGovernance(
		allPages as unknown as Document[],
		opts.governance,
	) as unknown as WikiPageView[]
	const allowedRoots = parseOkfAllowedRoots()
	const safeOutDir = validateOkfPath(opts.outDir, allowedRoots)
	const files: string[] = []
	const fileContents: Record<string, string> | undefined = opts.returnContent
		? {}
		: undefined
	const outputFiles: ContainedFile[] = []
	for (const page of pages) {
		const content = wikiPageToOkfMarkdown(page)
		const relativeFile = `${page.slug}.md`
		outputFiles.push({ path: relativeFile, content })
		files.push(relativeFile)
		if (fileContents) fileContents[relativeFile] = content
	}
	// Write index.md with links to all concepts.
	const indexContent = buildIndexMarkdown(pages)
	outputFiles.push({ path: "index.md", content: indexContent })
	files.push("index.md")
	if (fileContents) fileContents["index.md"] = indexContent
	writeContainedFiles(
		safeOutDir,
		outputFiles,
		allowedRoots.length > 0 ? allowedRoots : undefined,
	)
	return {
		dir: safeOutDir,
		exported: pages.length,
		files,
		...(fileContents ? { fileContents } : {}),
	}
}

/** Lists all wiki pages for a scope (paginated internally to avoid limits). */
async function listAllWikiPages(
	handle: WikiDbHandle,
	scope: string,
	scopeRef: string,
	okfBundleId?: string,
): Promise<{ pages: WikiPageView[] }> {
	const all: WikiPageView[] = []
	let skip = 0
	const limit = 100
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const batch = await listWikiPages(handle, {
			scope,
			scopeRef,
			limit,
			skip,
			state: "all",
		})
		// Filter by okfBundleId if specified (listWikiPages doesn't filter it).
		const filtered = okfBundleId
			? batch.pages.filter((p) => p.okfBundleId === okfBundleId)
			: batch.pages
		all.push(...filtered)
		if (batch.pages.length < limit) break
		skip += limit
	}
	return { pages: all }
}

/** Serializes a wiki page view back to OKF markdown (frontmatter + body + projected sections). */
function wikiPageToOkfMarkdown(page: WikiPageView): string {
	const fm: Record<string, unknown> = {
		type: page.frontmatter.type ?? "concept",
	}
	if (page.frontmatter.title) fm.title = page.frontmatter.title
	if (page.frontmatter.description)
		fm.description = page.frontmatter.description
	if (page.frontmatter.resource) fm.resource = page.frontmatter.resource
	if (Array.isArray(page.frontmatter.tags) && page.frontmatter.tags.length)
		fm.tags = page.frontmatter.tags
	const ts = page.frontmatter.timestamp
	if (ts !== undefined && ts !== null) {
		const d = ts instanceof Date ? ts : new Date(String(ts))
		if (!Number.isNaN(d.getTime())) fm.timestamp = d.toISOString()
	}
	// entityTypes/privacyTier are OKF frontmatter extension keys mdbrain reads
	// on import (conceptToWikiInput) — they must round-trip back out on export,
	// or a bundle that used them loses data on export → reimport. They are
	// distinct from the truly internal-only fields (embedding/backlinks/
	// trustTier/permissions), which never appear in page.frontmatter at all
	// and so are never at risk of being emitted here.
	if (
		Array.isArray(page.frontmatter.entityTypes) &&
		page.frontmatter.entityTypes.length
	) {
		fm.entityTypes = page.frontmatter.entityTypes
	}
	if (typeof page.frontmatter.privacyTier === "string") {
		fm.privacyTier = page.frontmatter.privacyTier
	}
	// OKF v0.2 provenance/trust vocabulary (spec §5, §7) — round-tripped
	// exactly like entityTypes/privacyTier above.
	if (isOkfStatus(page.frontmatter.status)) {
		fm.status = page.frontmatter.status
	}
	const generated = coerceOkfActorEvent(page.frontmatter.generated)
	if (generated) {
		fm.generated = generated
	}
	const verified = normalizeOkfVerified(page.frontmatter.verified)
	if (verified) {
		fm.verified = verified
	}
	const staleAfter = coerceOkfDateOnly(page.frontmatter.stale_after)
	if (staleAfter) {
		fm.stale_after = staleAfter
	}
	if (Array.isArray(page.frontmatter.sources)) {
		const sources = page.frontmatter.sources
			.map(coerceOkfSource)
			.filter((s): s is OkfSource => s !== undefined)
		if (sources.length > 0) {
			fm.sources = sources
		}
	}
	// Preserve remaining OKF extensions: any frontmatter key we don't
	// recognize is kept (OKF contract: consumers SHOULD preserve unknown
	// keys).
	const known = new Set([
		"type",
		"title",
		"description",
		"resource",
		"tags",
		"timestamp",
		"entityTypes",
		"privacyTier",
		"status",
		"generated",
		"verified",
		"stale_after",
		"sources",
	])
	for (const [k, v] of Object.entries(page.frontmatter)) {
		if (!known.has(k) && v !== undefined && v !== null) {
			fm[k] = v
		}
	}
	const fmYaml = yaml.dump(fm, { lineWidth: -1 })
	const sections: string[] = []
	if (page.summary) sections.push(`> ${page.summary}`)
	sections.push("")
	if (page.body) {
		sections.push(page.body)
		sections.push("")
	}
	// Project claims → ## Claims
	const claims = page.claims as Array<Record<string, unknown>>
	if (claims.length > 0) {
		sections.push("## Claims")
		sections.push("")
		for (const c of claims) {
			const status = c.status ? ` _[${c.status}]_` : ""
			sections.push(`- ${c.text}${status}`)
		}
		sections.push("")
	}
	const contradictions = (
		page as unknown as { contradictions?: Array<Record<string, unknown>> }
	).contradictions
	if (contradictions && contradictions.length > 0) {
		sections.push("## Contradictions")
		sections.push("")
		for (const c of contradictions) {
			const claimIds = Array.isArray(c.claimIds)
				? (c.claimIds as string[]).join(" ↔ ")
				: ""
			sections.push(`- [${c.resolution ?? "unresolved"}] ${claimIds}`)
		}
		sections.push("")
	}
	const questions = page.questions as Array<Record<string, unknown>>
	if (questions.length > 0) {
		sections.push("## Open Questions")
		sections.push("")
		for (const q of questions) {
			const marker = q.status === "answered" ? "✓" : "?"
			sections.push(`- ${marker} ${q.text}`)
		}
		sections.push("")
	}
	const relationships = page.relationships as Array<Record<string, unknown>>
	if (relationships.length > 0) {
		sections.push("## Relationships")
		sections.push("")
		for (const r of relationships) {
			// Spec-form standard Markdown link (bundle-root-relative, the OKF
			// spec's recommended form) — NOT the [[wikilink]] syntax mdbrain
			// previously emitted, which only mdbrain's own parser understood.
			// [[wikilink]] parsing is kept on import for backward compatibility
			// with bundles mdbrain exported before this fix, but it is no longer
			// produced, so a bundle mdbrain exports today resolves correctly in
			// any spec-compliant OKF consumer, not just mdbrain itself.
			sections.push(
				`- [${r.kind}] → [${r.targetTitle}](/${r.targetPageSlug}.md)`,
			)
		}
		sections.push("")
	}
	// Project personCard → ## Person Card
	const pc = page.personCard as Record<string, unknown> | null
	if (pc && typeof pc === "object" && Object.keys(pc).length > 0) {
		sections.push("## Person Card")
		sections.push("")
		if (pc.canonicalId) sections.push(`- **Canonical ID:** ${pc.canonicalId}`)
		if (Array.isArray(pc.handles) && pc.handles.length)
			sections.push(`- **Handles:** ${(pc.handles as string[]).join(", ")}`)
		if (Array.isArray(pc.socials) && pc.socials.length)
			sections.push(`- **Socials:** ${(pc.socials as string[]).join(", ")}`)
		if (Array.isArray(pc.emails) && pc.emails.length)
			sections.push(`- **Emails:** ${(pc.emails as string[]).join(", ")}`)
		if (pc.timezone) sections.push(`- **Timezone:** ${pc.timezone}`)
		if (pc.bestUsedFor) sections.push(`- **Best used for:** ${pc.bestUsedFor}`)
		if (pc.notEnoughFor)
			sections.push(`- **Not enough for:** ${pc.notEnoughFor}`)
		sections.push("")
	}
	return `---\n${fmYaml}---\n\n${sections.join("\n")}`
}

function buildIndexMarkdown(pages: WikiPageView[]): string {
	const lines: string[] = ["---", "type: index", "---", "", "# Index", ""]
	for (const p of pages) {
		lines.push(`- [${p.title}](${p.slug}.md)`)
	}
	return lines.join("\n") + "\n"
}
