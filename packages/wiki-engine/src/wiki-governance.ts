// @mdbrian/wiki-engine — governance layer.
//
// Centralizes scope enforcement, trust-tier propagation, and role/department
// permissions filtering. Applied on EVERY read path — search, get-by-slug,
// get-by-id, graph traversal, OKF export — not just the API edge.
//
// Implements the arXiv:2606.24535 governance primitives:
// - Scoped retrieval (scope + scopeRef required on every read)
// - Temporal supersession (claims retained with state="superseded", not deleted)
// - Provenance tracking (sourceMemId, migratedFrom, writerAgent)
// - Policy-governed propagation (trust tiers determine cross-scope visibility)
//
// T10.

import type { Document, Filter } from "mongodb"
import { wikiPagesCollection } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrustTier = "restricted" | "standard" | "admin"
export type PrivacyTier = "public" | "internal" | "confidential" | "restricted"

/** The requester's identity for governance checks. */
export interface GovernanceContext {
	/** The scope the requester is operating in. Required — no cross-scope reads
	 *  unless the requester is an admin. */
	scope: string
	scopeRef: string
	/** The requester's trust tier. restricted = own scope only; standard = own
	 *  scope + can see public/internal claims from other scopes; admin = can
	 *  propagate cross-scope. */
	trustTier: TrustTier
	/** The requester's roles (for permissions.allowedRoles). */
	roles?: string[]
	/** The requester's departments (for permissions.allowedDepartments). */
	departments?: string[]
	/** The requester's agent ID (for audit logging). */
	agentId?: string
}

// ---------------------------------------------------------------------------
// Scope filter — the fundamental governance gate.
// ---------------------------------------------------------------------------

export function buildScopeFilter(
	ctx: GovernanceContext,
	opts: { crossScope?: boolean } = {},
): Filter<Document> {
	if (ctx.trustTier === "admin" && opts.crossScope) {
		return {}
	}
	return { scope: ctx.scope, scopeRef: ctx.scopeRef }
}

// ---------------------------------------------------------------------------
// Permissions filter — role/department/privacyTier gating.
// A page is visible if ANY of:
//   - no permissions block
//   - no privacyTier set (open access)
//   - privacyTier is public/internal
//   - requester matches allowedRoles or allowedDepartments
// ---------------------------------------------------------------------------

export function buildPermissionsFilter(
	ctx: GovernanceContext,
): Filter<Document> {
	if (ctx.trustTier === "admin") return {}

	const visible: Filter<Document>[] = [
		{ permissions: { $exists: false } },
		{ "permissions.privacyTier": { $exists: false } },
		{ "permissions.privacyTier": "public" },
		{ "permissions.privacyTier": "internal" },
	]
	if (ctx.roles && ctx.roles.length > 0) {
		visible.push({ "permissions.allowedRoles": { $in: ctx.roles } })
	}
	if (ctx.departments && ctx.departments.length > 0) {
		visible.push({ "permissions.allowedDepartments": { $in: ctx.departments } })
	}
	return { $or: visible }
}

/** Combines scope + permissions filters. */
export function buildGovernanceFilter(
	ctx: GovernanceContext,
	opts: { crossScope?: boolean } = {},
): Filter<Document> {
	const scope = buildScopeFilter(ctx, opts)
	const perms = buildPermissionsFilter(ctx)
	return { $and: [scope, perms] }
}

// ---------------------------------------------------------------------------
// Trust-tier propagation
// ---------------------------------------------------------------------------

export function canPropagateCrossScope(
	writerTier: TrustTier,
	readerTier: TrustTier,
	pagePrivacyTier?: PrivacyTier,
): boolean {
	if (readerTier === "restricted") return false
	if (readerTier === "admin") return true
	if (writerTier === "restricted") return false
	if (writerTier === "standard") {
		return pagePrivacyTier === "public" || pagePrivacyTier === "internal"
	}
	return true
}

