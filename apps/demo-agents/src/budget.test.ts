import { randomUUID } from "node:crypto"
import { generateText, streamText, wrapLanguageModel } from "ai"
import type {
	LanguageModelV2,
	LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import { type Db, MongoClient } from "mongodb"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	BudgetExhaustedError,
	BudgetUnavailableError,
	budgetMiddleware,
	createModelBudget,
	operatorCeiling,
} from "./budget.js"

const usage = {
	inputTokens: 100,
	outputTokens: 20,
	totalTokens: 120,
	cachedInputTokens: 30,
}

type Mock = LanguageModelV2 & { doGenerateCalls: number }

function fakeModel(overrides: Partial<LanguageModelV2>): Mock {
	const model: Mock = {
		specificationVersion: "v2",
		provider: "fake",
		modelId: "fake",
		supportedUrls: {},
		doGenerateCalls: 0,
		doGenerate: async () => {
			model.doGenerateCalls++
			return {
				content: [{ type: "text", text: "ok" }],
				finishReason: "stop",
				usage,
				providerMetadata: { anthropic: { cacheCreationInputTokens: 50 } },
				warnings: [],
			}
		},
		doStream: async () => {
			throw new Error("not used")
		},
		...overrides,
	}
	return model
}

function mockModel(): Mock {
	return fakeModel({})
}

function slowStream(
	parts: LanguageModelV2StreamPart[],
): ReadableStream<LanguageModelV2StreamPart> {
	let index = 0
	return new ReadableStream({
		async pull(controller) {
			await new Promise((resolve) => setTimeout(resolve, 200))
			if (index < parts.length) controller.enqueue(parts[index++])
			else controller.close()
		},
	})
}

describe("operatorCeiling", () => {
	it("is off (0) unless the operator set a positive whole number", () => {
		expect(operatorCeiling({}, "DEMO_VISITOR_DAILY_TOKENS")).toBe(0)
		expect(
			operatorCeiling(
				{ DEMO_VISITOR_DAILY_TOKENS: "" },
				"DEMO_VISITOR_DAILY_TOKENS",
			),
		).toBe(0)
		expect(
			operatorCeiling(
				{ DEMO_VISITOR_DAILY_TOKENS: "-5" },
				"DEMO_VISITOR_DAILY_TOKENS",
			),
		).toBe(0)
		expect(
			operatorCeiling(
				{ DEMO_VISITOR_DAILY_TOKENS: "abc" },
				"DEMO_VISITOR_DAILY_TOKENS",
			),
		).toBe(0)
		expect(
			operatorCeiling(
				{ DEMO_VISITOR_DAILY_TOKENS: "200000" },
				"DEMO_VISITOR_DAILY_TOKENS",
			),
		).toBe(200_000)
	})
})

describe("budget without a database", () => {
	it("is off when the ceiling is not positive, and never calls the model", async () => {
		const model = mockModel()
		const budget = createModelBudget(unreachableDb())
		const wrapped = wrapLanguageModel({
			model,
			middleware: budgetMiddleware({
				budget,
				key: "k",
				ceiling: 0,
				maxInputTokens: 1000,
			}),
		})
		await expect(
			generateText({
				model: wrapped,
				prompt: "hi",
				maxOutputTokens: 10,
				maxRetries: 0,
			}),
		).rejects.toBeInstanceOf(BudgetExhaustedError)
		expect(model.doGenerateCalls).toBe(0)
	})

	it("fails closed when the control store is unreachable", async () => {
		const model = mockModel()
		const budget = createModelBudget(unreachableDb())
		const wrapped = wrapLanguageModel({
			model,
			middleware: budgetMiddleware({
				budget,
				key: "k",
				ceiling: 10_000,
				maxInputTokens: 1000,
			}),
		})
		await expect(
			generateText({
				model: wrapped,
				prompt: "hi",
				maxOutputTokens: 10,
				maxRetries: 0,
			}),
		).rejects.toBeInstanceOf(BudgetUnavailableError)
		expect(model.doGenerateCalls).toBe(0)
	})

	it("refuses a call without maxOutputTokens, since its worst case is unbounded", async () => {
		const model = mockModel()
		const budget = createModelBudget(unreachableDb())
		const wrapped = wrapLanguageModel({
			model,
			middleware: budgetMiddleware({
				budget,
				key: "k",
				ceiling: 10_000,
				maxInputTokens: 1000,
			}),
		})
		await expect(
			generateText({ model: wrapped, prompt: "hi", maxRetries: 0 }),
		).rejects.toThrow(/maxOutputTokens/)
		expect(model.doGenerateCalls).toBe(0)
	})
})

