import { createHash } from "node:crypto"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	createWikiPage,
	failMemoryDelivery,
	failMemoryPromotion,
	listMemoryDeliveryIntents,
	MemoryDeliveryStateError,
	promoteMemoryDelivery,
	recordWikiMutationIntent,
	recordMemoryDeliveryIntent,
	type MemoryDeliveryIntent,
	type MemoryDeliveryState,
	type WikiDbHandle,
	type WikiPageInput,
	type WikiTransactionSession,
} from "@mdbrain/wiki-engine"
import {
	mdbrainBridgeAdd,
	mdbrainBridgeWriteConversationEvent,
} from "@mdbrain/memory-bridge"
import type { MemoryScope } from "@mdbrain/lib/types/memory"
import type { ApiPrincipal, PrincipalTrustTier } from "./principal.js"
import {
	getWikiStoreHandle,
	withWikiTransaction,
} from "./wiki-store-runtime.js"

const WIKI_VALID_KINDS = [
	"entity",
	"concept",
	"synthesis",
	"source",
	"report",
	"procedure",
]
const WIKI_VALID_TRUST_TIERS = ["restricted", "standard", "admin"]

export type MemoryWriteReceipt = {
	eventId: string
	chunkCreated: boolean
}

export class MemoryDeliveryDispatchError extends Error {
	constructor(
		readonly operationId: string,
		readonly state: MemoryDeliveryState,
		readonly code: string,
	) {
		super(`memory delivery ${operationId} entered ${state}`)
		this.name = "MemoryDeliveryDispatchError"
	}
}

export type MemoryWikiPromotion = {
	key: string
	mutateWiki: (
		handle: WikiDbHandle,
		intent: MemoryDeliveryIntent,
		session: WikiTransactionSession,
	) => Promise<void>
}

export function buildMemoryWikiPromotion(params: {
	body: Record<string, unknown>
	operationId: string
	scope: string
	scopeRef: string
	principal: Pick<ApiPrincipal, "subjectId" | "trustTier" | "capabilities">
	trustedPersisted?: boolean
}): { promotion?: MemoryWikiPromotion; error?: string } {
	const policy = params.body.promotionPolicy
	if (policy === undefined || policy === "none") return {}
	if (policy !== "wiki") {
		return { error: "promotionPolicy must be none|wiki" }
	}
	const rawPromotion = params.body.wikiPromotion
	if (
		!rawPromotion ||
		typeof rawPromotion !== "object" ||
		Array.isArray(rawPromotion)
	) {
		return {
			error: "wikiPromotion is required when promotionPolicy is wiki",
		}
	}
	const rawPage = (rawPromotion as Record<string, unknown>).page
	if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage)) {
		return { error: "wikiPromotion.page is required" }
	}
	const page = rawPage as Record<string, unknown>
	if (
		!WIKI_VALID_KINDS.includes(String(page.kind)) ||
		typeof page.title !== "string" ||
		!page.title.trim() ||
		typeof page.slug !== "string" ||
		!page.slug.trim() ||
		typeof page.summary !== "string" ||
		!page.summary.trim() ||
		typeof page.body !== "string" ||
		!page.body.trim()
	) {
		return { error: "wikiPromotion.page has invalid required fields" }
	}
	if (page.scope !== params.scope || page.scopeRef !== params.scopeRef) {
		return { error: "wikiPromotion.page must use the memory write scope" }
	}
	if (
		!WIKI_VALID_TRUST_TIERS.includes(String(page.trustTier)) ||
		(!params.trustedPersisted &&
			page.trustTier !== params.principal.trustTier &&
			!params.principal.capabilities.includes("change-permissions"))
	) {
		return { error: "wikiPromotion.page trust tier is not permitted" }
	}
	if (
		!params.trustedPersisted &&
		page.permissions &&
		!params.principal.capabilities.includes("change-permissions")
	) {
		return { error: "wikiPromotion.page permissions are not permitted" }
	}
	const frontmatter = page.frontmatter
	if (
		!frontmatter ||
		typeof frontmatter !== "object" ||
		Array.isArray(frontmatter) ||
		typeof (frontmatter as Record<string, unknown>).type !== "string"
	) {
		return { error: "wikiPromotion.page.frontmatter.type is required" }
	}
	if (!Array.isArray(page.claims) || page.claims.length === 0) {
		return { error: "wikiPromotion.page requires at least one stable claim" }
	}
	if (
		page.claims.some(
			(claim) =>
				!claim ||
				typeof claim !== "object" ||
				Array.isArray(claim) ||
				typeof (claim as Record<string, unknown>).id !== "string" ||
				typeof (claim as Record<string, unknown>).text !== "string",
		)
	) {
		return { error: "wikiPromotion.page claims require id and text" }
	}
	const wikiPage = page as unknown as WikiPageInput
	const promotionKey = `${params.operationId}:wiki:${wikiPage.slug}:v1`
	return {
		promotion: {
			key: promotionKey,
			mutateWiki: async (handle, intent, session) => {
				const eventId =
					typeof intent.receipt?.eventId === "string"
						? intent.receipt.eventId
						: undefined
				if (!eventId) throw new Error("promotion receipt is missing eventId")
				const promotedPage: WikiPageInput = {
					...wikiPage,
					claims: wikiPage.claims?.map((claim) => ({
						...claim,
						evidence: [
							...(claim.evidence ?? []),
							{ kind: "event", sourceId: eventId },
						],
						derivedFrom: [...(claim.derivedFrom ?? []), eventId],
					})),
				}
				await createWikiPage(handle, promotedPage, { session })
				await recordWikiMutationIntent(
					handle,
					{
						operationId: `${params.operationId}:wiki-promotion`,
						kind: "create",
						pageSlug: wikiPage.slug,
						scope: params.scope,
						scopeRef: params.scopeRef,
						principalSubjectId: params.principal.subjectId,
						payload: { promotionKey, eventId, page: promotedPage },
					},
					session,
				)
			},
		},
	}
}