// ---------------------------------------------------------------------------
// Governance-enforced read operations
// ---------------------------------------------------------------------------

export async function getWikiPageGoverned(
	handle: WikiDbHandle,
	slug: string,
	ctx: GovernanceContext,
	opts: { crossScope?: boolean } = {},
): Promise<Document | null> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const filter = buildGovernanceFilter(ctx, opts)
	return coll.findOne({ $and: [{ slug }, filter] })
}

export async function getWikiPageByIdGoverned(
	handle: WikiDbHandle,
	id: string,
	ctx: GovernanceContext,
	opts: { crossScope?: boolean } = {},
): Promise<Document | null> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const filter = buildGovernanceFilter(ctx, opts)
	return coll.findOne({
		$and: [{ _id: id as unknown as Document }, filter],
	})
}

export async function graphTraversalGoverned(
	handle: WikiDbHandle,
	startSlug: string,
	ctx: GovernanceContext,
	opts: { maxDepth?: number; crossScope?: boolean } = {},
): Promise<Document[]> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const maxDepth = opts.maxDepth ?? 2
	const govFilter = buildGovernanceFilter(ctx, { crossScope: opts.crossScope })

	const visited = new Set<string>()
	const result: Document[] = []
	const queue: Array<{ slug: string; depth: number }> = [
		{ slug: startSlug, depth: 0 },
	]
	while (queue.length > 0 && result.length < 100) {
		const { slug, depth } = queue.shift()!
		if (visited.has(slug) || depth > maxDepth) continue
		visited.add(slug)
		const page = await coll.findOne({ $and: [{ slug }, govFilter] })
		if (!page) continue
		result.push(page)
		if (depth < maxDepth && Array.isArray(page.relationships)) {
			for (const rel of page.relationships as Array<{
				targetPageSlug?: string
			}>) {
				if (rel.targetPageSlug && !visited.has(rel.targetPageSlug)) {
					queue.push({ slug: rel.targetPageSlug, depth: depth + 1 })
				}
			}
		}
	}
	return result
}

/** Filters an array of pages through governance (for OKF export + search). */
export function filterPagesByGovernance(
	pages: Document[],
	ctx: GovernanceContext,
	opts: { crossScope?: boolean } = {},
): Document[] {
	// Admin with crossScope override sees everything.
	if (ctx.trustTier === "admin" && opts.crossScope) return pages
	return pages.filter((page) => {
		const scope = page.scope as string
		const scopeRef = page.scopeRef as string
		if (scope !== ctx.scope || scopeRef !== ctx.scopeRef) return false
		const perms = page.permissions as
			| {
					allowedRoles?: string[]
					allowedDepartments?: string[]
					privacyTier?: PrivacyTier
			  }
			| undefined
		if (!perms || Object.keys(perms).length === 0) return true
		if (!perms.privacyTier) return true
		if (perms.privacyTier === "public" || perms.privacyTier === "internal") {
			return true
		}
		if (
			perms.allowedRoles &&
			ctx.roles &&
			perms.allowedRoles.some((r) => ctx.roles!.includes(r))
		) {
			return true
		}
		if (
			perms.allowedDepartments &&
			ctx.departments &&
			perms.allowedDepartments.some((d) => ctx.departments!.includes(d))
		) {
			return true
		}
		return false
	})
}

// ---------------------------------------------------------------------------
// Supersession audit trail
// ---------------------------------------------------------------------------

export async function countSupersededClaims(
	handle: WikiDbHandle,
	scope: string,
	scopeRef: string,
): Promise<number> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const result = (await coll
		.aggregate([
			{ $match: { scope, scopeRef } },
			{ $unwind: "$claims" },
			{ $match: { "claims.status": "superseded" } },
			{ $count: "superseded" },
		])
		.toArray()) as Array<{ superseded: number }>
	return result[0]?.superseded ?? 0
}
