// @mdbrain/wiki-engine — wiki CRUD bridge.
//
// Wiki page create/read/list/update/delete over MongoDB, plus page rendering
// (markdown for agents, HTML for humans). WikiStore supplies the MongoDB
// handle and owns connection, schema, and transaction lifecycle.
//
// T3 (this commit): CRUD + rendering. Later tickets add OKF interchange,
// maintenance, contradictions, governance, connectors.

import type { ClientSession, Db, MongoClient, OptionalId } from "mongodb"
import {
	wikiPagesCollection,
	type WIKI_PAGE_KIND_VALUES,
	type WIKI_SCOPE_VALUES,
	type WIKI_TRUST_TIER_VALUES,
	type WIKI_PAGE_STATE_VALUES,
} from "./wiki-schema.js"
import { renderWikiPageMarkdown, renderWikiPageHtml } from "./wiki-renderer.js"
import { recomputeBacklinksAfterChange } from "./wiki-backlinks.js"
import {
	runWritePipelineGate,
	type ClaimRecord,
} from "./wiki-contradictions.js"
import {
	buildGovernanceFilter,
	type GovernanceContext,
} from "./wiki-governance.js"
import {
	recordWikiPageRevision,
	type WikiPageEditor,
} from "./wiki-revisions.js"
import { extractTransclusionTargets } from "./wiki-transclusion.js"
import { omitUndefined } from "./omit-undefined.js"

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
		// Migration provenance: "structured_mem:<id>" or "procedures:<id>".
		migratedFrom?: string
		// Maintenance provenance: content hash for git-diff change detection.
		maintenanceHash?: string
		// OKF v0.2 provenance/trust vocabulary (spec §5, §7) — preserved
		// losslessly on round-trip, not currently mapped into trustTier.
		status?: "draft" | "stable" | "deprecated"
		generated?: { by: string; at?: string }
		verified?: Array<{ by: string; at?: string }>
		stale_after?: string
		sources?: Array<{
			resource: string
			id?: string
			title?: string
			author?: string
			usage_count?: number
			last_modified?: string
			usage_window?: { from: string; to: string }
		}>
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
		allowedSubjects?: string[]
		allowedGroups?: string[]
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
	// Migration provenance: the structured_mem _id this claim was migrated from.
	sourceMemId?: string
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
	transcludes: string[]
	embedding?: number[]
	// Auto-embed text field: title + summary + body (for Atlas Voyage AI)
	text?: string
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
	transcludes: string[]
	createdAt: string
	updatedAt: string
}

// ---------------------------------------------------------------------------
// Db accessor owned by WikiStore.
// ---------------------------------------------------------------------------

