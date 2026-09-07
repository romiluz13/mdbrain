// @mdbrain/wiki-engine — live MongoDB conformance harness (WS-0).
//
// Runs ONLY against a real MongoDB when MDBRAIN_CONFORMANCE_MONGODB_URI is set
// (e.g. mongodb://localhost:27017 against the docker atlas-local:preview stack
// — see docker/docker-compose.yml). Skipped otherwise, so the normal
// `bun run test` unit suite is unaffected.
//
// Purpose: prove that behavior verified only against mocked collections in the
// colocated unit tests actually holds on a live mongod with the $jsonSchema
// validators installed (validationAction: "error"). Two review findings are
// reproduced here RED — the tests encode the INTENDED contract, which the
// current code violates on live MongoDB:
//
//   - C2-15 (wiki-bridge.ts updateWikiPage): patching `questions` unconditionally
//     includes `answeredByClaimId: q.answeredByClaimId` (undefined when absent).
//     The driver serializes undefined as BSON null, and the questions item
//     schema requires bsonType "string" for that field → "Document failed
//     validation" on every question update. The create path (normalizeInput)
//     already uses conditional assignment — only the update path is broken.
//
//   - NB-1 (wiki-backlinks.ts recomputeBacklinksFor): backlink entries are
//     written with `context: undefined` → BSON null → same validator rejection
//     whenever a page gains an incoming relationship. The create of the
//     REFERENCING page then throws after its own insert, leaving the page
//     written without backlinks or a revision record.
//
//   - C2-9 (wiki-search.ts): search errors were swallowed into `[]` with no
//     degradation signal. INVERTED by WS-6 (retrieval workstream): search
//     failures must throw WikiSearchUnavailableError — fail closed.
//
// MDBRAIN-CH001 / WS-0 exit criteria: C2-15 + NB-1 red here before any fix.
//
// WS-5 (dom-storage write-path integrity) also validates live here:
//   - item 2: same-revision concurrent updates → exactly one CAS winner,
//     the loser gets WikiRevisionConflictError
//   - items 1+3: revision documents (with the editor principal) pass the
//     live wiki_revisions validator
//   - item 5: hard delete is atomic and the delete revision stays readable

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Db, Document } from "mongodb"
import { WikiStore } from "./wiki-store.js"
import {
	createWikiPage,
	deleteWikiPage,
	getWikiPage,
	updateWikiPage,
	WikiDuplicateSlugError,
	WikiRevisionConflictError,
	type WikiDbHandle,
	type WikiPageInput,
} from "./wiki-bridge.js"
import {
	listWikiPageRevisions,
	getWikiPageRevision,
	type WikiPageEditor,
} from "./wiki-revisions.js"
import {
	ensureWikiCollections,
	wikiPagesCollection,
	wikiRevisionsCollection,
} from "./wiki-schema.js"
import {
	probeWikiSearch,
	type WikiSearchCapabilities,
} from "./wiki-search-probe.js"
import { searchWikiPages, WikiSearchUnavailableError } from "./wiki-search.js"

const conformanceUri = process.env.MDBRAIN_CONFORMANCE_MONGODB_URI?.trim()
const describeConformance = conformanceUri ? describe : describe.skip

const SCOPE = "workspace"
const SCOPE_REF = `conformance-${process.pid}-${Date.now()}`
const PREFIX = "conf_"
const DB_NAME = `mdbrain_conformance_${process.pid}_${Date.now()}`

function pageInput(overrides: Partial<WikiPageInput> = {}): WikiPageInput {
	return {
		kind: "concept",
		title: "Conformance Concept",
		slug: "concepts/conformance",
		summary: "A page created by the live conformance harness.",
		body: "# Conformance\n\nLive MongoDB validator checks.",
		frontmatter: { type: "concept" },
		scope: SCOPE,
		scopeRef: SCOPE_REF,
		trustTier: "standard",
		...overrides,
	}
}

