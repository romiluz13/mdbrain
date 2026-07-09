// @mdbrian/wiki-engine — cross-page contradiction detector.
//
// Detects contradictory claims across pages. CRITICAL: runs BEFORE the
// near-duplicate (dedup) gate in the write pipeline — a synchronous near-
// duplicate gate must not reject contradictory writes before the contradiction
// detector sees them (arXiv:2606.24535 pipeline-ordering bug).
//
// Populates contradictions[] on affected pages. wiki_lint lists unresolved
// contradictions. Resolution states: unresolved, newest_wins, authority_wins,
// human_escalation.
//
// T12.

import type { Document } from "mongodb"
import { wikiPagesCollection } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContradictionResolution =
	| "unresolved"
	| "newest_wins"
	| "authority_wins"
	| "human_escalation"

export interface Contradiction {
	id: string
	claimIds: string[] // always ≥2: the conflicting claims
	detectedAt: Date
	resolution: ContradictionResolution
	resolvedBy?: string
	resolvedAt?: Date
	note?: string
}

export interface ClaimRecord {
	id: string
	text: string
	status?: string
	confidence?: number
	sourceMemId?: string
	validFrom?: Date
}

// ---------------------------------------------------------------------------
// Negation detection — a heuristic for identifying contradictory claims.
// A claim with a negation marker ("not", "never", "no longer", "discontinued")
// that textually overlaps with an existing positive claim is a contradiction.
// ---------------------------------------------------------------------------

const NEGATION_MARKERS = [
	"not ",
	"never ",
	"no longer ",
	"discontinued",
	"deprecated",
	"removed",
	"incorrect",
	"false",
	"wrong",
	"contradicts",
	"does not",
	"doesn't",
	"is not",
	"isn't",
	"are not",
	"aren't",
	"was not",
	"wasn't",
]

/** Returns true if the text contains a negation marker. */
export function hasNegation(text: string): boolean {
	const lower = text.toLowerCase()
	return NEGATION_MARKERS.some((m) => lower.includes(m))
}

/** Computes a simple text-overlap score between two claims (0-1).
 *  Uses word-level Jaccard similarity — fast, no embeddings needed. */
export function textOverlap(a: string, b: string): number {
	const wordsA = new Set(
		a
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 2),
	)
	const wordsB = new Set(
		b
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 2),
	)
	if (wordsA.size === 0 || wordsB.size === 0) return 0
	let intersection = 0
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++
	}
	const union = wordsA.size + wordsB.size - intersection
	return intersection / union
}

/** Returns true if two claims are likely contradictory:
 *  - high text overlap (≥0.3) AND
 *  - exactly one has a negation marker (opposite polarity) */
export function areContradictory(
	claimA: ClaimRecord,
	claimB: ClaimRecord,
): boolean {
	const overlap = textOverlap(claimA.text, claimB.text)
	if (overlap < 0.3) return false
	const aNeg = hasNegation(claimA.text)
	const bNeg = hasNegation(claimB.text)
	// One negated, one not → contradictory.
	return aNeg !== bNeg
}

// ---------------------------------------------------------------------------
// Near-duplicate gate — runs AFTER contradiction detection.
// Rejects writes that are near-duplicates of existing claims on the SAME page.
// High text similarity (≥0.8) + same page → near-duplicate.
// ---------------------------------------------------------------------------

export interface DedupResult {
	isDuplicate: boolean
	existingClaimId?: string
	similarity: number
}

/** Checks if a new claim is a near-duplicate of an existing claim on the
 *  same page. Returns the result — does NOT throw. The caller decides
 *  whether to reject. */
export function checkNearDuplicate(
	newClaimText: string,
	existingClaims: ClaimRecord[],
	opts: { excludeClaimId?: string } = {},
): DedupResult {
	for (const existing of existingClaims) {
		// Skip self — a resubmitted claim (same id) is not a duplicate of itself.
		if (opts.excludeClaimId && existing.id === opts.excludeClaimId) continue
		const sim = textOverlap(newClaimText, existing.text)
		if (sim >= 0.8) {
			return {
				isDuplicate: true,
				existingClaimId: existing.id,
				similarity: sim,
			}
		}
	}
	return { isDuplicate: false, similarity: 0 }
}

