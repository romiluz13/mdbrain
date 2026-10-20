// @mdbrain/wiki-engine — who owns the claims a contradiction names.
//
// Claim ids are unique only within a page. A record written with claimRefs
// names the owning page of each claim and is resolved from those pages. An
// older record holds bare ids: it is resolved only when exactly one page in the
// scope holds each id, and dropped when ownership is ambiguous. Either way
// every page it names must be readable by the caller, and a record that cannot
// be fully resolved is dropped whole: showing the part that can be shown would
// reveal that the rest exists.

import type { ClientSession, Document } from "mongodb"
import type { WikiDbHandle } from "./wiki-bridge.js"
import type { ClaimRef } from "./wiki-contradictions.js"
import {
	buildGovernanceFilter,
	type GovernanceContext,
} from "./wiki-governance.js"
import { wikiPagesCollection } from "./wiki-schema.js"

export interface ContradictionOwnerContext {
	scope: string
	scopeRef: string
	governance: GovernanceContext
	session?: ClientSession
}

export interface ResolvedClaim {
	page: Document
	claim: Document
}

interface NamedClaims {
	ids: string[]
	refs?: ClaimRef[]
}

function arrayOf(value: unknown): Document[] {
	return Array.isArray(value) ? (value as Document[]) : []
}

// A record whose shape cannot be trusted has no owner to resolve.
function namedClaims(record: unknown): NamedClaims | undefined {
	if (record === null || typeof record !== "object") return undefined
	const { claimIds, claimRefs } = record as Document
	if (
		!Array.isArray(claimIds) ||
		claimIds.length < 2 ||
		!claimIds.every((id) => typeof id === "string")
	) {
		return undefined
	}
	if (claimRefs === undefined) return { ids: claimIds }
	if (!Array.isArray(claimRefs) || claimRefs.length !== claimIds.length) {
		return undefined
	}
	for (const [index, ref] of claimRefs.entries()) {
		if (
			ref === null ||
			typeof ref !== "object" ||
			typeof ref.pageSlug !== "string" ||
			ref.claimId !== claimIds[index]
		) {
			return undefined
		}
	}
	return { ids: claimIds, refs: claimRefs as ClaimRef[] }
}

// Every page in the scope that holds one of the ids, superseded pages and pages
// the caller may not read included. Nothing read here reaches a response; it
// only decides whether an id has one owner or several.
async function holdersOf(
	handle: WikiDbHandle,
	ctx: ContradictionOwnerContext,
	ids: string[],
): Promise<Map<string, string[]>> {
	const found = await wikiPagesCollection(handle.db, handle.prefix)
		.find(
			{ scope: ctx.scope, scopeRef: ctx.scopeRef, "claims.id": { $in: ids } },
			{
				projection: { slug: 1, "claims.id": 1 },
				...(ctx.session ? { session: ctx.session } : {}),
			},
		)
		.toArray()
	const holders = new Map<string, Set<string>>()
	for (const doc of found) {
		for (const claim of arrayOf(doc.claims)) {
			if (!ids.includes(claim.id)) continue
			const slugs = holders.get(claim.id) ?? new Set<string>()
			slugs.add(doc.slug as string)
			holders.set(claim.id, slugs)
		}
	}
	return new Map([...holders].map(([id, slugs]) => [id, [...slugs]]))
}

async function readablePages(
	handle: WikiDbHandle,
	ctx: ContradictionOwnerContext,
	slugs: string[],
): Promise<Document[]> {
	return wikiPagesCollection(handle.db, handle.prefix)
		.find(
			{
				scope: ctx.scope,
				scopeRef: ctx.scopeRef,
				slug: { $in: slugs },
				state: { $ne: "superseded" },
				...buildGovernanceFilter(ctx.governance),
			},
			{
				projection: { slug: 1, title: 1, revision: 1, claims: 1 },
				...(ctx.session ? { session: ctx.session } : {}),
			},
		)
		.toArray()
}

// An id with one holder has an owner; with none or several it has none.
const soleHolder = (slugs: string[] | undefined) =>
	slugs?.length === 1 ? slugs[0] : undefined

function ownersOf(
	named: NamedClaims,
	holders: Map<string, string[]>,
	pages: Map<string, Document>,
): ResolvedClaim[] | undefined {
	const owners: ResolvedClaim[] = []
	const seen = new Set<string>()
	for (const [index, id] of named.ids.entries()) {
		const slug = named.refs
			? named.refs[index]?.pageSlug
			: soleHolder(holders.get(id))
		const page = slug === undefined ? undefined : pages.get(slug)
		const claim = page ? arrayOf(page.claims).find((c) => c.id === id) : null
		if (!page || !claim) return undefined
		const key = JSON.stringify([slug, id])
		if (seen.has(key)) return undefined
		seen.add(key)
		owners.push({ page, claim })
	}
	return owners
}

/** Resolves the claims each record names, in the order of its claimIds. The
 *  result has one entry per record: undefined when the record must not be shown
 *  to this caller. `known` are pages the caller has already read under this
 *  governance, so they are not read again. */
export async function resolveContradictionClaims(
	handle: WikiDbHandle,
	ctx: ContradictionOwnerContext,
	records: unknown[],
	known: Document[] = [],
): Promise<Array<ResolvedClaim[] | undefined>> {
	const named = records.map(namedClaims)
	const legacyIds = [
		...new Set(named.flatMap((n) => (n && !n.refs ? n.ids : []))),
	]
	const holders =
		legacyIds.length > 0
			? await holdersOf(handle, ctx, legacyIds)
			: new Map<string, string[]>()

	const wanted = new Set<string>()
	for (const n of named) {
		if (!n) continue
		if (n.refs) {
			for (const ref of n.refs) wanted.add(ref.pageSlug)
		} else {
			for (const id of n.ids) {
				const sole = soleHolder(holders.get(id))
				if (sole !== undefined) wanted.add(sole)
			}
		}
	}

	const pages = new Map<string, Document>(
		known
			.filter((page) => page.state !== "superseded")
			.map((page) => [page.slug as string, page]),
	)
	const missing = [...wanted].filter((slug) => !pages.has(slug))
	if (missing.length > 0) {
		for (const page of await readablePages(handle, ctx, missing)) {
			pages.set(page.slug as string, page)
		}
	}
	return named.map((n) => (n ? ownersOf(n, holders, pages) : undefined))
}

/** The pages with the stored records this caller may see: those that resolve
 *  under resolveContradictionClaims. The pages themselves are already readable
 *  by this caller, so they are not read again. */
export async function governContradictions<T extends Document>(
	handle: WikiDbHandle,
	ctx: ContradictionOwnerContext,
	pages: T[],
): Promise<T[]> {
	const records = pages.flatMap((page) => arrayOf(page.contradictions))
	if (records.length === 0) return pages
	const owners = await resolveContradictionClaims(handle, ctx, records, pages)
	let next = 0
	return pages.map((page) => {
		const stored = arrayOf(page.contradictions)
		if (stored.length === 0) return page
		return {
			...page,
			contradictions: stored.filter(() => owners[next++] !== undefined),
		}
	})
}
