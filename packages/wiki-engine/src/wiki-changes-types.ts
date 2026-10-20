// @mdbrain/wiki-engine — shapes shared by the changes feed and its cursor.

import type { GovernanceContext } from "./wiki-governance.js"

export const WIKI_CHANGES_LIMITS = {
	limit: { default: 25, max: 100 },
	maxClaims: { default: 10, max: 50 },
} as const

export type WikiChangesLimitName = keyof typeof WIKI_CHANGES_LIMITS

// A revision's createdAt is stamped in app code before its transaction commits,
// so a revision stamped just before `until` can still commit after a reader has
// passed its position. When `until` is not given it is fixed this long before
// now, so nothing still in flight at the first page can land inside the window.
export const WIKI_CHANGES_SETTLE_MS = 15_000

export class WikiChangesRequestError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WikiChangesRequestError"
	}
}

// The feed examined its scan cap of revisions without finding one the caller
// may read, so it cannot move on without naming a position it must not reveal.
export class WikiChangesScanError extends Error {
	constructor() {
		super(
			"the changes feed could not find a readable revision within its scan limit",
		)
		this.name = "WikiChangesScanError"
	}
}

export const WIKI_CHANGES_SCAN_CAP = 1000

export type WikiChangeClaim = Record<string, unknown>

export type WikiChangedClaim = {
	id: string
	fields: string[]
	before: WikiChangeClaim
	after: WikiChangeClaim
}

export type WikiChangeClaims = {
	added: WikiChangeClaim[]
	changed: WikiChangedClaim[]
	removed: WikiChangeClaim[]
	counts: { added: number; changed: number; removed: number }
	truncated: boolean
}

export type WikiChange = {
	pageSlug: string
	title?: string
	revision: number
	editKind: "create" | "update" | "delete"
	createdAt: string
	editor?: { id: string; name: string; runId?: string }
	baseline: "none" | "previous" | "unavailable"
	baselineRevision: number | null
	claims: WikiChangeClaims | null
}

export type WikiChangesPage = {
	window: { since: string; until: string; settled: boolean }
	limits: { limit: number; maxClaims: number }
	changes: WikiChange[]
	hasMore: boolean
	nextCursor?: string
}

export type WikiChangesParams = {
	scope: string
	scopeRef: string
	governance: GovernanceContext
	since?: Date
	until?: Date
	cursor?: string
	limit?: number
	maxClaims?: number
	settleMs?: number
	scanCap?: number
	now?: () => Date
}
