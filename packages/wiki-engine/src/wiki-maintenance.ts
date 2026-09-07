// @mdbrain/wiki-engine — self-maintenance strategies.
//
// Two maintenance paths, unified through the same governance gates:
//
// 1. Git-diff maintenance (T13, OpenWiki pattern): detects changed source
//    files via maintenanceHash (content hash), sends changed snippets + current
//    wiki page state to an LLM, which regenerates only the affected pages.
//    For code/doc sources tracked in git.
//
// 2. Dreamer-wiki promotion (T14): adapts memongo's 5-phase consolidation to
//    compile wiki_pages from events/episodes. Phases: novelty scan →
//    $vectorSearch similarity → LLM injection classification → LLM entity +
//    claim extraction → promote to wiki_pages. For event/streaming/
//    conversation sources. Fails closed without an LLM classifier; the
//    legacy whole-event/0.7-confidence importer is an explicit, separately
//    named opt-in (agreed plan P5).
//
// Both paths pass new/updated claims through injection + contradiction-before-
// dedup + trust-tier + permission gates (the same runWritePipelineGate).
//
// T13 + T14.

import { createHash } from "node:crypto"
import type { Document } from "mongodb"
import { wikiPagesCollection } from "./wiki-schema.js"
import {
	createWikiPage,
	getWikiPage,
	updateWikiPage,
	type WikiDbHandle,
	type WikiPageInput,
} from "./wiki-bridge.js"
import { searchWikiPages, WikiSearchUnavailableError } from "./wiki-search.js"
import { omitUndefined } from "./omit-undefined.js"

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type MaintenanceSource = "git-diff" | "dreamer"

export interface MaintenanceResult {
	source: MaintenanceSource
	pagesProcessed: number
	pagesRegenerated: number
	claimsAdded: number
	claimsRejected: number
	contradictionsDetected: number
	errors: string[]
	/** Which extraction path produced the claims. Every summary must disclose
	 *  this (agreed plan P5): the heuristic importer is never the silent
	 *  default. */
	extractionMode: "llm" | "heuristic-importer"
}

export interface LlmGenerateFn {
	/** Called with the changed source snippet + current wiki page state.
	 *  Returns the regenerated page content (summary, body, claims). */
	(input: {
		sourceFile: string
		changedSnippet: string
		currentPage?: {
			title: string
			summary: string
			body: string
			claims: Array<{ text: string }>
		}
	}): Promise<{
		title?: string
		summary: string
		body: string
		claims: Array<{ text: string; confidence?: number }>
	}>
}

export type EmbedFn = (text: string) => Promise<number[]>

// ---------------------------------------------------------------------------
// Dreamer LLM dependency (phase 3 + 4) — agreed plan W3 / P5
// ---------------------------------------------------------------------------

export type DreamerInjectionType = "ignore" | "new" | "update" | "contradiction"

export interface DreamerExtractedClaim {
	text: string
	/** Per-claim confidence in [0, 1], extracted by the LLM — never a
	 *  hardcoded constant. */
	confidence: number
}

export interface DreamerClassification {
	/** Phase 3 verdict; routes phase 5 behavior. */
	injection: DreamerInjectionType
	/** Phase 4 output: the claims this event contributes. */
	claims: DreamerExtractedClaim[]
}

/** Phase 3 + 4 LLM dependency: classifies an event against the existing page
 *  (if any) and extracts the claims it contributes, with per-claim confidence.
 *  Implementations MUST validate the LLM output locally before returning. */
export type DreamerClassifier = (input: {
	event: EventInput
	existingPage?: {
		title: string
		summary: string
		body: string
		claims: Array<{ text: string }>
	} | null
}) => Promise<DreamerClassification>

/** Maintenance fails closed when its LLM dependency is unconfigured
 *  (agreed plan P5: no silent heuristic fallback). */
