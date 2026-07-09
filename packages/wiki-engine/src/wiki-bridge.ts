// @mdbrian/wiki-engine — wiki CRUD bridge.
//
// Wiki page create/read/list/update/delete over MongoDB, plus page rendering
// (markdown for agents, HTML for humans). Obtains a MongoDB Db + prefix via
// the existing @mdbrian/memory-engine manager (reuses connection + config +
// collection-prefix conventions) — no separate connection management.
//
// T3 (this commit): CRUD + rendering. Later tickets add OKF interchange,
// maintenance, contradictions, governance, connectors.

import type { Db, OptionalId } from "mongodb"
import {
	wikiPagesCollection,
	type WIKI_PAGE_KIND_VALUES,
	type WIKI_SCOPE_VALUES,
	type WIKI_TRUST_TIER_VALUES,
	type WIKI_PAGE_STATE_VALUES,
} from "./wiki-schema.js"
import { renderWikiPageMarkdown, renderWikiPageHtml } from "./wiki-renderer.js"
import { recomputeBacklinksAfterChange } from "./wiki-backlinks.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields a caller supplies when creating a page. The bridge fills in
 *  system fields (revision, state, freshness, timestamps, embedding placeholder). */
export interface WikiPageInput {
	kind: (typeof WIKI_PAGE_KIND_VALUES)[number]
	title: string
	slug: string
	aliases?: string[]
	summary: string
	body: string
	frontmatter: {
		type: string
		title?: string
		description?: string
		resource?: string
		tags?: string[]
		timestamp?: Date
		entityTypes?: string[]
		privacyTier?: "public" | "internal" | "confidential" | "restricted"
	}
	claims?: WikiClaimInput[]
	questions?: WikiQuestionInput[]
	relationships?: WikiRelationshipInput[]
	personCard?: WikiPersonCard | null
	entityId?: string
	okfConceptId?: string
	okfBundleId?: string
	scope: (typeof WIKI_SCOPE_VALUES)[number]
	scopeRef: string
	trustTier: (typeof WIKI_TRUST_TIER_VALUES)[number]
	permissions?: {
		allowedRoles?: string[]
		allowedDepartments?: string[]
		privacyTier?: "public" | "internal" | "confidential" | "restricted"
	}
	sourceAgent?: { id: string; name: string; runId?: string }
}

export interface WikiClaimInput {
	id: string
	text: string
	status?: "active" | "superseded" | "contradicted" | "disputed"
	confidence?: number
	evidence?: Array<{
		kind: "file" | "url" | "event" | "api" | "manual" | "agent"
		sourceId: string
		path?: string
		lines?: string
		weight?: number
		confidence?: number
		privacyTier?: "public" | "internal" | "confidential" | "restricted"
		note?: string
	}>
	writerAgent?: { id: string; name: string; runId?: string }
	derivedFrom?: string[]
	supersedesClaimId?: string
	validFrom?: Date
	validTo?: Date
}

export interface WikiQuestionInput {
	id: string
	text: string
	status?: "open" | "answered"
	answeredByClaimId?: string
}

export interface WikiRelationshipInput {
	targetPageSlug: string
	targetTitle: string
	kind: string
	weight?: number
	confidence?: number
	evidenceKind?: string
	privacyTier?: "public" | "internal" | "confidential" | "restricted"
}

export interface WikiPersonCard {
	canonicalId: string
	handles?: string[]
	socials?: string[]
	emails?: string[]
	timezone?: string
	lane?: string
	askFor?: string[]
	avoidAskingFor?: string[]
	bestUsedFor?: string
	notEnoughFor?: string
}

export interface WikiPage extends WikiPageInput {
	_id?: string
	claims: Required<WikiClaimInput>[]
	questions: Required<WikiQuestionInput>[]
	relationships: Required<WikiRelationshipInput>[]
	personCard: WikiPersonCard | null
	state: (typeof WIKI_PAGE_STATE_VALUES)[number]
	revision: number
	validFrom: Date
	validTo?: Date
	freshness: "fresh" | "stale" | "unknown"
	lastMaintainedAt?: Date
	lastMaintenanceSource?: "git-diff" | "dreamer" | "manual" | "api"
	maintenanceHash?: string
	backlinks: Array<{
		sourcePageSlug: string
		sourceTitle: string
		context?: string
	}>
	embedding?: number[]
	createdAt: Date
	updatedAt: Date
}

