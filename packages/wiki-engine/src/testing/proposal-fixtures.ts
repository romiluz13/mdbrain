// Shared setup for the proposal ledger tests: a fake database holding only the
// delivery ledger, and the steps that carry a proposal to each state.

import type { ClientSession } from "mongodb"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	promoteMemoryDelivery,
	recordMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval,
	type MemoryDeliveryIntent,
} from "../memory-delivery.js"
import type { WikiDbHandle } from "../wiki-bridge.js"
import { createFakeWikiDb } from "./fake-wiki-db.js"

export const session = {} as ClientSession

export function ledger() {
	const fake = createFakeWikiDb({ memory_delivery_intents: [] })
	const handle: WikiDbHandle = { db: fake.db, prefix: fake.prefix }
	return { handle, fake }
}

export const page = (slug: string, body = "Body.") => ({
	kind: "concept",
	title: `Title of ${slug}`,
	slug,
	summary: "Summary.",
	body,
	frontmatter: { type: "concept" },
	claims: [{ id: `${slug}-c1`, text: "A claim." }],
	scope: "workspace",
	scopeRef: "demo-run-1",
	trustTier: "standard",
})

export const intentInput = (
	operationId: string,
	slug: string,
	body = "Body.",
) => ({
	operationId,
	operation: "add" as const,
	idempotencyKey: `key-${operationId}`,
	payload: {
		content: "an event",
		scope: "workspace",
		scopeRef: "demo-run-1",
		promotionPolicy: "wiki",
		wikiPromotion: { page: page(slug, body) },
	},
	principalSubjectId: "demo-proposer-1",
	agentId: "agent-1",
	scope: "workspace",
	scopeRef: "demo-run-1",
	promotionPolicy: "wiki" as const,
	promotionApproval: "required" as const,
	proposalOnly: true as const,
})

export async function propose(
	handle: WikiDbHandle,
	operationId: string,
	slug = `concepts/${operationId}`,
): Promise<MemoryDeliveryIntent> {
	await recordMemoryDeliveryIntent(
		handle,
		intentInput(operationId, slug),
		session,
	)
	const begun = await beginMemoryDelivery(handle, operationId, session)
	return confirmMemoryDelivery(
		handle,
		operationId,
		{ eventId: `event-${operationId}`, chunkCreated: true },
		begun.leaseToken as string,
		session,
	)
}

export const read = async (handle: WikiDbHandle, operationId: string) =>
	(await handle.db
		.collection(`${handle.prefix}memory_delivery_intents`)
		.findOne({ operationId })) as unknown as MemoryDeliveryIntent

// A handle whose reads see `stale` instead of the stored row, for the moment
// between a caller's read and its conditional update.
export function readsAs(
	handle: WikiDbHandle,
	stale: Record<string, unknown>,
): WikiDbHandle {
	const db = {
		collection: (name: string) =>
			new Proxy(handle.db.collection(name), {
				get(target, key) {
					if (key === "findOne") return async () => stale
					const value = Reflect.get(target, key)
					return typeof value === "function" ? value.bind(target) : value
				},
			}),
	}
	return { db: db as unknown as WikiDbHandle["db"], prefix: handle.prefix }
}

export const admin = {
	rejectedBy: "api-key:admin",
	reason: "duplicates an existing page",
}

// What the API does on approve: mark approved, then run the promotion.
export async function approve(handle: WikiDbHandle, operationId: string) {
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
		async () => {},
		session,
	)
}
