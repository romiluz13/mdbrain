import { randomUUID } from "node:crypto"
import { Hono, type Context } from "hono"
import type { ApiEnvironment } from "../api-context.js"
import { getApiPrincipal, getAuthorizedRequestScope } from "../api-context.js"
import type { AuthorizedRequestScope } from "../api-context.js"
import {
	mdbrainBridgeAdd,
	mdbrainBridgeBuildContextBundle,
	mdbrainBridgeBuildDiscoveryProjection,
	mdbrainBridgeHydrateActiveSlate,
	mdbrainBridgeProfile,
	mdbrainBridgeRecallConversation,
	mdbrainBridgeApplyMemoryFeedback,
	mdbrainBridgeDeleteLifecycleItem,
	mdbrainBridgeExtractEvent,
	mdbrainBridgeGetLifecycleHistory,
	mdbrainBridgeGetLifecycleItem,
	mdbrainBridgeGetState,
	mdbrainBridgeSearch,
	mdbrainBridgeSearchDetailed,
	mdbrainBridgeSearchKB,
	mdbrainBridgeUpdateLifecycleItem,
	mdbrainBridgeReportProcedureOutcome,
	mdbrainBridgeWriteConversationEvent,
	mdbrainBridgeWriteProcedure,
	mdbrainBridgeWriteStructuredMemory,
	type MemoryStableHandle,
	type ProcedureEntry,
	type StructuredMemoryEntry,
} from "@mdbrain/memory-bridge"
import {
	createWikiPage,
	getWikiPage,
	listWikiPages,
	updateWikiPage,
	deleteWikiPage,
	renderMarkdown,
	renderHtml,
	importOkfBundle,
	exportOkfBundle,
	searchWikiPages,
	listUnresolvedContradictions,
	listWikiPageRevisions,
	listMemoryDeliveryIntents,
	MemoryDeliveryPayloadTooLargeError,
	getWikiPageRevision,
	resolveTransclusions,
	recordWikiMutationIntent,
	WikiDuplicateSlugError,
	type WikiDbHandle,
	type WikiPageInput,
	type GovernanceContext,
} from "@mdbrain/wiki-engine"
import { jsonError } from "../lib/errors.js"
import {
	approvePendingWikiPromotion,
	buildMemoryDeliveryOperationId,
	buildMemoryWikiPromotion,
	deliverMemoryWrite,
	MemoryDeliveryDispatchError,
	redriveDeadLetteredMemoryDelivery,
	wikiPromotionApprovalRequired,
} from "../memory-delivery-runtime.js"
import {
	getWikiStoreHandle,
	withWikiTransaction,
} from "../wiki-store-runtime.js"

const MAX_LIST_LIMIT = 100
const MAX_HISTORY_LIMIT = 200
const VALID_SCOPE_VALUES = [
	"session",
	"user",
	"agent",
	"workspace",
	"tenant",
	"global",
] as const
type ApiScope = (typeof VALID_SCOPE_VALUES)[number]
const WIKI_VALID_KINDS = [
	"entity",
	"concept",
	"synthesis",
	"source",
	"report",
	"procedure",
]
const WIKI_VALID_TRUST_TIERS = ["restricted", "standard", "admin"]
type MemongoFailure = {
	code: string
	message: string
	retryable: boolean
	outcome: string
	status?: number
	retryAfterMs?: number
}

function asMemongoFailure(error: unknown): MemongoFailure | undefined {
	if (!error || typeof error !== "object") return undefined
	const value = error as Record<string, unknown>
	if (
		typeof value.code !== "string" ||
		typeof value.message !== "string" ||
		typeof value.retryable !== "boolean" ||
		typeof value.outcome !== "string"
	) {
		return undefined
	}
	return {
		code: value.code,
		message: value.message,
		retryable: value.retryable,
		outcome: value.outcome,
		...(typeof value.status === "number" ? { status: value.status } : {}),
		...(typeof value.retryAfterMs === "number"
			? { retryAfterMs: value.retryAfterMs }
			: {}),
	}
}

function memongoResponseStatus(status?: number) {
	switch (status) {
		case 400:
		case 401:
		case 403:
		case 404:
		case 409:
		case 429:
		case 500:
		case 502:
		case 503:
		case 504:
			return status
		default:
			return 502
	}
}

function bridgeJsonError(
	c: Context<ApiEnvironment>,
	fallbackCode: string,
	error: unknown,
) {
	const failure = asMemongoFailure(error)
	if (!failure) {
		const message = error instanceof Error ? error.message : String(error)
		return jsonError(c, 500, fallbackCode, message)
	}
	if (failure.retryAfterMs !== undefined) {
		c.header(
			"Retry-After",
			String(Math.max(1, Math.ceil(failure.retryAfterMs / 1000))),
		)
	}
	return jsonError(
		c,
		memongoResponseStatus(failure.status),
		failure.code,
		failure.message,
		{
			retryable: failure.retryable,
			outcome: failure.outcome,
			...(failure.retryAfterMs !== undefined
				? { retryAfterMs: failure.retryAfterMs }
				: {}),
		},
	)
}

function readAgentId(body: Record<string, unknown>): string | undefined {
	return typeof body.agentId === "string" ? body.agentId : undefined
}

function parseListLimit(raw?: string): number | null | undefined {
	if (raw === undefined) {
		return undefined
	}
	const parsed = Number(raw)
	if (!Number.isFinite(parsed)) {
		return null
	}
	return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(parsed)))
}

function readContainerTag(body: Record<string, unknown>): string | undefined {
	return typeof body.containerTag === "string" && body.containerTag.trim()
		? body.containerTag
		: undefined
}

function readQuery(body: Record<string, unknown>): string {
	if (typeof body.query === "string") {
		return body.query
	}
	if (typeof body.q === "string") {
		return body.q
	}
	return ""
}

function readLimit(body: Record<string, unknown>): number | undefined {
	if (typeof body.limit === "number") {
		return body.limit
	}
	return typeof body.maxResults === "number" ? body.maxResults : undefined
}

function readSessionId(body: Record<string, unknown>): string | undefined {
	if (typeof body.sessionId === "string" && body.sessionId.trim()) {
		return body.sessionId
	}
	return readContainerTag(body)
}

function readSessionKey(body: Record<string, unknown>): string | undefined {
	if (typeof body.sessionKey === "string" && body.sessionKey.trim()) {
		return body.sessionKey
	}
	return readContainerTag(body)
}

function readScopeRef(body: Record<string, unknown>): string | undefined {
	if (typeof body.scopeRef === "string" && body.scopeRef.trim()) {
		return body.scopeRef
	}
	return readContainerTag(body)
}

function readScope(body: Record<string, unknown>): ApiScope | undefined {
	const scope = typeof body.scope === "string" ? body.scope : undefined
	if (VALID_SCOPE_VALUES.includes(scope as ApiScope)) {
		return scope as ApiScope
	}
	return undefined
}

function readScopeInputError(body: Record<string, unknown>): string | null {
	if (
		body.scope !== undefined &&
		(typeof body.scope !== "string" || !readScope(body))
	) {
		return "scope must be session|user|agent|workspace|tenant|global"
	}
	if (
		body.scopeRef !== undefined &&
		(typeof body.scopeRef !== "string" || !body.scopeRef.trim())
	) {
		return "scopeRef must be a non-empty string"
	}
	const scope = readScope(body)
	if (
		scope === "session" &&
		!readScopeRef(body) &&
		!readSessionId(body) &&
		!readSessionKey(body)
	) {
		return "session scope requires sessionId, sessionKey, scopeRef, or containerTag"
	}
	if ((scope === "user" || scope === "tenant") && !readScopeRef(body)) {
		return `${scope} scope requires scopeRef`
	}
	return null
}

/**
 * Effective write identity (REV-01 A1 fix): write routes execute under the
 * middleware-authorized request scope, never under divergent body defaults.
 * The body may narrow or repeat the authorized identity, but a conflicting
 * body identity is rejected. When the request omits an identity component,
 * the authorized (query-derived) value wins; only when neither supplies one
 * does the route default apply — and the exact resolved tuple is what is
 * dispatched upstream and stored in the delivery ledger.
 */
type WriteIdentity = { agentId: string; scope: ApiScope; scopeRef: string }

type WriteIdentityResolution =
	| { ok: true; identity: WriteIdentity }
	| { ok: false; error: string }

function resolveWriteIdentity(
	body: Record<string, unknown>,
	authorized: AuthorizedRequestScope,
): WriteIdentityResolution {
	const bodyAgentId = readAgentId(body)
	const bodyScope = readScope(body)
	const bodyScopeRef = readScopeRef(body)
	if (bodyAgentId && authorized.agentId && bodyAgentId !== authorized.agentId) {
		return {
			ok: false,
			error: "agentId conflicts with the authorized request scope",
		}
	}
	if (bodyScope && authorized.scope && bodyScope !== authorized.scope) {
		return {
			ok: false,
			error: "scope conflicts with the authorized request scope",
		}
	}
	if (
		bodyScopeRef &&
		authorized.scopeRef &&
		bodyScopeRef !== authorized.scopeRef
	) {
		return {
			ok: false,
			error: "scopeRef conflicts with the authorized request scope",
		}
	}
	const agentId = authorized.agentId ?? bodyAgentId ?? "default"
	const scope = (authorized.scope ?? bodyScope ?? "agent") as ApiScope
	const scopeRef = authorized.scopeRef ?? bodyScopeRef ?? agentId
	return { ok: true, identity: { agentId, scope, scopeRef } }
}

