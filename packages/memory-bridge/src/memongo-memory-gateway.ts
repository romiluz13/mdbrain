import type { MemoryScope } from "@mdbrain/lib/types/memory"
import {
	RETAINED_OPERATION_DEFINITIONS,
	type MemoryGatewayOperations,
	type MemorySearchResult,
} from "./memongo-gateway-contract.js"
import { MemongoHttpClient } from "./memongo-http-client.js"

export type {
	MemoryBatchReceipt,
	MemoryDetailedSearchResult,
	MemoryGatewayOperations,
	MemorySearchResult,
	MemoryStateResult,
	MemoryWriteReceipt,
} from "./memongo-gateway-contract.js"

export type MemoryGatewayContext = {
	agentId: string
	scope: MemoryScope
	scopeRef: string
	requestId?: string
	signal?: AbortSignal
	timeoutMs?: number
}

export type MemoryRetrievalRequest = {
	kind: "search"
	query: string
	limit?: number
	minScore?: number
	sessionKey?: string
}

export type MemoryRetrievalResult = {
	state: "complete" | "partial" | "degraded" | "failed"
	omissions: string[]
	results: MemorySearchResult[]
}

export type MemoryGatewayRequestOptions = {
	idempotencyKey?: string
	requestId?: string
	signal?: AbortSignal
	timeoutMs?: number
}

export type MemongoReadinessDependency =
	| "contract"
	| "retrieval"
	| "control"
	| "embedding"
	| "vector"

export class MemongoReadinessError extends Error {
	constructor(
		readonly dependency: MemongoReadinessDependency,
		readonly cause: unknown,
	) {
		super(`Memongo ${dependency} dependency is not ready`, { cause })
		this.name = "MemongoReadinessError"
	}
}

export const MEMONGO_CONTROL_READINESS_LANES = [
	"control",
	"embedding",
	"vector",
] as const

export type MemongoControlReadinessLane =
	(typeof MEMONGO_CONTROL_READINESS_LANES)[number]

export type MemongoReadinessOptions = {
	agentId: string
	requiredControlLanes: MemongoControlReadinessLane[]
	timeoutMs: number
}

export type MemongoReadinessReport = {
	lanes: {
		retrieval: "ready"
		control?: "ready"
		embedding?: "ready"
		vector?: "ready"
	}
}

export interface MemoryGateway {
	retrieve(
		request: MemoryRetrievalRequest,
		context: MemoryGatewayContext,
	): Promise<MemoryRetrievalResult>
	execute<Operation extends keyof MemoryGatewayOperations>(
		operation: Operation,
		input: MemoryGatewayOperations[Operation]["input"],
		options?: MemoryGatewayRequestOptions,
	): Promise<MemoryGatewayOperations[Operation]["output"]>
}

function bodyInput(input: unknown): Record<string, unknown> {
	return { ...(input as Record<string, unknown>) }
}

function queryInput(
	input: unknown,
): Record<string, string | number | boolean | null | undefined> {
	const query = input as {
		agentId?: string
		scope?: MemoryScope
		scopeRef?: string
	}
	return {
		agentId: query.agentId,
		scope: query.scope,
		scopeRef: query.scopeRef,
	}
}

export class MemongoMemoryGateway implements MemoryGateway {
	constructor(private readonly client: MemongoHttpClient) {}

	checkCompatibility(
		options: Pick<MemoryGatewayRequestOptions, "signal" | "timeoutMs"> = {},
	): Promise<void> {
		return this.client.checkCompatibility(options)
	}

	async checkReadiness(
		options: MemongoReadinessOptions,
	): Promise<MemongoReadinessReport> {
		const signal = AbortSignal.timeout(options.timeoutMs)
		const requestOptions = { signal, timeoutMs: options.timeoutMs }
		try {
			await this.checkCompatibility(requestOptions)
		} catch (error) {
			throw new MemongoReadinessError("contract", error)
		}
		try {
			await this.execute("state", { agentId: options.agentId }, requestOptions)
		} catch (error) {
			throw new MemongoReadinessError("retrieval", error)
		}
		const lanes: MemongoReadinessReport["lanes"] = { retrieval: "ready" }
		for (const lane of options.requiredControlLanes) {
			try {
				if (lane === "control") {
					await this.execute(
						"status",
						{ agentId: options.agentId },
						requestOptions,
					)
				} else if (lane === "embedding") {
					const result = await this.execute(
						"embeddingProbe",
						{ agentId: options.agentId },
						requestOptions,
					)
					if (!result.ok) throw new Error("Embedding probe reported not ready")
				} else {
					const ready = await this.execute(
						"vectorProbe",
						{ agentId: options.agentId },
						requestOptions,
					)
					if (!ready) throw new Error("Vector probe reported not ready")
				}
			} catch (error) {
				throw new MemongoReadinessError(lane, error)
			}
			lanes[lane] = "ready"
		}
		return { lanes }
	}

	async execute<Operation extends keyof MemoryGatewayOperations>(
		operation: Operation,
		input: MemoryGatewayOperations[Operation]["input"],
		options: MemoryGatewayRequestOptions = {},
	): Promise<MemoryGatewayOperations[Operation]["output"]> {
		const definition = RETAINED_OPERATION_DEFINITIONS[operation]
		const wireValue = await this.client.request<unknown>({
			operation,
			...(definition.transport === "query"
				? { query: queryInput(input) }
				: { body: bodyInput(input) }),
			idempotencyKey: options.idempotencyKey,
			requestId: options.requestId,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			validate: definition.validate,
		})
		return definition.adapt(
			wireValue,
		) as MemoryGatewayOperations[Operation]["output"]
	}

	async retrieve(
		request: MemoryRetrievalRequest,
		context: MemoryGatewayContext,
	): Promise<MemoryRetrievalResult> {
		const results = await this.execute(
			"search",
			{
				query: request.query,
				...(request.limit === undefined ? {} : { limit: request.limit }),
				...(request.minScore === undefined
					? {}
					: { minScore: request.minScore }),
				...(request.sessionKey === undefined
					? {}
					: { sessionKey: request.sessionKey }),
				agentId: context.agentId,
				scope: context.scope,
				scopeRef: context.scopeRef,
			},
			{
				requestId: context.requestId,
				signal: context.signal,
				timeoutMs: context.timeoutMs,
			},
		)
		return {
			state: "complete",
			omissions: [],
			results,
		}
	}
}
