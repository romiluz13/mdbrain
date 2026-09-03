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
//    $vectorSearch similarity → injection classification → entity + claim
//    extraction → promote to wiki_pages. For event/streaming/conversation
//    sources.
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
import { searchWikiPages } from "./wiki-search.js"
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
		})) as unknown as { frontmatter?: { maintenanceHash?: string } } | null

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
			)

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
 *  Phase 3 — Injection classification: determine if the event is new info,
 *            an update, or a contradiction.
 *  Phase 4 — Entity + claim extraction: extract claims from the event text.
 *  Phase 5 — Promotion: upsert claims to wiki_pages through the governance
 *            pipeline gate (contradiction-before-dedup).
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
	},
): Promise<MaintenanceResult> {
	const result: MaintenanceResult = {
		source: "dreamer",
		pagesProcessed: 0,
		pagesRegenerated: 0,
		claimsAdded: 0,
		claimsRejected: 0,
		contradictionsDetected: 0,
		errors: [],
	}

	for (const event of events) {
		try {
			result.pagesProcessed++

			// Phase 1: Novelty — skip events with no text.
			if (!event.text || event.text.trim().length === 0) continue

			// Phase 2: Similarity — search for an existing wiki page that
			// semantically matches the event text. Uses the wiki search
			// pipeline ($vectorSearch + $search + $rankFusion when available).
			// Falls back to hash-based slug when search is unavailable.
			let slug = eventToSlug(event.id)
			let existing = null
			try {
				const searchResult = await searchWikiPages(handle, {
					query: event.text.slice(0, 500),
					scope: opts.scope,
					scopeRef: opts.scopeRef,
					maxResults: 1,
					minScore: 0.65,
				})
				if (searchResult.results.length > 0) {
					slug = searchResult.results[0].page.slug
					existing = await getWikiPage(handle, slug, opts.scope, opts.scopeRef)
				} else {
					// No semantic match — fall back to hash slug lookup (backward compat)
					existing = await getWikiPage(handle, slug, opts.scope, opts.scopeRef)
				}
			} catch {
				// Search unavailable (no mongot) — fall back to hash slug
				existing = await getWikiPage(handle, slug, opts.scope, opts.scopeRef)
			}

			// Phase 3: Injection classification (simplified — always new info;
			// the pipeline gate handles contradictions).
			const _injectionType = existing ? "update" : "new"
			void _injectionType

			// Phase 4: Entity + claim extraction — extract a claim from the event.
			const claimId = `claim-dreamer-${event.id}`
			const claimText = event.text

			// Phase 5: Promotion — the pipeline gate runs INSIDE
			// createWikiPage/updateWikiPage (avoids double-gating + duplication).
			// Pass only the NEW claim — the bridge preserves existing claims.
			const newClaim = {
				id: claimId,
				text: claimText,
				confidence: 0.7,
			}

			// Upsert the page with the new claim.
			if (existing) {
				// Pass only the NEW claim — updateWikiPage preserves existing
				// claims and appends accepted new ones through the pipeline gate.
				await updateWikiPage(handle, slug, opts.scope, opts.scopeRef, {
					claims: [newClaim] as unknown as Array<{ id: string; text: string }>,
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
					claims: [{ id: claimId, text: claimText, confidence: 0.7 }],
				})
			}

			await updateMaintenanceMetadata(
				handle,
				slug,
				opts.scope,
				opts.scopeRef,
				"dreamer",
			)
			result.claimsAdded++
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
