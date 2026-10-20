import { randomUUID } from "node:crypto"
import {
	generateText,
	stepCountIs,
	streamText,
	tool,
	wrapLanguageModel,
} from "ai"
import type {
	LanguageModelV2,
	LanguageModelV2CallOptions,
	LanguageModelV2FunctionTool,
	LanguageModelV2Prompt,
	LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import { type Db, MongoClient } from "mongodb"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
	BudgetExhaustedError,
	BudgetInputRefusedError,
	BudgetUnavailableError,
	type BudgetUsage,
	type ModelBudget,
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

function fakeBudget(overrides: Partial<ModelBudget> = {}) {
	const calls = {
		reserve: [] as Array<{ key: string; ceiling: number; amount: number }>,
		settle: [] as Array<{ id: string; usage: BudgetUsage }>,
		uncertain: [] as string[],
	}
	const budget: ModelBudget = {
		reserve: async (input) => {
			calls.reserve.push(input)
			return `r${calls.reserve.length}`
		},
		settle: async (id, usage) => {
			calls.settle.push({ id, usage })
		},
		markUncertain: async (id) => {
			calls.uncertain.push(id)
		},
		read: async () => null,
		...overrides,
	}
	return { budget, calls }
}

function capped(
	model: LanguageModelV2,
	budget: ModelBudget,
	maxInputTokens: number,
) {
	return wrapLanguageModel({
		model,
		middleware: budgetMiddleware({
			budget,
			key: "k",
			ceiling: 1_000_000,
			maxInputTokens,
		}),
	})
}

function userPrompt(text: string): LanguageModelV2Prompt {
	return [{ role: "user", content: [{ type: "text", text }] }]
}

// Anthropic's token-counting page (accessed 2026-10-20) bills this tool plus
// the user message above at 403 input tokens on claude-opus-5-5; the call as
// provider-spec JSON is only 398 bytes, so the tool-use system prompt has to
// be counted on top of the bytes.
const docsWeatherTool: LanguageModelV2FunctionTool = {
	type: "function",
	name: "get_weather",
	description: "Get the current weather in a given location",
	inputSchema: {
		type: "object",
		properties: {
			location: {
				type: "string",
				description: "The city and state, e.g. San Francisco, CA",
			},
		},
		required: ["location"],
	},
}

describe("input cap", () => {
	it("refuses an oversized prompt before reserving or dispatching, counting bytes not characters", async () => {
		const model = mockModel()
		const { budget, calls } = fakeBudget()
		const wrapped = capped(model, budget, 1000)
		const prompt = userPrompt("😀".repeat(300))
		expect("😀".repeat(300).length).toBeLessThan(1000)
		await expect(
			wrapped.doGenerate({ prompt, maxOutputTokens: 10 }),
		).rejects.toBeInstanceOf(BudgetInputRefusedError)
		await expect(
			wrapped.doStream({ prompt, maxOutputTokens: 10 }),
		).rejects.toBeInstanceOf(BudgetInputRefusedError)
		expect(model.doGenerateCalls).toBe(0)
		expect(calls.reserve).toEqual([])
	})

	it("counts the tool-use system prompt: a request the docs bill at 403 input tokens is refused under a 402 cap", async () => {
		const model = mockModel()
		const { budget, calls } = fakeBudget()
		const request: LanguageModelV2CallOptions = {
			prompt: userPrompt("What's the weather like in San Francisco?"),
			maxOutputTokens: 10,
			tools: [docsWeatherTool],
		}
		await expect(
			capped(model, budget, 402).doGenerate(request),
		).rejects.toBeInstanceOf(BudgetInputRefusedError)
		expect(calls.reserve).toEqual([])
		await capped(model, budget, 2000).doGenerate(request)
		expect(model.doGenerateCalls).toBe(1)
	})

	it("counts a JSON response tool like any other tool", async () => {
		const model = mockModel()
		const { budget } = fakeBudget()
		const request: LanguageModelV2CallOptions = {
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
			responseFormat: {
				type: "json",
				schema: { type: "object", properties: {} },
			},
		}
		await expect(
			capped(model, budget, 300).doGenerate(request),
		).rejects.toBeInstanceOf(BudgetInputRefusedError)
		await capped(model, budget, 2000).doGenerate(request)
		expect(model.doGenerateCalls).toBe(1)
	})

	it("refuses the tool-loop step whose history pushes the call over the cap, after settling the step before it", async () => {
		let step = 0
		const model = fakeModel({
			doGenerate: async () => {
				step++
				return {
					content:
						step === 1
							? [
									{
										type: "tool-call",
										toolCallId: "c1",
										toolName: "lookup",
										input: "{}",
									},
								]
							: [{ type: "text", text: "done" }],
					finishReason: step === 1 ? "tool-calls" : "stop",
					usage,
					warnings: [],
				}
			},
		})
		const { budget, calls } = fakeBudget()
		await expect(
			generateText({
				model: capped(model, budget, 3000),
				prompt: "look it up",
				maxOutputTokens: 10,
				maxRetries: 0,
				stopWhen: stepCountIs(3),
				tools: {
					lookup: tool({
						description: "look a thing up",
						inputSchema: z.object({}),
						execute: async () => "x".repeat(5000),
					}),
				},
			}),
		).rejects.toBeInstanceOf(BudgetInputRefusedError)
		expect(step).toBe(1)
		expect(calls.reserve).toHaveLength(1)
		expect(calls.settle).toHaveLength(1)
	})

	it.each([
		[
			"a user file part",
			/file parts/,
			{
				prompt: [
					{
						role: "user",
						content: [
							{ type: "file", mediaType: "image/png", data: new Uint8Array(4) },
						],
					},
				],
			},
		],
		[
			"an assistant file part",
			/file parts/,
			{
				prompt: [
					{
						role: "assistant",
						content: [
							{ type: "file", mediaType: "image/png", data: new Uint8Array(4) },
						],
					},
				],
			},
		],
		[
			"tool result media",
			/media/,
			{
				prompt: [
					{
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "c1",
								toolName: "shot",
								output: {
									type: "content",
									value: [
										{ type: "media", data: "AAAA", mediaType: "image/png" },
									],
								},
							},
						],
					},
				],
			},
		],
		[
			"a provider-defined tool",
			/provider-defined tool web_search/,
			{
				prompt: userPrompt("hi"),
				tools: [
					{
						type: "provider-defined",
						id: "anthropic.web_search_20250305",
						name: "web_search",
						args: {},
					},
				],
			},
		],
		[
			"a server-side fallback option",
			/providerOptions\.anthropic\.fallbacks/,
			{
				prompt: userPrompt("hi"),
				providerOptions: { anthropic: { fallbacks: "default" } },
			},
		],
		[
			"a context management option",
			/providerOptions\.anthropic\.contextManagement/,
			{
				prompt: userPrompt("hi"),
				providerOptions: { anthropic: { contextManagement: { edits: [] } } },
			},
		],
		[
			"options for another provider",
			/openai/,
			{ prompt: userPrompt("hi"), providerOptions: { openai: { user: "u" } } },
		],
		[
			"params that cannot be serialized",
			/serialized/,
			{
				prompt: userPrompt("hi"),
				providerOptions: { anthropic: { metadata: { userId: 10n } } },
			},
		],
	])("refuses %s, whose billing the byte bound cannot see", async (_name, reason, extra) => {
		const model = mockModel()
		const { budget, calls } = fakeBudget()
		const wrapped = capped(model, budget, 1_000_000)
		const request = { maxOutputTokens: 10, ...extra } as never
		const attempt = wrapped.doGenerate(request)
		await expect(attempt).rejects.toBeInstanceOf(BudgetInputRefusedError)
		await expect(attempt).rejects.toThrow(reason)
		expect(model.doGenerateCalls).toBe(0)
		expect(calls.reserve).toEqual([])
	})

	it("allows prompt caching, whose cost is the same tokens", async () => {
		const model = mockModel()
		const { budget } = fakeBudget()
		await capped(model, budget, 10_000).doGenerate({
			prompt: [
				{
					role: "system",
					content: "be brief",
					providerOptions: {
						anthropic: { cacheControl: { type: "ephemeral" } },
					},
				},
				...userPrompt("hi"),
			],
			maxOutputTokens: 10,
			providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
		})
		expect(model.doGenerateCalls).toBe(1)
	})

	it("dispatches a prompt inside the cap under the unchanged reservation", async () => {
		const model = mockModel()
		const { budget, calls } = fakeBudget()
		const wrapped = capped(model, budget, 1000)
		await wrapped.doGenerate({ prompt: userPrompt("hi"), maxOutputTokens: 10 })
		expect(model.doGenerateCalls).toBe(1)
		expect(calls.reserve).toEqual([
			{ key: "k", ceiling: 1_000_000, amount: 1010 },
		])
	})
})