// ---------------------------------------------------------------------------
// Cross-page contradiction detection.
// When a new claim is written, check related pages (via relationships) for
// claims that conflict. Returns the contradictions to record.
// ---------------------------------------------------------------------------

/** Detects contradictions between a new claim and claims on related pages.
 *  Fetches pages related to `pageSlug` via relationships[] and checks each
 *  related page's claims for contradictions with the new claim.
 *  Returns the contradictions to record on the affected pages. */
export async function detectContradictions(
	handle: WikiDbHandle,
	pageSlug: string,
	newClaim: ClaimRecord,
	scope: string,
	scopeRef: string,
): Promise<Array<{ pageSlug: string; contradiction: Contradiction }>> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)

	// Get the source page to find its relationships.
	const sourcePage = (await coll.findOne({
		slug: pageSlug,
		scope,
		scopeRef,
	})) as unknown as {
		relationships?: Array<{ targetPageSlug?: string }>
	} | null
	if (!sourcePage?.relationships) return []

	const results: Array<{ pageSlug: string; contradiction: Contradiction }> = []

	for (const rel of sourcePage.relationships) {
		const targetSlug = rel.targetPageSlug
		if (!targetSlug || targetSlug === pageSlug) continue

		const targetPage = (await coll.findOne({
			slug: targetSlug,
			scope,
			scopeRef,
		})) as unknown as {
			claims?: Array<{
				id: string
				text: string
				status?: string
				confidence?: number
			}>
			contradictions?: Contradiction[]
		} | null
		if (!targetPage?.claims) continue

		// Check each existing claim on the target page for contradiction.
		for (const existingClaim of targetPage.claims) {
			if (existingClaim.status === "superseded") continue
			const existingRecord: ClaimRecord = {
				id: existingClaim.id,
				text: existingClaim.text,
				status: existingClaim.status,
				confidence: existingClaim.confidence,
			}
			if (areContradictory(newClaim, existingRecord)) {
				// Check if this contradiction was already recorded.
				const alreadyRecorded = (targetPage.contradictions ?? []).some(
					(c) =>
						c.claimIds.includes(newClaim.id) &&
						c.claimIds.includes(existingClaim.id),
				)
				if (alreadyRecorded) continue

				const contradiction: Contradiction = {
					id: `contra-${newClaim.id}-${existingClaim.id}`,
					claimIds: [newClaim.id, existingClaim.id],
					detectedAt: new Date(),
					resolution: "unresolved",
				}
				results.push({ pageSlug: targetSlug, contradiction })
			}
		}
	}

	return results
}

// ---------------------------------------------------------------------------
// Record contradictions on pages.
// ---------------------------------------------------------------------------

/** Records contradictions on the affected pages by appending to
 *  contradictions[]. Returns the number of pages updated. */
export async function recordContradictions(
	handle: WikiDbHandle,
	contradictions: Array<{ pageSlug: string; contradiction: Contradiction }>,
	scope: string,
	scopeRef: string,
): Promise<number> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	let count = 0
	for (const { pageSlug, contradiction } of contradictions) {
		const result = await coll.updateOne(
			{ slug: pageSlug, scope, scopeRef },
			{ $push: { contradictions: contradiction } as Document },
		)
		if (result.modifiedCount > 0) count++
	}
	return count
}

// ---------------------------------------------------------------------------
// List unresolved contradictions (for wiki_lint).
// ---------------------------------------------------------------------------

export interface UnresolvedContradiction {
	pageSlug: string
	pageTitle: string
	contradiction: Contradiction
}

