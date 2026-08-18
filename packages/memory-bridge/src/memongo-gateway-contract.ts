import type { MemoryScope } from "@mdbrain/lib/types/memory"
import type { MemongoOperationName } from "./memongo-operation-policy.js"

export type MemorySearchResult = {
	path: string
	startLine: number
	endLine: number
	score: number
	snippet: string
	source: string
	canonicalId?: string
	sessionId?: string
	timestamp?: string
	scope?: string
	scopeRef?: string
}

export type MemoryStateResult = {
	profile: Record<string, unknown>
	blocks: {
		blocks: unknown[]
		totalTokenBudget: number
		totalActualTokens: number
	}
	bundle: Record<string, unknown>
	partial?: boolean
}

export type MemoryWriteReceipt = {
	eventId: string
	chunkCreated: boolean
}

export type MemoryBatchReceipt =
	| (MemoryWriteReceipt & { ok: true; replayed?: boolean })
	| {
			ok: false
			code: "VALIDATION_ERROR" | "IDEMPOTENCY_CONFLICT" | "WRITE_ERROR"
			message: string
	  }

export type MemoryDetailedSearchResult = {
	results: MemorySearchResult[]
	metadata: Record<string, unknown>
}

type Operation<Input, Output> = {
	input: Input
	output: Output
}

type Body = Record<string, unknown>
type Query = {
	agentId?: string
	scope?: MemoryScope
	scopeRef?: string
}

export type MemoryGatewayOperations = {
	search: Operation<Body & { query: string }, MemorySearchResult[]>
	searchDetailed: Operation<
		Body & { query: string },
		MemoryDetailedSearchResult
	>
	searchKb: Operation<Body & { query: string }, MemorySearchResult[]>
	recallConversation: Operation<
		Body,
		{ results: unknown[]; metadata: Record<string, unknown> }
	>
	profile: Operation<Body, Record<string, unknown>>
	hydrateActiveSlate: Operation<Body, Record<string, unknown>>
	discoveryProjection: Operation<
		Body & { kind: string },
		Record<string, unknown>
	>
	contextBundle: Operation<Body, Record<string, unknown>>
	state: Operation<Query, MemoryStateResult>
	add: Operation<Body & { content: string }, MemoryWriteReceipt>
	writeEvent: Operation<
		Body & {
			role: "user" | "assistant" | "system" | "tool"
			body: string
		},
		MemoryWriteReceipt
	>
	writeEvents: Operation<Body & { events: unknown[] }, MemoryBatchReceipt[]>
	extract: Operation<
		Body & { eventId: string },
		{ jobId: string; scheduled: boolean }
	>
	writeStructured: Operation<
		Body & { entry: Record<string, unknown> },
		{ upserted: boolean; id: string }
	>
	writeProcedure: Operation<
		Body & { entry: Record<string, unknown> },
		{ upserted: boolean; id: string }
	>
	lifecycleGet: Operation<Body & { handle: unknown }, Record<string, unknown>>
	lifecycleUpdate: Operation<
		Body & { handle: unknown; patch: unknown },
		Record<string, unknown>
	>
	lifecycleDelete: Operation<
		Body & { handle: unknown },
		Record<string, unknown>
	>
	lifecycleHistory: Operation<
		Body & { handle: unknown },
		Array<Record<string, unknown>>
	>
	procedureOutcome: Operation<
		Body & { handle: unknown; success: boolean },
		Record<string, unknown>
	>
	memoryFeedback: Operation<
		Body & { handle: unknown; signal: string },
		Record<string, unknown>
	>
	status: Operation<Query, Record<string, unknown>>
	embeddingProbe: Operation<Query, { ok: boolean; error?: string }>
	vectorProbe: Operation<Query, boolean>
}

export type RetainedMemongoOperation = keyof MemoryGatewayOperations

export type GatewayOperationDefinition = {
	transport: "body" | "query"
	validate: (value: unknown) => boolean
	adapt: (value: unknown) => unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string"
}

function isSearchResult(value: unknown): value is MemorySearchResult {
	if (!isRecord(value)) return false
	return (
		typeof value.path === "string" &&
		typeof value.startLine === "number" &&
		typeof value.endLine === "number" &&
		typeof value.score === "number" &&
		typeof value.snippet === "string" &&
		typeof value.source === "string" &&
		optionalString(value.canonicalId) &&
		optionalString(value.sessionId) &&
		optionalString(value.timestamp) &&
		optionalString(value.scope) &&
		optionalString(value.scopeRef)
	)
}

function isSearchEnvelope(
	value: unknown,
): value is { results: MemorySearchResult[] } {
	return (
		isRecord(value) &&
		Array.isArray(value.results) &&
		value.results.every(isSearchResult)
	)
}

function isDetailedSearch(value: unknown): boolean {
	if (!isRecord(value)) return false
	const metadata = value.metadata
	return isSearchEnvelope(value) && isRecord(metadata)
}

function isRecall(value: unknown): boolean {
	return (
		isRecord(value) &&
		Array.isArray(value.results) &&
		value.results.every(isRecord) &&
		isRecord(value.metadata) &&
		typeof value.metadata.totalMatched === "number" &&
		Array.isArray(value.metadata.filtersApplied) &&
		typeof value.metadata.searchMethod === "string" &&
		typeof value.metadata.durationMs === "number"
	)
}

function isActiveSlate(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.agentId === "string" &&
		typeof value.scope === "string" &&
		typeof value.scopeRef === "string" &&
		Array.isArray(value.items) &&
		isRecord(value.metadata) &&
		typeof value.hydratedAt === "string"
	)
}