export interface WikiDbHandle {
	db: Db
	prefix: string
	// Optional for bare test handles. Production WikiStore handles include it.
	client?: MongoClient
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function toView(doc: Record<string, unknown>): WikiPageView {
	const { _id, embedding, text, ...rest } = doc as Record<string, unknown> & {
		_id: { toString(): string }
	}
	void embedding // omitted from the view
	void text // internal auto-embed field, not exposed via API
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
		claims: (input.claims ?? []).map((c) => {
			const claim: Record<string, unknown> = {
				id: c.id,
				text: c.text,
				status: c.status ?? "active",
				confidence: c.confidence ?? 0,
				evidence: c.evidence ?? [],
				derivedFrom: c.derivedFrom ?? [],
				validFrom: c.validFrom ?? now,
				updatedAt: now,
			}
			if (c.writerAgent) claim.writerAgent = c.writerAgent
			if (c.supersedesClaimId) claim.supersedesClaimId = c.supersedesClaimId
			if (c.sourceMemId) claim.sourceMemId = c.sourceMemId
			if (c.validTo) claim.validTo = c.validTo
			return claim
		}) as Required<WikiClaimInput>[],
		contradictions: [],
		questions: (input.questions ?? []).map((q) => {
			const question: Record<string, unknown> = {
				id: q.id,
				text: q.text,
				status: q.status ?? "open",
				createdAt: now,
			}
			if (q.answeredByClaimId) question.answeredByClaimId = q.answeredByClaimId
			return question
		}) as Required<WikiQuestionInput>[],
		relationships: (input.relationships ?? []).map((r) => {
			const rel: Record<string, unknown> = {
				targetPageSlug: r.targetPageSlug,
				targetTitle: r.targetTitle,
				kind: r.kind,
				weight: r.weight ?? 0,
				confidence: r.confidence ?? 0,
			}
			if (r.evidenceKind) rel.evidenceKind = r.evidenceKind
			if (r.privacyTier) rel.privacyTier = r.privacyTier
			return rel
		}) as Required<WikiRelationshipInput>[],
		personCard: input.personCard ?? null,
		scope: input.scope,
		scopeRef: input.scopeRef,
		trustTier: input.trustTier,
		permissions: input.permissions ?? {},
		provenance: {},
		sourceEventIds: [],
		sourceReliability: 0,
		state: "active",
		revision: 1,
		validFrom: now,
		freshness: "fresh",
		backlinks: [],
		transcludes: extractTransclusionTargets(input.body),
		// Auto-embed text field: MongoDB Atlas generates embeddings via Voyage
		// AI from this field.
		text: `${input.title} ${input.summary} ${input.body}`,
		createdAt: now,
		updatedAt: now,
		// Optional fields — only set when they have values (avoids MongoDB
		// $jsonSchema validation failures on undefined fields).
		...(input.entityId ? { entityId: input.entityId } : {}),
		...(input.okfConceptId ? { okfConceptId: input.okfConceptId } : {}),
		...(input.okfBundleId ? { okfBundleId: input.okfBundleId } : {}),
		...(input.sourceAgent ? { sourceAgent: input.sourceAgent } : {}),
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
	opts: {
		embed?: WikiEmbedFn
		session?: ClientSession
		/** The actual calling principal; recorded on the revision instead of
		 *  the payload-supplied sourceAgent when present. */
		editor?: WikiPageEditor
	} = {},
): Promise<WikiPageView> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const doc = omitUndefined(normalizeInput(input))
	if (opts.embed) {
		const text = `${input.summary}\n${input.body}`
		doc.embedding = await opts.embed(text)
	}
	try {
		const result = await coll.insertOne(
			doc as Record<string, unknown>,
			opts.session ? { session: opts.session } : undefined,
		)
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
				session: opts.session,
			},
		)
		// Run contradiction detection for each claim (BEFORE dedup — for a new
		// page there are no existing claims so dedup always passes, but
		// cross-page contradictions are still detected).
		if (Array.isArray(doc.claims)) {
			for (const claim of doc.claims as ClaimRecord[]) {
				await runWritePipelineGate(
					handle,
					input.slug,
					{
						id: claim.id,
						text: claim.text,
						status: claim.status,
						confidence: claim.confidence,
					},
					[], // no existing claims on a new page
					input.scope,
					input.scopeRef,
					opts.session,
				)
			}
		}
		await recordWikiPageRevision(
			handle,
			{
				pageSlug: input.slug,
				scope: input.scope,
				scopeRef: input.scopeRef,
				revision: 1,
				editKind: "create",
				editor: opts.editor ?? input.sourceAgent,
				snapshot: inserted,
			},
			{
				session: opts.session,
				strict: Boolean(opts.session),
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
	governance?: GovernanceContext,
	session?: ClientSession,
): Promise<WikiPageView | undefined> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const baseFilter: Record<string, unknown> = { slug, scope, scopeRef }
	if (governance) {
		const govFilter = buildGovernanceFilter(governance)
		// Merge: the $and from governance + the equality fields coexist as an
		// implicit top-level $and in MongoDB.
		const merged: Record<string, unknown> = { ...baseFilter }
		if (Array.isArray((govFilter as Record<string, unknown>).$and)) {
			merged.$and = (govFilter as Record<string, unknown>).$and
		}
		const doc = (await coll.findOne(
			merged,
			session ? { session } : undefined,
		)) as unknown as Record<string, unknown> | null
		if (!doc) return undefined
		return toView(doc)
	}
	const doc = (await coll.findOne(
		baseFilter,
		session ? { session } : undefined,
	)) as unknown as Record<string, unknown> | null
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
		governance?: GovernanceContext
	} = {},
): Promise<{ pages: WikiPageView[]; total: number }> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const filter: Record<string, unknown> = {}
	if (opts.kind) filter.kind = opts.kind
	if (opts.scope) filter.scope = opts.scope
	if (opts.scopeRef) filter.scopeRef = opts.scopeRef
	if (opts.trustTier) filter.trustTier = opts.trustTier
	// Default: exclude superseded pages unless the caller explicitly requests them.
	// Prevents soft-deleted pages from appearing in normal listings.
	if (opts.state === "all") {
		// Explicit "all states" — no state filter (for OKF export / archive)
	} else if (opts.state) {
		filter.state = opts.state
	} else {
		// Default: exclude superseded pages (soft-delete safety)
		filter.state = { $ne: "superseded" }
	}
	if (opts.governance) {
		const govFilter = buildGovernanceFilter(opts.governance)
		if (Array.isArray((govFilter as Record<string, unknown>).$and)) {
			filter.$and = (govFilter as Record<string, unknown>).$and
		}
	}
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

