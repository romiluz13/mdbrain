// Fixtures for the changes feed tests: revision documents shaped like
// recordWikiPageRevision leaves them, and a fake database that evaluates the
// feed's real filters (see fake-wiki-db.ts).

import type { Document } from "mongodb"
import { type WikiChangesParams, getWikiChanges } from "../wiki-changes.js"
import { SCOPE, outsider } from "./overview-fixtures.js"
import { createFakeWikiDb } from "./fake-wiki-db.js"

export {
	HIDDEN,
	SCOPE,
	admin,
	claim,
	exec,
	outsider,
} from "./overview-fixtures.js"

// Wall-clock time on one fixed day, written as "HH:MM:SS.mmm".
export const at = (time: string): Date => new Date(`2026-10-01T${time}Z`)
export const iso = (time: string): string => at(time).toISOString()

export function rev(
	pageSlug: string,
	revision: number,
	time: string,
	options: {
		editKind?: "create" | "update" | "delete"
		snapshot?: Document
		extra?: Document
	} = {},
): Document {
	const editKind = options.editKind ?? (revision === 1 ? "create" : "update")
	return {
		pageSlug,
		...SCOPE,
		revision,
		editKind,
		editor: { id: "agent-1", name: "Writer" },
		snapshot: {
			slug: pageSlug,
			title: `Title of ${pageSlug}`,
			...SCOPE,
			trustTier: "standard",
			revision,
			claims: [],
			...options.snapshot,
		},
		createdAt: at(time),
		...options.extra,
	}
}

export const NOW = at("12:00:00.000")

export const WINDOW = { since: at("00:00:00.000"), until: at("11:00:00.000") }

// The feed against these revisions as `outsider` (a standard-tier reader with
// no roles), with a fixed clock and no settle lag unless the test sets one.
export function feedOf(
	revisions: Document[],
	params: Partial<WikiChangesParams> = {},
) {
	const fake = createFakeWikiDb({ wiki_pages: [], wiki_revisions: revisions })
	return {
		fake,
		run: (more: Partial<WikiChangesParams> = {}) =>
			getWikiChanges(fake, {
				...SCOPE,
				governance: outsider,
				...WINDOW,
				now: () => NOW,
				settleMs: 0,
				...params,
				...more,
			}),
	}
}

export const slugsOf = (page: {
	changes: Array<{ pageSlug: string; revision: number }>
}) => page.changes.map((c) => `${c.pageSlug}@${c.revision}`)