/**
 * Optional agentId-only resolution for routes without a scope/scopeRef
 * payload (/extract, /write-structured, /write-procedure). Conflicting body
 * identity is rejected; the authorized value wins otherwise.
 */
type AgentIdentityResolution =
	| { ok: true; agentId: string | undefined }
	| { ok: false; error: string }

function resolveAgentIdentity(
	bodyAgentId: string | undefined,
	authorizedAgentId: string | undefined,
): AgentIdentityResolution {
	if (bodyAgentId && authorizedAgentId && bodyAgentId !== authorizedAgentId) {
		return {
			ok: false,
			error: "agentId conflicts with the authorized request scope",
		}
	}
	return { ok: true, agentId: authorizedAgentId ?? bodyAgentId }
}

function readAccessCollection(
	raw: string | undefined,
):
	| "events"
	| "structured_mem"
	| "procedures"
	| "episodes"
	| "entities"
	| "relations"
	| undefined {
	if (
		raw === "events" ||
		raw === "structured_mem" ||
		raw === "procedures" ||
		raw === "episodes" ||
		raw === "entities" ||
		raw === "relations"
	) {
		return raw
	}
	return undefined
}

/**
 * Task 1.A — parse optional embeddingConfig from benchmark request body.
 * Returns the validated config or undefined if absent/malformed. All fields
 * must be present to accept it.
 */
function parseEmbeddingConfig(raw: unknown):
	| {
			model: string
			dimensions: number
			quantization: "float32" | "int8" | "binary"
	  }
	| undefined {
	if (!raw || typeof raw !== "object") return undefined
	const r = raw as Record<string, unknown>
	const model = typeof r.model === "string" ? r.model : undefined
	const dimensions =
		typeof r.dimensions === "number" && r.dimensions > 0
			? Math.floor(r.dimensions)
			: undefined
	const quantization =
		r.quantization === "float32" ||
		r.quantization === "int8" ||
		r.quantization === "binary"
			? r.quantization
			: undefined
	if (!model || !dimensions || !quantization) return undefined
	return { model, dimensions, quantization }
}

/**
 * Task 1.A — parse optional rerankerConfig from benchmark request body.
 * `version` is null-able (Voyage SDK does not always expose version).
 */
function parseRerankerConfig(raw: unknown):
	| {
			model: string
			version: string | null
			stage: "post-fusion" | "pre-fusion" | "none"
	  }
	| undefined {
	if (!raw || typeof raw !== "object") return undefined
	const r = raw as Record<string, unknown>
	const model = typeof r.model === "string" ? r.model : undefined
	const version =
		typeof r.version === "string"
			? r.version
			: r.version === null
				? null
				: undefined
	const stage =
		r.stage === "post-fusion" || r.stage === "pre-fusion" || r.stage === "none"
			? r.stage
			: undefined
	if (!model || version === undefined || !stage) return undefined
	return { model, version, stage }
}

function parseBenchmarkRetrievalLane(
	raw: unknown,
): "native" | "raw-session" | undefined {
	if (typeof raw !== "string") return undefined
	const normalized = raw.trim().toLowerCase().replace(/_/g, "-")
	if (normalized === "native") return "native"
	if (normalized === "raw-session" || normalized === "session") {
		return "raw-session"
	}
	return undefined
}

function readDiscoveryProjectionKind(
	body: Record<string, unknown>,
):
	| "entity-brief"
	| "topic-brief"
	| "what-changed"
	| "contradiction-report"
	| undefined {
	const kind = typeof body.kind === "string" ? body.kind : undefined
	if (
		kind === "entity-brief" ||
		kind === "topic-brief" ||
		kind === "what-changed" ||
		kind === "contradiction-report"
	) {
		return kind
	}
	return undefined
}

function readConversationRoles(
	body: Record<string, unknown>,
): Array<"user" | "assistant" | "system" | "tool"> | undefined | null {
	if (!Array.isArray(body.roles)) {
		return undefined
	}
	const roles = body.roles.filter(
		(role): role is "user" | "assistant" | "system" | "tool" =>
			role === "user" ||
			role === "assistant" ||
			role === "system" ||
			role === "tool",
	)
	return roles.length === body.roles.length ? roles : null
}

function isRecallConversationValidationError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return (
		message.includes("invalid timestamp") ||
		message.includes("invalid date boundary") ||
		message.includes("Invalid time zone specified") ||
		message.includes("roles must contain only")
	)
}

type LifecycleSourceAgent = {
	id: string
	name: string
	runId?: string
}

type StructuredLifecyclePatchBody = {
	value?: string
	context?: string
	confidence?: number
	source?: StructuredMemoryEntry["source"]
	sessionId?: string
	tags?: string[]
	salience?: StructuredMemoryEntry["salience"]
	temporalScope?: StructuredMemoryEntry["temporalScope"]
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	validTo?: Date
	reviewAt?: Date
	lastConfirmedAt?: Date
	sourceReliability?: number
	sourceAgent?: LifecycleSourceAgent
	artifact?: StructuredMemoryEntry["artifact"]
}

