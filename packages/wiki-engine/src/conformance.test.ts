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
//   - C2-9 (wiki-search.ts, characterization): search errors are swallowed into
//     `[]` with no degradation signal. This test currently asserts the
//     observable (fail-open) behavior and will be INVERTED by the retrieval
//     workstream to require visible degradation.
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
import type { Document } from "mongodb"
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
import { searchWikiPages } from "./wiki-search.js"

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

	// Characterization — C2-9. CURRENT behavior: search over a collection with
	// no search index fails open (results: [], no error, no degradation flag).
	// The retrieval workstream (WS-3) will invert this test to require a
	// visible degradation signal instead of silent emptiness.
	it("searchWikiPages fails open when the search index is missing (C2-9, characterization)", async () => {
		// Second prefix: collections + validators, but NO search indexes.
		const barePrefix = "confnosearch_"
		const db = handle.client?.db(DB_NAME)
		expect(db, "store handle should expose the client").toBeDefined()
		await ensureWikiCollections(db as never, barePrefix)
		const bareHandle: WikiDbHandle = { db: db as never, prefix: barePrefix }
		await createWikiPage(bareHandle, pageInput({ slug: "concepts/c2-9" }))

		const response = await searchWikiPages(bareHandle, {
			query: "live validator behavior",
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		// Characterization: silent empty — no throw, no degradation marker.
		// TODO(WS-3): invert — assert a visible degradation signal here.
		expect(response.results).toEqual([])
		expect(response.total).toBe(0)
	})

	// WS-5 item 2 — optimistic concurrency. Two writers racing on the same
	// revision cannot both win: the CAS predicate (slug + scope + scopeRef +
	// revision) admits exactly one update; the loser observes that the page
	// still exists and gets WikiRevisionConflictError (409 at the API).
	it("concurrent same-revision updates: exactly one wins, the loser gets WikiRevisionConflictError (WS-5 item 2)", async () => {
		const slug = "concepts/ws5-cas"
		await createWikiPage(handle, pageInput({ slug }))
		let observedConflict = false
		// The two reads inside updateWikiPage race the two writes; on a
		// localhost mongod both reads virtually always land before either
		// write completes. Retry a few times so a slow first roundtrip can
		// never flake the suite.
		for (let attempt = 0; attempt < 5 && !observedConflict; attempt++) {
			const results = await Promise.allSettled([
				updateWikiPage(handle, slug, SCOPE, SCOPE_REF, {
					summary: `writer A, attempt ${attempt}`,
				}),
				updateWikiPage(handle, slug, SCOPE, SCOPE_REF, {
					summary: `writer B, attempt ${attempt}`,
				}),
			])
			for (const r of results) {
				if (r.status === "rejected") {
					expect(r.reason).toBeInstanceOf(WikiRevisionConflictError)
					expect(r.reason.expectedRevision).toBeGreaterThanOrEqual(1)
					observedConflict = true
				}
			}
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