type DeliveryFailure = {
	code: string
	outcome: "not-applied" | "unknown"
	retryable: boolean
}

function classifyFailure(error: unknown): DeliveryFailure {
	if (error && typeof error === "object") {
		const value = error as Record<string, unknown>
		const code = typeof value.code === "string" ? value.code : "OUTCOME_UNKNOWN"
		const outcome = value.outcome === "not-applied" ? "not-applied" : "unknown"
		const retryable = value.retryable === true
		return { code, outcome, retryable }
	}
	return {
		code: "OUTCOME_UNKNOWN",
		outcome: "unknown",
		retryable: false,
	}
}

function failureState(failure: DeliveryFailure): MemoryDeliveryState {
	if (failure.code === "IDEMPOTENCY_CONFLICT") return "conflict"
	if (failure.outcome === "unknown") return "outcome-unknown"
	return failure.retryable ? "retryable" : "dead-letter"
}

function isDuplicateKeyError(error: unknown): boolean {
	return (
		!!error &&
		typeof error === "object" &&
		(error as Record<string, unknown>).code === 11000
	)
}

export function buildMemoryDeliveryOperationId(params: {
	operation: "add" | "write-event"
	idempotencyKey: string
	principalSubjectId: string
	scope: string
	scopeRef: string
}): string {
	const digest = createHash("sha256")
		.update(
			JSON.stringify([
				params.principalSubjectId,
				params.scope,
				params.scopeRef,
				params.operation,
				params.idempotencyKey,
			]),
		)
		.digest("hex")
	return `${params.operation}:${digest}`
}

