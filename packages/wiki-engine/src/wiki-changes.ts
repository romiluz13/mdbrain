// @mdbrain/wiki-engine — the what-changed-since feed.
//
// Revisions across pages in a time window, oldest first, each with the claims it
// added, changed and removed. The window is [since, until): `since` inclusive,
// `until` exclusive and frozen when the first page is served, so adjacent windows
// tile and a long read never drifts. Revisions are ordered by (createdAt,
// pageSlug, revision), a total order inside one scope because
// (pageSlug, scope, scopeRef, revision) is unique.

import type { Document } from "mongodb"
import type { WikiDbHandle } from "./wiki-bridge.js"
import {
	type WikiChangesPosition,
	decodeWikiChangesCursor,
	encodeWikiChangesCursor,
} from "./wiki-changes-cursor.js"
import {
	type WikiChange,
	type WikiChangeClaim,
	type WikiChangeClaims,
	type WikiChangesPage,
	type WikiChangesParams,
	WIKI_CHANGES_LIMITS,
	WIKI_CHANGES_SCAN_CAP,
	WIKI_CHANGES_SETTLE_MS,
	WikiChangesRequestError,
	WikiChangesScanError,
} from "./wiki-changes-types.js"
import { diffClaims } from "./wiki-changes-diff.js"
import {
	canReadRevision,
	revisionPermissionsFilter,
} from "./wiki-changes-governance.js"
import { wikiRevisionsCollection } from "./wiki-schema.js"

export * from "./wiki-changes-types.js"
export { decodeWikiChangesCursor, encodeWikiChangesCursor }

const REVISION_PROJECTION = {
	pageSlug: 1,
	scope: 1,
	scopeRef: 1,
	revision: 1,
	editKind: 1,
	editor: 1,
	createdAt: 1,
	"snapshot.title": 1,
	"snapshot.claims": 1,
	"snapshot.scope": 1,
	"snapshot.scopeRef": 1,
	"snapshot.permissions": 1,
}

const SORT = { createdAt: 1, pageSlug: 1, revision: 1 } as const

const PREVIOUS_PROJECTION = {
	pageSlug: 1,
	revision: 1,
	"snapshot.claims": 1,
	"snapshot.scope": 1,
	"snapshot.scopeRef": 1,
	"snapshot.permissions": 1,
}

function bound(
	value: number | undefined,
	limit: { default: number; max: number },
): number {
	if (value === undefined) return limit.default
	return Math.min(Math.max(Math.trunc(value), 1), limit.max)
}

function claimsOf(snapshot: Document): WikiChangeClaim[] {
	return Array.isArray(snapshot.claims)
		? (snapshot.claims as WikiChangeClaim[])
		: []
}

function listClaims(
	claims: WikiChangeClaim[],
	maxClaims: number,
	kind: "added" | "removed",
): WikiChangeClaims {
	const shown = claims.slice(0, maxClaims)
	return {
		added: kind === "added" ? shown : [],
		changed: [],
		removed: kind === "removed" ? shown : [],
		counts: {
			added: kind === "added" ? claims.length : 0,
			changed: 0,
			removed: kind === "removed" ? claims.length : 0,
		},
		truncated: shown.length < claims.length,
	}
}

function toChange(
	doc: Document,
	maxClaims: number,
	previous: Map<string, Document>,
): WikiChange {
	const snapshot = (doc.snapshot ?? {}) as Document
	const editKind = doc.editKind as WikiChange["editKind"]
	const revision = doc.revision as number
	const base = {
		pageSlug: doc.pageSlug as string,
		...(typeof snapshot.title === "string" ? { title: snapshot.title } : {}),
		revision,
		editKind,
		createdAt: (doc.createdAt as Date).toISOString(),
		...(doc.editor ? { editor: doc.editor as WikiChange["editor"] } : {}),
	}
	if (editKind === "create") {
		return {
			...base,
			baseline: "none",
			baselineRevision: null,
			claims: listClaims(claimsOf(snapshot), maxClaims, "added"),
		}
	}
	if (editKind === "delete") {
		return {
			...base,
			baseline: "none",
			baselineRevision: null,
			claims: listClaims(claimsOf(snapshot), maxClaims, "removed"),
		}
	}
	const prior = previous.get(snapshotKey(base.pageSlug, revision - 1))
	if (!prior) {
		return {
			...base,
			baseline: "unavailable",
			baselineRevision: null,
			claims: null,
		}
	}
	return {
		...base,
		baseline: "previous",
		baselineRevision: revision - 1,
		claims: diffClaims(
			claimsOf((prior.snapshot ?? {}) as Document),
			claimsOf(snapshot),
			maxClaims,
		),
	}
}

const snapshotKey = (pageSlug: string, revision: number) =>
	`${pageSlug}\u0000${revision}`