/** Merges new claims into existing claims BY CLAIM ID: a new claim whose id
 *  already exists replaces the existing entry in place (preserving the
 *  original position); novel ids are appended. Guarantees the resulting
 *  array contains no duplicate claim ids, regardless of what a caller
 *  submits. */
function upsertClaimsById(
	existing: Record<string, unknown>[],
	incoming: Record<string, unknown>[],
): Record<string, unknown>[] {
	const merged = [...existing]
	for (const claim of incoming) {
		const index = merged.findIndex((m) => m.id === claim.id)
		if (index >= 0) merged[index] = claim
		else merged.push(claim)
	}
	return merged
}

/** Updates a wiki page by slug within a scope. Bumps revision + updatedAt.
 *  Returns the updated view, or undefined if not found.
 *
 *  Concurrency: the update is a compare-and-swap on the page's revision —
 *  the filter includes the revision observed when this update was built, so
 *  a concurrent writer landing in between causes a WikiRevisionConflictError
 *  (stale-read RMW eliminated: the merged claims/relationships/text are
 *  applied against a known revision or not at all).
 *
 *  Claims: patch claims are merged into the existing claims by claim id —
 *  a patch claim whose id already exists REPLACES that claim (upsert-by-id),
 *  so no write can accumulate duplicate claim ids on a page. */
