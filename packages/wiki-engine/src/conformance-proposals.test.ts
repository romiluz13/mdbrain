// Runs ONLY against a real MongoDB when MDBRAIN_CONFORMANCE_MONGODB_URI is
// set, like conformance.test.ts (same switch, off by default). It covers what
// the in-memory fake cannot: that the live $jsonSchema validator accepts the
// proposal fields, that approve and reject racing in real transactions leave
// one winner, and that a proposal is absent from the wiki until approved and
// present once the real createWikiPage has run.

import type { ClientSession } from "mongodb"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	getMemoryDeliveryIntent,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval,
} from "./memory-delivery.js"
import {
	PROPOSAL_REJECTED_CODE,
	rejectMemoryDeliveryPromotion,
} from "./memory-delivery-proposals.js"
import {
	createWikiPage,
	getWikiPage,
	listWikiPages,
	type WikiDbHandle,
	type WikiPageInput,
} from "./wiki-bridge.js"
import { WikiStore } from "./wiki-store.js"

const conformanceUri = process.env.MDBRAIN_CONFORMANCE_MONGODB_URI?.trim()
const describeConformance = conformanceUri ? describe : describe.skip

const SCOPE = "workspace"
const SCOPE_REF = `conformance-proposals-${process.pid}-${Date.now()}`
const DB_NAME = `mdbrain_conformance_proposals_${process.pid}_${Date.now()}`

const proposedPage = (slug: string): WikiPageInput => ({
	kind: "concept",
	title: "Silent ETA drift",
	slug,
	summary: "ETAs drift silently.",
	body: "ETAs drift without a signal.",
	frontmatter: { type: "concept" },
	claims: [{ id: "c1", text: "ETAs drift silently." }],
	scope: SCOPE,
	scopeRef: SCOPE_REF,
	trustTier: "standard",
})

describeConformance("live MongoDB proposals", { timeout: 60_000 }, () => {
	let store: WikiStore
	let handle: WikiDbHandle

	beforeAll(async () => {
		store = new WikiStore({
			uri: conformanceUri as string,
			databaseName: DB_NAME,
			collectionPrefix: "conf_",
		})
		await store.initialize()
		handle = store.handle()
	}, 30_000)

	afterAll(async () => {
		if (store) {
			await handle?.db.dropDatabase().catch(() => {})
			await store.close()
		}
	}, 30_000)

	async function propose(operationId: string, slug: string) {
		await store.transaction(async (session) => {
			await recordMemoryDeliveryIntent(
				handle,
				{
					operationId,
					operation: "add",
					idempotencyKey: operationId,
					payload: {
						content: "ETA drift",
						scope: SCOPE,
						scopeRef: SCOPE_REF,
						promotionPolicy: "wiki",
						wikiPromotion: { page: proposedPage(slug) },
					},
					principalSubjectId: "demo-proposer-1",
					agentId: "agent-1",
					scope: SCOPE,
					scopeRef: SCOPE_REF,
					promotionPolicy: "wiki",
					promotionApproval: "required",
					proposalOnly: true,
				},
				session,
			)
		})
		const begun = await store.transaction((session) =>
			beginMemoryDelivery(handle, operationId, session),
		)
		await store.transaction((session) =>
			confirmMemoryDelivery(
				handle,
				operationId,
				{ eventId: `event-${operationId}`, chunkCreated: true },
				begun.leaseToken as string,
				session,
			),
		)
	}

	const approve = (operationId: string, slug: string) =>
		store.transaction(async (session: ClientSession) => {
			await setMemoryDeliveryPromotionApproval(
				handle,
				operationId,
				"approved",
				session,
			)
			return promoteMemoryDelivery(
				handle,
				operationId,
				`${operationId}:key`,
				async (h, _intent, tx) => {
					await createWikiPage(h, proposedPage(slug), { session: tx })
				},
				session,
			)
		})

	const reject = (operationId: string) =>
		store.transaction((session) =>
			rejectMemoryDeliveryPromotion(
				handle,
				operationId,
				{ rejectedBy: "api-key:admin" },
				session,
			),
		)

	it("accepts the proposal and rejection fields under the live validator", async () => {
		await propose("op-validator", "concepts/validator")
		const rejected = await reject("op-validator")

		expect(rejected.state).toBe("dead-letter")
		expect(rejected.lastErrorCode).toBe(PROPOSAL_REJECTED_CODE)
		const stored = await getMemoryDeliveryIntent(handle, "op-validator")
		expect(stored?.proposalOnly).toBe(true)
		expect(stored?.rejectedAt).toBeInstanceOf(Date)
	})

	it("keeps a proposal out of the wiki until it is approved", async () => {
		const slug = "concepts/pending-then-live"
		await propose("op-visible", slug)

		expect(await getWikiPage(handle, slug, SCOPE, SCOPE_REF)).toBeUndefined()
		const before = await listWikiPages(handle, {
			scope: SCOPE,
			scopeRef: SCOPE_REF,
		})
		expect(before.pages.map((p) => p.slug)).not.toContain(slug)

		await approve("op-visible", slug)

		expect((await getWikiPage(handle, slug, SCOPE, SCOPE_REF))?.slug).toBe(slug)
	})

	it("leaves exactly one winner when approve and reject race, in either order", async () => {
		for (let round = 0; round < 8; round++) {
			const operationId = `op-race-${round}`
			const slug = `concepts/race-${round}`
			await propose(operationId, slug)
			const order =
				round % 2 === 1
					? (["reject", "approve"] as const)
					: (["approve", "reject"] as const)
			const run = {
				approve: () => approve(operationId, slug),
				reject: () => reject(operationId),
			}

			const results = await Promise.allSettled(order.map((who) => run[who]()))

			const stored = await getMemoryDeliveryIntent(handle, operationId)
			const page = await getWikiPage(handle, slug, SCOPE, SCOPE_REF)
			if (stored?.state === "promoted") {
				expect(page?.slug).toBe(slug)
				expect(stored.rejectedAt).toBeUndefined()
			} else {
				expect(stored?.lastErrorCode).toBe(PROPOSAL_REJECTED_CODE)
				expect(page).toBeUndefined()
			}
			const approveResult = results[order.indexOf("approve")]
			expect(approveResult?.status === "fulfilled").toBe(
				stored?.state === "promoted",
			)
		}
	})
})
