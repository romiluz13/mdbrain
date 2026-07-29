// @mdbrain/wiki-engine — OKF (Open Knowledge Format) interchange.
//
// OKF spec (GoogleCloudPlatform/knowledge-catalog, v0.1):
//   - Knowledge Bundle = directory of concept .md files
//   - Concept ID = file path with .md removed (tables/users.md → "tables/users")
//   - Frontmatter: required `type`; recommended title/description/resource/tags/timestamp
//   - Reserved files: index.md (directory listing), log.md (update history)
//   - Links = standard markdown links between concepts → relationships
//   - Extensions: producers MAY add extra frontmatter keys; consumers preserve them
//
// MBrain internal wiki_pages schema is a strict SUPERSET of OKF. OKF is the
// portable projection: export → import round-trips structure, but unexpressible
// fields (embedding, backlinks, trustTier, permissions) stay in MongoDB.
//
// Design spec: docs/specs/2026-07-08-mdbrain-llm-wiki-design.md §5

import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import type { Document } from "mongodb"
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

/** Resolves and validates a directory path against allowed roots. Throws if
 *  the path escapes all allowed roots or contains parent-directory traversal.
 *
 *  Fails closed by default: with no MDBRAIN_OKF_ALLOWED_ROOTS configured, any
 *  absolute path (including outside the deployment) would otherwise be a
 *  valid import/export target — an arbitrary filesystem read (import) or
 *  write (export) reachable by any authenticated API caller. Local-first dev
 *  can opt back into the old unrestricted behavior explicitly via
 *  MDBRAIN_OKF_ALLOW_UNRESTRICTED=true; production deployments must set
 *  MDBRAIN_OKF_ALLOWED_ROOTS. */
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
			return resolved
		}
		throw new Error(
			"OKF import/export requires MDBRAIN_OKF_ALLOWED_ROOTS to be configured " +
				"(comma-separated allowed directory roots), or explicit opt-in via " +
				"MDBRAIN_OKF_ALLOW_UNRESTRICTED=true for local-first dev. Refusing " +
				"to resolve an unrestricted filesystem path.",
		)
	}
	const allowed = allowedRoots.some((root) =>
		isPathWithinRoot(resolved, path.resolve(root)),
	)
	if (!allowed) {
		throw new Error(
			"directory path must resolve inside the workspace or a configured OKF root",
		)
	}
	return resolved
}

// ---------------------------------------------------------------------------
// Frontmatter shape
// ---------------------------------------------------------------------------

interface OkfFrontmatter {
	type: string // required
	title?: string
	description?: string
	resource?: string
	tags?: string[]
	timestamp?: string // ISO 8601
	// Extensions (preserved on round-trip)
	[key: string]: unknown
}

