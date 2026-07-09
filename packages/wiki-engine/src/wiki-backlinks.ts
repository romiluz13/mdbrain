// @mdbrian/wiki-engine — backlinks auto-generation.
//
// Backlinks are computed from relationships[] across all pages: if page A has
// a relationship targeting page B, then B has a backlink to A. Updated
// incrementally on page write (create/update/delete) — not a full recompute
// on every write, only the affected pages are touched.
//
// T11.

import { wikiPagesCollection } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikiBacklink {
	sourcePageSlug: string
	sourceTitle: string
	context?: string
}

// ---------------------------------------------------------------------------
// Recompute backlinks for a single target page (the page that may have gained
// or lost incoming relationships). Finds all pages whose relationships[]
// reference this slug and writes their backlinks[].
// ---------------------------------------------------------------------------

/** Recomputes the backlinks[] field for the page identified by `targetSlug`
 *  in the given scope. Finds all pages in the same scope whose relationships[]
 *  target this slug, and sets this page's backlinks[] accordingly.
 *  Returns the backlinks that were written (or null if the target page
 *  doesn't exist). */
export async function recomputeBacklinksFor(
	handle: WikiDbHandle,
	targetSlug: string,
	scope: string,
	scopeRef: string,
): Promise<WikiBacklink[] | null> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)

	// Find all pages in this scope that reference targetSlug in their
	// relationships[]. Uses $match on relationships.targetPageSlug.
	const referringPages = (await coll
		.aggregate([
			{
				$match: {
					scope,
					scopeRef,
					"relationships.targetPageSlug": targetSlug,
					// Exclude superseded (soft-deleted) pages — they should not
					// contribute backlinks.
					state: { $ne: "superseded" },
				},
			},
			{
				$project: {
					slug: 1,
					title: 1,
					relationships: 1,
				},
			},
		])
		.toArray()) as Array<{
		slug: string
		title: string
		relationships?: Array<{ targetPageSlug: string; kind?: string }>
	}>

	const backlinks: WikiBacklink[] = referringPages
		.filter((p) => p.slug !== targetSlug) // no self-backlinks
		.map((p) => ({
			sourcePageSlug: p.slug,
			sourceTitle: p.title,
			context: undefined,
		}))

	// Write the backlinks[] to the target page.
	const result = await coll.updateOne(
		{ slug: targetSlug, scope, scopeRef },
		{ $set: { backlinks } },
	)
	if (result.matchedCount === 0) return null
	return backlinks
}

// ---------------------------------------------------------------------------
// Recompute backlinks for all pages affected by a relationship change.
//
// When page A's relationships[] change, two sets of pages need backlink
// updates:
//   1. The pages that A NOW references (new targets gained a backlink from A)
//   2. The pages that A NO LONGER references (old targets lost a backlink)
//   3. A itself (its own backlinks don't change from its outgoing relationships,
//      but if A was deleted, pages that referenced A need recompute)
// ---------------------------------------------------------------------------

/** Recomputes backlinks for all pages that reference (or referenced) the given
 *  slug — call this after a page is created, updated (relationships changed),
 *  or deleted. For a delete, also recompute the backlinks of pages that
 *  referenced the deleted page (they need the stale backlink removed). */
export async function recomputeBacklinksAfterChange(
	handle: WikiDbHandle,
	changedSlug: string,
	scope: string,
	scopeRef: string,
	opts: {
		oldRelationshipTargets?: string[] // slugs the page used to reference
		newRelationshipTargets?: string[] // slugs the page now references
		deleted?: boolean
	} = {},
): Promise<void> {
	// When deleted, the changed page is gone — recompute backlinks for all
	// pages that referenced it (to remove the stale backlink from the deleted page).
	if (opts.deleted) {
		await recomputeBacklinksForReferencingPages(
			handle,
			changedSlug,
			scope,
			scopeRef,
		)
		return
	}

	// Collect all slugs whose backlinks may have changed:
	// - the changed page itself (its incoming backlinks)
	// - all old + new relationship targets (gained/lost a backlink)
	const affectedSlugs = new Set<string>([changedSlug])
	for (const s of opts.oldRelationshipTargets ?? []) affectedSlugs.add(s)
	for (const s of opts.newRelationshipTargets ?? []) affectedSlugs.add(s)

	for (const slug of affectedSlugs) {
		await recomputeBacklinksFor(handle, slug, scope, scopeRef)
	}
}

/** Finds all pages whose backlinks[] contain a reference to `sourceSlug` and
 *  recomputes their backlinks (to remove the stale entry from a deleted page). */
async function recomputeBacklinksForReferencingPages(
	handle: WikiDbHandle,
	sourceSlug: string,
	scope: string,
	scopeRef: string,
): Promise<void> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const pagesWithStaleBacklink = (await coll
		.aggregate([
			{
				$match: {
					scope,
					scopeRef,
					"backlinks.sourcePageSlug": sourceSlug,
				},
			},
			{ $project: { slug: 1 } },
		])
		.toArray()) as Array<{ slug: string }>
	for (const p of pagesWithStaleBacklink) {
		await recomputeBacklinksFor(handle, p.slug, scope, scopeRef)
	}
}

// ---------------------------------------------------------------------------
// Full recompute (batch/admin tool — not used in the incremental path but
// useful for initial backfill or repair).
// ---------------------------------------------------------------------------

/** Recomputes backlinks for ALL pages in a scope. Use for initial backfill
 *  or repair. Returns the number of pages updated. */
export async function recomputeAllBacklinks(
	handle: WikiDbHandle,
	scope: string,
	scopeRef: string,
): Promise<number> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const allPages = (await coll
		.aggregate([{ $match: { scope, scopeRef } }, { $project: { slug: 1 } }])
		.toArray()) as Array<{ slug: string }>
	let count = 0
	for (const p of allPages) {
		const result = await recomputeBacklinksFor(handle, p.slug, scope, scopeRef)
		if (result !== null) count++
	}
	return count
}
