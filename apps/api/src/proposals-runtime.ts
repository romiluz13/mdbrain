import {
	listPendingPromotionIntents,
	MemoryDeliveryStateError,
	rejectMemoryDeliveryPromotion,
	type MemoryDeliveryIntent,
} from "@mdbrain/wiki-engine"
import {
	defaultResolveReplayPrincipal,
	memoryLedgerTtlMs,
} from "./memory-delivery-runtime.js"
import type { ApiPrincipal } from "./principal.js"
import {
	getWikiStoreHandle,
	withWikiTransaction,
} from "./wiki-store-runtime.js"

export type PendingWikiProposal = {
	operationId: string
	state: "pending"
	proposer: { subjectId: string; displayName?: string; agentId: string }
	scope: string
	scopeRef: string
	proposedAt: string
	page: {
		slug: string
		title: string
		kind: string
		summary: string
		body: string
		claims: Array<{ id: string; text: string; confidence?: number }>
	}
}

function readProposedPage(
	intent: MemoryDeliveryIntent,
): PendingWikiProposal["page"] | undefined {
	const wikiPromotion = intent.payload.wikiPromotion
	if (typeof wikiPromotion !== "object" || wikiPromotion === null) return
	const page = (wikiPromotion as Record<string, unknown>).page
	if (typeof page !== "object" || page === null) return
	const raw = page as Record<string, unknown>
	if (typeof raw.slug !== "string" || typeof raw.title !== "string") return
	const claims = Array.isArray(raw.claims) ? raw.claims : []
	return {
		slug: raw.slug,
		title: raw.title,
		kind: String(raw.kind ?? ""),
		summary: String(raw.summary ?? ""),
		body: String(raw.body ?? ""),
		claims: claims.flatMap((claim) => {
			if (typeof claim !== "object" || claim === null) return []
			const entry = claim as Record<string, unknown>
			return [
				{
					id: String(entry.id ?? ""),
					text: String(entry.text ?? ""),
					...(typeof entry.confidence === "number"
						? { confidence: entry.confidence }
						: {}),
				},
			]
		}),
	}
}

/** The proposals waiting for a decision, each with the page it would create
 *  and who proposed it. Only the proposed page is shown: the ledger's keys,
 *  fingerprints and receipts stay inside it. */
export async function listPendingWikiProposals(params: {
	scope?: string
	scopeRef?: string
	limit?: number
	resolvePrincipal?: (subjectId: string) => ApiPrincipal | null
}): Promise<PendingWikiProposal[]> {
	const handle = await getWikiStoreHandle()
	const intents = await listPendingPromotionIntents(handle, {
		scope: params.scope,
		scopeRef: params.scopeRef,
		limit: params.limit,
	})
	const resolve = params.resolvePrincipal ?? defaultResolveReplayPrincipal
	return intents.flatMap((intent) => {
		const page = readProposedPage(intent)
		if (!page) return []
		const displayName = resolve(intent.principalSubjectId)?.displayName
		return [
			{
				operationId: intent.operationId,
				state: "pending" as const,
				proposer: {
					subjectId: intent.principalSubjectId,
					...(displayName ? { displayName } : {}),
					agentId: intent.agentId,
				},
				scope: intent.scope,
				scopeRef: intent.scopeRef,
				proposedAt: intent.createdAt.toISOString(),
				page,
			},
		]
	})
}

export async function rejectPendingWikiPromotion(params: {
	operationId: string
	rejectedBy: string
	reason?: string
}): Promise<
	| { ok: true; operationId: string; state: "rejected" }
	| { ok: false; status: 404 | 409 | 500; code: string; message: string }
> {
	try {
		await withWikiTransaction((handle, session) =>
			rejectMemoryDeliveryPromotion(
				handle,
				params.operationId,
				{ rejectedBy: params.rejectedBy, reason: params.reason },
				session,
				memoryLedgerTtlMs(),
			),
		)
		return { ok: true, operationId: params.operationId, state: "rejected" }
	} catch (error) {
		if (error instanceof MemoryDeliveryStateError) {
			return {
				ok: false,
				status: error.message.includes("not found") ? 404 : 409,
				code: error.message.includes("not found")
					? "NOT_FOUND"
					: "INVALID_DELIVERY_STATE",
				message: error.message,
			}
		}
		return {
			ok: false,
			status: 500,
			code: "REJECT_FAILED",
			message: error instanceof Error ? error.message : String(error),
		}
	}
}