function streamOf(parts: LanguageModelV2StreamPart[]) {
	return new ReadableStream<LanguageModelV2StreamPart>({
		start(controller) {
			for (const part of parts) controller.enqueue(part)
			controller.close()
		},
	})
}

async function drain(stream: ReadableStream<LanguageModelV2StreamPart>) {
	const reader = stream.getReader()
	while (!(await reader.read()).done) {
		// pull to the end
	}
}

const settledUsage = {
	uncachedInput: 100,
	cacheRead: 30,
	cacheWrite: 50,
	output: 20,
}

describe("usage settlement", () => {
	it("settles a complete report, counting absent cache fields as zero", async () => {
		const { budget, calls } = fakeBudget()
		const model = fakeModel({
			doGenerate: async () => ({
				content: [{ type: "text", text: "ok" }],
				finishReason: "stop",
				usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
				warnings: [],
			}),
		})
		await capped(model, budget, 1000).doGenerate({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		expect(calls.settle).toEqual([
			{
				id: "r1",
				usage: { uncachedInput: 7, cacheRead: 0, cacheWrite: 0, output: 3 },
			},
		])
		expect(calls.uncertain).toEqual([])
	})

	it.each([
		["missing output tokens", { ...usage, outputTokens: undefined }, undefined],
		["missing input tokens", { ...usage, inputTokens: undefined }, undefined],
		["NaN output tokens", { ...usage, outputTokens: Number.NaN }, undefined],
		["negative input tokens", { ...usage, inputTokens: -1 }, undefined],
		[
			"infinite input tokens",
			{ ...usage, inputTokens: Number.POSITIVE_INFINITY },
			undefined,
		],
		["negative cached tokens", { ...usage, cachedInputTokens: -5 }, undefined],
		[
			"a non-numeric cache write count",
			usage,
			{ anthropic: { cacheCreationInputTokens: "50" } },
		],
	])("keeps the full reservation when a generate result has %s", async (_name, reported, providerMetadata) => {
		const { budget, calls } = fakeBudget()
		const model = fakeModel({
			doGenerate: async () => ({
				content: [{ type: "text", text: "ok" }],
				finishReason: "stop",
				usage: reported,
				providerMetadata,
				warnings: [],
			}),
		})
		await capped(model, budget, 1000).doGenerate({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		expect(calls.settle).toEqual([])
		expect(calls.uncertain).toEqual(["r1"])
	})

	it("settles a clean stream that finishes with a complete report", async () => {
		const { budget, calls } = fakeBudget()
		const model = fakeModel({
			doStream: async () => ({
				stream: streamOf([
					{ type: "text-start", id: "1" },
					{ type: "text-end", id: "1" },
					{
						type: "finish",
						finishReason: "stop",
						usage,
						providerMetadata: { anthropic: { cacheCreationInputTokens: 50 } },
					},
				]),
			}),
		})
		const { stream } = await capped(model, budget, 1000).doStream({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		await drain(stream)
		expect(calls.settle).toEqual([{ id: "r1", usage: settledUsage }])
		expect(calls.uncertain).toEqual([])
	})

	it("keeps the full reservation when a stream finishes without an output count", async () => {
		const { budget, calls } = fakeBudget()
		const model = fakeModel({
			doStream: async () => ({
				stream: streamOf([
					{
						type: "finish",
						finishReason: "stop",
						usage: { ...usage, outputTokens: undefined },
					},
				]),
			}),
		})
		const { stream } = await capped(model, budget, 1000).doStream({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		await drain(stream)
		expect(calls.settle).toEqual([])
		expect(calls.uncertain).toEqual(["r1"])
	})

	it("keeps the full reservation when an error part is followed by a complete finish", async () => {
		const { budget, calls } = fakeBudget()
		const model = fakeModel({
			doStream: async () => ({
				stream: streamOf([
					{ type: "error", error: new Error("overloaded") },
					{ type: "finish", finishReason: "error", usage },
				]),
			}),
		})
		const { stream } = await capped(model, budget, 1000).doStream({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		await drain(stream)
		expect(calls.settle).toEqual([])
		expect(calls.uncertain).toEqual(["r1"])
	})

	it("keeps the full reservation when a stream ends without a finish part", async () => {
		const { budget, calls } = fakeBudget()
		const model = fakeModel({
			doStream: async () => ({
				stream: streamOf([{ type: "text-start", id: "1" }]),
			}),
		})
		const { stream } = await capped(model, budget, 1000).doStream({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		await drain(stream)
		expect(calls.settle).toEqual([])
		expect(calls.uncertain).toEqual(["r1"])
	})
})

function cancelWatchingStream() {
	const cancelled: unknown[] = []
	const stream = new ReadableStream<LanguageModelV2StreamPart>({
		start(controller) {
			controller.enqueue({ type: "text-start", id: "1" })
		},
		pull: () => new Promise<void>(() => {}),
		cancel(reason) {
			cancelled.push(reason)
		},
	})
	return { stream, cancelled }
}

describe("cancellation", () => {
	it("cancels the provider stream even when the store rejects during cancel", async () => {
		const { stream: providerStream, cancelled } = cancelWatchingStream()
		const { budget, calls } = fakeBudget({
			markUncertain: async (id) => {
				calls.uncertain.push(id)
				throw new Error("store down")
			},
		})
		const model = fakeModel({
			doStream: async () => ({ stream: providerStream }),
		})
		const { stream } = await capped(model, budget, 1000).doStream({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		const reader = stream.getReader()
		await reader.read()
		await reader.cancel("client gone")
		expect(cancelled).toEqual(["client gone"])
		expect(calls.uncertain).toEqual(["r1"])
	})

	it("cancels the provider stream without waiting for a store that hangs", {
		timeout: 1000,
	}, async () => {
		const { stream: providerStream, cancelled } = cancelWatchingStream()
		const { budget } = fakeBudget({
			markUncertain: () => new Promise<void>(() => {}),
		})
		const model = fakeModel({
			doStream: async () => ({ stream: providerStream }),
		})
		const { stream } = await capped(model, budget, 1000).doStream({
			prompt: userPrompt("hi"),
			maxOutputTokens: 10,
		})
		const reader = stream.getReader()
		await reader.read()
		await reader.cancel("client gone")
		expect(cancelled).toEqual(["client gone"])
	})

	it("leaves no unhandled rejection when the abort listener's bookkeeping fails", async () => {
		const unhandled: unknown[] = []
		const onUnhandled = (reason: unknown) => unhandled.push(reason)
		process.on("unhandledRejection", onUnhandled)
		try {
			const { stream: providerStream } = cancelWatchingStream()
			const { budget, calls } = fakeBudget({
				markUncertain: async (id) => {
					calls.uncertain.push(id)
					throw new Error("store down")
				},
			})
			const model = fakeModel({
				doStream: async () => ({ stream: providerStream }),
			})
			const controller = new AbortController()
			await capped(model, budget, 1000).doStream({
				prompt: userPrompt("hi"),
				maxOutputTokens: 10,
				abortSignal: controller.signal,
			})
			controller.abort()
			await new Promise((resolve) => setTimeout(resolve, 20))
			expect(calls.uncertain).toEqual(["r1"])
			expect(unhandled).toEqual([])
		} finally {
			process.off("unhandledRejection", onUnhandled)
		}
	})
})

describe("numeric limits", () => {
	const unsafe = [
		Number.NaN,
		-1,
		Number.POSITIVE_INFINITY,
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
	]

	it.each(
		unsafe,
	)("rejects ceiling %s when the middleware is built", (ceiling) => {
		const { budget } = fakeBudget()
		expect(() =>
			budgetMiddleware({ budget, key: "k", ceiling, maxInputTokens: 1000 }),
		).toThrow(/ceiling/)
	})

	it.each([
		0,
		...unsafe,
	])("rejects maxInputTokens %s when the middleware is built", (maxInputTokens) => {
		const { budget } = fakeBudget()
		expect(() =>
			budgetMiddleware({ budget, key: "k", ceiling: 10_000, maxInputTokens }),
		).toThrow(/maxInputTokens/)
	})

	it.each([
		0,
		...unsafe,
	])("refuses a call with maxOutputTokens %s before reserving", async (maxOutputTokens) => {
		const model = mockModel()
		const { budget, calls } = fakeBudget()
		await expect(
			capped(model, budget, 1000).doGenerate({
				prompt: userPrompt("hi"),
				maxOutputTokens,
			}),
		).rejects.toThrow(/maxOutputTokens/)
		expect(model.doGenerateCalls).toBe(0)
		expect(calls.reserve).toEqual([])
	})

	it("refuses a reservation whose total is not a safe integer", async () => {
		const model = mockModel()
		const { budget, calls } = fakeBudget()
		await expect(
			capped(model, budget, Number.MAX_SAFE_INTEGER).doGenerate({
				prompt: userPrompt("hi"),
				maxOutputTokens: 10,
			}),
		).rejects.toThrow(/reservation/)
		expect(calls.reserve).toEqual([])
	})

	it("treats ceiling 0 as off and any other bad ceiling or amount as an error in reserve", async () => {
		const budget = createModelBudget(unreachableDb())
		await expect(
			budget.reserve({ key: "k", ceiling: 0, amount: 10 }),
		).rejects.toBeInstanceOf(BudgetExhaustedError)
		for (const ceiling of unsafe) {
			await expect(
				budget.reserve({ key: "k", ceiling, amount: 10 }),
			).rejects.toBeInstanceOf(RangeError)
		}
		for (const amount of [0, ...unsafe]) {
			await expect(
				budget.reserve({ key: "k", ceiling: 100, amount }),
			).rejects.toBeInstanceOf(RangeError)
		}
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
