/** In-memory stand-ins for the agent runner unit tests: scripted language
 * models, API clients, and a model budget. Mirrors the seams proven by
 * budget.test.ts and seeding/testing/fakes.ts. */
import type {
	LanguageModelV2,
	LanguageModelV2CallOptions,
	LanguageModelV2Usage,
} from "@ai-sdk/provider"
import { MdbrainClientError, type MdbrainClient } from "@mdbrain/client"
import {
	BudgetExhaustedError,
	type BudgetUsage,
	type ModelBudget,
} from "../../budget.js"
import type { AgentRole } from "../config.js"

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export type CallLog = {
	seq: number
	role: AgentRole
	method: string
	input: Record<string, unknown>
}

export type WrittenEvent = { role: AgentRole; input: Record<string, unknown> }

export type FakeAgentClientsOptions = {
	/** slug -> page view returned by wikiGet; wikiApply stores into it. */
	pages?: Record<string, unknown>
	/** slugs that 404 for one role only, whatever the shared page map says. */
	refuseWikiGetFor?: Partial<Record<AgentRole, string[]>>
	/** artificial delay for every writeEvent call. */
	writeEventDelayMs?: number
	/** the agentId the support and account keys are pinned to; like the API,
	 * any call from either role without that agentId is refused with 403. */
	pinnedAgentId?: string
	/** the exact workspace grant every role key holds; like the API, a call
	 * whose scopeRef sits outside it is refused with 403. */
	grantedScopeRef?: string
}

export function fakeAgentClients(options: FakeAgentClientsOptions = {}) {
	const pages: Record<string, unknown> = options.pages ?? {}
	const logs: CallLog[] = []
	const writtenEvents: WrittenEvent[] = []
	const receipts: Array<{
		role: AgentRole
		input: Record<string, unknown>
		eventId: string
		chunkCreated: boolean
	}> = []
	const receiptsByKey = new Map<
		string,
		{ eventId: string; chunkCreated: boolean }
	>()
	let seq = 0
	/** Receipt ids mint at call time (331): concurrent in-flight writes
	 * must still get distinct ids, so the id cannot depend on how many
	 * writes have landed so far. */
	let receiptSeq = 0
	function note(
		role: AgentRole,
		method: string,
		input: Record<string, unknown>,
	): void {
		logs.push({ seq: ++seq, role, method, input })
	}
	/** Mirrors authorizePrincipalRequest's order: the pinned agentId first,
	 * then the exact workspace grant, then the role's capabilities. */
	function guard(
		role: AgentRole,
		method: string,
		input: Record<string, unknown>,
	): void {
		if (
			options.pinnedAgentId !== undefined &&
			role !== "product" &&
			input.agentId !== options.pinnedAgentId
		) {
			throw agentIdRequired()
		}
		if (
			options.grantedScopeRef !== undefined &&
			input.scopeRef !== options.grantedScopeRef
		) {
			throw scopeRefOutsideGrant(options.grantedScopeRef)
		}
		if (method === "wikiApply" && role === "product") {
			throw proposeOnly()
		}
	}

	/** Mirrors the API's idempotent duplicate: the original receipt comes
	 * back with chunkCreated false. */
	function writeReceipt(
		method: string,
		role: AgentRole,
		input: Record<string, unknown>,
	): { ok: true; eventId: string; chunkCreated: boolean } {
		const key = `${method}:${String(input.idempotencyKey)}`
		const stored = receiptsByKey.get(key)
		if (stored) {
			receipts.push({
				role,
				input,
				eventId: stored.eventId,
				chunkCreated: false,
			})
			return { ok: true, eventId: stored.eventId, chunkCreated: false }
		}
		receiptSeq += 1
		const receipt = { eventId: `evt-${receiptSeq}`, chunkCreated: true }
		receiptsByKey.set(key, receipt)
		receipts.push({ role, input, ...receipt })
		return { ok: true, ...receipt }
	}

	function clientFor(role: AgentRole): MdbrainClient {
		const self = {
			writeEvent: async (input: Record<string, unknown>) => {
				note(role, "writeEvent", input)
				guard(role, "writeEvent", input)
				if (options.writeEventDelayMs) await delay(options.writeEventDelayMs)
				writtenEvents.push({ role, input })
				return writeReceipt("writeEvent", role, input)
			},
			add: async (input: Record<string, unknown>) => {
				note(role, "add", input)
				guard(role, "add", input)
				return writeReceipt("add", role, input)
			},
			wikiApply: async (input: Record<string, unknown>) => {
				note(role, "wikiApply", input)
				guard(role, "wikiApply", input)
				pages[String(input.slug)] = {
					slug: input.slug,
					revision: 1,
					claims: input.claims,
					relationships: input.relationships,
				}
				return { ok: true, slug: input.slug, revision: 1 }
			},
			wikiGet: async (input: Record<string, unknown>) => {
				note(role, "wikiGet", input)
				guard(role, "wikiGet", input)
				const slug = String(input.slug)
				if (options.refuseWikiGetFor?.[role]?.includes(slug)) {
					throw notFound(slug)
				}
				const page = pages[slug]
				if (page === undefined) throw notFound(slug)
				return page
			},
		}
		return self as unknown as MdbrainClient
	}
	return {
		clients: {
			support: clientFor("support"),
			account: clientFor("account"),
			product: clientFor("product"),
		},
		logs,
		writtenEvents,
		receipts,
		pages,
	}
}

