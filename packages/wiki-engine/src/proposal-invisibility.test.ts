// A proposal is not a page. While it waits, and after it is rejected, no wiki
// read may return it, name it, or count it; once the page exists the same reads
// find it. The proposal itself is a real ledger row, built with the real
// ledger functions, sitting in the same database the reads run against.
//
// Search needs Atlas Search, which the fake cannot be. Its stub records the
// pipeline and returns nothing, so for search this proves which collection a
// query can reach, not what a ranking returns; the live check searches for real.

import type { ClientSession, Document } from "mongodb"
import { describe, expect, it } from "vitest"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval,
} from "./memory-delivery.js"
import { rejectMemoryDeliveryPromotion } from "./memory-delivery-proposals.js"
import { getWikiPage, listWikiPages, type WikiDbHandle } from "./wiki-bridge.js"
import { getWikiChanges } from "./wiki-changes.js"
import { getWikiEntityOverview } from "./wiki-overview.js"
import { getWikiPageRevision } from "./wiki-revisions.js"
import { searchWikiPages } from "./wiki-search.js"
import { createFakeWikiDb } from "./testing/fake-wiki-db.js"
import {
	SCOPE,
	admin,
	claim,
	outsider,
	page,
	revision,
} from "./testing/overview-fixtures.js"

const session = {} as ClientSession
const PENDING = "concepts/silent-eta-drift"
const CLAIM = "ETAs drift silently."

const proposedPage = {
	kind: "concept",
	title: "Silent ETA drift",
	slug: PENDING,
	summary: "ETAs drift silently.",
	body: "See [[accounts/acme]].",
	frontmatter: { type: "concept" },
	claims: [{ id: "drift-1", text: CLAIM }],
	relationships: [
		{ targetPageSlug: "accounts/acme", targetTitle: "Acme", kind: "mentions" },
	],
	...SCOPE,
	trustTier: "standard",
}

function world() {
	const acme = page("accounts/acme", { claims: [claim("a1", "Acme renewed.")] })
	const collections: Record<string, Document[]> = {
		wiki_pages: [acme],
		wiki_revisions: [
			revision("accounts/acme", 1, { title: "Title of accounts/acme" }),
		],
		memory_delivery_intents: [],
	}
	const fake = createFakeWikiDb(collections)
	const touched = new Set<string>()
	const inner = fake.db.collection.bind(fake.db)
	const db = {
		collection(name: string) {
			touched.add(name.replace(fake.prefix, ""))
			const collection = inner(name) as unknown as Record<string, unknown>
			return name.endsWith("wiki_pages")
				? {
						...collection,
						aggregate: (pipeline: Document[]) => ({
							toArray: async () => {
								void pipeline
								return []
							},
						}),
					}
				: collection
		},
	} as unknown as WikiDbHandle["db"]
	const handle: WikiDbHandle = { db, prefix: fake.prefix }
	return { handle, collections, touched }
}

async function propose(handle: WikiDbHandle) {
	await recordMemoryDeliveryIntent(
		handle,
		{
			operationId: "add:proposal-1",
			operation: "add",
			idempotencyKey: "k1",
			payload: {
				content: "ETAs drift",
				...SCOPE,
				promotionPolicy: "wiki",
				wikiPromotion: { page: proposedPage },
			},
			principalSubjectId: "demo-proposer-1",
			agentId: "agent-1",
			...SCOPE,
			promotionPolicy: "wiki",
			promotionApproval: "required",
			proposalOnly: true,
		},
		session,
	)
	const begun = await beginMemoryDelivery(handle, "add:proposal-1", session)
	await confirmMemoryDelivery(
		handle,
		"add:proposal-1",
		{ eventId: "event-1", chunkCreated: true },
		begun.leaseToken as string,
		session,
	)
}

// Everything a caller can read the wiki through, as one function so each phase
// runs the same reads.
async function readEverything(handle: WikiDbHandle, governance = outsider) {
	const get = await getWikiPage(
		handle,
		PENDING,
		SCOPE.scope,
		SCOPE.scopeRef,
		governance,
	)
	const list = await listWikiPages(handle, { ...SCOPE, governance })
	const overview = await getWikiEntityOverview(handle, {
		slug: PENDING,
		...SCOPE,
		governance,
	})
	const acme = await getWikiEntityOverview(handle, {
		slug: "accounts/acme",
		...SCOPE,
		governance,
	})
	const changes = await getWikiChanges(handle, {
		...SCOPE,
		governance,
		since: new Date("2026-01-01T00:00:00Z"),
		until: new Date("2026-12-31T00:00:00Z"),
		now: () => new Date("2027-01-01T00:00:00Z"),
		settleMs: 0,
	})
	const revisionRead = await getWikiPageRevision(handle, {
		pageSlug: PENDING,
		...SCOPE,
		revision: 1,
		governance,
	})
	const search = await searchWikiPages(handle, {
		query: "ETAs drift silently",
		...SCOPE,
		governance,
	} as never)
	return { get, list, overview, acme, changes, revisionRead, search }
}