export class MaintenanceLlmUnconfiguredError extends Error {
	constructor(operation: string, detail: string) {
		super(`${operation} requires an LLM: ${detail}`)
		this.name = "MaintenanceLlmUnconfiguredError"
	}
}

// ---------------------------------------------------------------------------
// Git-diff maintenance (T13)
// ---------------------------------------------------------------------------

/** Computes a content hash for a source file (used as maintenanceHash). */
export function computeMaintenanceHash(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/** Represents a changed source file detected by git-diff. */
export interface ChangedSource {
	path: string
	content: string
	previousHash?: string
}

/** Detects which source files have changed since the last maintenance run.
 *  Compares current content hashes against the stored maintenanceHash on
 *  wiki pages (frontmatter.resource points to the source file). */
export async function detectChangedSources(
	handle: WikiDbHandle,
	currentSources: Array<{ path: string; content: string }>,
	scope: string,
	scopeRef: string,
): Promise<ChangedSource[]> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const changed: ChangedSource[] = []

	for (const source of currentSources) {
		const currentHash = computeMaintenanceHash(source.content)
		// Find the wiki page that tracks this source file (frontmatter.resource).
		const existing = (await coll.findOne({
			scope,
			scopeRef,
			"frontmatter.resource": source.path,
		})) as unknown as {
			state?: string
			frontmatter?: { maintenanceHash?: string }
		} | null

		// A deleted source stays deleted until an explicit restore operation.
		if (existing?.state === "superseded") continue

		const previousHash = existing?.frontmatter?.maintenanceHash
		if (!previousHash || previousHash !== currentHash) {
			changed.push({
				path: source.path,
				content: source.content,
				previousHash,
			})
		}
	}

	return changed
}

/** Runs git-diff maintenance: for each changed source, calls the LLM to
 *  regenerate the affected wiki page(s). New claims pass through the
 *  governance pipeline gate (contradiction-before-dedup). */