export async function getWikiChanges(
	handle: WikiDbHandle,
	params: WikiChangesParams,
): Promise<WikiChangesPage> {
	const now = (params.now ?? (() => new Date()))()
	const settleMs = params.settleMs ?? WIKI_CHANGES_SETTLE_MS
	const limit = bound(params.limit, WIKI_CHANGES_LIMITS.limit)
	const maxClaims = bound(params.maxClaims, WIKI_CHANGES_LIMITS.maxClaims)
	const settledBefore = now.getTime() - settleMs

	let since = params.since
	let until = params.until
	let after: WikiChangesPosition | undefined
	if (params.cursor) {
		const frozen = decodeWikiChangesCursor(params.cursor)
		if (since && since.getTime() !== frozen.since.getTime()) {
			throw new WikiChangesRequestError(
				"since does not match the window the cursor belongs to",
			)
		}
		if (until && until.getTime() !== frozen.until.getTime()) {
			throw new WikiChangesRequestError(
				"until does not match the window the cursor belongs to",
			)
		}
		since = frozen.since
		until = frozen.until
		after = frozen.after
	}
	if (!since) {
		throw new WikiChangesRequestError("since is required without a cursor")
	}
	if (params.until && since.getTime() > params.until.getTime()) {
		throw new WikiChangesRequestError("since must not be later than until")
	}
	const window = until ?? new Date(settledBefore)

	const permissions = revisionPermissionsFilter(params.governance)
	const filterFrom = (from: WikiChangesPosition | undefined): Document => {
		const parts: Document[] = [
			{
				scope: params.scope,
				scopeRef: params.scopeRef,
				createdAt: { $gte: from?.createdAt ?? since, $lt: window },
			},
		]
		if (from) {
			parts.push({
				$or: [
					{ createdAt: { $gt: from.createdAt } },
					{ pageSlug: { $gt: from.pageSlug } },
					{ pageSlug: from.pageSlug, revision: { $gt: from.revision } },
				],
			})
		}
		if (Object.keys(permissions).length > 0) parts.push(permissions)
		return { $and: parts }
	}

	// Read in batches until limit + 1 readable revisions are found, so a revision
	// the caller may not read never counts toward a page or toward hasMore. The
	// position used to continue is internal and never leaves this function.
	const revisions = wikiRevisionsCollection(handle.db, handle.prefix)
	const batchSize = limit + 1
	const scanCap = params.scanCap ?? WIKI_CHANGES_SCAN_CAP
	const readable: Document[] = []
	let examined = 0
	let capped = false
	let from = after
	for (;;) {
		const batch = await revisions
			.find(filterFrom(from), { projection: REVISION_PROJECTION })
			.sort(SORT)
			.limit(batchSize)
			.toArray()
		for (const doc of batch) {
			examined++
			if (canReadRevision(doc, params.governance)) readable.push(doc)
			if (readable.length > limit) break
		}
		if (readable.length > limit || batch.length < batchSize) break
		if (examined >= scanCap) {
			capped = true
			break
		}
		const tail = batch[batch.length - 1] as Document
		from = {
			createdAt: tail.createdAt as Date,
			pageSlug: tail.pageSlug as string,
			revision: tail.revision as number,
		}
	}
	const shown = readable.slice(0, limit)
	if (capped && shown.length === 0) throw new WikiChangesScanError()
	const hasMore = readable.length > limit || capped
	const wanted = shown
		.filter((doc) => doc.editKind === "update" && (doc.revision as number) > 1)
		.map((doc) => ({
			pageSlug: doc.pageSlug as string,
			revision: (doc.revision as number) - 1,
		}))
	const priorDocs =
		wanted.length === 0
			? []
			: await revisions
					.find(
						{ scope: params.scope, scopeRef: params.scopeRef, $or: wanted },
						{ projection: PREVIOUS_PROJECTION },
					)
					.toArray()
	const previous = new Map(
		priorDocs
			.filter((doc) => canReadRevision(doc, params.governance))
			.map((doc) => [
				snapshotKey(doc.pageSlug as string, doc.revision as number),
				doc,
			]),
	)
	const last = shown.at(-1)
	return {
		window: {
			since: since.toISOString(),
			until: window.toISOString(),
			settled: window.getTime() <= settledBefore,
		},
		limits: { limit, maxClaims },
		changes: shown.map((doc) => toChange(doc, maxClaims, previous)),
		hasMore,
		...(hasMore && last
			? {
					nextCursor: encodeWikiChangesCursor({
						since,
						until: window,
						after: {
							createdAt: last.createdAt as Date,
							pageSlug: last.pageSlug as string,
							revision: last.revision as number,
						},
					}),
				}
			: {}),
	}
}