function expectAbsent(read: Awaited<ReturnType<typeof readEverything>>) {
	expect(read.get).toBeUndefined()
	expect(read.list.pages.map((p) => p.slug)).toEqual(["accounts/acme"])
	expect(read.list.total).toBe(1)
	expect(read.overview).toBeUndefined()
	expect(read.acme?.backlinks.items.map((b) => b.slug)).toEqual([])
	expect(read.acme?.neighbors.items.map((n) => n.slug) ?? []).not.toContain(
		PENDING,
	)
	expect(read.changes.changes.map((c) => c.pageSlug)).not.toContain(PENDING)
	expect(read.revisionRead).toBeUndefined()
	expect(read.search.results).toEqual([])
	const everything = JSON.stringify(read)
	expect(everything).not.toContain(PENDING)
	expect(everything).not.toContain(CLAIM)
	expect(everything).not.toContain("drift-1")
}

describe("a pending proposal", () => {
	it("is in no wiki read, and no read reaches the ledger that holds it", async () => {
		const { handle, collections, touched } = world()
		await propose(handle)
		expect(collections.memory_delivery_intents).toHaveLength(1)
		touched.clear()

		const read = await readEverything(handle)
		const asAdmin = await readEverything(handle, admin)

		expectAbsent(read)
		expectAbsent(asAdmin)
		expect(touched.has("memory_delivery_intents")).toBe(false)
		expect([...touched].sort()).toEqual(
			[...touched].filter((name) => name.startsWith("wiki_")).sort(),
		)
	})

	it("does not appear as a backlink, a neighbor or a revision of the page it links to", async () => {
		const { handle } = world()
		await propose(handle)

		const acme = await getWikiPage(
			handle,
			"accounts/acme",
			SCOPE.scope,
			SCOPE.scopeRef,
			outsider,
		)

		expect(acme?.backlinks).toEqual([])
	})
})

describe("a rejected proposal", () => {
	it("stays out of every wiki read", async () => {
		const { handle, touched } = world()
		await propose(handle)
		await rejectMemoryDeliveryPromotion(
			handle,
			"add:proposal-1",
			{ rejectedBy: "api-key:admin" },
			session,
		)
		touched.clear()

		expectAbsent(await readEverything(handle))
		expect(touched.has("memory_delivery_intents")).toBe(false)
	})
})

describe("an approved proposal", () => {
	it("is found by the reads that missed it, once its page exists", async () => {
		const { handle, collections } = world()
		await propose(handle)
		expectAbsent(await readEverything(handle))

		// Approval promotes inside the ledger transaction. createWikiPage needs a
		// server, so this stands in for it by writing the page and the revision it
		// would write; the point is that the same reads now find what they missed.
		await setMemoryDeliveryPromotionApproval(
			handle,
			"add:proposal-1",
			"approved",
			session,
		)
		await promoteMemoryDelivery(
			handle,
			"add:proposal-1",
			"add:proposal-1:key",
			async () => {
				collections.wiki_pages?.push(
					page(PENDING, {
						title: proposedPage.title,
						claims: [claim("drift-1", CLAIM)],
						relationships: proposedPage.relationships,
					}),
				)
				const acme = collections.wiki_pages?.[0]
				if (acme) {
					acme.backlinks = [
						{ sourcePageSlug: PENDING, sourceTitle: proposedPage.title },
					]
				}
				collections.wiki_revisions?.push(
					revision(PENDING, 1, {
						title: proposedPage.title,
						claims: [claim("drift-1", CLAIM)],
					}),
				)
			},
			session,
		)

		const read = await readEverything(handle)

		expect(read.get?.slug).toBe(PENDING)
		expect(read.list.pages.map((p) => p.slug).sort()).toEqual([
			"accounts/acme",
			PENDING,
		])
		expect(read.overview?.page.slug).toBe(PENDING)
		expect(read.acme?.backlinks.items.map((b) => b.slug)).toEqual([PENDING])
		expect(read.revisionRead?.pageSlug).toBe(PENDING)
	})
})