const liveUri = process.env.MDBRAIN_DEMO_CONTROL_TEST_URI

describe.skipIf(!liveUri)("budget against MongoDB", () => {
	let client: MongoClient
	let db: Db
	const prefix = `test_budget_${randomUUID().slice(0, 8)}_`

	beforeAll(async () => {
		client = await MongoClient.connect(liveUri ?? "")
		db = client.db("mdbrain_demo_control")
	})

	afterAll(async () => {
		for (const name of ["ledger", "reservations"]) {
			await db
				.collection(`${prefix}${name}`)
				.drop()
				.catch(() => undefined)
		}
		await client.close()
	})

	it("lets concurrent callers reserve no more than the ceiling", async () => {
		const budget = createModelBudget(db, { collectionPrefix: prefix })
		const key = `concurrency-${randomUUID()}`
		const attempts = await Promise.allSettled(
			Array.from({ length: 12 }, () =>
				budget.reserve({ key, ceiling: 500, amount: 100 }),
			),
		)
		const granted = attempts.filter((a) => a.status === "fulfilled")
		const refused = attempts.filter(
			(a) =>
				a.status === "rejected" && a.reason instanceof BudgetExhaustedError,
		)
		expect(granted).toHaveLength(5)
		expect(refused).toHaveLength(7)
		expect(await budget.read(key)).toMatchObject({ reserved: 500, spent: 0 })
	}, 60_000)

	it("settles to actual usage, keeps uncertain calls charged, and survives a restart", async () => {
		const key = `settle-${randomUUID()}`
		const first = createModelBudget(db, { collectionPrefix: prefix })
		const model = mockModel()
		const wrapped = wrapLanguageModel({
			model,
			middleware: budgetMiddleware({
				budget: first,
				key,
				ceiling: 10_000,
				maxInputTokens: 1000,
			}),
		})
		await generateText({
			model: wrapped,
			prompt: "hi",
			maxOutputTokens: 200,
			maxRetries: 0,
		})
		expect(await first.read(key)).toMatchObject({
			reserved: 0,
			spent: 200,
			usage: { uncachedInput: 100, cacheRead: 30, cacheWrite: 50, output: 20 },
		})

		const failing = wrapLanguageModel({
			model: fakeModel({
				doGenerate: async () => {
					throw new Error("socket hang up")
				},
			}),
			middleware: budgetMiddleware({
				budget: first,
				key,
				ceiling: 10_000,
				maxInputTokens: 1000,
			}),
		})
		await expect(
			generateText({
				model: failing,
				prompt: "hi",
				maxOutputTokens: 200,
				maxRetries: 0,
			}),
		).rejects.toThrow(/socket hang up/)

		const afterRestart = createModelBudget(db, { collectionPrefix: prefix })
		expect(await afterRestart.read(key)).toMatchObject({
			reserved: 0,
			spent: 1400,
		})
	}, 60_000)

	it("charges a cancelled stream its full reservation", async () => {
		const key = `stream-${randomUUID()}`
		const budget = createModelBudget(db, { collectionPrefix: prefix })
		const controller = new AbortController()
		const model = fakeModel({
			doStream: async () => ({
				stream: slowStream([
					{ type: "text-start", id: "1" },
					{ type: "text-delta", id: "1", delta: "a" },
					{ type: "text-delta", id: "1", delta: "b" },
					{ type: "text-end", id: "1" },
					{ type: "finish", finishReason: "stop", usage },
				]),
			}),
		})
		const wrapped = wrapLanguageModel({
			model,
			middleware: budgetMiddleware({
				budget,
				key,
				ceiling: 10_000,
				maxInputTokens: 1000,
			}),
		})
		const result = streamText({
			model: wrapped,
			prompt: "hi",
			maxOutputTokens: 200,
			maxRetries: 0,
			abortSignal: controller.signal,
		})
		for await (const _ of result.textStream) {
			controller.abort()
		}
		await waitFor(async () => (await budget.read(key))?.reserved === 0)
		expect(await budget.read(key)).toMatchObject({ reserved: 0, spent: 1200 })
	}, 60_000)
})

async function waitFor(check: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if (await check()) return
		await new Promise((resolve) => setTimeout(resolve, 200))
	}
	throw new Error("condition not met")
}

function unreachableDb(): Db {
	const fail = async () => {
		throw new Error("connection refused")
	}
	const collection = {
		updateOne: fail,
		findOneAndUpdate: fail,
		insertOne: fail,
		findOne: fail,
	}
	return { collection: () => collection } as unknown as Db
}