function isDiscoveryProjection(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.kind === "string" &&
		typeof value.title === "string" &&
		typeof value.summary === "string" &&
		typeof value.scope === "string" &&
		typeof value.scopeRef === "string" &&
		Array.isArray(value.sections) &&
		isRecord(value.metadata) &&
		typeof value.builtAt === "string"
	)
}

function isContextBundle(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.agentId === "string" &&
		typeof value.scope === "string" &&
		typeof value.scopeRef === "string" &&
		typeof value.rendered === "string" &&
		Array.isArray(value.sections) &&
		isRecord(value.metadata) &&
		typeof value.builtAt === "string"
	)
}

function isState(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.profile) || !isRecord(value.bundle)) {
		return false
	}
	if (!isRecord(value.blocks)) return false
	return (
		Array.isArray(value.blocks.blocks) &&
		typeof value.blocks.totalTokenBudget === "number" &&
		typeof value.blocks.totalActualTokens === "number" &&
		(value.partial === undefined || typeof value.partial === "boolean")
	)
}

function isWriteReceipt(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.ok === true &&
		typeof value.eventId === "string" &&
		typeof value.chunkCreated === "boolean"
	)
}

function isBatchReceipt(value: unknown): boolean {
	if (!isRecord(value) || typeof value.ok !== "boolean") return false
	if (value.ok) {
		return (
			typeof value.eventId === "string" &&
			typeof value.chunkCreated === "boolean" &&
			(value.replayed === undefined || typeof value.replayed === "boolean")
		)
	}
	return typeof value.code === "string" && typeof value.message === "string"
}

function isBatchEnvelope(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.ok === true &&
		Array.isArray(value.receipts) &&
		value.receipts.every(isBatchReceipt)
	)
}

function isExtraction(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.ok === true &&
		typeof value.jobId === "string" &&
		typeof value.scheduled === "boolean"
	)
}

function isUpsert(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.upserted === "boolean" &&
		typeof value.id === "string"
	)
}

function isLifecycleItem(value: unknown): boolean {
	return (
		isRecord(value) &&
		(value.family === "structured" || value.family === "procedure") &&
		isRecord(value.handle) &&
		isRecord(value.data)
	)
}

function isLifecycleHistory(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(item) =>
				isLifecycleItem(item) &&
				(item.historyKind === "revision" || item.historyKind === "current"),
		)
	)
}

function isStatus(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.version === "string" &&
		typeof value.backend === "string"
	)
}

function isProbe(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.ok === "boolean" &&
		(value.error === undefined || typeof value.error === "string")
	)
}

const passthrough = (value: unknown) => value
const results = (value: unknown) => (value as { results: unknown }).results
const writeReceipt = (value: unknown) => {
	const receipt = value as { eventId: string; chunkCreated: boolean }
	return { eventId: receipt.eventId, chunkCreated: receipt.chunkCreated }
}

export const RETAINED_OPERATION_DEFINITIONS = {
	search: { transport: "body", validate: isSearchEnvelope, adapt: results },
	searchDetailed: {
		transport: "body",
		validate: isDetailedSearch,
		adapt: passthrough,
	},
	searchKb: { transport: "body", validate: isSearchEnvelope, adapt: results },
	recallConversation: {
		transport: "body",
		validate: isRecall,
		adapt: passthrough,
	},
	profile: { transport: "body", validate: isRecord, adapt: passthrough },
	hydrateActiveSlate: {
		transport: "body",
		validate: isActiveSlate,
		adapt: passthrough,
	},
	discoveryProjection: {
		transport: "body",
		validate: isDiscoveryProjection,
		adapt: passthrough,
	},
	contextBundle: {
		transport: "body",
		validate: isContextBundle,
		adapt: passthrough,
	},
	state: { transport: "query", validate: isState, adapt: passthrough },
	add: { transport: "body", validate: isWriteReceipt, adapt: writeReceipt },
	writeEvent: {
		transport: "body",
		validate: isWriteReceipt,
		adapt: writeReceipt,
	},
	writeEvents: {
		transport: "body",
		validate: isBatchEnvelope,
		adapt: (value) => (value as { receipts: unknown[] }).receipts,
	},
	extract: {
		transport: "body",
		validate: isExtraction,
		adapt: (value) => {
			const result = value as { jobId: string; scheduled: boolean }
			return { jobId: result.jobId, scheduled: result.scheduled }
		},
	},
	writeStructured: {
		transport: "body",
		validate: isUpsert,
		adapt: passthrough,
	},
	writeProcedure: {
		transport: "body",
		validate: isUpsert,
		adapt: passthrough,
	},
	lifecycleGet: {
		transport: "body",
		validate: isLifecycleItem,
		adapt: passthrough,
	},
	lifecycleUpdate: {
		transport: "body",
		validate: isLifecycleItem,
		adapt: passthrough,
	},
	lifecycleDelete: {
		transport: "body",
		validate: isLifecycleItem,
		adapt: passthrough,
	},
	lifecycleHistory: {
		transport: "body",
		validate: isLifecycleHistory,
		adapt: passthrough,
	},
	procedureOutcome: {
		transport: "body",
		validate: isLifecycleItem,
		adapt: passthrough,
	},
	memoryFeedback: {
		transport: "body",
		validate: isLifecycleItem,
		adapt: passthrough,
	},
	status: { transport: "query", validate: isStatus, adapt: passthrough },
	embeddingProbe: {
		transport: "query",
		validate: isProbe,
		adapt: passthrough,
	},
	vectorProbe: {
		transport: "query",
		validate: isProbe,
		adapt: (value) => (value as { ok: boolean }).ok,
	},
} as const satisfies Record<MemongoOperationName, GatewayOperationDefinition>