export async function deliverMemoryWrite(params: {
	operation: "add" | "write-event"
	idempotencyKey: string
	payload: Record<string, unknown>
	principalSubjectId: string
	agentId: string
	scope: string
	scopeRef: string
	promotion?: {
		key: string
		mutateWiki: (
			handle: WikiDbHandle,
			intent: MemoryDeliveryIntent,
			session: WikiTransactionSession,
		) => Promise<void>
	}
	dispatch: () => Promise<MemoryWriteReceipt>
}): Promise<MemoryWriteReceipt> {
	const operationId = buildMemoryDeliveryOperationId(params)
	const promotion = params.promotion
	const promote = async (): Promise<void> => {
		if (!promotion) return
		try {
			await withWikiTransaction((handle, session) =>
				promoteMemoryDelivery(
					handle,
					operationId,
					promotion.key,
					promotion.mutateWiki,
					session,
				),
			)
		} catch (error) {
			const classified = classifyFailure(error)
			const errorCode =
				classified.code === "OUTCOME_UNKNOWN"
					? "PROMOTION_FAILED"
					: classified.code
			let state: MemoryDeliveryState = "promotion-pending"
			try {
				const failed = await withWikiTransaction((handle, session) =>
					failMemoryPromotion(handle, operationId, errorCode, session),
				)
				state = failed.state
			} catch {
				// Preserve the original promotion failure when ledger recovery races.
			}
			throw new MemoryDeliveryDispatchError(operationId, state, errorCode)
		}
	}
	const record = () =>
		withWikiTransaction((handle, session) =>
			recordMemoryDeliveryIntent(
				handle,
				{
					operationId,
					operation: params.operation,
					idempotencyKey: params.idempotencyKey,
					payload: params.payload,
					principalSubjectId: params.principalSubjectId,
					agentId: params.agentId,
					scope: params.scope,
					scopeRef: params.scopeRef,
					promotionPolicy: params.promotion ? "wiki" : "none",
				},
				session,
			),
		)
	let recorded: Awaited<ReturnType<typeof record>>
	try {
		recorded = await record()
	} catch (error) {
		if (!isDuplicateKeyError(error)) throw error
		recorded = await record()
	}
	if (recorded.conflict) {
		throw new MemoryDeliveryDispatchError(operationId, "conflict", "CONFLICT")
	}
	if (recorded.intent.receipt) {
		if (promotion && recorded.intent.state === "promotion-pending") {
			await promote()
		} else if (
			promotion &&
			recorded.intent.state !== "promoted" &&
			recorded.intent.state !== "confirmed"
		) {
			throw new MemoryDeliveryDispatchError(
				operationId,
				recorded.intent.state,
				"PROMOTION_UNAVAILABLE",
			)
		}
		return recorded.intent.receipt as MemoryWriteReceipt
	}
	try {
		const begun = await withWikiTransaction((handle, session) =>
			beginMemoryDelivery(handle, operationId, session),
		)
		if (begun.state !== "delivering") {
			throw new MemoryDeliveryDispatchError(
				operationId,
				begun.state,
				"RECONCILIATION_EXHAUSTED",
			)
		}
	} catch (error) {
		if (error instanceof MemoryDeliveryDispatchError) throw error
		if (error instanceof MemoryDeliveryStateError) {
			throw new MemoryDeliveryDispatchError(
				operationId,
				recorded.intent.state,
				"DELIVERY_IN_PROGRESS",
			)
		}
		throw error
	}
	let receipt: MemoryWriteReceipt
	try {
		receipt = await params.dispatch()
	} catch (error) {
		const failure = classifyFailure(error)
		try {
			await withWikiTransaction((handle, session) =>
				failMemoryDelivery(handle, operationId, failure, session),
			)
		} catch {
			// Preserve the dispatch classification when ledger recovery races.
		}
		throw new MemoryDeliveryDispatchError(
			operationId,
			failureState(failure),
			failure.code,
		)
	}
	const confirmed = await withWikiTransaction((handle, session) =>
		confirmMemoryDelivery(handle, operationId, receipt, session),
	)
	if (promotion && confirmed.state === "promotion-pending") {
		await promote()
	}
	return receipt
}

const RECONCILABLE_STATES: MemoryDeliveryState[] = [
	"recorded",
	"delivering",
	"retryable",
	"outcome-unknown",
	"promotion-pending",
]

function retryDelayMs(intent: MemoryDeliveryIntent): number {
	const exponent = Math.max(0, Math.min(intent.attempts - 1, 6))
	return Math.min(60_000, 1_000 * 2 ** exponent)
}

function isDueForReconciliation(
	intent: MemoryDeliveryIntent,
	now: number,
): boolean {
	const updatedAt = new Date(intent.updatedAt).getTime()
	const age = Number.isFinite(updatedAt)
		? now - updatedAt
		: Number.POSITIVE_INFINITY
	if (intent.state === "recorded") return true
	if (intent.state === "delivering") {
		const startedAt = intent.dispatchStartedAt
			? new Date(intent.dispatchStartedAt).getTime()
			: updatedAt
		return now - startedAt >= 30_000
	}
	return age >= retryDelayMs(intent)
}

function persistedTrustTier(intent: MemoryDeliveryIntent): PrincipalTrustTier {
	const promotion = intent.payload.wikiPromotion
	const page =
		promotion && typeof promotion === "object" && !Array.isArray(promotion)
			? (promotion as Record<string, unknown>).page
			: undefined
	const trustTier =
		page && typeof page === "object" && !Array.isArray(page)
			? (page as Record<string, unknown>).trustTier
			: undefined
	return trustTier === "restricted" || trustTier === "admin"
		? trustTier
		: "standard"
}

