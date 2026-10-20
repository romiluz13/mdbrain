import { randomUUID } from "node:crypto"
import type {
	LanguageModelV2CallOptions,
	LanguageModelV2StreamPart,
	LanguageModelV2Usage,
	SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import type { LanguageModelMiddleware } from "ai"
import type { Db } from "mongodb"

export class BudgetExhaustedError extends Error {
	name = "BudgetExhaustedError"
}

export class BudgetUnavailableError extends Error {
	name = "BudgetUnavailableError"
}

export class BudgetInputRefusedError extends Error {
	name = "BudgetInputRefusedError"
}

export function operatorCeiling(env: NodeJS.ProcessEnv, name: string): number {
	const raw = env[name]?.trim() ?? ""
	return /^[1-9]\d*$/.test(raw) ? Number(raw) : 0
}

export type BudgetUsage = {
	uncachedInput: number
	cacheRead: number
	cacheWrite: number
	output: number
}

type LedgerDoc = {
	_id: string
	reserved: number
	spent: number
	usage: BudgetUsage
	updatedAt?: Date
}

type ReservationDoc = {
	_id: string
	key: string
	amount: number
	state: "reserved" | "settled" | "uncertain"
	createdAt: Date
	usage?: BudgetUsage
}

function assertCount(name: string, value: number, minimum: 0 | 1): void {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new RangeError(
			`${name} must be a safe integer of at least ${minimum}, got ${value}`,
		)
	}
}

export type ModelBudget = ReturnType<typeof createModelBudget>

// Invariant: a reservation leaves the ledger's `reserved` only through settle
// or markUncertain, each guarded by a one-way state change on the reservation.
// A crash between the two writes leaves the amount counted, never released,
// so failures overcount and cannot overspend.
export function createModelBudget(
	db: Db,
	options: { collectionPrefix?: string } = {},
) {
	const prefix = options.collectionPrefix ?? "demo_budget_"
	const ledger = db.collection<LedgerDoc>(`${prefix}ledger`)
	const reservations = db.collection<ReservationDoc>(`${prefix}reservations`)

	async function store<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation()
		} catch (error) {
			throw new BudgetUnavailableError(
				"model budget control store unavailable",
				{
					cause: error,
				},
			)
		}
	}

	async function release(
		id: string,
		state: "settled" | "uncertain",
		usage?: BudgetUsage,
	): Promise<void> {
		const reservation = await store(() =>
			reservations.findOneAndUpdate(
				{ _id: id, state: "reserved" },
				{ $set: { state, ...(usage ? { usage } : {}) } },
			),
		)
		if (!reservation) return
		const charged = usage
			? usage.uncachedInput + usage.cacheRead + usage.cacheWrite + usage.output
			: reservation.amount
		const inc: Record<string, number> = {
			reserved: -reservation.amount,
			spent: charged,
		}
		if (usage) {
			for (const [field, value] of Object.entries(usage)) {
				inc[`usage.${field}`] = value
			}
		}
		await store(() =>
			ledger.updateOne(
				{ _id: reservation.key },
				{ $inc: inc, $currentDate: { updatedAt: true } },
			),
		)
	}

	return {
		async reserve(input: {
			key: string
			ceiling: number
			amount: number
		}): Promise<string> {
			assertCount("ceiling", input.ceiling, 0)
			assertCount("amount", input.amount, 1)
			if (input.ceiling === 0) {
				throw new BudgetExhaustedError(`model budget ${input.key} is off`)
			}
			await store(() =>
				ledger.updateOne(
					{ _id: input.key },
					{
						$setOnInsert: {
							reserved: 0,
							spent: 0,
							usage: {
								uncachedInput: 0,
								cacheRead: 0,
								cacheWrite: 0,
								output: 0,
							},
						},
					},
					{ upsert: true },
				),
			)
			const granted = await store(() =>
				ledger.findOneAndUpdate(
					{
						_id: input.key,
						$expr: {
							$lte: [
								{ $add: ["$reserved", "$spent", input.amount] },
								input.ceiling,
							],
						},
					},
					{
						$inc: { reserved: input.amount },
						$currentDate: { updatedAt: true },
					},
				),
			)
			if (!granted) {
				throw new BudgetExhaustedError(`model budget ${input.key} is spent`)
			}
			const id = randomUUID()
			await store(() =>
				reservations.insertOne({
					_id: id,
					key: input.key,
					amount: input.amount,
					state: "reserved",
					createdAt: new Date(),
				}),
			)
			return id
		},
		settle: (id: string, usage: BudgetUsage) => release(id, "settled", usage),
		markUncertain: (id: string) => release(id, "uncertain"),
		read: (key: string) => store(() => ledger.findOne({ _id: key })),
	}
}

