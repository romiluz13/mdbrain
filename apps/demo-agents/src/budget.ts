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
			if (!(input.ceiling > 0)) {
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

function toBudgetUsage(
	usage: LanguageModelV2Usage,
	metadata: SharedV2ProviderMetadata | undefined,
): BudgetUsage {
	const cacheWrite = metadata?.anthropic?.cacheCreationInputTokens
	return {
		uncachedInput: usage.inputTokens ?? 0,
		cacheRead: usage.cachedInputTokens ?? 0,
		cacheWrite: typeof cacheWrite === "number" ? cacheWrite : 0,
		output: usage.outputTokens ?? 0,
	}
}

function worstCase(
	params: LanguageModelV2CallOptions,
	maxInputTokens: number,
): number {
	if (!params.maxOutputTokens) {
		throw new Error("budgeted model calls need maxOutputTokens")
	}
	return maxInputTokens + params.maxOutputTokens
}

// Wraps every provider call (each tool-loop step and each retry) in a
// reservation of maxInputTokens + maxOutputTokens. Any outcome other than a
// reported usage keeps the full reservation charged.
export function budgetMiddleware(input: {
	budget: ModelBudget
	key: string
	ceiling: number
	maxInputTokens: number
}): LanguageModelMiddleware {
	return {
		wrapGenerate: async ({ doGenerate, params }) => {
			const amount = worstCase(params, input.maxInputTokens)
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
			await input.budget.settle(
				id,
				toBudgetUsage(result.usage, result.providerMetadata),
			)
			return result
		},
		wrapStream: async ({ doStream, params }) => {
			const amount = worstCase(params, input.maxInputTokens)
			const id = await input.budget.reserve({
				key: input.key,
				ceiling: input.ceiling,
				amount,
			})
			let released = false
			const releaseOnce = (usage?: BudgetUsage) => {
				if (released) return Promise.resolve()
				released = true
				return usage
					? input.budget.settle(id, usage)
					: input.budget.markUncertain(id)
			}
			params.abortSignal?.addEventListener("abort", () => void releaseOnce(), {
				once: true,
			})
			let result: Awaited<ReturnType<typeof doStream>>
			try {
				result = await doStream()
			} catch (error) {
				await releaseOnce()
				throw error
			}
			const reader = result.stream.getReader()
			let finalUsage: BudgetUsage | undefined
			const stream = new ReadableStream<LanguageModelV2StreamPart>({
				async pull(controller) {
					try {
						const { done, value } = await reader.read()
						if (done) {
							await releaseOnce(finalUsage)
							controller.close()
							return
						}
						if (value.type === "finish") {
							finalUsage = toBudgetUsage(value.usage, value.providerMetadata)
						}
						controller.enqueue(value)
					} catch (error) {
						await releaseOnce()
						controller.error(error)
					}
				},
				async cancel(reason) {
					await releaseOnce()
					await reader.cancel(reason)
				},
			})
			return { ...result, stream }
		},
	}
}