export async function updateWikiPage(
	handle: WikiDbHandle,
	slug: string,
	scope: string,
	scopeRef: string,
	patch: Partial<Omit<WikiPageInput, "slug" | "scope" | "scopeRef">>,
	opts: { session?: ClientSession; editor?: WikiPageEditor } = {},
): Promise<WikiPageView | undefined> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const now = new Date()
	const setFields: Record<string, unknown> = { updatedAt: now }
	if (patch.title !== undefined) setFields.title = patch.title
	if (patch.aliases !== undefined) setFields.aliases = patch.aliases
	if (patch.summary !== undefined) setFields.summary = patch.summary
	if (patch.body !== undefined) {
		setFields.body = patch.body
		setFields.transcludes = extractTransclusionTargets(patch.body)
	}
	if (patch.frontmatter !== undefined) setFields.frontmatter = patch.frontmatter
	if (patch.entityId !== undefined) setFields.entityId = patch.entityId
	if (patch.okfConceptId !== undefined)
		setFields.okfConceptId = patch.okfConceptId
	if (patch.okfBundleId !== undefined) setFields.okfBundleId = patch.okfBundleId
	if (patch.trustTier !== undefined) setFields.trustTier = patch.trustTier
	if (patch.permissions !== undefined) setFields.permissions = patch.permissions
	if (patch.personCard !== undefined) setFields.personCard = patch.personCard
	// Claims AND questions are processed below (after fetching the old page):
	// claims need the existing-claims merge, questions need existing-question
	// preservation (status/createdAt survive a patch that re-submits the
	// array without them).
	if (patch.relationships !== undefined) {
		// Normalize like the create path: default weight/confidence and omit
		// optional string/enum fields when absent — undefined values serialize
		// to BSON null and fail the $jsonSchema validator (same class as C2-15).
		setFields.relationships = (patch.relationships ?? []).map((r) => {
			const rel: Record<string, unknown> = {
				targetPageSlug: r.targetPageSlug,
				targetTitle: r.targetTitle,
				kind: r.kind,
				weight: r.weight ?? 0,
				confidence: r.confidence ?? 0,
			}
			if (r.evidenceKind) rel.evidenceKind = r.evidenceKind
			if (r.privacyTier) rel.privacyTier = r.privacyTier
			return rel
		})
	}

	// Single read of the old page, used for (a) auto-embed text merge,
	// (b) removed-relationship-target detection, (c) the existing-claims
	// merge below, and (d) the compare-and-swap revision predicate.
	const oldPage = (await coll.findOne(
		{ slug, scope, scopeRef },
		opts.session ? { session: opts.session } : undefined,
	)) as {
		title?: string
		summary?: string
		body?: string
		revision?: number
		relationships?: Array<{ targetPageSlug: string }>
		claims?: WikiClaimInput[]
		questions?: Array<{
			id: string
			status?: string
			createdAt?: Date
			answeredByClaimId?: string
		}>
	} | null

	// Recompute the auto-embed text field when title/summary/body changes.
	// Uses merged old + new values so partial patches still produce correct text.
	if (
		patch.title !== undefined ||
		patch.summary !== undefined ||
		patch.body !== undefined
	) {
		const mergedTitle = patch.title ?? oldPage?.title ?? ""
		const mergedSummary = patch.summary ?? oldPage?.summary ?? ""
		const mergedBody = patch.body ?? oldPage?.body ?? ""
		setFields.text = `${mergedTitle} ${mergedSummary} ${mergedBody}`
	}

	const oldTargets = oldPage?.relationships?.map((r) => r.targetPageSlug) ?? []

	if (patch.questions !== undefined) {
		// WS-5 item 4: a questions patch is merged against the page's
		// EXISTING questions by id. Callers re-submitting the array they read
		// (read-modify-write) cannot clobber an existing question's status or
		// createdAt by omitting them, and answeredByClaimId is written only
		// when truthy — never undefined→BSON null (C2-15). Novel questions
		// get the create-path defaults (status "open", createdAt now).
		const existingQuestions = new Map(
			(oldPage?.questions ?? []).map((q) => [q.id, q]),
		)
		setFields.questions = (patch.questions ?? []).map((q) => {
			const existing = existingQuestions.get(q.id)
			const question: Record<string, unknown> = {
				id: q.id,
				text: q.text,
				status: q.status ?? existing?.status ?? "open",
				createdAt: existing?.createdAt ?? now,
			}
			const answeredBy = q.answeredByClaimId ?? existing?.answeredByClaimId
			if (answeredBy) question.answeredByClaimId = answeredBy
			return question
		})
	}

	// Process claims through the write pipeline gate: contradiction detection
	// FIRST (cross-page), then dedup (same-page near-duplicate). Claims rejected
	// by dedup are filtered out — but contradictions are still recorded.
	// CRITICAL: the final claims array = existing claims + accepted new claims
	// (NOT just the accepted new claims — that would drop all existing claims).
	if (patch.claims !== undefined) {
		if (patch.claims.length === 0) {
			// Clear all claims (empty array = clear).
			setFields.claims = []
		} else {
			const existingClaims = oldPage?.claims ?? []
			const existingClaimRecords: ClaimRecord[] = existingClaims.map((c) => ({
				id: c.id,
				text: c.text,
				status: c.status,
				confidence: c.confidence,
			}))
			const acceptedNewClaims = [] as typeof patch.claims
			for (const newClaim of patch.claims) {
				const gate = await runWritePipelineGate(
					handle,
					slug,
					{
						id: newClaim.id,
						text: newClaim.text,
						status: newClaim.status,
						confidence: newClaim.confidence,
					},
					existingClaimRecords,
					scope,
					scopeRef,
					opts.session,
				)
				if (!gate.rejected) {
					acceptedNewClaims.push(newClaim)
				}
			}
			const newClaimsNormalized = acceptedNewClaims.map((c) => ({
				id: c.id,
				text: c.text,
				status: c.status ?? "active",
				confidence: c.confidence ?? 0,
				evidence: c.evidence ?? [],
				derivedFrom: c.derivedFrom ?? [],
				validFrom: c.validFrom ?? now,
				updatedAt: now,
				...(c.writerAgent ? { writerAgent: c.writerAgent } : {}),
				...(c.supersedesClaimId
					? { supersedesClaimId: c.supersedesClaimId }
					: {}),
				...(c.sourceMemId ? { sourceMemId: c.sourceMemId } : {}),
				...(c.validTo ? { validTo: c.validTo } : {}),
			}))
			// Final claims = existing claims with patch claims upserted BY ID:
			// a patch claim whose id matches an existing claim replaces it in
			// place; novel ids are appended. The page can never accumulate two
			// claims with the same id.
			setFields.claims = upsertClaimsById(
				existingClaims as unknown as Record<string, unknown>[],
				newClaimsNormalized as unknown as Record<string, unknown>[],
			) as unknown as typeof setFields.claims
		}
	}

	// Compare-and-swap: the update filter pins the revision observed in
	// oldPage. If a concurrent writer changed the page in between, the filter
	// matches nothing and we surface a conflict instead of silently writing
	// a stale merge (stale-read RMW).
	const updateFilter: Record<string, unknown> = { slug, scope, scopeRef }
	if (oldPage !== null) {
		updateFilter.revision = Number(oldPage.revision ?? 1)
	}
	const result = await coll.findOneAndUpdate(
		updateFilter,
		{ $set: omitUndefined(setFields), $inc: { revision: 1 } },
		{ returnDocument: "after", session: opts.session },
	)
	const value = result ?? null
	if (!value) {
		// Distinguish "page gone" (not found) from "revision moved" (conflict).
		if (oldPage !== null) {
			const stillExists = await coll.findOne(
				{ slug, scope, scopeRef },
				opts.session
					? {
							session: opts.session,
							projection: { _id: 1 },
						}
					: { projection: { _id: 1 } },
			)
			if (stillExists) {
				throw new WikiRevisionConflictError(
					slug,
					scope,
					scopeRef,
					Number(oldPage.revision ?? 1),
				)
			}
		}
		return undefined
	}
	// Recompute backlinks for gained/lost relationship targets.
	const newTargets = (patch.relationships ?? []).map((r) => r.targetPageSlug)
	await recomputeBacklinksAfterChange(handle, slug, scope, scopeRef, {
		oldRelationshipTargets: oldTargets,
		newRelationshipTargets: newTargets,
		session: opts.session,
	})
	const valueRecord = value as unknown as Record<string, unknown>
	await recordWikiPageRevision(
		handle,
		{
			pageSlug: slug,
			scope,
			scopeRef,
			revision: valueRecord.revision as number,
			editKind: "update",
			// The revision records the ACTUAL calling principal when the
			// caller supplies one (routes always do); sourceAgent — the
			// payload-supplied agent string — is only a fallback for
			// engine-internal callers (OKF import, maintenance).
			editor:
				opts.editor ?? (valueRecord.sourceAgent as WikiPageEditor | undefined),
			snapshot: valueRecord,
		},
		{
			session: opts.session,
			strict: Boolean(opts.session),
		},
	)
	return toView(valueRecord)
}