function isCount(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
}

// Input and output counts are mandatory: the provider contract allows them to
// be undefined, and a report without them is uncertain billing, not zero.
// Cache counts are optional and count as 0 only when absent.
function toBudgetUsage(
	usage: LanguageModelV2Usage,
	metadata: SharedV2ProviderMetadata | undefined,
): BudgetUsage | undefined {
	const cacheRead = usage.cachedInputTokens ?? 0
	const cacheWrite = metadata?.anthropic?.cacheCreationInputTokens ?? 0
	if (
		!isCount(usage.inputTokens) ||
		!isCount(usage.outputTokens) ||
		!isCount(cacheRead) ||
		!isCount(cacheWrite)
	) {
		return undefined
	}
	return {
		uncachedInput: usage.inputTokens,
		cacheRead,
		cacheWrite,
		output: usage.outputTokens,
	}
}

function worstCase(
	params: LanguageModelV2CallOptions,
	maxInputTokens: number,
): number {
	if (params.maxOutputTokens == null) {
		throw new Error("budgeted model calls need maxOutputTokens")
	}
	assertCount("maxOutputTokens", params.maxOutputTokens, 1)
	const amount = maxInputTokens + params.maxOutputTokens
	assertCount("reservation (maxInputTokens + maxOutputTokens)", amount, 1)
	return amount
}

// Anthropic adds a hidden tool-use system prompt to any request with tools:
// 286 tokens on Haiku 5.5 (406 when tool_choice is any or tool), and at most
// 804 in any row of its pricing table (platform.claude.com, tool use overview,
// "Pricing", read 2026-10-20). 1,024 covers every row.
const TOOL_PROMPT_ALLOWANCE_TOKENS = 1024

// The only call-level Anthropic options that add no input beyond bytes already
// in the call. The rest (fallbacks, contextManagement, container skills,
// thinking, taskBudget, ...) can bill input or output the reservation cannot
// see, so they are refused by name rather than guessed at.
// effort only sets how much the model thinks; thinking counts toward
// max_tokens, so maxOutputTokens still bounds it.
const BOUNDABLE_ANTHROPIC_OPTIONS = new Set([
	"cacheControl",
	"effort",
	"disableParallelToolUse",
	"sendReasoning",
	"structuredOutputMode",
	"metadata",
])

function unboundable(reason: string): never {
	throw new BudgetInputRefusedError(
		`model call input cannot be bounded: ${reason}`,
	)
}

function assertBoundable(params: LanguageModelV2CallOptions): void {
	for (const message of params.prompt) {
		if (message.role === "system") continue
		for (const part of message.content) {
			if (part.type === "file") {
				unboundable(
					`${message.role} file parts (images, PDFs) bill by their own rules`,
				)
			}
			if (
				part.type === "tool-result" &&
				part.output.type === "content" &&
				part.output.value.some((item) => item.type === "media")
			) {
				unboundable("tool result media bills by its own rules")
			}
		}
	}
	for (const tool of params.tools ?? []) {
		if (tool.type === "provider-defined") {
			unboundable(
				`provider-defined tool ${tool.name} runs on the provider side`,
			)
		}
	}
	for (const [namespace, options] of Object.entries(
		params.providerOptions ?? {},
	)) {
		if (namespace !== "anthropic") {
			unboundable(`providerOptions.${namespace} is not known to add no input`)
		}
		for (const key of Object.keys(options)) {
			if (!BOUNDABLE_ANTHROPIC_OPTIONS.has(key)) {
				unboundable(
					`providerOptions.anthropic.${key} can change what is billed`,
				)
			}
		}
	}
}

