import { createHash } from "node:crypto"
import {
	beginMemoryDelivery,
	confirmMemoryDelivery,
	createWikiPage,
	failMemoryDelivery,
	failMemoryPromotion,
	getMemoryDeliveryIntent,
	listMemoryDeliveryIntents,
	MemoryDeliveryStateError,
	promoteMemoryDelivery,
	recordWikiMutationIntent,
	recordMemoryDeliveryIntent,
	setMemoryDeliveryPromotionApproval,
	type MemoryDeliveryIntent,
	type MemoryDeliveryState,
	type MemoryPromotionApproval,
	type WikiDbHandle,
	type WikiPageInput,
	type WikiTransactionSession,
} from "@mdbrain/wiki-engine"
import {
	mdbrainBridgeAdd,
	mdbrainBridgeWriteConversationEvent,
} from "@mdbrain/memory-bridge"
import type { MemoryScope } from "@mdbrain/lib/types/memory"
import {
	authorizePrincipalRequest,
	resolvePrincipalBySubjectId,
	type ApiPrincipal,
} from "./principal.js"
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
}): { promotion?: MemoryWikiPromotion; error?: string } {
	const policy = params.body.promotionPolicy
	if (policy === undefined || policy === "none") return {}
	if (policy !== "wiki") {
		return { error: "promotionPolicy must be none|wiki" }
	}
	// Trust tier floor: retrieved memory (and model output flowing through
	// these writes) must never be promoted into the governed wiki from a
	// restricted-tier principal, regardless of the page's claimed tier. The
	// full-capability development principal (trusted local development only)
	// is admin-equivalent and passes the floor.
	if (
		params.principal.trustTier !== "standard" &&
		params.principal.trustTier !== "admin" &&
		params.principal.trustTier !== "development"
	) {
		return {
			error:
				"wiki promotion requires a principal trust tier of standard or admin",
		}
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
		(page.trustTier !== params.principal.trustTier &&
			!params.principal.capabilities.includes("change-permissions"))
	) {
		return { error: "wikiPromotion.page trust tier is not permitted" }
	}
	if (
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
	/** "required" records the intent in the human approval queue: the write
	 *  dispatches, the promotion is held, and only an admin approval (or a
	 *  replay after approval) can execute it. */
	promotionApproval?: MemoryPromotionApproval
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
					...(params.promotionApproval
						? { promotionApproval: params.promotionApproval }
						: {}),
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
		const approvalHeld =
			(params.promotionApproval ?? recorded.intent.promotionApproval) ===
			"required"
		if (promotion && recorded.intent.state === "promotion-pending") {
			// An approval-queued promotion is replayed only after an admin has
			// approved it (the approve path promotes directly; a later replay
			// of an approved intent is idempotent via promoteMemoryDelivery).
			if (!approvalHeld) await promote()
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
	if (
		promotion &&
		confirmed.state === "promotion-pending" &&
		params.promotionApproval !== "required"
	) {
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

/** Resolves the replay principal for a recorded subject ID from the CURRENT
 *  credential configuration — never from the request payload. A trust tier
 *  captured in the caller-controlled wikiPromotion payload must not stand in
 *  for the principal's live tier: a revoked or downgraded key must fail its
 *  pending promotion on replay. */
const defaultResolveReplayPrincipal = (
	subjectId: string,
): ApiPrincipal | null =>
	resolvePrincipalBySubjectId(subjectId, {
		adminSubjectId:
			process.env.MDBRAIN_API_ADMIN_SUBJECT_ID?.trim() || undefined,
	})

function persistedPromotion(
	intent: MemoryDeliveryIntent,
	resolvePrincipal: (
		subjectId: string,
	) => ApiPrincipal | null = defaultResolveReplayPrincipal,
): MemoryWikiPromotion | undefined {
	if (intent.promotionPolicy !== "wiki") return undefined
	// Re-authorize the replay at the current principal. The original HTTP
	// request validated the promotion against the live principal; replay
	// must re-run the same checks (identity active, agent/scope grants,
	// trust tier, change-permissions) so credential changes between record
	// and reconciliation cannot smuggle a promotion through.
	const principal = resolvePrincipal(intent.principalSubjectId)
	if (!principal) {
		throw new Error(
			`principal "${intent.principalSubjectId}" no longer resolves; ` +
				"refusing to replay wiki promotion",
		)
	}
	const authzError = authorizePrincipalRequest(principal, {
		agentId: intent.agentId ?? undefined,
		scope: intent.scope,
		scopeRef: intent.scopeRef,
	})
	if (authzError) {
		throw new Error(
			`principal "${intent.principalSubjectId}" is no longer authorized ` +
				`(${authzError}); refusing to replay wiki promotion`,
		)
	}
	const result = buildMemoryWikiPromotion({
		body: intent.payload,
		operationId: intent.operationId,
		scope: intent.scope,
		scopeRef: intent.scopeRef,
		principal,
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

/**
 * When enabled (MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL=1|true), wiki
 * promotions are recorded into a human approval queue instead of executing
 * inline; an admin must approve each pending promotion.
 */
export function wikiPromotionApprovalRequired(): boolean {
	const raw = process.env.MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL?.trim()
	return raw === "1" || raw?.toLowerCase() === "true"
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

/**
 * Approves and executes one promotion-pending intent that was recorded
 * under approval mode. The original principal is re-authorized at its
 * CURRENT credential state (same rules as replay): a queued promotion from
 * a since-revoked or downgraded principal cannot execute. The approval
 * marker and the promotion run in a single transaction so the reconciler
 * can never observe approved-but-unpromoted state.
 */
export async function approvePendingWikiPromotion(params: {
	operationId: string
	resolvePrincipal?: (subjectId: string) => ApiPrincipal | null
}): Promise<
	| { ok: true; operationId: string; pageSlug: string }
	| { ok: false; status: 400 | 404 | 409; code: string; message: string }
> {
	const handle = await getWikiStoreHandle()
	const intent = await getMemoryDeliveryIntent(handle, params.operationId)
	if (!intent) {
		return {
			ok: false,
			status: 404,
			code: "NOT_FOUND",
			message: "memory delivery intent not found",
		}
	}
	if (
		intent.state !== "promotion-pending" ||
		intent.promotionApproval !== "required"
	) {
		return {
			ok: false,
			status: 409,
			code: "INVALID_DELIVERY_STATE",
			message:
				`delivery ${params.operationId} is ${intent.state}` +
				(intent.promotionApproval
					? ` (approval ${intent.promotionApproval})`
					: ""),
		}
	}
	let promotion: MemoryWikiPromotion | undefined
	try {
		promotion = persistedPromotion(
			intent,
			params.resolvePrincipal ?? defaultResolveReplayPrincipal,
		)
		if (!promotion) {
			return {
				ok: false,
				status: 409,
				code: "PROMOTION_INVALID",
				message: "persisted wiki promotion is invalid",
			}
		}
	} catch (error) {
		return {
			ok: false,
			status: 409,
			code: "PROMOTION_UNAUTHORIZED",
			message: error instanceof Error ? error.message : String(error),
		}
	}
	const wikiPromotion = intent.payload.wikiPromotion
	const rawPage =
		typeof wikiPromotion === "object" && wikiPromotion !== null
			? (wikiPromotion as Record<string, unknown>).page
			: undefined
	const pageSlug =
		typeof rawPage === "object" && rawPage !== null
			? String((rawPage as Record<string, unknown>).slug ?? "")
			: ""
	try {
		await withWikiTransaction(async (transactionHandle, session) => {
			await setMemoryDeliveryPromotionApproval(
				transactionHandle,
				params.operationId,
				"approved",
				session,
			)
			await promoteMemoryDelivery(
				transactionHandle,
				params.operationId,
				promotion!.key,
				promotion!.mutateWiki,
				session,
			)
		})
		return { ok: true, operationId: params.operationId, pageSlug }
	} catch (error) {
		const classified = classifyFailure(error)
		const errorCode =
			classified.code === "OUTCOME_UNKNOWN"
				? "PROMOTION_FAILED"
				: classified.code
		// Record the failed attempt so repeated failures eventually dead-letter
		// rather than being retried forever.
		try {
			await withWikiTransaction((recoveryHandle, session) =>
				failMemoryPromotion(
					recoveryHandle,
					params.operationId,
					errorCode,
					session,
				),
			)
		} catch {
			// Preserve the original promotion failure when ledger recovery races.
		}
		return {
			ok: false,
			status: 409,
			code: errorCode,
			message: error instanceof Error ? error.message : "wiki promotion failed",
		}
	}
}

export async function reconcileMemoryDeliveriesOnce(
	options: {
		now?: number
		limitPerState?: number
		resolvePrincipal?: (subjectId: string) => ApiPrincipal | null
	} = {},
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
		// Approval-queued promotions wait for an explicit admin approval;
		// auto-replay would defeat the queue (and starve other due intents).
		if (intent.promotionApproval === "required") continue
		if (!isDueForReconciliation(intent, now)) continue
		attempted++
		try {
			const promotion = persistedPromotion(
				intent,
				options.resolvePrincipal ?? defaultResolveReplayPrincipal,
			)
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
	options: {
		intervalMs?: number
		onError?: (error: unknown) => void
		resolvePrincipal?: (subjectId: string) => ApiPrincipal | null
	} = {},
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
		active = reconcileMemoryDeliveriesOnce({
			resolvePrincipal: options.resolvePrincipal,
		})
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