/** Lists all unresolved contradictions in a scope. Used by wiki_lint. */
export async function listUnresolvedContradictions(
	handle: WikiDbHandle,
	scope: string,
	scopeRef: string,
): Promise<UnresolvedContradiction[]> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const pages = (await coll
		.aggregate([
			{
				$match: {
					scope,
					scopeRef,
					"contradictions.resolution": "unresolved",
				},
			},
			{ $project: { slug: 1, title: 1, contradictions: 1 } },
		])
		.toArray()) as Array<{
		slug: string
		title: string
		contradictions?: Contradiction[]
	}>

	const results: UnresolvedContradiction[] = []
	for (const page of pages) {
		for (const c of page.contradictions ?? []) {
			if (c.resolution === "unresolved") {
				results.push({
					pageSlug: page.slug,
					pageTitle: page.title,
					contradiction: c,
				})
			}
		}
	}
	return results
}

// ---------------------------------------------------------------------------
// Resolve a contradiction.
// ---------------------------------------------------------------------------

/** Resolves a contradiction by ID. Updates the resolution state, resolvedBy,
 *  and resolvedAt. */
export async function resolveContradiction(
	handle: WikiDbHandle,
	pageSlug: string,
	contradictionId: string,
	resolution: ContradictionResolution,
	scope: string,
	scopeRef: string,
	opts: { resolvedBy?: string; note?: string } = {},
): Promise<boolean> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const result = await coll.updateOne(
		{
			slug: pageSlug,
			scope,
			scopeRef,
			"contradictions.id": contradictionId,
		},
		{
			$set: {
				"contradictions.$.resolution": resolution,
				"contradictions.$.resolvedBy": opts.resolvedBy,
				"contradictions.$.resolvedAt": new Date(),
				"contradictions.$.note": opts.note,
			} as Document,
		},
	)
	return result.modifiedCount > 0
}

// ---------------------------------------------------------------------------
// Write pipeline gate: contradiction detection BEFORE dedup.
// This is the critical pipeline-ordering function (arXiv:2606.24535).
// ---------------------------------------------------------------------------

export interface PipelineGateResult {
	/** Contradictions detected (the write proceeds — contradictions are
	 *  recorded but the claim is NOT rejected). */
	contradictions: Array<{ pageSlug: string; contradiction: Contradiction }>
	/** Dedup result — if isDuplicate is true, the caller should reject the
	 *  write (but ONLY after contradictions have been detected). */
	dedup: DedupResult
	/** Whether the write should be rejected (dedup only — contradictions
	 *  never reject). */
	rejected: boolean
}

/** Runs the write pipeline gate: contradiction detection FIRST, then dedup.
 *  Returns the result — contradictions are always recorded, dedup may reject.
 *  This ordering prevents the arXiv pipeline bug where dedup would reject
 *  contradictory writes before the contradiction detector could see them. */
export async function runWritePipelineGate(
	handle: WikiDbHandle,
	pageSlug: string,
	newClaim: ClaimRecord,
	existingClaims: ClaimRecord[],
	scope: string,
	scopeRef: string,
): Promise<PipelineGateResult> {
	// STEP 1: Contradiction detection — ALWAYS runs, even if the claim is a
	// near-duplicate. This is the arXiv fix: contradictions are detected
	// BEFORE dedup, so a contradictory write is never silently rejected.
	const contradictions = await detectContradictions(
		handle,
		pageSlug,
		newClaim,
		scope,
		scopeRef,
	)
	// Record any detected contradictions immediately.
	if (contradictions.length > 0) {
		await recordContradictions(handle, contradictions, scope, scopeRef)
	}

	// STEP 2: Near-duplicate gate — runs AFTER contradiction detection.
	// A near-duplicate of an existing claim on the SAME page is rejected.
	const dedup = checkNearDuplicate(newClaim.text, existingClaims, {
		excludeClaimId: newClaim.id,
	})

	return {
		contradictions,
		dedup,
		rejected: dedup.isDuplicate,
	}
}