function persistedPromotion(
	intent: MemoryDeliveryIntent,
): MemoryWikiPromotion | undefined {
	if (intent.promotionPolicy !== "wiki") return undefined
	const result = buildMemoryWikiPromotion({
		body: intent.payload,
		operationId: intent.operationId,
		scope: intent.scope,
		scopeRef: intent.scopeRef,
		principal: {
			subjectId: intent.principalSubjectId,
			trustTier: persistedTrustTier(intent),
			capabilities: [],
		},
		trustedPersisted: true,
	})
	if (!result.promotion) {
		throw new Error(result.error ?? "persisted wiki promotion is invalid")
	}
	return result.promotion
}

function stringPayload(
	payload: Record<string, unknown>,
	field: string,
): string | undefined {
	return typeof payload[field] === "string"
		? (payload[field] as string)
		: undefined
}

async function dispatchPersistedIntent(
	intent: MemoryDeliveryIntent,
): Promise<MemoryWriteReceipt> {
	const payload = intent.payload
	const metadata =
		payload.metadata &&
		typeof payload.metadata === "object" &&
		!Array.isArray(payload.metadata)
			? (payload.metadata as Record<string, unknown>)
			: undefined
	if (intent.operation === "add") {
		const content = stringPayload(payload, "content")
		if (!content) throw new Error("persisted add payload is invalid")
		return mdbrainBridgeAdd({
			content,
			agentId: intent.agentId,
			sessionId: stringPayload(payload, "sessionId"),
			metadata,
			scope: intent.scope as MemoryScope,
			scopeRef: intent.scopeRef,
			idempotencyKey: intent.idempotencyKey,
		})
	}
	const role = stringPayload(payload, "role")
	const body = stringPayload(payload, "body")
	if (
		!body ||
		(role !== "user" &&
			role !== "assistant" &&
			role !== "system" &&
			role !== "tool")
	) {
		throw new Error("persisted write-event payload is invalid")
	}
	return mdbrainBridgeWriteConversationEvent({
		agentId: intent.agentId,
		role,
		body,
		sessionId: stringPayload(payload, "sessionId"),
		timestamp: stringPayload(payload, "timestamp"),
		metadata,
		scope: intent.scope as MemoryScope,
		scopeRef: intent.scopeRef,
		idempotencyKey: intent.idempotencyKey,
	})
}

export async function reconcileMemoryDeliveriesOnce(
	options: { now?: number; limitPerState?: number } = {},
): Promise<{ attempted: number; completed: number; failed: number }> {
	const handle = await getWikiStoreHandle()
	const batches = await Promise.all(
		RECONCILABLE_STATES.map((state) =>
			listMemoryDeliveryIntents(handle, {
				state,
				limit: options.limitPerState ?? 20,
			}),
		),
	)
	const now = options.now ?? Date.now()
	let attempted = 0
	let completed = 0
	let failed = 0
	for (const intent of batches.flat()) {
		if (!isDueForReconciliation(intent, now)) continue
		attempted++
		try {
			const promotion = persistedPromotion(intent)
			await deliverMemoryWrite({
				operation: intent.operation,
				idempotencyKey: intent.idempotencyKey,
				payload: intent.payload,
				principalSubjectId: intent.principalSubjectId,
				agentId: intent.agentId,
				scope: intent.scope,
				scopeRef: intent.scopeRef,
				promotion,
				dispatch: () => dispatchPersistedIntent(intent),
			})
			completed++
		} catch {
			failed++
		}
	}
	return { attempted, completed, failed }
}

export function startMemoryDeliveryReconciler(
	options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): { stop: () => Promise<void> } {
	const configuredInterval = options.intervalMs ?? 5_000
	if (!Number.isFinite(configuredInterval) || configuredInterval < 1_000) {
		throw new Error("memory delivery reconciliation interval must be >= 1000ms")
	}
	const intervalMs = configuredInterval
	let stopped = false
	let timer: NodeJS.Timeout | undefined
	let active = Promise.resolve()
	const schedule = () => {
		if (stopped) return
		timer = setTimeout(run, intervalMs)
		timer.unref()
	}
	const run = () => {
		if (stopped) return
		active = reconcileMemoryDeliveriesOnce()
			.then(() => undefined)
			.catch((error) => options.onError?.(error))
			.finally(schedule)
	}
	run()
	return {
		stop: async () => {
			stopped = true
			if (timer) clearTimeout(timer)
			await active
		},
	}
}