export async function runGitDiffMaintenance(
	handle: WikiDbHandle,
	changedSources: ChangedSource[],
	llmGenerate: LlmGenerateFn,
	opts: {
		scope: string
		scopeRef: string
		trustTier?: string
		agentId?: string
	},
): Promise<MaintenanceResult> {
	const result: MaintenanceResult = {
		source: "git-diff",
		pagesProcessed: 0,
		pagesRegenerated: 0,
		claimsAdded: 0,
		claimsRejected: 0,
		contradictionsDetected: 0,
		errors: [],
		extractionMode: "llm",
	}

	for (const source of changedSources) {
		try {
			result.pagesProcessed++
			const slug = sourceToSlug(source.path)
			const existing = await getWikiPage(
				handle,
				slug,
				opts.scope,
				opts.scopeRef,
				undefined,
				undefined,
				{ includeSuperseded: true },
			)
			if (existing?.state === "superseded") continue

			// Call the LLM with the changed snippet + current page state.
			const generated = await llmGenerate({
				sourceFile: source.path,
				changedSnippet: source.content,
				currentPage: existing
					? {
							title: existing.title,
							summary: existing.summary,
							body: existing.body,
							claims: ((existing.claims ?? []) as Array<{ text: string }>).map(
								(c) => ({
									text: c.text,
								}),
							),
						}
					: undefined,
			})

			// Generate claim IDs. The pipeline gate (contradiction-before-dedup)
			// runs INSIDE createWikiPage/updateWikiPage — we don't gate manually
			// here (avoids double-gating + data loss).
			const newClaims = generated.claims.map((c, i) => ({
				id: `claim-git-${computeMaintenanceHash(source.path)}-${i}`,
				text: c.text,
				confidence: c.confidence,
			}))

			// Upsert the page with the regenerated content + new claims.
			const maintenanceHash = computeMaintenanceHash(source.content)
			if (existing) {
				// Pass only NEW claims — updateWikiPage preserves existing claims
				// and appends accepted new ones through the pipeline gate.
				await updateWikiPage(handle, slug, opts.scope, opts.scopeRef, {
					summary: generated.summary,
					body: generated.body,
					frontmatter: {
						...(existing.frontmatter as object),
						type: (existing.frontmatter as { type?: string })?.type ?? "source",
						resource: source.path,
						maintenanceHash,
					} as unknown as WikiPageInput["frontmatter"],
					claims: newClaims as unknown as Array<{ id: string; text: string }>,
				})
				result.claimsAdded += newClaims.length
			} else {
				// createWikiPage runs the pipeline gate internally for each claim.
				await createWikiPage(handle, {
					kind: "source",
					title: generated.title ?? source.path,
					slug,
					summary: generated.summary,
					body: generated.body,
					frontmatter: {
						type: "source",
						resource: source.path,
						maintenanceHash,
					},
					scope: opts.scope as
						| "workspace"
						| "session"
						| "user"
						| "agent"
						| "tenant"
						| "global",
					scopeRef: opts.scopeRef,
					trustTier: (opts.trustTier ?? "standard") as
						| "restricted"
						| "standard"
						| "admin",
					sourceAgent: opts.agentId
						? { id: opts.agentId, name: opts.agentId }
						: undefined,
					claims: newClaims as unknown as Array<{
						id: string
						text: string
						confidence?: number
					}>,
				})
				result.claimsAdded += newClaims.length
			}

			// Update lastMaintainedAt + lastMaintenanceSource.
			await updateMaintenanceMetadata(
				handle,
				slug,
				opts.scope,
				opts.scopeRef,
				"git-diff",
			)
			result.pagesRegenerated++
		} catch (err) {
			result.errors.push(
				`${source.path}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Dreamer-wiki promotion (T14)
// ---------------------------------------------------------------------------

/** Represents a new event/episode to be promoted to wiki_pages. */
export interface EventInput {
	id: string
	text: string
	embedding?: number[]
	timestamp?: Date
	agentId?: string
}

/** Runs the Dreamer 5-phase consolidation to promote events to wiki_pages.
 *
 *  Phase 1 — Novelty scan: filter events that are likely new (not processed).
 *  Phase 2 — Similarity: $vectorSearch each event against existing wiki pages.
 *  Phase 3 — Injection classification (LLM): ignore | new | update |
 *            contradiction — routes phase 5 behavior.
 *  Phase 4 — Entity + claim extraction (LLM): per-claim confidence and event
 *            provenance (evidence kind "event").
 *  Phase 5 — Promotion: upsert claims to wiki_pages through the governance
 *            pipeline gate (contradiction-before-dedup).
 *
 *  Fails closed without a classifier: the whole-event/0.7-confidence importer
 *  is an explicit opt-in (`importer: "heuristic-importer"`), separately named
 *  and reported via `MaintenanceResult.extractionMode` (agreed plan P5).
 */
export async function runDreamerPromotion(
	handle: WikiDbHandle,
	events: EventInput[],
	opts: {
		scope: string
		scopeRef: string
		trustTier?: string
		agentId?: string
		/** Optional embedding function for events without embeddings. */
		embed?: EmbedFn
		/** Phase 3 + 4 classifier (LLM). Required unless the heuristic
		 *  importer is explicitly selected — never the default. */
		classifier?: DreamerClassifier
		/** Explicit opt-in for the legacy whole-event/0.7-confidence
		 *  importer (separately named, disclosed in the result). */
		importer?: "heuristic-importer"
	},
): Promise<MaintenanceResult> {
	if (!opts.classifier && opts.importer !== "heuristic-importer") {
		throw new MaintenanceLlmUnconfiguredError(
			"Dreamer promotion",
			"no classifier configured (set MDBRAIN_LLM_BASE_URL, MDBRAIN_LLM_API_KEY, and MDBRAIN_LLM_MODEL, or explicitly opt in with importer: 'heuristic-importer' for the legacy whole-event importer)",
		)
	}
	const result: MaintenanceResult = {
		source: "dreamer",
		pagesProcessed: 0,
		pagesRegenerated: 0,
		claimsAdded: 0,
		claimsRejected: 0,
		contradictionsDetected: 0,
		errors: [],
		extractionMode: opts.classifier ? "llm" : "heuristic-importer",
	}

	for (const event of events) {
		try {
			result.pagesProcessed++

			// Phase 1: Novelty — skip events with no text.
			if (!event.text || event.text.trim().length === 0) continue

			// Phase 2: Similarity — search for an existing wiki page that
			// semantically matches the event text. Uses recipe "fast"
			// (vector-only) so scores are cosine similarities in [0,1] and the
			// 0.65 minScore floor is a real similarity gate: results below the
			// floor are FILTERED OUT, so a non-empty result set here means a
			// genuinely similar page (no unconditional top-1 adoption of
			// unrelated pages). RRF-fused "hybrid" scores are orders of
			// magnitude smaller and would never clear 0.65. Falls back to
			// hash-based slug when search is unavailable or nothing clears.
			let slug = eventToSlug(event.id)
			let existing = null
			try {
				const searchResult = await searchWikiPages(handle, {
					query: event.text.slice(0, 500),
					scope: opts.scope,
					scopeRef: opts.scopeRef,
					maxResults: 1,
					minScore: 0.65,
					recipe: "fast",
				})
				if (searchResult.results.length > 0) {
					slug = searchResult.results[0].page.slug
					existing = await getWikiPage(
						handle,
						slug,
						opts.scope,
						opts.scopeRef,
						undefined,
						undefined,
						{ includeSuperseded: true },
					)
				} else {
					// No semantic match above the floor — fall back to hash slug
					// lookup (backward compat)
					existing = await getWikiPage(
						handle,
						slug,
						opts.scope,
						opts.scopeRef,
						undefined,
						undefined,
						{ includeSuperseded: true },
					)
				}
			} catch (err) {
				// Search unavailable (WikiSearchUnavailableError: no mongot /
				// index outage) — degrade to hash-slug consolidation instead of
				// skipping the event entirely.
				if (!(err instanceof WikiSearchUnavailableError)) throw err
				existing = await getWikiPage(
					handle,
					slug,
					opts.scope,
					opts.scopeRef,
					undefined,
					undefined,
					{ includeSuperseded: true },
				)
			}
			if (existing?.state === "superseded") continue

			// Phase 3 + 4 — injection classification + entity/claim extraction.
			// LLM path (default): the classifier routes phase 5 and extracts
			// claims with per-claim confidence + event provenance. Heuristic
			// path (explicit opt-in only, P5): the whole event is one claim at
			// a fixed 0.7 confidence — disclosed via extractionMode.
			let newClaims: Array<{
				id: string
				text: string
				confidence: number
				evidence: Array<{ kind: "event"; sourceId: string }>
			}>
			if (opts.classifier) {
				const classification = await opts.classifier({
					event,
					existingPage: existing
						? {
								title: existing.title,
								summary: existing.summary,
								body: existing.body,
								claims: (
									(existing.claims ?? []) as Array<{
										text: string
									}>
								).map((c) => ({ text: c.text })),
							}
						: null,
				})
				const invalid = validateClassification(classification)
				if (invalid) {
					result.errors.push(`event ${event.id}: ${invalid}`)
					continue
				}

				// Phase 5 routing per the classification verdict.
				if (classification.injection === "ignore") {
					// Ignored events contribute nothing; count the rejection so
					// the summary discloses it.
					result.claimsRejected++
					continue
				}
				if (classification.injection === "contradiction") {
					// Routed like an update: the pipeline gate inside
					// updateWikiPage is the authority on contradictions; this
					// counter discloses the classifier's verdict.
					result.contradictionsDetected++
				}
				if (classification.claims.length === 0) continue

				newClaims = classification.claims.map((c, i) => ({
					id: `claim-dreamer-${event.id}-${i}`,
					text: c.text,
					confidence: c.confidence,
					evidence: [{ kind: "event", sourceId: event.id }],
				}))
			} else {
				// importer: "heuristic-importer" — explicit opt-in (P5).
				newClaims = [
					{
						id: `claim-dreamer-${event.id}`,
						text: event.text,
						confidence: 0.7,
						evidence: [{ kind: "event", sourceId: event.id }],
					},
				]
			}

			// Phase 5: Promotion — the pipeline gate runs INSIDE
			// createWikiPage/updateWikiPage (avoids double-gating + duplication).
			// Pass only the NEW claims — the bridge preserves existing claims.

			// Upsert the page with the new claims.
			if (existing) {
				// Pass only NEW claims — updateWikiPage preserves existing
				// claims and appends accepted new ones through the pipeline gate.
				await updateWikiPage(handle, slug, opts.scope, opts.scopeRef, {
					claims: newClaims as unknown as Array<{ id: string; text: string }>,
				})
			} else {
				// createWikiPage runs the pipeline gate internally.
				await createWikiPage(handle, {
					kind: "entity",
					title: `Event ${event.id}`,
					slug,
					summary: event.text.slice(0, 100),
					body: "",
					frontmatter: { type: "entity" },
					scope: opts.scope as
						| "workspace"
						| "session"
						| "user"
						| "agent"
						| "tenant"
						| "global",
					scopeRef: opts.scopeRef,
					trustTier: (opts.trustTier ?? "standard") as
						| "restricted"
						| "standard"
						| "admin",
					sourceAgent: event.agentId
						? { id: event.agentId, name: event.agentId }
						: undefined,
					claims: newClaims,
				})
			}

			await updateMaintenanceMetadata(
				handle,
				slug,
				opts.scope,
				opts.scopeRef,
				"dreamer",
			)
			result.claimsAdded += newClaims.length
			result.pagesRegenerated++
		} catch (err) {
			result.errors.push(
				`event ${event.id}: ${err instanceof Error ? err.message : String(err)}`,
			)
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runtime-validates a classifier (LLM) result before it touches the store.
 *  Returns an error message, or undefined when the classification is sound. */
function validateClassification(
	classification: DreamerClassification,
): string | undefined {
	const injections: DreamerInjectionType[] = [
		"ignore",
		"new",
		"update",
		"contradiction",
	]
	if (
		!classification ||
		!injections.includes(classification.injection as DreamerInjectionType)
	) {
		return "classifier returned an invalid injection type (expected ignore | new | update | contradiction)"
	}
	if (!Array.isArray(classification.claims)) {
		return "classifier returned a non-array claims list"
	}
	for (const claim of classification.claims) {
		if (typeof claim?.text !== "string" || claim.text.trim().length === 0) {
			return "classifier returned a claim with empty text"
		}
		if (
			typeof claim.confidence !== "number" ||
			!Number.isFinite(claim.confidence) ||
			claim.confidence < 0 ||
			claim.confidence > 1
		) {
			return "classifier returned a claim with confidence outside [0, 1]"
		}
	}
	return undefined
}

function sourceToSlug(sourcePath: string): string {
	const clean = sourcePath
		.toLowerCase()
		.replace(/[^a-z0-9/.]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return `sources/${clean}`
}

function eventToSlug(eventId: string): string {
	const clean = eventId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return `events/${clean}`
}

/** Updates the lastMaintainedAt + lastMaintenanceSource fields on a page. */
async function updateMaintenanceMetadata(
	handle: WikiDbHandle,
	slug: string,
	scope: string,
	scopeRef: string,
	source: MaintenanceSource,
): Promise<void> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	await coll.updateOne(
		{ slug, scope, scopeRef },
		{
			$set: omitUndefined({
				lastMaintainedAt: new Date(),
				lastMaintenanceSource: source,
				freshness: "fresh",
			}) as Document,
		},
	)
}
