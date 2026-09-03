// @mdbrain/wiki-engine — wiki page revision history.
//
// wiki_pages.revision is a bare monotonic counter — it tells you a page has
// been edited N times, but stores no content history, so there is no undo
// and no audit trail of what actually changed. This module records a full
// snapshot on every create/update/delete, mirroring MediaWiki's "every edit
// is a revision" model.
//
// Deliberately has no runtime dependency on wiki-bridge.ts (only a type-only
// import, erased at compile time) so wiki-bridge.ts can call into this
// module without creating an import cycle.

import { createSubsystemLogger } from "@mdbrain/lib"
import type { ClientSession, Document } from "mongodb"
import {
	filterPagesByGovernance,
	type GovernanceContext,
} from "./wiki-governance.js"
import { wikiRevisionsCollection } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import { omitUndefined } from "./omit-undefined.js"

const log = createSubsystemLogger("wiki:revisions")

export type WikiRevisionEditKind = "create" | "update" | "delete"

/** Who performed a write. Recorded on every revision snapshot so history
 *  reflects the actual calling principal rather than a caller-supplied
 *  sourceAgent string. */
export interface WikiPageEditor {
	id: string
	name: string
	runId?: string
}

export interface WikiPageRevisionRecord {
	pageSlug: string
	scope: string
	scopeRef: string
	revision: number
	editKind: WikiRevisionEditKind
	editor?: WikiPageEditor
	snapshot: Record<string, unknown>
	createdAt: string
}

/** Records a full-content snapshot of a page at the revision it was just
 *  written to. Best-effort: a failure here is logged but never thrown, since
 *  revision history is an audit feature and must never block the actual
 *  page write it's recording. */
export async function recordWikiPageRevision(
	handle: WikiDbHandle,
	params: {
		pageSlug: string
		scope: string
		scopeRef: string
		revision: number
		editKind: WikiRevisionEditKind
		editor?: WikiPageEditor
		// The stored page document as of this revision. embedding is stripped
		// (large, not meaningful for content history/diffing).
		snapshot: Record<string, unknown>
	},
	options: { session?: ClientSession; strict?: boolean } = {},
): Promise<void> {
	try {
		const coll = wikiRevisionsCollection(handle.db, handle.prefix)
		const { embedding, ...snapshot } = params.snapshot
		void embedding
		await coll.insertOne(
			omitUndefined({
				pageSlug: params.pageSlug,
				scope: params.scope,
				scopeRef: params.scopeRef,
				revision: params.revision,
				editKind: params.editKind,
				...(params.editor ? { editor: params.editor } : {}),
				snapshot,
				createdAt: new Date(),
			}),
			options.session ? { session: options.session } : undefined,
		)
	} catch (err) {
		if (options.strict) throw err
		const msg = err instanceof Error ? err.message : String(err)
		log.warn(
			`failed to record revision ${params.revision} for ${params.pageSlug}: ${msg}`,
		)
	}
}

/** Lists revision metadata for a page, newest first. Excludes the snapshot
 *  body — callers that need full content should use getWikiPageRevision for
 *  a specific revision, keeping the list cheap to fetch/render.
 *
 *  Governed mode: each revision is authorized against its OWN snapshot
 *  metadata (the permissions/trustTier the page had at that revision), not
 *  against the page's current state — so restricting or hard-deleting a page
 *  later never hides or leaks its earlier history: readers who could see a
 *  revision when it was written still can, and readers who could not,
 *  cannot. */
export async function listWikiPageRevisions(
	handle: WikiDbHandle,
	params: {
		pageSlug: string
		scope: string
		scopeRef: string
		limit?: number
		governance?: GovernanceContext
	},
): Promise<Array<Omit<WikiPageRevisionRecord, "snapshot">>> {
	const coll = wikiRevisionsCollection(handle.db, handle.prefix)
	const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
	if (params.governance) {
		// Governed mode: fetch full docs (the snapshot carries the governance
		// metadata), authorize each revision individually, then reduce the
		// surviving revisions to summaries.
		const docs = await coll
			.find({
				pageSlug: params.pageSlug,
				scope: params.scope,
				scopeRef: params.scopeRef,
			})
			.sort({ revision: -1 })
			.limit(limit)
			.toArray()
		return docs
			.filter(
				(doc) =>
					filterPagesByGovernance(
						[(doc as Record<string, unknown>).snapshot ?? {}],
						params.governance as GovernanceContext,
					).length > 0,
			)
			.map((doc) => toRevisionSummary(doc as Record<string, unknown>))
	}
	const docs = await coll
		.find(
			{
				pageSlug: params.pageSlug,
				scope: params.scope,
				scopeRef: params.scopeRef,
			},
			{ projection: { snapshot: 0 } },
		)
		.sort({ revision: -1 })
		.limit(limit)
		.toArray()
	return docs.map((doc) => toRevisionSummary(doc as Record<string, unknown>))
}

/** Fetches one full revision snapshot, or undefined if not found. Governed
 *  mode authorizes against the revision's OWN snapshot metadata — see
 *  listWikiPageRevisions. */
export async function getWikiPageRevision(
	handle: WikiDbHandle,
	params: {
		pageSlug: string
		scope: string
		scopeRef: string
		revision: number
		governance?: GovernanceContext
	},
): Promise<WikiPageRevisionRecord | undefined> {
	const coll = wikiRevisionsCollection(handle.db, handle.prefix)
	const doc = await coll.findOne({
		pageSlug: params.pageSlug,
		scope: params.scope,
		scopeRef: params.scopeRef,
		revision: params.revision,
	})
	if (!doc) return undefined
	const record = toRevisionRecord(doc as Record<string, unknown>)
	if (
		params.governance &&
		filterPagesByGovernance([record.snapshot as Document], params.governance)
			.length === 0
	) {
		return undefined
	}
	return record
}

function toRevisionSummary(
	doc: Record<string, unknown>,
): Omit<WikiPageRevisionRecord, "snapshot"> {
	return {
		pageSlug: doc.pageSlug as string,
		scope: doc.scope as string,
		scopeRef: doc.scopeRef as string,
		revision: doc.revision as number,
		editKind: doc.editKind as WikiRevisionEditKind,
		editor: doc.editor as WikiPageRevisionRecord["editor"],
		createdAt:
			doc.createdAt instanceof Date
				? doc.createdAt.toISOString()
				: String(doc.createdAt),
	}
}

function toRevisionRecord(
	doc: Record<string, unknown>,
): WikiPageRevisionRecord {
	return {
		...toRevisionSummary(doc),
		snapshot: (doc.snapshot as Record<string, unknown>) ?? {},
	}
}