type ProcedureLifecyclePatchBody = {
	name?: string
	intentTags?: string[]
	triggerQueries?: string[]
	steps?: string[]
	successSignals?: string[]
	confidence?: number
	provenance?: Record<string, unknown>
	sourceEventIds?: string[]
	sourceAgent?: LifecycleSourceAgent
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringArray(raw: unknown): string[] | null | undefined {
	if (raw === undefined) {
		return undefined
	}
	if (!Array.isArray(raw)) {
		return null
	}
	if (!raw.every((value) => typeof value === "string")) {
		return null
	}
	return raw
}

function readDateValue(raw: unknown): Date | null | undefined {
	if (raw === undefined) {
		return undefined
	}
	if (typeof raw !== "string" || !raw.trim()) {
		return null
	}
	const parsed = new Date(raw)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readSourceAgentValue(
	raw: unknown,
): LifecycleSourceAgent | null | undefined {
	if (raw === undefined) {
		return undefined
	}
	if (!isRecord(raw)) {
		return null
	}
	const id = typeof raw.id === "string" ? raw.id.trim() : ""
	const name = typeof raw.name === "string" ? raw.name.trim() : ""
	if (!id || !name) {
		return null
	}
	const runId =
		typeof raw.runId === "string" && raw.runId.trim() ? raw.runId : undefined
	return { id, name, ...(runId ? { runId } : {}) }
}

function readActorRole(
	raw: unknown,
): "user" | "assistant" | "system" | null | undefined {
	if (raw === undefined) {
		return undefined
	}
	return raw === "user" || raw === "assistant" || raw === "system" ? raw : null
}

function readLifecycleState(
	raw: unknown,
): "active" | "invalidated" | "conflicted" | undefined {
	return raw === "active" || raw === "invalidated" || raw === "conflicted"
		? raw
		: undefined
}

function readLifecycleHandle(raw: unknown): MemoryStableHandle | null {
	if (!isRecord(raw)) {
		return null
	}
	const family = raw.family
	if (family !== "structured" && family !== "procedure") {
		return null
	}
	const id = typeof raw.id === "string" ? raw.id.trim() : ""
	const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : ""
	const scope = readScope(raw)
	const scopeRef = typeof raw.scopeRef === "string" ? raw.scopeRef.trim() : ""
	const revision =
		typeof raw.revision === "number" && Number.isInteger(raw.revision)
			? raw.revision
			: Number.NaN
	const state = readLifecycleState(raw.state)
	if (!id || !agentId || !scope || !scopeRef || revision < 1 || !state) {
		return null
	}
	const validFrom = readDateValue(raw.validFrom)
	const validTo = readDateValue(raw.validTo)
	const updatedAt = readDateValue(raw.updatedAt)
	if (validFrom === null || validTo === null || updatedAt === null) {
		return null
	}
	if (family === "structured") {
		if (!isRecord(raw.structured)) {
			return null
		}
		const type =
			typeof raw.structured.type === "string" ? raw.structured.type.trim() : ""
		const key =
			typeof raw.structured.key === "string" ? raw.structured.key.trim() : ""
		if (!type || !key) {
			return null
		}
		return {
			family,
			id,
			agentId,
			scope,
			scopeRef,
			revision,
			state,
			structured: { type, key },
			...(validFrom ? { validFrom } : {}),
			...(validTo ? { validTo } : {}),
			...(updatedAt ? { updatedAt } : {}),
		}
	}
	if (!isRecord(raw.procedure)) {
		return null
	}
	const procedureId =
		typeof raw.procedure.procedureId === "string"
			? raw.procedure.procedureId.trim()
			: ""
	if (!procedureId) {
		return null
	}
	return {
		family,
		id,
		agentId,
		scope,
		scopeRef,
		revision,
		state,
		procedure: { procedureId },
		...(validFrom ? { validFrom } : {}),
		...(validTo ? { validTo } : {}),
		...(updatedAt ? { updatedAt } : {}),
	}
}

function readStructuredLifecyclePatch(
	raw: unknown,
): StructuredLifecyclePatchBody | null {
	if (!isRecord(raw)) {
		return null
	}
	const patch: StructuredLifecyclePatchBody = {}
	if ("value" in raw) {
		if (typeof raw.value !== "string") return null
		patch.value = raw.value
	}
	if ("context" in raw) {
		if (typeof raw.context !== "string") return null
		patch.context = raw.context
	}
	if ("confidence" in raw) {
		if (
			typeof raw.confidence !== "number" ||
			!Number.isFinite(raw.confidence)
		) {
			return null
		}
		patch.confidence = raw.confidence
	}
	if ("source" in raw) {
		if (
			raw.source !== "agent" &&
			raw.source !== "user" &&
			raw.source !== "session" &&
			raw.source !== "ingestion"
		) {
			return null
		}
		patch.source = raw.source
	}
	if ("sessionId" in raw) {
		if (typeof raw.sessionId !== "string") return null
		patch.sessionId = raw.sessionId
	}
	if ("tags" in raw) {
		const tags = readStringArray(raw.tags)
		if (!tags) return null
		patch.tags = tags
	}
	if ("salience" in raw) {
		if (
			raw.salience !== "critical" &&
			raw.salience !== "high" &&
			raw.salience !== "normal" &&
			raw.salience !== "low"
		) {
			return null
		}
		patch.salience = raw.salience
	}
	if ("temporalScope" in raw) {
		if (
			raw.temporalScope !== "ongoing" &&
			raw.temporalScope !== "bounded" &&
			raw.temporalScope !== "permanent" &&
			raw.temporalScope !== "transient"
		) {
			return null
		}
		patch.temporalScope = raw.temporalScope
	}
	if ("provenance" in raw) {
		if (!isRecord(raw.provenance)) return null
		patch.provenance = raw.provenance
	}
	if ("sourceEventIds" in raw) {
		const sourceEventIds = readStringArray(raw.sourceEventIds)
		if (!sourceEventIds) return null
		patch.sourceEventIds = sourceEventIds
	}
	if ("validTo" in raw) {
		const validTo = readDateValue(raw.validTo)
		if (!validTo) return null
		patch.validTo = validTo
	}
	if ("reviewAt" in raw) {
		const reviewAt = readDateValue(raw.reviewAt)
		if (!reviewAt) return null
		patch.reviewAt = reviewAt
	}
	if ("lastConfirmedAt" in raw) {
		const lastConfirmedAt = readDateValue(raw.lastConfirmedAt)
		if (!lastConfirmedAt) return null
		patch.lastConfirmedAt = lastConfirmedAt
	}
	if ("sourceReliability" in raw) {
		if (
			typeof raw.sourceReliability !== "number" ||
			!Number.isFinite(raw.sourceReliability)
		) {
			return null
		}
		patch.sourceReliability = raw.sourceReliability
	}
	if ("sourceAgent" in raw) {
		const sourceAgent = readSourceAgentValue(raw.sourceAgent)
		if (!sourceAgent) return null
		patch.sourceAgent = sourceAgent
	}
	if ("artifact" in raw) {
		if (
			!isRecord(raw.artifact) ||
			(raw.artifact.type !== "solution" &&
				raw.artifact.type !== "formula" &&
				raw.artifact.type !== "command" &&
				raw.artifact.type !== "config" &&
				raw.artifact.type !== "snippet") ||
			typeof raw.artifact.title !== "string" ||
			typeof raw.artifact.content !== "string"
		) {
			return null
		}
		patch.artifact = {
			type: raw.artifact.type,
			title: raw.artifact.title,
			content: raw.artifact.content,
		}
	}
	return Object.keys(patch).length > 0 ? patch : null
}

function readProcedureLifecyclePatch(
	raw: unknown,
): ProcedureLifecyclePatchBody | null {
	if (!isRecord(raw)) {
		return null
	}
	const patch: ProcedureLifecyclePatchBody = {}
	if ("name" in raw) {
		if (typeof raw.name !== "string") return null
		patch.name = raw.name
	}
	if ("intentTags" in raw) {
		const intentTags = readStringArray(raw.intentTags)
		if (!intentTags) return null
		patch.intentTags = intentTags
	}
	if ("triggerQueries" in raw) {
		const triggerQueries = readStringArray(raw.triggerQueries)
		if (!triggerQueries) return null
		patch.triggerQueries = triggerQueries
	}
	if ("steps" in raw) {
		const steps = readStringArray(raw.steps)
		if (!steps) return null
		patch.steps = steps
	}
	if ("successSignals" in raw) {
		const successSignals = readStringArray(raw.successSignals)
		if (!successSignals) return null
		patch.successSignals = successSignals
	}
	if ("confidence" in raw) {
		if (
			typeof raw.confidence !== "number" ||
			!Number.isFinite(raw.confidence)
		) {
			return null
		}
		patch.confidence = raw.confidence
	}
	if ("provenance" in raw) {
		if (!isRecord(raw.provenance)) return null
		patch.provenance = raw.provenance
	}
	if ("sourceEventIds" in raw) {
		const sourceEventIds = readStringArray(raw.sourceEventIds)
		if (!sourceEventIds) return null
		patch.sourceEventIds = sourceEventIds
	}
	if ("sourceAgent" in raw) {
		const sourceAgent = readSourceAgentValue(raw.sourceAgent)
		if (!sourceAgent) return null
		patch.sourceAgent = sourceAgent
	}
	return Object.keys(patch).length > 0 ? patch : null
}

export function createV1Router(): Hono<ApiEnvironment> {
	const v1 = new Hono<ApiEnvironment>()

	v1.post("/search", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const authorizedScope = getAuthorizedRequestScope(c)
		const query = readQuery(body)
		if (!query.trim()) {
			return jsonError(c, 400, "VALIDATION_ERROR", "query is required")
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const results = await mdbrainBridgeSearch({
				query,
				agentId: authorizedScope.agentId,
				maxResults: readLimit(body),
				minScore: typeof body.minScore === "number" ? body.minScore : undefined,
				sessionKey: readSessionKey(body),
				scope: authorizedScope.scope,
				scopeRef: authorizedScope.scopeRef,
			})
			return c.json({ results })
		} catch (err) {
			return bridgeJsonError(c, "SEARCH_FAILED", err)
		}
	})

	v1.post("/search-kb", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const authorizedScope = getAuthorizedRequestScope(c)
		const query = readQuery(body)
		if (!query.trim()) {
			return jsonError(c, 400, "VALIDATION_ERROR", "query is required")
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const filter =
				typeof body.filter === "object" &&
				body.filter !== null &&
				!Array.isArray(body.filter)
					? (body.filter as {
							tags?: string[]
							category?: string
							source?: string
						})
					: undefined
			const results = await mdbrainBridgeSearchKB({
				query,
				agentId: authorizedScope.agentId,
				maxResults: readLimit(body),
				minScore: typeof body.minScore === "number" ? body.minScore : undefined,
				filter,
				scope: authorizedScope.scope,
				scopeRef: authorizedScope.scopeRef,
			})
			return c.json({ results })
		} catch (err) {
			return bridgeJsonError(c, "SEARCH_KB_FAILED", err)
		}
	})

	v1.post("/recall-conversation", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const authorizedScope = getAuthorizedRequestScope(c)
		const roles = readConversationRoles(body)
		if (roles === null) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"roles must contain only user|assistant|system|tool",
			)
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const result = await mdbrainBridgeRecallConversation({
				agentId: authorizedScope.agentId,
				query: typeof body.query === "string" ? body.query : undefined,
				scope: authorizedScope.scope,
				scopeRef: authorizedScope.scopeRef,
				sessionId:
					typeof body.sessionId === "string" ? body.sessionId : undefined,
				roles,
				startTime:
					typeof body.startTime === "string" ? body.startTime : undefined,
				endTime: typeof body.endTime === "string" ? body.endTime : undefined,
				timezone: typeof body.timezone === "string" ? body.timezone : undefined,
				includeToolMessages:
					typeof body.includeToolMessages === "boolean"
						? body.includeToolMessages
						: undefined,
				limit: readLimit(body),
			})
			return c.json(result)
		} catch (err) {
			if (isRecallConversationValidationError(err)) {
				const message = err instanceof Error ? err.message : String(err)
				return jsonError(c, 400, "VALIDATION_ERROR", message)
			}
			return bridgeJsonError(c, "RECALL_CONVERSATION_FAILED", err)
		}
	})

	v1.post("/lifecycle/get", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const handle = readLifecycleHandle(body.handle)
		if (!handle) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"handle must be a valid structured/procedure stable handle",
			)
		}
		try {
			const item = await mdbrainBridgeGetLifecycleItem({ handle })
			if (!item) {
				return jsonError(c, 404, "NOT_FOUND", "memory not found")
			}
			return c.json(item)
		} catch (err) {
			return bridgeJsonError(c, "LIFECYCLE_GET_FAILED", err)
		}
	})

	v1.post("/lifecycle/update", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const handle = readLifecycleHandle(body.handle)
		if (!handle) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"handle must be a valid structured/procedure stable handle",
			)
		}
		const patch =
			handle.family === "structured"
				? readStructuredLifecyclePatch(body.patch)
				: readProcedureLifecyclePatch(body.patch)
		if (!patch) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"patch must be a valid lifecycle patch for the handle family",
			)
		}
		try {
			const item = await mdbrainBridgeUpdateLifecycleItem({ handle, patch })
			if (!item) {
				return jsonError(c, 404, "NOT_FOUND", "memory not found")
			}
			return c.json(item)
		} catch (err) {
			return bridgeJsonError(c, "LIFECYCLE_UPDATE_FAILED", err)
		}
	})

	v1.post("/lifecycle/delete", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const handle = readLifecycleHandle(body.handle)
		if (!handle) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"handle must be a valid structured/procedure stable handle",
			)
		}
		if (body.invalidatedBy !== undefined && !isRecord(body.invalidatedBy)) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"invalidatedBy must be an object when provided",
			)
		}
		try {
			const item = await mdbrainBridgeDeleteLifecycleItem({
				handle,
				...(isRecord(body.invalidatedBy)
					? { invalidatedBy: body.invalidatedBy }
					: {}),
			})
			if (!item) {
				return jsonError(c, 404, "NOT_FOUND", "memory not found")
			}
			return c.json(item)
		} catch (err) {
			return bridgeJsonError(c, "LIFECYCLE_DELETE_FAILED", err)
		}
	})

	v1.post("/lifecycle/history", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const handle = readLifecycleHandle(body.handle)
		if (!handle) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"handle must be a valid structured/procedure stable handle",
			)
		}
		if (
			body.limit !== undefined &&
			(typeof body.limit !== "number" || !Number.isFinite(body.limit))
		) {
			return jsonError(c, 400, "VALIDATION_ERROR", "limit must be a number")
		}
		const limit =
			typeof body.limit === "number"
				? Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(body.limit)))
				: undefined
		try {
			const history = await mdbrainBridgeGetLifecycleHistory({
				handle,
				limit,
			})
			if (history.length === 0) {
				return jsonError(c, 404, "NOT_FOUND", "memory not found")
			}
			return c.json(history)
		} catch (err) {
			return bridgeJsonError(c, "LIFECYCLE_HISTORY_FAILED", err)
		}
	})

	v1.post("/procedures/outcome", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const handle = readLifecycleHandle(body.handle)
		if (!handle || handle.family !== "procedure") {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"handle must be a valid procedure stable handle",
			)
		}
		if (typeof body.success !== "boolean") {
			return jsonError(c, 400, "VALIDATION_ERROR", "success must be a boolean")
		}
		if (body.note !== undefined && typeof body.note !== "string") {
			return jsonError(c, 400, "VALIDATION_ERROR", "note must be a string")
		}
		const actorRole = readActorRole(body.actorRole)
		if (actorRole === null) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"actorRole must be user|assistant|system when provided",
			)
		}
		try {
			const item = await mdbrainBridgeReportProcedureOutcome({
				handle,
				success: body.success,
				...(typeof body.note === "string" ? { note: body.note } : {}),
				...(actorRole ? { actorRole } : {}),
			})
			if (!item) {
				return jsonError(c, 404, "NOT_FOUND", "procedure not found")
			}
			return c.json(item)
		} catch (err) {
			return bridgeJsonError(c, "PROCEDURE_OUTCOME_FAILED", err)
		}
	})

	v1.post("/memory/feedback", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const handle = readLifecycleHandle(body.handle)
		if (!handle || handle.family !== "structured") {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"handle must be a valid structured memory stable handle",
			)
		}
		const signal =
			body.signal === "confirm" ||
			body.signal === "correct" ||
			body.signal === "irrelevant"
				? body.signal
				: null
		if (!signal) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"signal must be confirm|correct|irrelevant",
			)
		}
		if (body.note !== undefined && typeof body.note !== "string") {
			return jsonError(c, 400, "VALIDATION_ERROR", "note must be a string")
		}
		const actorRole = readActorRole(body.actorRole)
		if (actorRole === null) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"actorRole must be user|assistant|system when provided",
			)
		}
		const patch =
			signal === "correct"
				? readStructuredLifecyclePatch(body.patch)
				: undefined
		if (signal === "correct" && (!patch || Object.keys(patch).length === 0)) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"patch must be a valid structured lifecycle patch for correct feedback",
			)
		}
		if (body.invalidatedBy !== undefined && !isRecord(body.invalidatedBy)) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"invalidatedBy must be an object when provided",
			)
		}
		try {
			const item = await mdbrainBridgeApplyMemoryFeedback({
				handle,
				signal,
				...(patch ? { patch } : {}),
				...(typeof body.note === "string" ? { note: body.note } : {}),
				...(actorRole ? { actorRole } : {}),
				...(isRecord(body.invalidatedBy)
					? { invalidatedBy: body.invalidatedBy }
					: {}),
			})
			if (!item) {
				return jsonError(c, 404, "NOT_FOUND", "memory not found")
			}
			return c.json(item)
		} catch (err) {
			return bridgeJsonError(c, "MEMORY_FEEDBACK_FAILED", err)
		}
	})

	v1.post("/search-detailed", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		const query = readQuery(body)
		if (!query.trim()) {
			return jsonError(c, 400, "VALIDATION_ERROR", "query is required")
		}
		try {
			const searchMode =
				body.searchMode === "auto" ||
				body.searchMode === "direct" ||
				body.searchMode === "agentic"
					? body.searchMode
					: undefined
			const sourcePreference = Array.isArray(body.sourcePreference)
				? (body.sourcePreference as string[])
				: undefined
			const timeRange =
				typeof body.timeRange === "object" &&
				body.timeRange !== null &&
				!Array.isArray(body.timeRange)
					? (body.timeRange as Record<string, unknown>)
					: undefined
			const conversationScope =
				typeof body.conversationScope === "object" &&
				body.conversationScope !== null
					? (body.conversationScope as { sessionKey?: string })
					: undefined
			const structuredScope =
				typeof body.structuredScope === "object" &&
				body.structuredScope !== null
					? (body.structuredScope as Record<string, unknown>)
					: undefined
			const referenceScope =
				typeof body.referenceScope === "object" && body.referenceScope !== null
					? (body.referenceScope as Record<string, unknown>)
					: undefined
			const proceduralScope =
				typeof body.proceduralScope === "object" &&
				body.proceduralScope !== null
					? (body.proceduralScope as Record<string, unknown>)
					: undefined
			const searchConfig =
				typeof body.searchConfig === "object" &&
				body.searchConfig !== null &&
				!Array.isArray(body.searchConfig)
					? (body.searchConfig as Record<string, unknown>)
					: undefined
			const result = await mdbrainBridgeSearchDetailed({
				query,
				agentId: readAgentId(body),
				scope: readScope(body),
				scopeRef: readScopeRef(body),
				maxResults: readLimit(body),
				minScore: typeof body.minScore === "number" ? body.minScore : undefined,
				searchMode,
				sourcePreference,
				timeRange: timeRange as
					| { preset?: string; start?: string; end?: string }
					| undefined,
				needExactEvidence:
					typeof body.needExactEvidence === "boolean"
						? body.needExactEvidence
						: undefined,
				maxPasses:
					typeof body.maxPasses === "number" ? body.maxPasses : undefined,
				returnPlan:
					typeof body.returnPlan === "boolean" ? body.returnPlan : undefined,
				conversationScope,
				structuredScope: structuredScope as
					| {
							type?: string
							state?: string | string[]
							salience?: string[]
					  }
					| undefined,
				referenceScope: referenceScope as
					| {
							source?: string
							category?: string
							tags?: string[]
					  }
					| undefined,
				proceduralScope: proceduralScope as
					| { state?: string; intentTags?: string[] }
					| undefined,
				searchConfig: searchConfig as
					| {
							recipe?:
								| "fast"
								| "hybrid"
								| "deep"
								| "temporal"
								| "chain-of-thought"
							recallProfile?: "latency" | "balanced" | "proof"
							maxResults?: number
							searchMode?: "auto" | "direct" | "agentic"
							maxPasses?: number
							sourcePreference?: string[]
							timeRange?: { preset?: string; start?: string; end?: string }
							needExactEvidence?: boolean
							numCandidates?: number
							fusionMethod?: "scoreFusion" | "rankFusion" | "js-merge"
							hybridMode?: "hybrid" | "vector-only"
							allowHybridBackstop?: boolean
							lexicalPrefilter?: "disabled" | "experimental"
					  }
					| undefined,
			})
			return c.json(result)
		} catch (err) {
			return bridgeJsonError(c, "SEARCH_DETAILED_FAILED", err)
		}
	})

	v1.post("/hydrate-active-slate", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const slate = await mdbrainBridgeHydrateActiveSlate({
				agentId: readAgentId(body),
				scope: readScope(body),
				scopeRef: readScopeRef(body),
				maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
			})
			return c.json(slate)
		} catch (err) {
			return bridgeJsonError(c, "ACTIVE_SLATE_FAILED", err)
		}
	})

	v1.post("/discovery-projection", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const kind = readDiscoveryProjectionKind(body)
		if (!kind) {
			return jsonError(c, 400, "VALIDATION_ERROR", "kind is required")
		}
		if (
			(kind === "entity-brief" || kind === "topic-brief") &&
			!readQuery(body).trim()
		) {
			return jsonError(c, 400, "VALIDATION_ERROR", "query is required")
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const timeRange =
				typeof body.timeRange === "object" &&
				body.timeRange !== null &&
				!Array.isArray(body.timeRange)
					? (body.timeRange as Record<string, unknown>)
					: undefined
			const projection = await mdbrainBridgeBuildDiscoveryProjection({
				agentId: readAgentId(body),
				kind,
				query: readQuery(body) || undefined,
				scope: readScope(body),
				scopeRef: readScopeRef(body),
				maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
				timeRange: timeRange as
					| { preset?: string; start?: string; end?: string }
					| undefined,
			})
			return c.json(projection)
		} catch (err) {
			return bridgeJsonError(c, "DISCOVERY_PROJECTION_FAILED", err)
		}
	})

	v1.post("/context-bundle", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const discoveryKind =
			body.discoveryKind === undefined
				? undefined
				: readDiscoveryProjectionKind({ kind: body.discoveryKind })
		if (body.discoveryKind !== undefined && !discoveryKind) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"discoveryKind must be entity-brief|topic-brief|what-changed|contradiction-report",
			)
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const timeRange =
				typeof body.timeRange === "object" &&
				body.timeRange !== null &&
				!Array.isArray(body.timeRange)
					? (body.timeRange as Record<string, unknown>)
					: undefined
			const bundle = await mdbrainBridgeBuildContextBundle({
				agentId: readAgentId(body),
				query: readQuery(body) || undefined,
				scope: readScope(body),
				scopeRef: readScopeRef(body),
				sessionId: readSessionId(body),
				tokenBudget:
					typeof body.tokenBudget === "number" ? body.tokenBudget : undefined,
				maxActiveItems:
					typeof body.maxActiveItems === "number"
						? body.maxActiveItems
						: undefined,
				maxEvidenceItems:
					typeof body.maxEvidenceItems === "number"
						? body.maxEvidenceItems
						: undefined,
				maxRecentEvents:
					typeof body.maxRecentEvents === "number"
						? body.maxRecentEvents
						: undefined,
				includeDiscoveryProjection:
					typeof body.includeDiscoveryProjection === "boolean"
						? body.includeDiscoveryProjection
						: undefined,
				discoveryKind,
				includeProfile:
					typeof body.includeProfile === "boolean"
						? body.includeProfile
						: undefined,
				timeRange: timeRange as
					| { preset?: string; start?: string; end?: string }
					| undefined,
				mode: body.mode === "wake-up" ? "wake-up" : undefined,
			})
			return c.json(bundle)
		} catch (err) {
			return bridgeJsonError(c, "CONTEXT_BUNDLE_FAILED", err)
		}
	})

	v1.post("/add", async (c) => {
		const idempotencyKey = c.req.header("Idempotency-Key")?.trim()
		if (!idempotencyKey) {
			return jsonError(
				c,
				400,
				"IDEMPOTENCY_KEY_REQUIRED",
				"Idempotency-Key header is required",
			)
		}
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const content = typeof body.content === "string" ? body.content : ""
		if (!content.trim()) {
			return jsonError(c, 400, "VALIDATION_ERROR", "content is required")
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		const metadata =
			typeof body.metadata === "object" &&
			body.metadata !== null &&
			!Array.isArray(body.metadata)
				? (body.metadata as Record<string, unknown>)
				: undefined
		try {
			const principal = getApiPrincipal(c)
			const resolvedIdentity = resolveWriteIdentity(
				body,
				getAuthorizedRequestScope(c),
			)
			if (!resolvedIdentity.ok) {
				return jsonError(c, 403, "FORBIDDEN", resolvedIdentity.error)
			}
			const { agentId, scope, scopeRef } = resolvedIdentity.identity
			const requestId = c.req.header("X-Request-ID")?.trim()
			const promotionResult = buildMemoryWikiPromotion({
				body,
				operationId: buildMemoryDeliveryOperationId({
					operation: "add",
					idempotencyKey,
					principalSubjectId: principal.subjectId,
					scope,
					scopeRef,
				}),
				scope,
				scopeRef,
				principal,
			})
			if (promotionResult.error) {
				return jsonError(c, 400, "VALIDATION_ERROR", promotionResult.error)
			}
			const promotionApproval =
				promotionResult.promotion && wikiPromotionApprovalRequired()
					? ("required" as const)
					: undefined
			const bridgePayload = {
				content,
				agentId,
				sessionId: readSessionId(body),
				metadata,
				scope,
				scopeRef,
			}
			const payload = {
				...bridgePayload,
				agentId,
				scope,
				scopeRef,
				promotionPolicy: body.promotionPolicy ?? "none",
				...(body.wikiPromotion ? { wikiPromotion: body.wikiPromotion } : {}),
			}
			const out = await deliverMemoryWrite({
				operation: "add",
				idempotencyKey,
				payload,
				principalSubjectId: principal.subjectId,
				agentId,
				scope,
				scopeRef,
				promotion: promotionResult.promotion,
				...(promotionApproval ? { promotionApproval } : {}),
				dispatch: () =>
					mdbrainBridgeAdd({
						...bridgePayload,
						idempotencyKey,
						requestId,
					}),
			})
			return c.json({
				ok: true,
				eventId: out.eventId,
				chunkCreated: out.chunkCreated,
			})
		} catch (err) {
			if (err instanceof MemoryDeliveryDispatchError) {
				if (err.code === "LEASE_LOST") {
					// Another worker owns the claim: the client's same-key retry
					// is safe and will observe the claimant's outcome.
					return jsonError(
						c,
						409,
						"DELIVERY_LEASE_LOST",
						`Memory delivery ${err.operationId} is claimed by another worker`,
					)
				}
				const status = err.state === "conflict" ? 409 : 503
				return jsonError(
					c,
					status,
					err.state === "conflict"
						? "IDEMPOTENCY_CONFLICT"
						: "MEMORY_DELIVERY_PENDING",
					`Memory delivery is ${err.state}`,
				)
			}
			if (err instanceof MemoryDeliveryPayloadTooLargeError) {
				return jsonError(
					c,
					413,
					"PAYLOAD_TOO_LARGE",
					`Memory delivery payload exceeds ${err.limit} bytes`,
				)
			}
			return bridgeJsonError(c, "ADD_FAILED", err)
		}
	})

	v1.post("/write-event", async (c) => {
		const idempotencyKey = c.req.header("Idempotency-Key")?.trim()
		if (!idempotencyKey) {
			return jsonError(
				c,
				400,
				"IDEMPOTENCY_KEY_REQUIRED",
				"Idempotency-Key header is required",
			)
		}
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const role = body.role
		const bodyText = typeof body.body === "string" ? body.body : ""
		if (
			role !== "user" &&
			role !== "assistant" &&
			role !== "system" &&
			role !== "tool"
		) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"role must be user|assistant|system|tool",
			)
		}
		if (!bodyText.trim()) {
			return jsonError(c, 400, "VALIDATION_ERROR", "body is required")
		}
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		const metadata =
			typeof body.metadata === "object" &&
			body.metadata !== null &&
			!Array.isArray(body.metadata)
				? (body.metadata as Record<string, unknown>)
				: undefined
		try {
			const principal = getApiPrincipal(c)
			// system/tool roles speak with platform authority: they are reserved
			// for principals explicitly granted the write-trusted capability.
			// Adapter writebacks (user/assistant with provenance metadata) are
			// unaffected.
			if (
				(role === "system" || role === "tool") &&
				!principal.capabilities.includes("write-trusted")
			) {
				return jsonError(
					c,
					403,
					"FORBIDDEN",
					"system and tool write roles require the write-trusted capability",
				)
			}
			const resolvedIdentity = resolveWriteIdentity(
				body,
				getAuthorizedRequestScope(c),
			)
			if (!resolvedIdentity.ok) {
				return jsonError(c, 403, "FORBIDDEN", resolvedIdentity.error)
			}
			const {
				agentId,
				scope: resolvedScope,
				scopeRef,
			} = resolvedIdentity.identity
			const requestId = c.req.header("X-Request-ID")?.trim()
			const promotionResult = buildMemoryWikiPromotion({
				body,
				operationId: buildMemoryDeliveryOperationId({
					operation: "write-event",
					idempotencyKey,
					principalSubjectId: principal.subjectId,
					scope: resolvedScope,
					scopeRef,
				}),
				scope: resolvedScope,
				scopeRef,
				principal,
			})
			if (promotionResult.error) {
				return jsonError(c, 400, "VALIDATION_ERROR", promotionResult.error)
			}
			const promotionApproval =
				promotionResult.promotion && wikiPromotionApprovalRequired()
					? ("required" as const)
					: undefined
			const bridgePayload = {
				agentId,
				role: role as "user" | "assistant" | "system" | "tool",
				body: bodyText,
				sessionId: readSessionId(body),
				timestamp:
					typeof body.timestamp === "string" ? body.timestamp : undefined,
				metadata,
				scope: resolvedScope,
				scopeRef,
			}
			const payload = {
				...bridgePayload,
				agentId,
				scope: resolvedScope,
				scopeRef,
				promotionPolicy: body.promotionPolicy ?? "none",
				...(body.wikiPromotion ? { wikiPromotion: body.wikiPromotion } : {}),
			}
			const out = await deliverMemoryWrite({
				operation: "write-event",
				idempotencyKey,
				payload,
				principalSubjectId: principal.subjectId,
				agentId,
				scope: resolvedScope,
				scopeRef,
				promotion: promotionResult.promotion,
				...(promotionApproval ? { promotionApproval } : {}),
				dispatch: () =>
					mdbrainBridgeWriteConversationEvent({
						...bridgePayload,
						idempotencyKey,
						requestId,
					}),
			})
			return c.json({
				ok: true,
				eventId: out.eventId,
				chunkCreated: out.chunkCreated,
			})
		} catch (err) {
			if (err instanceof MemoryDeliveryDispatchError) {
				if (err.code === "LEASE_LOST") {
					// Another worker owns the claim: the client's same-key retry
					// is safe and will observe the claimant's outcome.
					return jsonError(
						c,
						409,
						"DELIVERY_LEASE_LOST",
						`Memory delivery ${err.operationId} is claimed by another worker`,
					)
				}
				const status = err.state === "conflict" ? 409 : 503
				return jsonError(
					c,
					status,
					err.state === "conflict"
						? "IDEMPOTENCY_CONFLICT"
						: "MEMORY_DELIVERY_PENDING",
					`Memory delivery is ${err.state}`,
				)
			}
			if (err instanceof MemoryDeliveryPayloadTooLargeError) {
				return jsonError(
					c,
					413,
					"PAYLOAD_TOO_LARGE",
					`Memory delivery payload exceeds ${err.limit} bytes`,
				)
			}
			return bridgeJsonError(c, "WRITE_EVENT_FAILED", err)
		}
	})

	v1.post("/extract", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const eventId = typeof body.eventId === "string" ? body.eventId : ""
		if (!eventId.trim()) {
			return jsonError(c, 400, "VALIDATION_ERROR", "eventId is required")
		}
		const resolvedAgent = resolveAgentIdentity(
			readAgentId(body),
			getAuthorizedRequestScope(c).agentId,
		)
		if (!resolvedAgent.ok) {
			return jsonError(c, 403, "FORBIDDEN", resolvedAgent.error)
		}
		try {
			const out = await mdbrainBridgeExtractEvent({
				agentId: resolvedAgent.agentId,
				eventId,
			})
			return c.json({ ok: true, ...out }, 202)
		} catch (err) {
			return bridgeJsonError(c, "EXTRACT_FAILED", err)
		}
	})

	v1.post("/write-structured", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const entry = body.entry
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return jsonError(c, 400, "VALIDATION_ERROR", "entry object is required")
		}
		const resolvedAgent = resolveAgentIdentity(
			readAgentId(body),
			getAuthorizedRequestScope(c).agentId,
		)
		if (!resolvedAgent.ok) {
			return jsonError(c, 403, "FORBIDDEN", resolvedAgent.error)
		}
		// REV-01 A14 guard: a nested entry.agentId may not launder a different
		// identity past the authorized one.
		const rawEntryAgentId = (entry as Record<string, unknown>).agentId
		const entryAgentId =
			typeof rawEntryAgentId === "string" && rawEntryAgentId.trim()
				? rawEntryAgentId
				: undefined
		if (
			entryAgentId &&
			resolvedAgent.agentId &&
			entryAgentId !== resolvedAgent.agentId
		) {
			return jsonError(
				c,
				403,
				"FORBIDDEN",
				"entry.agentId conflicts with the authorized request scope",
			)
		}
		try {
			const out = await mdbrainBridgeWriteStructuredMemory({
				agentId: resolvedAgent.agentId ?? entryAgentId,
				entry: entry as StructuredMemoryEntry,
			})
			return c.json(out)
		} catch (err) {
			return bridgeJsonError(c, "WRITE_STRUCTURED_FAILED", err)
		}
	})

	v1.post("/write-procedure", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const entry = body.entry
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return jsonError(c, 400, "VALIDATION_ERROR", "entry object is required")
		}
		const resolvedAgent = resolveAgentIdentity(
			readAgentId(body),
			getAuthorizedRequestScope(c).agentId,
		)
		if (!resolvedAgent.ok) {
			return jsonError(c, 403, "FORBIDDEN", resolvedAgent.error)
		}
		const rawEntryAgentId = (entry as Record<string, unknown>).agentId
		const entryAgentId =
			typeof rawEntryAgentId === "string" && rawEntryAgentId.trim()
				? rawEntryAgentId
				: undefined
		if (
			entryAgentId &&
			resolvedAgent.agentId &&
			entryAgentId !== resolvedAgent.agentId
		) {
			return jsonError(
				c,
				403,
				"FORBIDDEN",
				"entry.agentId conflicts with the authorized request scope",
			)
		}
		try {
			const out = await mdbrainBridgeWriteProcedure({
				agentId: resolvedAgent.agentId ?? entryAgentId,
				entry: entry as ProcedureEntry,
			})
			return c.json(out)
		} catch (err) {
			return bridgeJsonError(c, "WRITE_PROCEDURE_FAILED", err)
		}
	})

	v1.post("/profile", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const scopeError = readScopeInputError(body)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		try {
			const profile = await mdbrainBridgeProfile({
				agentId: readAgentId(body),
				scope: readScope(body),
				scopeRef: readScopeRef(body),
				maxEntities:
					typeof body.maxEntities === "number" ? body.maxEntities : undefined,
				maxEpisodes:
					typeof body.maxEpisodes === "number" ? body.maxEpisodes : undefined,
				maxPerType:
					typeof body.maxPerType === "number" ? body.maxPerType : undefined,
				activityWindowMs:
					typeof body.activityWindowMs === "number"
						? body.activityWindowMs
						: undefined,
			})
			return c.json(profile)
		} catch (err) {
			return bridgeJsonError(c, "PROFILE_FAILED", err)
		}
	})

	v1.get("/state", async (c) => {
		const query = c.req.query() as Record<string, unknown>
		const scopeError = readScopeInputError(query)
		if (scopeError) {
			return jsonError(c, 400, "VALIDATION_ERROR", scopeError)
		}
		const agentId = c.req.query("agentId") ?? undefined
		const scope = readScope(query)
		const scopeRef = readScopeRef(query)
		try {
			const state = await mdbrainBridgeGetState({ agentId, scope, scopeRef })
			return c.json(state)
		} catch (err) {
			return bridgeJsonError(c, "STATE_FAILED", err)
		}
	})

	v1.get("/admin/deliveries", async (c) => {
		const state = c.req.query("state")
		const deliveryStates = [
			"recorded",
			"delivering",
			"retryable",
			"outcome-unknown",
			"confirmed",
			"promotion-pending",
			"promoted",
			"dead-letter",
			"conflict",
		] as const
		if (
			state &&
			!deliveryStates.includes(state as (typeof deliveryStates)[number])
		) {
			return jsonError(c, 400, "VALIDATION_ERROR", "invalid delivery state")
		}
		const limit = parseListLimit(c.req.query("limit"))
		if (limit === null) {
			return jsonError(c, 400, "VALIDATION_ERROR", "limit must be 1..100")
		}
		try {
			const handle = await getWikiStoreHandle()
			const deliveries = await listMemoryDeliveryIntents(handle, {
				state: state as (typeof deliveryStates)[number] | undefined,
				scope: c.req.query("scope"),
				scopeRef: c.req.query("scopeRef"),
				limit,
			})
			return c.json({
				deliveries: deliveries.map(
					({
						payload: _payload,
						idempotencyKey: _idempotencyKey,
						payloadFingerprint: _payloadFingerprint,
						principalSubjectId: _principalSubjectId,
						...delivery
					}) => {
						void _payload
						void _idempotencyKey
						void _payloadFingerprint
						void _principalSubjectId
						return delivery
					},
				),
			})
		} catch {
			return jsonError(
				c,
				500,
				"DELIVERY_LIST_FAILED",
				"Unable to list memory deliveries",
			)
		}
	})

	// Approves a promotion-pending memory delivery that was recorded under
	// approval mode (MDBRAIN_WIKI_PROMOTION_REQUIRE_APPROVAL). Gated to the
	// administer capability by the /v1/admin/* middleware. The original
	// principal is re-authorized at its current credential state before the
	// promotion executes.
	v1.post("/admin/wiki-promotions/:operationId/approve", async (c) => {
		const operationId = c.req.param("operationId")?.trim()
		if (!operationId) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"operationId path parameter is required",
			)
		}
		const result = await approvePendingWikiPromotion({ operationId })
		if (!result.ok) {
			return jsonError(c, result.status, result.code, result.message)
		}
		return c.json({
			ok: true,
			operationId,
			state: "promoted",
			pageSlug: result.pageSlug,
		})
	})
	// Requeues a dead-lettered memory delivery intent for a fresh delivery
	// lifecycle (counters reset, failure evidence cleared). Gated to the
	// administer capability by the /v1/admin/* middleware. A dead letter
	// carrying a confirmed receipt is requeued as promotion-pending so the
	// promotion is retried rather than redispatched.
	v1.post("/admin/deliveries/:operationId/redrive", async (c) => {
		const operationId = c.req.param("operationId")?.trim()
		if (!operationId) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"operationId path parameter is required",
			)
		}
		const result = await redriveDeadLetteredMemoryDelivery({ operationId })
		if (!result.ok) {
			return jsonError(c, result.status, result.code, result.message)
		}
		return c.json({
			ok: true,
			operationId,
			state: result.state,
		})
	})

	// ---------------------------------------------------------------------------
	// Wiki routes (/v1/wiki/*) — T3
	// ---------------------------------------------------------------------------

	async function readWikiDbHandle(_agentId?: string) {
		return getWikiStoreHandle()
	}

	// Slug may contain slashes (OKF concept IDs are file paths like
	// "tables/users"), so routes use /wiki/* and parse the slug from the path.
	// Robust against slugs containing the literal "/wiki/" substring and
	// against a trailing slash.
	function readWikiSlug(c: { req: { path: string } }): string {
		const afterWiki = c.req.path.split("/wiki/").slice(1).join("/wiki/")
		return (afterWiki ?? "").replace(/\/$/, "")
	}

	const WIKI_VALID_SCOPES = [
		"session",
		"user",
		"agent",
		"workspace",
		"tenant",
		"global",
	]
	function buildWikiGovContext(
		c: Parameters<typeof getApiPrincipal>[0],
		scope: string,
		scopeRef: string,
	): GovernanceContext {
		const principal = getApiPrincipal(c)
		return {
			scope,
			scopeRef,
			subjectId: principal.subjectId,
			groups: principal.groups,
			// The development principal is full-capability; governance sees it
			// as admin while the principal itself reports "development" for audit.
			trustTier:
				principal.trustTier === "development" ? "admin" : principal.trustTier,
			roles: principal.roles,
			departments: principal.departments,
			capabilities: principal.capabilities,
		}
	}

	function readWikiOperationId(
		c: Parameters<typeof getApiPrincipal>[0],
	): string {
		return (
			c.req.header("Idempotency-Key")?.trim() ||
			c.req.header("X-Request-ID")?.trim() ||
			randomUUID()
		)
	}

	function canChangeWikiPermissions(
		c: Parameters<typeof getApiPrincipal>[0],
	): boolean {
		return getApiPrincipal(c).capabilities.includes("change-permissions")
	}

	v1.post("/wiki", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const kind = String(body.kind ?? "")
		const title = String(body.title ?? "")
		const slug = String(body.slug ?? "")
		const summary = String(body.summary ?? "")
		const scope = String(body.scope ?? "")
		const scopeRef = String(body.scopeRef ?? "")
		const trustTier = String(body.trustTier ?? "")
		const frontmatter = (body.frontmatter ?? {}) as Record<string, unknown>
		if (!title.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "title is required")
		if (!slug.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "slug is required")
		if (!summary.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "summary is required")
		if (!WIKI_VALID_KINDS.includes(kind))
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				`kind must be one of ${WIKI_VALID_KINDS.join("|")}`,
			)
		if (!WIKI_VALID_SCOPES.includes(scope))
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				`scope must be one of ${WIKI_VALID_SCOPES.join("|")}`,
			)
		if (!scopeRef.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "scopeRef is required")
		if (!WIKI_VALID_TRUST_TIERS.includes(trustTier))
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				`trustTier must be one of ${WIKI_VALID_TRUST_TIERS.join("|")}`,
			)
		if (
			!frontmatter ||
			typeof frontmatter !== "object" ||
			!String(frontmatter.type ?? "").trim()
		)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"frontmatter.type is required (OKF)",
			)
		try {
			const principal = getApiPrincipal(c)
			const permissions =
				body.permissions &&
				typeof body.permissions === "object" &&
				!Array.isArray(body.permissions)
					? (body.permissions as Record<string, unknown>)
					: {}
			if (
				(trustTier !== principal.trustTier ||
					Object.keys(permissions).length > 0) &&
				!canChangeWikiPermissions(c)
			) {
				return jsonError(
					c,
					403,
					"FORBIDDEN",
					"change-permissions capability is required",
				)
			}
			const input = body as unknown as WikiPageInput
			const page = await withWikiTransaction(async (handle, session) => {
				const created = await createWikiPage(handle, input, { session })
				await recordWikiMutationIntent(
					handle,
					{
						operationId: readWikiOperationId(c),
						kind: "create",
						pageSlug: slug,
						scope,
						scopeRef,
						principalSubjectId: principal.subjectId,
						payload: body,
					},
					session,
				)
				return created
			})
			return c.json(page, 201)
		} catch (err) {
			if (err instanceof WikiDuplicateSlugError) {
				return jsonError(c, 409, "DUPLICATE_SLUG", err.message)
			}
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_CREATE_FAILED", message)
		}
	})

	v1.get("/wiki", async (c) => {
		const scope = c.req.query("scope")
		const scopeRef = c.req.query("scopeRef")
		const kind = c.req.query("kind")
		const trustTier = c.req.query("trustTier")
		const state = c.req.query("state")
		const limit = c.req.query("limit")
			? Number(c.req.query("limit"))
			: undefined
		const skip = c.req.query("skip") ? Number(c.req.query("skip")) : undefined
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef query params are required",
			)
		try {
			const handle = await readWikiDbHandle(
				String(c.req.query("agentId") ?? ""),
			)
			const result = await listWikiPages(handle, {
				kind: kind ?? undefined,
				scope: scope ?? undefined,
				scopeRef: scopeRef ?? undefined,
				trustTier: trustTier ?? undefined,
				state: state ?? undefined,
				limit: Number.isFinite(limit) ? limit : undefined,
				skip: Number.isFinite(skip) ? skip : undefined,
				governance: buildWikiGovContext(c, scope, scopeRef),
			})
			return c.json(result)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_LIST_FAILED", message)
		}
	})

	// Wiki lint (/v1/wiki/lint) — T12: lists pages + unresolved contradictions
	v1.get("/wiki/lint", async (c) => {
		const scope = c.req.query("scope")
		const scopeRef = c.req.query("scopeRef")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		try {
			const handle = await readWikiDbHandle(
				String(c.req.query("agentId") ?? ""),
			)
			const governance = buildWikiGovContext(c, scope, scopeRef)
			const [pagesResult, contradictions] = await Promise.all([
				listWikiPages(handle, {
					scope,
					scopeRef,
					limit: MAX_LIST_LIMIT,
					governance,
				}),
				listUnresolvedContradictions(handle, scope, scopeRef, governance),
			])
			return c.json({
				pages: pagesResult.pages,
				total: pagesResult.total,
				unresolvedContradictions: contradictions,
			})
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_LINT_FAILED", message)
		}
	})

	// Wiki revision history (/v1/wiki/revisions, /v1/wiki/revisions/:revision).
	// Gated behind the same governed read a caller would need for the live
	// page — revision history must never be a side channel around governance
	// (a caller who can't currently read a page can't read its history either).
	v1.get("/wiki/revisions", async (c) => {
		const slug = c.req.query("slug")
		const scope = c.req.query("scope")
		const scopeRef = c.req.query("scopeRef")
		const limit = Number(c.req.query("limit") ?? "50")
		if (!slug) return jsonError(c, 400, "VALIDATION_ERROR", "slug is required")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		try {
			const handle = await readWikiDbHandle(
				String(c.req.query("agentId") ?? ""),
			)
			const governance = buildWikiGovContext(c, scope, scopeRef)
			const page = await getWikiPage(handle, slug, scope, scopeRef, governance)
			if (!page)
				return jsonError(
					c,
					404,
					"WIKI_NOT_FOUND",
					`wiki page "${slug}" not found in scope ${scope}:${scopeRef}`,
				)
			const revisions = await listWikiPageRevisions(handle, {
				pageSlug: slug,
				scope,
				scopeRef,
				limit: Number.isFinite(limit) ? limit : undefined,
				governance,
			})
			return c.json({ revisions })
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_REVISIONS_FAILED", message)
		}
	})

	v1.get("/wiki/revisions/:revision", async (c) => {
		const slug = c.req.query("slug")
		const scope = c.req.query("scope")
		const scopeRef = c.req.query("scopeRef")
		const revision = Number(c.req.param("revision"))
		if (!slug) return jsonError(c, 400, "VALIDATION_ERROR", "slug is required")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		if (!Number.isFinite(revision) || revision < 1)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"revision must be a positive integer",
			)
		try {
			const handle = await readWikiDbHandle(
				String(c.req.query("agentId") ?? ""),
			)
			const governance = buildWikiGovContext(c, scope, scopeRef)
			const page = await getWikiPage(handle, slug, scope, scopeRef, governance)
			if (!page)
				return jsonError(
					c,
					404,
					"WIKI_NOT_FOUND",
					`wiki page "${slug}" not found in scope ${scope}:${scopeRef}`,
				)
			const record = await getWikiPageRevision(handle, {
				pageSlug: slug,
				scope,
				scopeRef,
				revision,
				governance,
			})
			if (!record)
				return jsonError(
					c,
					404,
					"WIKI_REVISION_NOT_FOUND",
					`revision ${revision} of "${slug}" not found`,
				)
			return c.json(record)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_REVISIONS_FAILED", message)
		}
	})

	v1.get("/wiki/*", async (c) => {
		const slug = readWikiSlug(c)
		const scope = String(c.req.query("scope") ?? "")
		const scopeRef = String(c.req.query("scopeRef") ?? "")
		const format = c.req.query("format")
		const transclude = c.req.query("transclude") === "true"
		if (!slug) return jsonError(c, 400, "VALIDATION_ERROR", "slug is required")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef query params are required",
			)
		try {
			const handle = await readWikiDbHandle(
				String(c.req.query("agentId") ?? ""),
			)
			const governance = buildWikiGovContext(c, scope, scopeRef)
			const page = await getWikiPage(handle, slug, scope, scopeRef, governance)
			if (!page)
				return jsonError(
					c,
					404,
					"WIKI_NOT_FOUND",
					`wiki page "${slug}" not found in scope ${scope}:${scopeRef}`,
				)
			// Transclusion resolution is opt-in: the stored body keeps its raw
			// {{page:slug}} markers by default (what an editor should see/edit),
			// resolved only when the caller explicitly asks for it. Resolved
			// through the SAME governance context as the page itself, so a
			// marker referencing a page the caller can't read never leaks
			// content — see wiki-transclusion.ts.
			const resolvedPage = transclude
				? {
						...page,
						body: await resolveTransclusions(handle, page.body, governance),
					}
				: page
			if (format === "html") {
				return c.html(renderHtml(resolvedPage))
			}
			if (format === "markdown") {
				return c.text(renderMarkdown(resolvedPage), 200, {
					"Content-Type": "text/markdown; charset=utf-8",
				})
			}
			return c.json(resolvedPage)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_GET_FAILED", message)
		}
	})

	v1.patch("/wiki/*", async (c) => {
		const slug = readWikiSlug(c)
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const scope = String(body.scope ?? c.req.query("scope") ?? "")
		const scopeRef = String(body.scopeRef ?? c.req.query("scopeRef") ?? "")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		if (
			body.frontmatter !== undefined &&
			(!body.frontmatter ||
				typeof body.frontmatter !== "object" ||
				Array.isArray(body.frontmatter) ||
				typeof (body.frontmatter as Record<string, unknown>).type !== "string")
		) {
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"frontmatter.type is required",
			)
		}
		try {
			const {
				scope: _s,
				scopeRef: _sr,
				slug: _sl,
				...patch
			} = body as Record<string, unknown>
			void _s
			void _sr
			void _sl
			const principal = getApiPrincipal(c)
			if (
				(patch.trustTier !== undefined || patch.permissions !== undefined) &&
				!canChangeWikiPermissions(c)
			) {
				return jsonError(
					c,
					403,
					"FORBIDDEN",
					"change-permissions capability is required",
				)
			}
			const updated = await withWikiTransaction(async (handle, session) => {
				const target = await getWikiPage(
					handle,
					slug,
					scope,
					scopeRef,
					buildWikiGovContext(c, scope, scopeRef),
					session,
				)
				if (!target) return undefined
				const result = await updateWikiPage(
					handle,
					slug,
					scope,
					scopeRef,
					patch as Partial<WikiPageInput>,
					{ session },
				)
				if (!result) return undefined
				await recordWikiMutationIntent(
					handle,
					{
						operationId: readWikiOperationId(c),
						kind: "update",
						pageSlug: slug,
						scope,
						scopeRef,
						principalSubjectId: principal.subjectId,
						payload: patch,
					},
					session,
				)
				return result
			})
			if (!updated)
				return jsonError(
					c,
					404,
					"WIKI_NOT_FOUND",
					`wiki page "${slug}" not found in scope ${scope}:${scopeRef}`,
				)
			return c.json(updated)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_UPDATE_FAILED", message)
		}
	})

	v1.delete("/wiki/*", async (c) => {
		const slug = readWikiSlug(c)
		const scope = String(c.req.query("scope") ?? "")
		const scopeRef = String(c.req.query("scopeRef") ?? "")
		const hard = c.req.query("hard") === "true"
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef query params are required",
			)
		try {
			const principal = getApiPrincipal(c)
			const deleted = await withWikiTransaction(async (handle, session) => {
				const target = await getWikiPage(
					handle,
					slug,
					scope,
					scopeRef,
					buildWikiGovContext(c, scope, scopeRef),
					session,
				)
				if (!target) return false
				const result = await deleteWikiPage(handle, slug, scope, scopeRef, {
					hard,
					session,
				})
				if (!result) return false
				await recordWikiMutationIntent(
					handle,
					{
						operationId: readWikiOperationId(c),
						kind: hard ? "hard-delete" : "soft-delete",
						pageSlug: slug,
						scope,
						scopeRef,
						principalSubjectId: principal.subjectId,
						payload: { hard },
					},
					session,
				)
				return true
			})
			if (!deleted)
				return jsonError(
					c,
					404,
					"WIKI_NOT_FOUND",
					`wiki page "${slug}" not found in scope ${scope}:${scopeRef}`,
				)
			return c.json({ ok: true, slug, scope, scopeRef, hard })
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_DELETE_FAILED", message)
		}
	})

	// OKF interchange routes (/v1/wiki/okf-import, /v1/wiki/okf-export)
	v1.post("/wiki/okf-import", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const bundleDir = String(body.bundleDir ?? "")
		const scope = String(body.scope ?? "")
		const scopeRef = String(body.scopeRef ?? "")
		const trustTier = String(body.trustTier ?? "")
		const okfBundleId = String(body.okfBundleId ?? "")
		if (!bundleDir.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "bundleDir is required")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		if (!okfBundleId.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "okfBundleId is required")
		if (!["restricted", "standard", "admin"].includes(trustTier))
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"trustTier must be restricted|standard|admin",
			)
		try {
			const principal = getApiPrincipal(c)
			if (!canChangeWikiPermissions(c)) {
				return jsonError(
					c,
					403,
					"FORBIDDEN",
					"change-permissions capability is required",
				)
			}
			const result = await withWikiTransaction(async (handle, session) => {
				const imported = await importOkfBundle(handle, bundleDir, {
					scope: scope as
						| "session"
						| "user"
						| "agent"
						| "workspace"
						| "tenant"
						| "global",
					scopeRef,
					trustTier: trustTier as "restricted" | "standard" | "admin",
					okfBundleId,
					session,
				})
				await recordWikiMutationIntent(
					handle,
					{
						operationId: readWikiOperationId(c),
						kind: "okf-import",
						pageSlug: okfBundleId,
						scope,
						scopeRef,
						principalSubjectId: principal.subjectId,
						payload: {
							bundleDir,
							trustTier,
							okfBundleId,
							conceptIds: imported.conceptIds,
						},
					},
					session,
				)
				return imported
			})
			return c.json(result)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "OKF_IMPORT_FAILED", message)
		}
	})

	v1.post("/wiki/okf-export", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const scope = String(body.scope ?? "")
		const scopeRef = String(body.scopeRef ?? "")
		const outDir = String(body.outDir ?? "")
		const okfBundleId = body.okfBundleId ? String(body.okfBundleId) : undefined
		const trustTier = body.trustTier ? String(body.trustTier) : undefined
		const returnContent = body.returnContent === true
		if (trustTier && !WIKI_VALID_TRUST_TIERS.includes(trustTier))
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"trustTier must be restricted|standard|admin",
			)
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		if (!outDir.trim())
			return jsonError(c, 400, "VALIDATION_ERROR", "outDir is required")
		try {
			const handle = await readWikiDbHandle(String(body.agentId ?? ""))
			const result = await exportOkfBundle(handle, {
				scope,
				scopeRef,
				okfBundleId,
				outDir,
				// Export must never surface a page the requester couldn't otherwise
				// read via a governed GET — filtered exactly like /wiki (list).
				governance: buildWikiGovContext(c, scope, scopeRef),
				returnContent,
			})
			return c.json(result)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "OKF_EXPORT_FAILED", message)
		}
	})

	// Wiki search (/v1/wiki/search) — T5
	v1.post("/wiki/search", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>
		const query = String(body.query ?? "").trim()
		if (!query)
			return jsonError(c, 400, "VALIDATION_ERROR", "query is required")
		const scope = String(body.scope ?? "")
		const scopeRef = String(body.scopeRef ?? "")
		if (!scope || !scopeRef)
			return jsonError(
				c,
				400,
				"VALIDATION_ERROR",
				"scope and scopeRef are required",
			)
		try {
			const handle = await readWikiDbHandle(String(body.agentId ?? ""))
			const result = await searchWikiPages(handle, {
				query,
				scope,
				scopeRef,
				kind: body.kind ? String(body.kind) : undefined,
				trustTier: body.trustTier ? String(body.trustTier) : undefined,
				state: body.state ? String(body.state) : undefined,
				privacyTier: body.privacyTier ? String(body.privacyTier) : undefined,
				recipe:
					body.recipe === "fast" ||
					body.recipe === "hybrid" ||
					body.recipe === "deep"
						? body.recipe
						: undefined,
				maxResults:
					typeof body.maxResults === "number" ? body.maxResults : undefined,
				minScore: typeof body.minScore === "number" ? body.minScore : undefined,
				governance: buildWikiGovContext(c, scope, scopeRef),
			})
			return c.json(result)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return jsonError(c, 500, "WIKI_SEARCH_FAILED", message)
		}
	})

	return v1
}