/** Shape returned to API consumers — excludes the raw embedding vector. */
export interface WikiPageView {
	_id: string
	kind: string
	title: string
	slug: string
	aliases: string[]
	summary: string
	body: string
	frontmatter: Record<string, unknown>
	claims: unknown[]
	contradictions: unknown[]
	questions: unknown[]
	relationships: unknown[]
	personCard: unknown
	entityId?: string
	okfConceptId?: string
	okfBundleId?: string
	scope: string
	scopeRef: string
	trustTier: string
	permissions: Record<string, unknown>
	state: string
	revision: number
	validFrom: string
	validTo?: string
	freshness: string
	lastMaintainedAt?: string
	backlinks: unknown[]
	createdAt: string
	updatedAt: string
}

// ---------------------------------------------------------------------------
// Db accessor — obtains a raw Db + collection prefix via the memory engine.
// The manager exposes its db + prefix through a narrow interface so the wiki
// engine never duplicates connection management.
// ---------------------------------------------------------------------------

export interface WikiDbHandle {
	db: Db
	prefix: string
}

/** Extracts a Db + prefix handle from a memory-engine manager. The manager is
 *  expected to expose `db` and `prefix` (MongoDBMemoryManager does). We keep
 *  this loosely typed to avoid importing the concrete manager type. */
export function getWikiDbHandle(manager: unknown): WikiDbHandle {
	const m = manager as {
		db?: Db
		prefix?: string
		getDb?: () => Db
		getPrefix?: () => string
	}
	const db = m.db ?? (m.getDb?.() as Db | undefined)
	const prefix = m.prefix ?? (m.getPrefix?.() as string | undefined)
	if (!db || prefix === undefined) {
		throw new Error("wiki bridge: manager does not expose db + prefix")
	}
	return { db, prefix }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function toView(doc: Record<string, unknown>): WikiPageView {
	const { _id, embedding, ...rest } = doc as Record<string, unknown> & {
		_id: { toString(): string }
	}
	void embedding // omitted from the view
	const out: Record<string, unknown> = { _id: _id.toString(), ...rest }
	for (const dateField of [
		"validFrom",
		"validTo",
		"lastMaintainedAt",
		"createdAt",
		"updatedAt",
	]) {
		if (out[dateField] instanceof Date) {
			out[dateField] = (out[dateField] as Date).toISOString()
		}
	}
	return out as unknown as WikiPageView
}

function normalizeInput(input: WikiPageInput): OptionalId<WikiPage> {
	const now = new Date()
	return {
		kind: input.kind,
		title: input.title,
		slug: input.slug,
		aliases: input.aliases ?? [],
		summary: input.summary,
		body: input.body,
		frontmatter: input.frontmatter,
		claims: (input.claims ?? []).map((c) => ({
			id: c.id,
			text: c.text,
			status: c.status ?? "active",
			confidence: c.confidence ?? 0,
			evidence: c.evidence ?? [],
			writerAgent: c.writerAgent,
			derivedFrom: c.derivedFrom ?? [],
			supersedesClaimId: c.supersedesClaimId,
			validFrom: c.validFrom ?? now,
			validTo: c.validTo,
			updatedAt: now,
		})) as Required<WikiClaimInput>[],
		contradictions: [],
		questions: (input.questions ?? []).map((q) => ({
			id: q.id,
			text: q.text,
			status: q.status ?? "open",
			answeredByClaimId: q.answeredByClaimId,
			createdAt: now,
		})) as Required<WikiQuestionInput>[],
		relationships: (input.relationships ?? []).map((r) => ({
			targetPageSlug: r.targetPageSlug,
			targetTitle: r.targetTitle,
			kind: r.kind,
			weight: r.weight ?? 0,
			confidence: r.confidence ?? 0,
			evidenceKind: r.evidenceKind,
			privacyTier: r.privacyTier,
		})) as Required<WikiRelationshipInput>[],
		personCard: input.personCard ?? null,
		entityId: input.entityId,
		okfConceptId: input.okfConceptId,
		okfBundleId: input.okfBundleId,
		scope: input.scope,
		scopeRef: input.scopeRef,
		trustTier: input.trustTier,
		permissions: input.permissions ?? {},
		provenance: {},
		sourceAgent: input.sourceAgent,
		sourceEventIds: [],
		sourceReliability: 0,
		state: "active",
		supersedes: undefined,
		supersededBy: undefined,
		revision: 1,
		validFrom: now,
		validTo: undefined,
		lastMaintainedAt: undefined,
		lastMaintenanceSource: undefined,
		maintenanceHash: undefined,
		freshness: "fresh",
		backlinks: [],
		embedding: undefined,
		createdAt: now,
		updatedAt: now,
	} as unknown as OptionalId<WikiPage>
}

/** Embedding hook — given page text, returns a vector. When provided to
 *  createWikiPage, the page is indexed for vector search (T2 index). When
 *  absent, embedding is left undefined and the page is only text-searchable
 *  until a maintenance/embedding pass populates it. */
export type WikiEmbedFn = (text: string) => Promise<number[]>

/** Creates a wiki page. Throws on duplicate slug within the same scope.
 *  When `embed` is provided, generates a vector from summary + body so the
 *  page is retrievable via the T2 vector search index (AC1: writes embedding). */
export async function createWikiPage(
	handle: WikiDbHandle,
	input: WikiPageInput,
	opts: { embed?: WikiEmbedFn } = {},
): Promise<WikiPageView> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const doc = normalizeInput(input)
	if (opts.embed) {
		const text = `${input.summary}\n${input.body}`
		doc.embedding = await opts.embed(text)
	}
	try {
		const result = await coll.insertOne(doc as Record<string, unknown>)
		const inserted = {
			...doc,
			_id: result.insertedId.toString(),
		} as unknown as Record<string, unknown>
		// Recompute backlinks for the targets this page now references.
		const newTargets = (input.relationships ?? []).map((r) => r.targetPageSlug)
		await recomputeBacklinksAfterChange(
			handle,
			input.slug,
			input.scope,
			input.scopeRef,
			{
				newRelationshipTargets: newTargets,
			},
		)
		return toView(inserted)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (msg.includes("E11000") || msg.includes("duplicate key")) {
			throw new WikiDuplicateSlugError(input.slug, input.scope, input.scopeRef)
		}
		throw err
	}
}