/** Deletes a wiki page (hard delete) OR marks state=superseded (soft).
 *  Default is soft (preserves audit trail per arXiv:2606.24535 temporal
 *  supersession). Pass { hard: true } for a real delete.
 *  Returns true if a page was matched, false otherwise.
 *
 *  Hard-delete snapshot consistency: the snapshot and the delete are ONE
 *  atomic operation (findOneAndDelete) — the recorded revision is exactly
 *  the document that was removed, never a read that raced a concurrent
 *  write between snapshot and delete. */
export async function deleteWikiPage(
	handle: WikiDbHandle,
	slug: string,
	scope: string,
	scopeRef: string,
	opts: {
		hard?: boolean
		session?: ClientSession
		/** The actual calling principal; recorded on the delete revision. */
		editor?: WikiPageEditor
	} = {},
): Promise<boolean> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	let deleted = false
	if (opts.hard) {
		const beforeDelete = (await coll.findOneAndDelete(
			{ slug, scope, scopeRef },
			{ session: opts.session },
		)) as Record<string, unknown> | null
		deleted = beforeDelete !== null
		if (deleted && beforeDelete) {
			await recordWikiPageRevision(
				handle,
				{
					pageSlug: slug,
					scope,
					scopeRef,
					revision: Number(beforeDelete.revision ?? 0) + 1,
					editKind: "delete",
					editor: opts.editor,
					snapshot: beforeDelete,
				},
				{
					session: opts.session,
					strict: Boolean(opts.session),
				},
			)
		}
	} else {
		const now = new Date()
		const result = await coll.findOneAndUpdate(
			{ slug, scope, scopeRef, state: { $ne: "superseded" } },
			{
				$set: omitUndefined({
					state: "superseded",
					updatedAt: now,
					validTo: now,
				}),
				$inc: { revision: 1 },
			},
			{ returnDocument: "after", session: opts.session },
		)
		const value = result ?? null
		deleted = value !== null
		if (value) {
			const valueRecord = value as unknown as Record<string, unknown>
			await recordWikiPageRevision(
				handle,
				{
					pageSlug: slug,
					scope,
					scopeRef,
					revision: valueRecord.revision as number,
					editKind: "delete",
					editor:
						opts.editor ??
						(valueRecord.sourceAgent as WikiPageEditor | undefined),
					snapshot: valueRecord,
				},
				{
					session: opts.session,
					strict: Boolean(opts.session),
				},
			)
		}
	}
	if (deleted) {
		// Recompute backlinks: pages that referenced this slug lose a backlink.
		await recomputeBacklinksAfterChange(handle, slug, scope, scopeRef, {
			deleted: true,
			session: opts.session,
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

/** Thrown when updateWikiPage's compare-and-swap misses: the page's revision
 *  moved between the read that built the patch merge and the write, meaning
 *  a concurrent writer landed first. The caller should re-read and retry
 *  (the HTTP API surfaces this as 409 REVISION_CONFLICT). */
export class WikiRevisionConflictError extends Error {
	constructor(
		readonly slug: string,
		readonly scope: string,
		readonly scopeRef: string,
		readonly expectedRevision: number,
	) {
		super(
			`wiki page "${slug}" in scope ${scope}:${scopeRef} moved past revision ${expectedRevision} — concurrent update, re-read and retry`,
		)
		this.name = "WikiRevisionConflictError"
	}
}