function inputTokenUpperBound(params: LanguageModelV2CallOptions): number {
	assertBoundable(params)
	const { abortSignal: _signal, headers: _headers, ...sent } = params
	let json: string
	try {
		json = JSON.stringify(sent)
	} catch {
		return unboundable("the call cannot be serialized")
	}
	const hasTools =
		(params.tools?.length ?? 0) > 0 || params.responseFormat?.type === "json"
	return (
		Buffer.byteLength(json, "utf8") +
		(hasTools ? TOOL_PROMPT_ALLOWANCE_TOKENS : 0)
	)
}

function enforceInputCap(
	params: LanguageModelV2CallOptions,
	maxInputTokens: number,
): void {
	const bound = inputTokenUpperBound(params)
	if (bound > maxInputTokens) {
		throw new BudgetInputRefusedError(
			`model call input bound ${bound} exceeds maxInputTokens ${maxInputTokens}`,
		)
	}
}

// Wraps every provider call (each tool-loop step and each retry). maxInputTokens
// is enforced, not declared: a call whose input bound is larger is refused
// before anything is reserved or sent. Otherwise the call reserves
// maxInputTokens + maxOutputTokens first, and any outcome other than a complete
// usage report keeps the full reservation charged.
//
// The bound is the UTF-8 byte length of the serialized call plus a fixed
// allowance for the tool-use system prompt. It rests on one assumption
// Anthropic does not publish: that no token covers less than one byte of text.
// Input whose cost is not a function of its bytes (files, media, server tools,
// provider options that bill elsewhere) is refused rather than estimated.
export function budgetMiddleware(input: {
	budget: ModelBudget
	key: string
	ceiling: number
	maxInputTokens: number
}): LanguageModelMiddleware {
	assertCount("ceiling", input.ceiling, 0)
	assertCount("maxInputTokens", input.maxInputTokens, 1)
	return {
		wrapGenerate: async ({ doGenerate, params }) => {
			const amount = worstCase(params, input.maxInputTokens)
			enforceInputCap(params, input.maxInputTokens)
			const id = await input.budget.reserve({
				key: input.key,
				ceiling: input.ceiling,
				amount,
			})
			let result: Awaited<ReturnType<typeof doGenerate>>
			try {
				result = await doGenerate()
			} catch (error) {
				await input.budget.markUncertain(id)
				throw error
			}
			const actual = toBudgetUsage(result.usage, result.providerMetadata)
			if (actual) await input.budget.settle(id, actual)
			else await input.budget.markUncertain(id)
			return result
		},
		wrapStream: async ({ doStream, params }) => {
			const amount = worstCase(params, input.maxInputTokens)
			enforceInputCap(params, input.maxInputTokens)
			const id = await input.budget.reserve({
				key: input.key,
				ceiling: input.ceiling,
				amount,
			})
			let released = false
			const releaseOnce = async (usage?: BudgetUsage) => {
				if (released) return
				released = true
				if (usage) await input.budget.settle(id, usage)
				else await input.budget.markUncertain(id)
			}
			// A release that fails leaves the reservation counted, so dropping the
			// failure here cannot overspend.
			const keepCharged = () => undefined
			params.abortSignal?.addEventListener(
				"abort",
				() => void releaseOnce().catch(keepCharged),
				{ once: true },
			)
			let result: Awaited<ReturnType<typeof doStream>>
			try {
				result = await doStream()
			} catch (error) {
				await releaseOnce()
				throw error
			}
			const reader = result.stream.getReader()
			let finalUsage: BudgetUsage | undefined
			let sawError = false
			const stream = new ReadableStream<LanguageModelV2StreamPart>({
				async pull(controller) {
					try {
						const { done, value } = await reader.read()
						if (done) {
							await releaseOnce(sawError ? undefined : finalUsage)
							controller.close()
							return
						}
						if (value.type === "error") sawError = true
						if (value.type === "finish") {
							finalUsage = toBudgetUsage(value.usage, value.providerMetadata)
						}
						controller.enqueue(value)
					} catch (error) {
						await releaseOnce()
						controller.error(error)
					}
				},
				cancel(reason) {
					const providerCancel = reader.cancel(reason)
					void releaseOnce().catch(keepCharged)
					return providerCancel
				},
			})
			return { ...result, stream }
		},
	}
}