/** Gets a wiki page by slug within a scope. Returns undefined if not found. */
export async function getWikiPage(
	handle: WikiDbHandle,
	slug: string,
	scope: string,
	scopeRef: string,
): Promise<WikiPageView | undefined> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const doc = (await coll.findOne({
		slug,
		scope,
		scopeRef,
	})) as unknown as Record<string, unknown> | null
	if (!doc) return undefined
	return toView(doc)
}

/** Lists wiki pages with optional filters + pagination. */
export async function listWikiPages(
	handle: WikiDbHandle,
	opts: {
		kind?: string
		scope?: string
		scopeRef?: string
		trustTier?: string
		state?: string
		limit?: number
		skip?: number
	} = {},
): Promise<{ pages: WikiPageView[]; total: number }> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const filter: Record<string, unknown> = {}
	if (opts.kind) filter.kind = opts.kind
	if (opts.scope) filter.scope = opts.scope
	if (opts.scopeRef) filter.scopeRef = opts.scopeRef
	if (opts.trustTier) filter.trustTier = opts.trustTier
	if (opts.state) filter.state = opts.state
	const limit = Math.min(opts.limit ?? 50, 100)
	const skip = opts.skip ?? 0
	const [docs, total] = await Promise.all([
		coll.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
		coll.countDocuments(filter),
	])
	return {
		pages: docs.map((d) => toView(d as unknown as Record<string, unknown>)),
		total,
	}
}

/** Updates a wiki page by slug within a scope. Bumps revision + updatedAt.
 *  Returns the updated view, or undefined if not found. */