function agentIdRequired(): MdbrainClientError {
	return new MdbrainClientError(
		403,
		JSON.stringify({
			error: {
				code: "FORBIDDEN",
				message: "agentId is required for this API key",
			},
		}),
	)
}

function scopeRefOutsideGrant(grant: string): MdbrainClientError {
	return new MdbrainClientError(
		403,
		JSON.stringify({
			error: {
				code: "FORBIDDEN",
				message: `scopeRef is outside this API key's workspace grant (${grant})`,
			},
		}),
	)
}

function proposeOnly(): MdbrainClientError {
	return new MdbrainClientError(
		403,
		JSON.stringify({
			error: {
				code: "FORBIDDEN",
				message:
					"this API key can read and propose, not write: use mdbrain_add",
			},
		}),
	)
}

function notFound(slug: string): MdbrainClientError {
	return new MdbrainClientError(
		404,
		JSON.stringify({ code: "NOT_FOUND", message: `no page ${slug}` }),
	)
}

// --- scripted language model -----------------------------------------------

export type ScriptedTurn =
	| { toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> }
	| { text: string }

export type ScriptedModel = LanguageModelV2 & {
	doGenerateCalls: number
	lastOptions: LanguageModelV2CallOptions | undefined
}

const usage: LanguageModelV2Usage = {
	inputTokens: 100,
	outputTokens: 20,
	totalTokens: 120,
	cachedInputTokens: 30,
}

export function scriptedModel(
	turns: ScriptedTurn[],
	options: { delayMs?: number; repeatLast?: boolean } = {},
): ScriptedModel {
	const model: ScriptedModel = {
		specificationVersion: "v2",
		provider: "scripted",
		modelId: "scripted",
		supportedUrls: {},
		doGenerateCalls: 0,
		lastOptions: undefined,
		doGenerate: async (callOptions) => {
			model.doGenerateCalls++
			model.lastOptions = callOptions
			if (options.delayMs) await delay(options.delayMs)
			if (callOptions.abortSignal?.aborted) {
				throw new Error("scripted model aborted")
			}
			const index = model.doGenerateCalls - 1
			if (index >= turns.length && !options.repeatLast) {
				throw new Error(`scripted model exhausted after ${turns.length} turns`)
			}
			const turn = turns[Math.min(index, turns.length - 1)]
			if ("toolCalls" in turn) {
				return {
					content: turn.toolCalls.map((call, i) => ({
						type: "tool-call" as const,
						toolCallId: `call-${model.doGenerateCalls}-${i}`,
						toolName: call.toolName,
						input: JSON.stringify(call.input),
					})),
					finishReason: "tool-calls",
					usage,
					providerMetadata: { anthropic: { cacheCreationInputTokens: 50 } },
					warnings: [],
				}
			}
			return {
				content: [{ type: "text" as const, text: turn.text }],
				finishReason: "stop",
				usage,
				providerMetadata: { anthropic: { cacheCreationInputTokens: 50 } },
				warnings: [],
			}
		},
		doStream: async () => {
			throw new Error("not used")
		},
	}
	return model
}

// --- model budget -----------------------------------------------------------

export function fakeModelBudget(options: { ceiling?: number } = {}) {
	const state = {
		reserved: 0,
		spent: 0,
		usage: {
			uncachedInput: 0,
			cacheRead: 0,
			cacheWrite: 0,
			output: 0,
		} satisfies BudgetUsage,
	}
	const reserves: Array<{ key: string; ceiling: number; amount: number }> = []
	const amounts = new Map<string, number>()
	let counter = 0
	function release(id: string, charged: number, usage?: BudgetUsage) {
		const amount = amounts.get(id) ?? 0
		amounts.delete(id)
		state.reserved = Math.max(0, state.reserved - amount)
		state.spent += charged
		if (usage) {
			state.usage.uncachedInput += usage.uncachedInput
			state.usage.cacheRead += usage.cacheRead
			state.usage.cacheWrite += usage.cacheWrite
			state.usage.output += usage.output
		}
	}
	const budget = {
		async reserve(input: { key: string; ceiling: number; amount: number }) {
			reserves.push({ ...input })
			if (input.ceiling === 0) {
				throw new BudgetExhaustedError(`model budget ${input.key} is off`)
			}
			if (state.reserved + state.spent + input.amount > input.ceiling) {
				throw new BudgetExhaustedError(`model budget ${input.key} is spent`)
			}
			state.reserved += input.amount
			const id = `r${++counter}`
			amounts.set(id, input.amount)
			return id
		},
		async settle(id: string, usage: BudgetUsage) {
			release(
				id,
				usage.uncachedInput + usage.cacheRead + usage.cacheWrite + usage.output,
				usage,
			)
		},
		async markUncertain(id: string) {
			release(id, amounts.get(id) ?? 0)
		},
		async read(key: string) {
			return {
				_id: key,
				reserved: state.reserved,
				spent: state.spent,
				usage: { ...state.usage },
			}
		},
	}
	return { budget: budget as unknown as ModelBudget, reserves, ledger: state }
}