describeConformance("live MongoDB conformance", { timeout: 30_000 }, () => {
	let store: WikiStore
	let handle: WikiDbHandle

	beforeAll(async () => {
		store = new WikiStore({
			uri: conformanceUri as string,
			databaseName: DB_NAME,
			collectionPrefix: PREFIX,
		})
		await store.initialize()
		handle = store.handle()
	}, 30_000)

	afterAll(async () => {
		if (store) {
			const db = handle?.db
			if (db) await db.dropDatabase().catch(() => {})
			await store.close()
		}
	}, 30_000)

	it("installs $jsonSchema validators with validationAction error on all wiki collections", async () => {
		const names = [
			"wiki_pages",
			"wiki_revisions",
			"wiki_mutation_intents",
			"memory_delivery_intents",
		].map((n) => `${PREFIX}${n}`)
		const colls = await handle.db
			.listCollections({ name: { $in: names } })
			.toArray()
		const byName = new Map(colls.map((c) => [c.name, c]))
		for (const name of names) {
			const coll = byName.get(name)
			expect(coll, `collection ${name} should exist`).toBeDefined()
			const options = (coll as { options?: Document }).options ?? {}
			// Guards the collMod fail-open finding (C2-8): if ensureWikiSchemaValidation
			// had silently failed, the validator would be absent here.
			expect(options.validator, `${name} should have a validator`).toBeDefined()
			expect(options.validationAction, `${name} should reject on error`).toBe(
				"error",
			)
		}
	})

	it("live mongod rejects documents that violate the validator (harness is not fail-open)", async () => {
		const coll = wikiPagesCollection(handle.db, handle.prefix)
		await expect(
			coll.insertOne({ kind: "entity" } as Document),
		).rejects.toThrow(/Document failed validation/)
	})

	it("duplicate slug in the same scope throws WikiDuplicateSlugError", async () => {
		await createWikiPage(handle, pageInput())
		await expect(createWikiPage(handle, pageInput())).rejects.toThrow(
			WikiDuplicateSlugError,
		)
	})

	// RED reproduction — C2-15. Intended contract: updating questions without
	// answeredByClaimId succeeds (the field is optional in the schema).
	it("updateWikiPage accepts questions without answeredByClaimId (C2-15)", async () => {
		await createWikiPage(handle, pageInput({ slug: "concepts/c2-15" }))
		const updated = await updateWikiPage(
			handle,
			"concepts/c2-15",
			SCOPE,
			SCOPE_REF,
			{
				questions: [{ id: "q1", text: "What is the live validator behavior?" }],
			},
		)
		expect(updated?.questions).toEqual([
			expect.objectContaining({ id: "q1", status: "open" }),
		])
	})

	// RED reproduction — C2-15 defect class. The update path must normalize
	// relationships like the create path: optional fields (weight, confidence,
	// evidenceKind, privacyTier) omitted when absent, defaults applied.
	it("updateWikiPage accepts relationships without optional fields (C2-15 class)", async () => {
		await createWikiPage(handle, pageInput({ slug: "concepts/c2-15b" }))
		await createWikiPage(handle, pageInput({ slug: "concepts/c2-15b-target" }))
		const updated = await updateWikiPage(
			handle,
			"concepts/c2-15b",
			SCOPE,
			SCOPE_REF,
			{
				relationships: [
					{
						targetPageSlug: "concepts/c2-15b-target",
						targetTitle: "Conformance Concept",
						kind: "relates_to",
					},
				],
			},
		)
		expect(updated?.relationships).toEqual([
			expect.objectContaining({
				targetPageSlug: "concepts/c2-15b-target",
				kind: "relates_to",
				weight: 0,
			}),
		])
		// The target gained a clean backlink from the update path (also
		// exercises NB-1: the backlink write must omit context, not null it).
		const target = await getWikiPage(
			handle,
			"concepts/c2-15b-target",
			SCOPE,
			SCOPE_REF,
		)
		expect(target?.backlinks).toEqual([
			expect.objectContaining({
				sourcePageSlug: "concepts/c2-15b",
				sourceTitle: "Conformance Concept",
			}),
		])
	})

	// RED reproduction — NB-1. Intended contract: creating a page with
	// relationships succeeds and the target gains a clean backlink entry.
	it("creating a page with relationships writes clean backlinks to the target (NB-1)", async () => {
		await createWikiPage(handle, pageInput({ slug: "concepts/nb-1-target" }))
		await expect(
			createWikiPage(
				handle,
				pageInput({
					slug: "concepts/nb-1-source",
					title: "NB-1 Source",
					relationships: [
						{
							targetPageSlug: "concepts/nb-1-target",
							targetTitle: "Conformance Concept",
							kind: "relates_to",
						},
					],
				}),
			),
		).resolves.toBeDefined()
		const target = await getWikiPage(
			handle,
			"concepts/nb-1-target",
			SCOPE,
			SCOPE_REF,
		)
		const backlinks = (target?.backlinks ?? []) as Array<{
			sourcePageSlug: string
			context?: unknown
		}>
		expect(backlinks).toHaveLength(1)
		expect(backlinks[0]?.sourcePageSlug).toBe("concepts/nb-1-source")
		// The backlink entry must not carry a null/undefined context (validator:
		// context is optional, but must be a string when present).
		expect(backlinks[0]?.context == null).toBe(true)
	})

	// WS-6 inversion of C2-9. PREVIOUS (fail-open) behavior: search over a
	// collection with no search index returned silent emptiness with no
	// degradation signal anywhere. Verified live on atlas-local:preview, the
	// server itself returns [] for a $search against a missing index (real
	// Atlas errors with index-not-found — preview-build leniency), so the
	// engine cannot distinguish misconfiguration from no-matches at query
	// time on this stack. The outage signal therefore lives in the readiness
	// probe: it verifies the index EXISTS and that search management is
	// reachable, so a misconfigured or mongot-less deployment fails /ready
	// instead of silently serving empty searches.
	it("a missing search index fails the readiness probe (C2-9, WS-6 inversion)", async () => {
		// Second prefix: collections + validators, but NO search indexes.
		const barePrefix = "confnosearch_"
		const db = handle.client?.db(DB_NAME)
		expect(db, "store handle should expose the client").toBeDefined()
		await ensureWikiCollections(db as never, barePrefix)
		const bareHandle: WikiDbHandle = { db: db as never, prefix: barePrefix }
		await createWikiPage(bareHandle, pageInput({ slug: "concepts/c2-9" }))

		// Probe: index missing → WikiSearchUnavailableError → /ready 503.
		await expect(probeWikiSearch(bareHandle)).rejects.toBeInstanceOf(
			WikiSearchUnavailableError,
		)
		// Query path on the preview stack: the server answers [] itself for a
		// missing index (documented divergence from Atlas, where this throws
		// and searchWikiPages propagates WikiSearchUnavailableError — covered
		// by the unit tests).
		const response = await searchWikiPages(bareHandle, {
			query: "live validator behavior",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(response.results).toEqual([])
	})

	// WS-6: the probe passes against an indexed collection with mongot up —
	// full round-trip (index management + $search) on live mongot. Retries
	// briefly: search index creation is async on mongot, and a probe fired
	// milliseconds after createSearchIndex can observe the index list before
	// registration lands (observed as a transient flake after container
	// restart).
	it("probeWikiSearch resolves against an indexed collection (WS-6)", async () => {
		// The main conformance prefix had its search indexes created by
		// ensureWikiSchema during store.initialize().
		let caps: WikiSearchCapabilities | undefined
		for (let attempt = 0; attempt < 10; attempt++) {
			try {
				caps = await probeWikiSearch(handle)
				break
			} catch (err) {
				if (attempt === 9) throw err
				await new Promise((r) => setTimeout(r, 500))
			}
		}
		// The text lane is fail-closed: resolving at all means it is ready.
		expect(caps?.text).toBe("ready")
		// The vector/auto-embed lane depends on the cluster's model key:
		// keyed → "ready"; keyless (no VOYAGE_API_KEY on the container) →
		// "unavailable" with an actionable diagnostic (P6). Both are valid
		// conformance outcomes; the probe must never lie "ready".
		if (caps?.vector === "unavailable") {
			expect(caps.autoEmbed).toBe("unavailable")
			expect(caps.detail).toContain("VOYAGE_API_KEY")
		} else {
			expect(caps?.vector).toBe("ready")
			expect(caps?.autoEmbed).toBe("ready")
		}
	})

	// WS-5 item 2 — optimistic concurrency. Two writers that explicitly pin the
	// same observed revision cannot both win, including when withTransaction
	// retries a callback after a transient write conflict.
	it("concurrent same-revision updates: exactly one wins, the loser gets WikiRevisionConflictError (WS-5 item 2)", async () => {
		const slug = "concepts/ws5-cas"
		const created = await createWikiPage(handle, pageInput({ slug }))
		let observedConflict = false
		let expectedRevision = created.revision
		for (let attempt = 0; attempt < 5 && !observedConflict; attempt++) {
			const results = await Promise.allSettled([
				updateWikiPage(
					handle,
					slug,
					SCOPE,
					SCOPE_REF,
					{ summary: `writer A, attempt ${attempt}` },
					{ expectedRevision },
				),
				updateWikiPage(
					handle,
					slug,
					SCOPE,
					SCOPE_REF,
					{ summary: `writer B, attempt ${attempt}` },
					{ expectedRevision },
				),
			])
			for (const r of results) {
				if (r.status === "rejected") {
					expect(r.reason).toBeInstanceOf(WikiRevisionConflictError)
					expect(r.reason.expectedRevision).toBeGreaterThanOrEqual(1)
					observedConflict = true
				}
			}
			const current = await getWikiPage(handle, slug, SCOPE, SCOPE_REF)
			expectedRevision = current?.revision ?? expectedRevision
		}
		expect(observedConflict).toBe(true)
		// The winner's write survived and the revision counter moved past the
		// conflicting one — the page is never lost or double-applied.
		const page = await getWikiPage(handle, slug, SCOPE, SCOPE_REF)
		expect(page?.revision).toBeGreaterThanOrEqual(2)
	})

	// WS-5 items 1 + 3 — revision history records the actual calling
	// principal (editor), and the revision documents pass the live
	// wiki_revisions $jsonSchema validator (no BSON-null optional fields).
	it("revisions record the calling principal as editor and pass the live validator (WS-5 items 1+3)", async () => {
		const slug = "concepts/ws5-editor"
		const editor: WikiPageEditor = {
			id: "user:conformance",
			name: "Conformance Runner",
			runId: "run-42",
		}
		await createWikiPage(handle, pageInput({ slug }), { editor })
		await updateWikiPage(
			handle,
			slug,
			SCOPE,
			SCOPE_REF,
			{ summary: "edited under a named principal" },
			{ editor },
		)
		const revisions = await listWikiPageRevisions(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(revisions.map((r) => r.revision)).toEqual([2, 1])
		for (const r of revisions) {
			// Editor is the authenticated principal — not the payload's
			// sourceAgent ("agent:payload" in pageInput's sourceAgent default).
			expect(r.editor).toEqual(editor)
		}
		// Raw stored document: the live validator (bsonType constraints on
		// every field) accepted it, and the editor subdocument is intact.
		const doc = (await wikiRevisionsCollection(
			handle.db,
			handle.prefix,
		).findOne({ pageSlug: slug, revision: 2 })) as Document | null
		expect(doc).toBeDefined()
		expect(doc?.editor).toMatchObject({
			id: "user:conformance",
			name: "Conformance Runner",
			runId: "run-42",
		})
	})

	// WS-5 item 5 — hard delete is atomic (findOneAndDelete) and the delete
	// revision remains readable after the page itself is gone: history is
	// neither lost nor hidden by the deletion.
	it("hard delete snapshots the final state and the delete revision stays readable (WS-5 item 5)", async () => {
		const slug = "concepts/ws5-harddelete"
		const editor: WikiPageEditor = {
			id: "user:conformance",
			name: "Conformance Runner",
		}
		await createWikiPage(handle, pageInput({ slug }), { editor })
		await updateWikiPage(
			handle,
			slug,
			SCOPE,
			SCOPE_REF,
			{ summary: "final content before hard delete" },
			{ editor },
		)
		await deleteWikiPage(handle, slug, SCOPE, SCOPE_REF, {
			hard: true,
			editor,
		})
		await expect(
			getWikiPage(handle, slug, SCOPE, SCOPE_REF),
		).resolves.toBeUndefined()
		const del = await getWikiPageRevision(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			revision: 3,
		})
		expect(del?.editKind).toBe("delete")
		expect(del?.editor).toEqual(editor)
		// The snapshot is the full final page state captured atomically with
		// the delete — no torn snapshot from a separate read-then-delete.
		expect(del?.snapshot).toMatchObject({
			slug,
			summary: "final content before hard delete",
		})
		const list = await listWikiPageRevisions(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(list.map((r) => r.editKind)).toEqual(["delete", "update", "create"])
	})

	it("continues retained slug history after hard delete with per-snapshot authorization (T9)", async () => {
		const slug = "concepts/t9-recreated"
		await createWikiPage(
			handle,
			pageInput({
				slug,
				permissions: {
					privacyTier: "restricted",
					allowedSubjects: ["user:original"],
				},
			}),
		)
		await deleteWikiPage(handle, slug, SCOPE, SCOPE_REF, { hard: true })

		const recreated = await createWikiPage(
			handle,
			pageInput({
				slug,
				title: "Recreated concept",
				permissions: {
					privacyTier: "restricted",
					allowedSubjects: ["user:new-owner"],
				},
			}),
		)

		expect(recreated.revision).toBe(3)
		const revisions = await listWikiPageRevisions(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(revisions.map((revision) => revision.revision)).toEqual([3, 2, 1])
		const newOwner = {
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			trustTier: "standard" as const,
			subjectId: "user:new-owner",
		}
		await expect(
			getWikiPageRevision(handle, {
				pageSlug: slug,
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				revision: 1,
				governance: newOwner,
			}),
		).resolves.toBeUndefined()
		await expect(
			getWikiPageRevision(handle, {
				pageSlug: slug,
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				revision: 3,
				governance: newOwner,
			}),
		).resolves.toMatchObject({ editKind: "create" })

		const fresh = await createWikiPage(
			handle,
			pageInput({ slug: "concepts/t9-fresh" }),
		)
		expect(fresh.revision).toBe(1)
	})

	it("rolls back contradiction writes when the source-page CAS misses (T6)", async () => {
		const sourceSlug = "concepts/t6-source"
		const targetSlug = "concepts/t6-target"
		await createWikiPage(
			handle,
			pageInput({
				slug: targetSlug,
				claims: [
					{
						id: "claim-target",
						text: "The API uses REST endpoints",
					},
				],
			}),
		)
		await createWikiPage(
			handle,
			pageInput({
				slug: sourceSlug,
				relationships: [
					{
						targetPageSlug: targetSlug,
						targetTitle: "T6 target",
						kind: "relates_to",
					},
				],
			}),
		)

		const pagesName = `${handle.prefix}wiki_pages`
		let contradictionWriteObserved = false
		const injectedDb = new Proxy(handle.db, {
			get(target, property) {
				if (property === "collection") {
					return (name: string, options?: Document) => {
						const collection = target.collection(name, options)
						if (name !== pagesName) return collection
						return new Proxy(collection, {
							get(collectionTarget, collectionProperty) {
								if (collectionProperty === "findOneAndUpdate") {
									return async (
										filter: Document,
										update: Document,
										updateOptions: Document,
									) => {
										if (
											filter.slug === sourceSlug &&
											filter.revision !== undefined
										) {
											return null
										}
										return collectionTarget.findOneAndUpdate(
											filter,
											update,
											updateOptions,
										)
									}
								}
								if (collectionProperty === "updateOne") {
									return async (
										filter: Document,
										update: Document,
										updateOptions: Document,
									) => {
										const result = await collectionTarget.updateOne(
											filter,
											update,
											updateOptions,
										)
										if (
											filter.slug === targetSlug &&
											update.$push?.contradictions
										) {
											contradictionWriteObserved = result.modifiedCount === 1
										}
										return result
									}
								}
								const value = Reflect.get(
									collectionTarget,
									collectionProperty,
									collectionTarget,
								)
								return typeof value === "function"
									? value.bind(collectionTarget)
									: value
							},
						})
					}
				}
				const value = Reflect.get(target, property, target)
				return typeof value === "function" ? value.bind(target) : value
			},
		}) as Db

		await expect(
			updateWikiPage(
				{
					db: injectedDb,
					prefix: handle.prefix,
					client: handle.client,
				},
				sourceSlug,
				SCOPE,
				SCOPE_REF,
				{
					relationships: [],
					claims: [
						{
							id: "claim-source",
							text: "The API does not use REST endpoints",
						},
					],
				},
			),
		).rejects.toBeInstanceOf(WikiRevisionConflictError)

		const source = await getWikiPage(handle, sourceSlug, SCOPE, SCOPE_REF)
		const target = await getWikiPage(handle, targetSlug, SCOPE, SCOPE_REF)
		const sourceRevisions = await listWikiPageRevisions(handle, {
			pageSlug: sourceSlug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(contradictionWriteObserved).toBe(true)
		expect(source?.claims).toEqual([])
		expect(source?.revision).toBe(1)
		expect(source?.relationships).toHaveLength(1)
		expect(target?.contradictions).toEqual([])
		expect(target?.backlinks).toEqual([
			expect.objectContaining({ sourcePageSlug: sourceSlug }),
		])
		expect(sourceRevisions.map((revision) => revision.revision)).toEqual([1])
	})

	it("soft-deleted pages stay inert but remain hard-deletable after a governed administrative read (F1)", async () => {
		const slug = "concepts/f1-delete-lifecycle"
		await createWikiPage(
			handle,
			pageInput({
				slug,
				permissions: {
					privacyTier: "restricted",
					allowedSubjects: ["user:deleter"],
				},
			}),
		)

		await expect(deleteWikiPage(handle, slug, SCOPE, SCOPE_REF)).resolves.toBe(
			true,
		)
		await expect(
			getWikiPage(handle, slug, SCOPE, SCOPE_REF),
		).resolves.toBeUndefined()
		await expect(
			updateWikiPage(handle, slug, SCOPE, SCOPE_REF, {
				summary: "must not restore the tombstone",
			}),
		).resolves.toBeUndefined()
		await expect(deleteWikiPage(handle, slug, SCOPE, SCOPE_REF)).resolves.toBe(
			false,
		)

		const beforeHardDelete = await listWikiPageRevisions(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(beforeHardDelete.map((r) => r.editKind)).toEqual([
			"delete",
			"create",
		])

		const denied = await getWikiPage(
			handle,
			slug,
			SCOPE,
			SCOPE_REF,
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				trustTier: "standard",
				subjectId: "user:other",
			},
			undefined,
			{ includeSuperseded: true },
		)
		expect(denied).toBeUndefined()

		const authorized = await getWikiPage(
			handle,
			slug,
			SCOPE,
			SCOPE_REF,
			{
				scope: SCOPE,
				scopeRef: SCOPE_REF,
				trustTier: "standard",
				subjectId: "user:deleter",
			},
			undefined,
			{ includeSuperseded: true },
		)
		expect(authorized?.state).toBe("superseded")
		await expect(
			deleteWikiPage(handle, slug, SCOPE, SCOPE_REF, { hard: true }),
		).resolves.toBe(true)

		const afterHardDelete = await listWikiPageRevisions(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(afterHardDelete.map((r) => r.editKind)).toEqual([
			"delete",
			"delete",
			"create",
		])
		const hardDeleteRevision = await getWikiPageRevision(handle, {
			pageSlug: slug,
			scope: SCOPE,
			scopeRef: SCOPE_REF,
			revision: 3,
		})
		expect(hardDeleteRevision?.snapshot).toMatchObject({
			slug,
			state: "superseded",
			revision: 2,
		})
	})

	// WS-5 item 4 — question patches merge against the page's existing
	// questions by id: a read-modify-write caller re-submitting the array it
	// read cannot clobber status/createdAt/answeredByClaimId, and the writes
	// pass the live wiki_pages validator throughout.
	it("question patches preserve existing status/createdAt/answeredByClaimId (WS-5 item 4)", async () => {
		const slug = "concepts/ws5-q-preserve"
		await createWikiPage(handle, pageInput({ slug }))
		const coll = wikiPagesCollection(handle.db, handle.prefix)
		const readQuestions = async () =>
			((await coll.findOne({ slug, scope: SCOPE, scopeRef: SCOPE_REF }))
				?.questions ?? []) as Array<{
				id: string
				status?: string
				createdAt?: Date
				answeredByClaimId?: string
			}>
		// Explicit patch values win: answer the question.
		await updateWikiPage(handle, slug, SCOPE, SCOPE_REF, {
			questions: [
				{
					id: "q1",
					text: "Who owns billing?",
					status: "answered",
					answeredByClaimId: "claim-billing",
				},
			],
		})
		const answered = await readQuestions()
		expect(answered[0]?.status).toBe("answered")
		expect(answered[0]?.answeredByClaimId).toBe("claim-billing")
		const answeredAt = answered[0]?.createdAt
		expect(answeredAt).toBeInstanceOf(Date)
		// Read-modify-write: re-submit q1 exactly as a caller that read the
		// page would — no status, no answeredByClaimId. Nothing may reset.
		await updateWikiPage(handle, slug, SCOPE, SCOPE_REF, {
			questions: [{ id: "q1", text: "Who owns billing?" }],
		})
		const afterRmw = await readQuestions()
		expect(afterRmw[0]?.status).toBe("answered")
		expect(afterRmw[0]?.answeredByClaimId).toBe("claim-billing")
		expect(afterRmw[0]?.createdAt).toEqual(answeredAt)
	})
})