export async function updateWikiPage(
	handle: WikiDbHandle,
	slug: string,
	scope: string,
	scopeRef: string,
	patch: Partial<Omit<WikiPageInput, "slug" | "scope" | "scopeRef">>,
): Promise<WikiPageView | undefined> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const now = new Date()
	const setFields: Record<string, unknown> = { updatedAt: now }
	if (patch.title !== undefined) setFields.title = patch.title
	if (patch.aliases !== undefined) setFields.aliases = patch.aliases
	if (patch.summary !== undefined) setFields.summary = patch.summary
	if (patch.body !== undefined) setFields.body = patch.body
	if (patch.frontmatter !== undefined) setFields.frontmatter = patch.frontmatter
	if (patch.entityId !== undefined) setFields.entityId = patch.entityId
	if (patch.okfConceptId !== undefined)
		setFields.okfConceptId = patch.okfConceptId
	if (patch.okfBundleId !== undefined) setFields.okfBundleId = patch.okfBundleId
	if (patch.trustTier !== undefined) setFields.trustTier = patch.trustTier
	if (patch.permissions !== undefined) setFields.permissions = patch.permissions
	if (patch.personCard !== undefined) setFields.personCard = patch.personCard
	if (patch.claims !== undefined) {
		setFields.claims = (patch.claims ?? []).map((c) => ({
			id: c.id,
			text: c.text,
			status: c.status ?? "active",
			confidence: c.confidence ?? 0,
			evidence: c.evidence ?? [],
			writerAgent: c.writerAgent,
			derivedFrom: c.derivedFrom ?? [],
			supersedesClaimId: c.supersedesClaimId,
			validFrom: c.validFrom ?? now,
			validTo: c.validTo,
			updatedAt: now,
		}))
	}
	if (patch.questions !== undefined) {
		// Normalize like the create path: default status + createdAt so the
		// $jsonSchema validator (requires id/text/status/createdAt per question)
		// does not reject the update.
		setFields.questions = (patch.questions ?? []).map((q) => ({
			id: q.id,
			text: q.text,
			status: q.status ?? "open",
			answeredByClaimId: q.answeredByClaimId,
			createdAt: now,
		}))
	}
	if (patch.relationships !== undefined)
		setFields.relationships = patch.relationships

	// Fetch the old page to compute which relationship targets are being removed
	// (so their backlinks can be cleaned).
	const oldPage = (await coll.findOne({ slug, scope, scopeRef })) as {
		relationships?: Array<{ targetPageSlug: string }>
	} | null
	const oldTargets = oldPage?.relationships?.map((r) => r.targetPageSlug) ?? []

	const result = await coll.findOneAndUpdate(
		{ slug, scope, scopeRef },
		{ $set: setFields, $inc: { revision: 1 } },
		{ returnDocument: "after" },
	)
	const value = result?.value ?? null
	if (!value) return undefined
	// Recompute backlinks for gained/lost relationship targets.
	const newTargets = (patch.relationships ?? []).map((r) => r.targetPageSlug)
	await recomputeBacklinksAfterChange(handle, slug, scope, scopeRef, {
		oldRelationshipTargets: oldTargets,
		newRelationshipTargets: newTargets,
	})
	return toView(value as unknown as Record<string, unknown>)
}

/** Deletes a wiki page (hard delete) OR marks state=superseded (soft).
 *  Default is soft (preserves audit trail per arXiv:2606.24535 temporal
 *  supersession). Pass { hard: true } for a real delete.
 *  Returns true if a page was matched, false otherwise. */
export async function deleteWikiPage(
	handle: WikiDbHandle,
	slug: string,
	scope: string,
	scopeRef: string,
	opts: { hard?: boolean } = {},
): Promise<boolean> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	let deleted = false
	if (opts.hard) {
		const result = await coll.deleteOne({ slug, scope, scopeRef })
		deleted = result.deletedCount > 0
	} else {
		const now = new Date()
		const result = await coll.updateOne(
			{ slug, scope, scopeRef, state: { $ne: "superseded" } },
			{ $set: { state: "superseded", updatedAt: now, validTo: now } },
		)
		deleted = result.matchedCount > 0
	}
	if (deleted) {
		// Recompute backlinks: pages that referenced this slug lose a backlink.
		await recomputeBacklinksAfterChange(handle, slug, scope, scopeRef, {
			deleted: true,
		})
	}
	return deleted
}
// ---------------------------------------------------------------------------

/** Returns the page rendered as markdown (agent-readable). */
export function renderMarkdown(view: WikiPageView): string {
	return renderWikiPageMarkdown(view)
}

/** Returns the page rendered as HTML (human-browsable). */
export function renderHtml(view: WikiPageView): string {
	return renderWikiPageHtml(view)
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WikiDuplicateSlugError extends Error {
	constructor(
		readonly slug: string,
		readonly scope: string,
		readonly scopeRef: string,
	) {
		super(
			`wiki page slug "${slug}" already exists in scope ${scope}:${scopeRef}`,
		)
		this.name = "WikiDuplicateSlugError"
	}
}

export class WikiNotFoundError extends Error {
	constructor(
		readonly slug: string,
		readonly scope: string,
		readonly scopeRef: string,
	) {
		super(`wiki page "${slug}" not found in scope ${scope}:${scopeRef}`)
		this.name = "WikiNotFoundError"
	}
}