interface OkfConcept {
	conceptId: string // file path without .md
	filePath: string // relative path within bundle
	frontmatter: OkfFrontmatter
	body: string // markdown body (after frontmatter)
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

/** Parses a single .md file into frontmatter + body. Returns a diagnostic
 *  reason on skip instead of a bare null, so a caller can record WHY a
 *  concept was dropped rather than have it silently vanish from the import
 *  result. */
function parseConceptFile(
	filePath: string,
	relativePath: string,
): { concept: OkfConcept | null; skipReason: string | null } {
	// Cap file size to prevent DoS via oversized concept files.
	const MAX_CONCEPT_BYTES = 1024 * 1024 // 1 MiB
	const stat = fs.statSync(filePath)
	if (stat.size > MAX_CONCEPT_BYTES) {
		return {
			concept: null,
			skipReason: `file exceeds ${MAX_CONCEPT_BYTES} byte limit (${stat.size} bytes)`,
		}
	}
	const raw = fs.readFileSync(filePath, "utf-8")
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
 *  entry for every file that was skipped and why. */
function readBundleConcepts(bundleDir: string): {
	concepts: OkfConcept[]
	skipped: Array<{ path: string; reason: string }>
} {
	const concepts: OkfConcept[] = []
	const skipped: Array<{ path: string; reason: string }> = []
	function walk(dir: string) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(full)
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				if (entry.name === "index.md" || entry.name === "log.md") continue
				const relative = path.relative(bundleDir, full)
				const { concept, skipReason } = parseConceptFile(full, relative)
				if (concept) {
					concepts.push(concept)
				} else if (skipReason) {
					skipped.push({ path: relative, reason: skipReason })
				}
			}
		}
	}
	walk(bundleDir)
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
	},
): Promise<OkfImportResult> {
	const allowedRoots = process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		? process.env.MDBRAIN_OKF_ALLOWED_ROOTS.split(",").map((r) => r.trim())
		: []
	const safeBundleDir = validateOkfPath(bundleDir, allowedRoots)
	const { concepts, skipped } = readBundleConcepts(safeBundleDir)
	const indexRelationships = parseIndexRelationships(safeBundleDir)
	const result: OkfImportResult = {
		imported: 0,
		skipped: skipped.length,
		conceptIds: [],
		errors: skipped.map((s) => ({ conceptId: s.path, error: s.reason })),
	}

	for (const concept of concepts) {
		try {
			const input = conceptToWikiInput(concept, opts, indexRelationships)
			// Upsert by slug+scope: if the page exists, update; else create.
			const existing = await getWikiPage(
				handle,
				input.slug,
				input.scope,
				input.scopeRef,
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
				await updateWikiPage(handle, input.slug, input.scope, input.scopeRef, {
					title: input.title,
					aliases: input.aliases,
					summary: input.summary,
					body: input.body,
					frontmatter: input.frontmatter,
					okfConceptId: input.okfConceptId,
					okfBundleId: input.okfBundleId,
					relationships: input.relationships,
				})
			} else {
				await createWikiPage(handle, input, { embed: opts.embed })
			}
			result.imported++
			result.conceptIds.push(concept.conceptId)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			result.errors.push({ conceptId: concept.conceptId, error: msg })
			result.skipped++
		}
	}
	return result
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
	// Extract claims/questions from conventional body sections.
	const {
		body: cleanBody,
		claims,
		questions,
	} = extractBodySections(concept.body)
	// Extract relationships from markdown links in the body.
	const bodyRelationships = extractRelationshipsFromLinks(concept.body)
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
	])
	// Preserve OKF extensions: unknown frontmatter keys are passed through.
	const extensions: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(fm)) {
		if (!known.has(k) && v !== undefined && v !== null) extensions[k] = v
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
			tags: fm.tags,
			timestamp: fm.timestamp ? new Date(fm.timestamp) : undefined,
			entityTypes: Array.isArray(fm.entityTypes)
				? (fm.entityTypes as string[])
				: undefined,
			privacyTier:
				typeof fm.privacyTier === "string"
					? (fm.privacyTier as WikiPageInput["frontmatter"]["privacyTier"])
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

/** Extracts relationships from markdown links in the body. */
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
	return rels
}

// ---------------------------------------------------------------------------
// Export (wiki_pages → bundle on disk)
// ---------------------------------------------------------------------------

export interface OkfExportResult {
	dir: string
	exported: number
	files: string[]
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
	const allowedRoots = process.env.MDBRAIN_OKF_ALLOWED_ROOTS
		? process.env.MDBRAIN_OKF_ALLOWED_ROOTS.split(",").map((r) => r.trim())
		: []
	const safeOutDir = validateOkfPath(opts.outDir, allowedRoots)
	fs.mkdirSync(safeOutDir, { recursive: true })
	const files: string[] = []
	for (const page of pages) {
		const filePath = path.join(safeOutDir, `${page.slug}.md`)
		fs.mkdirSync(path.dirname(filePath), { recursive: true })
		const content = wikiPageToOkfMarkdown(page)
		fs.writeFileSync(filePath, content, "utf-8")
		files.push(`${page.slug}.md`)
	}
	// Write index.md with links to all concepts.
	const indexContent = buildIndexMarkdown(pages)
	fs.writeFileSync(path.join(safeOutDir, "index.md"), indexContent, "utf-8")
	files.push("index.md")
	return { dir: safeOutDir, exported: pages.length, files }
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
