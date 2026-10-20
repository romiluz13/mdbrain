// Fixtures for the entity overview tests: pages, claims and revisions shaped like
// the write path leaves them, and a fake database that evaluates the real
// governance filters (see fake-wiki-db.ts).

import type { Document } from "mongodb"
import type { GovernanceContext } from "../wiki-governance.js"
import { getWikiEntityOverview } from "../wiki-overview.js"
import { createFakeWikiDb } from "./fake-wiki-db.js"

export const SCOPE = { scope: "workspace", scopeRef: "ws-1" }

// A caller with no special access: standard tier, no roles.
export const outsider: GovernanceContext = { ...SCOPE, trustTier: "standard" }
export const exec: GovernanceContext = {
	...SCOPE,
	trustTier: "standard",
	roles: ["exec"],
}
export const admin: GovernanceContext = { ...SCOPE, trustTier: "admin" }

export const HIDDEN = { privacyTier: "restricted", allowedRoles: ["exec"] }

let clock = 0
export function page(slug: string, extra: Document = {}): Document {
	clock += 1
	return {
		_id: `id-${slug}`,
		slug,
		title: `Title of ${slug}`,
		kind: "entity",
		summary: `Summary of ${slug}`,
		body: "",
		aliases: [],
		frontmatter: { type: "account" },
		claims: [],
		contradictions: [],
		questions: [],
		relationships: [],
		backlinks: [],
		personCard: null,
		transcludes: [],
		...SCOPE,
		trustTier: "standard",
		state: "active",
		revision: 1,
		freshness: "fresh",
		validFrom: new Date("2026-09-01T00:00:00.000Z"),
		createdAt: new Date("2026-09-01T00:00:00.000Z"),
		updatedAt: new Date(2026, 8, 1, 0, clock),
		...extra,
	}
}

export function claim(
	id: string,
	text: string,
	extra: Document = {},
): Document {
	return { id, text, status: "active", confidence: 0.5, evidence: [], ...extra }
}

export function overviewOf(
	pages: Document[],
	slug: string,
	governance: GovernanceContext,
	extra: { revisions?: Document[]; limits?: Document } = {},
) {
	const fake = createFakeWikiDb({
		wiki_pages: pages,
		wiki_revisions: extra.revisions ?? [],
	})
	return {
		fake,
		result: getWikiEntityOverview(fake, {
			slug,
			...SCOPE,
			governance,
			limits: extra.limits,
		}),
	}
}

// A target page whose stored backlinks[] names these sources, and the source
// pages that really link to it (the way the write path leaves them).
export function linked(
	target: string,
	sources: Array<{ slug: string; extra?: Document; kind?: string }>,
	targetExtra: Document = {},
): Document[] {
	return [
		page(target, {
			backlinks: sources.map((s) => ({
				sourcePageSlug: s.slug,
				sourceTitle: `Title of ${s.slug}`,
			})),
			...targetExtra,
		}),
		...sources.map((s) =>
			page(s.slug, {
				relationships: [
					{
						targetPageSlug: target,
						targetTitle: `Title of ${target}`,
						kind: s.kind ?? "mentions",
					},
				],
				...s.extra,
			}),
		),
	]
}

export const slugsIn = (
	section: { items: Array<{ slug: string }> } | undefined,
) => section?.items.map((item) => item.slug)

// A hub page that links out to these neighbors.
export function hubLinking(
	neighbors: Array<{ slug: string; extra?: Document; kind?: string }>,
): Document[] {
	return [
		page("hub", {
			relationships: neighbors.map((n) => ({
				targetPageSlug: n.slug,
				targetTitle: `Title of ${n.slug}`,
				kind: n.kind ?? "related_to",
			})),
		}),
		...neighbors.map((n) => page(n.slug, n.extra)),
	]
}

export function contradiction(
	id: string,
	claimIds: string[],
	extra: Document = {},
	day = 5,
): Document {
	return {
		id,
		claimIds,
		detectedAt: new Date(Date.UTC(2026, 8, day)),
		resolution: "unresolved",
		...extra,
	}
}

export function revision(
	pageSlug: string,
	number: number,
	snapshotExtra: Document = {},
	extra: Document = {},
): Document {
	return {
		pageSlug,
		...SCOPE,
		revision: number,
		editKind: number === 1 ? "create" : "update",
		editor: { id: "agent-1", name: "Writer" },
		snapshot: {
			slug: pageSlug,
			...SCOPE,
			claims: [claim("snap", "Snapshot only.")],
			...snapshotExtra,
		},
		createdAt: new Date(Date.UTC(2026, 8, number)),
		...extra,
	}
}
