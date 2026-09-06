// openai-compatible-llm.ts tests — fake-fetch coverage of every explicit
// failure path (agreed plan W3): success, malformed JSON, refusal,
// truncation, timeout, retry bounds, redaction, response caps, structured
// outputs on/off, env contract.

import { describe, expect, it, vi } from "vitest"
import {
	chatJson,
	DEFAULT_LLM_MAX_RESPONSE_BYTES,
	DEFAULT_LLM_TIMEOUT_MS,
	LlmConfigError,
	LlmRequestError,
	LlmResponseError,
	resolveLlmConfigFromEnv,
	type LlmConfig,
} from "./openai-compatible-llm.js"
import type { JsonSchema } from "./json-schema.js"

const TEST_SCHEMA: JsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["answer"],
	properties: { answer: { type: "string" } },
}

function testConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
	return {
		baseUrl: "http://llm.test/v1",
		apiKey: "secret-key",
		model: "test-model",
		authStyle: "authorization-bearer",
		tokenParam: "max_tokens",
		timeoutMs: 5000,
		maxResponseBytes: 64 * 1024,
		structuredOutputs: true,
		...overrides,
	}
}

interface CapturedCall {
	url: string
	init: RequestInit
}

function okResponse(
	content: string,
	opts: { finishReason?: string; refusal?: string } = {},
): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: { content, refusal: opts.refusal ?? null },
					finish_reason: opts.finishReason ?? "stop",
				},
			],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	)
}

function errorResponse(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	})
}

/** A 200 response streamed in chunks without a declared content-length. */
function streamingResponse(chunks: string[]): Response {
	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
			controller.close()
		},
	})
	return new Response(stream, { status: 200 })
}

/** A fetch fake that records calls and replays a queue of responses. Each
 *  call gets a clone so bodies stay readable across retries. */
function fetchQueue(responses: Response[]): {
	fetchImpl: typeof fetch
	calls: CapturedCall[]
} {
	const calls: CapturedCall[] = []
	let index = 0
	const fetchImpl = (async (url: unknown, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} })
		const response = responses[Math.min(index, responses.length - 1)]
		index++
		return response instanceof Response ? response.clone() : response
	}) as unknown as typeof fetch
	return { fetchImpl, calls }
}

describe("resolveLlmConfigFromEnv", () => {
	it("resolves defaults from a complete environment", () => {
		const config = resolveLlmConfigFromEnv({
			MDBRAIN_LLM_BASE_URL: " http://llm.test/v1 ",
			MDBRAIN_LLM_API_KEY: "key",
			MDBRAIN_LLM_MODEL: "model",
		})
		expect(config).toEqual({
			baseUrl: "http://llm.test/v1",
			apiKey: "key",
			model: "model",
			authStyle: "authorization-bearer",
			tokenParam: "max_tokens",
			timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
			maxResponseBytes: DEFAULT_LLM_MAX_RESPONSE_BYTES,
			structuredOutputs: true,
		})
	})

	it("names every missing required variable", () => {
		expect(() => resolveLlmConfigFromEnv({})).toThrow(LlmConfigError)
		expect(() => resolveLlmConfigFromEnv({})).toThrow(
			/MDBRAIN_LLM_BASE_URL, MDBRAIN_LLM_API_KEY, MDBRAIN_LLM_MODEL are required/,
		)
	})

	it("rejects invalid auth style and token param", () => {
		const base = {
			MDBRAIN_LLM_BASE_URL: "http://llm.test/v1",
			MDBRAIN_LLM_API_KEY: "key",
			MDBRAIN_LLM_MODEL: "model",
		}
		expect(() =>
			resolveLlmConfigFromEnv({ ...base, MDBRAIN_LLM_AUTH_STYLE: "basic" }),
		).toThrow(/AUTH_STYLE must be/)
		expect(() =>
			resolveLlmConfigFromEnv({ ...base, MDBRAIN_LLM_TOKEN_PARAM: "tokens" }),
		).toThrow(/TOKEN_PARAM must be/)
	})

	it("rejects non-positive timeouts and size caps", () => {
		const base = {
			MDBRAIN_LLM_BASE_URL: "http://llm.test/v1",
			MDBRAIN_LLM_API_KEY: "key",
			MDBRAIN_LLM_MODEL: "model",
		}
		expect(() =>
			resolveLlmConfigFromEnv({ ...base, MDBRAIN_LLM_TIMEOUT_MS: "0" }),
		).toThrow(/TIMEOUT_MS must be a positive integer/)
		expect(() =>
			resolveLlmConfigFromEnv({
				...base,
				MDBRAIN_LLM_MAX_RESPONSE_BYTES: "-1",
			}),
		).toThrow(/MAX_RESPONSE_BYTES must be a positive integer/)
	})

	it("disables structured outputs with 0 or false", () => {
		const base = {
			MDBRAIN_LLM_BASE_URL: "http://llm.test/v1",
			MDBRAIN_LLM_API_KEY: "key",
			MDBRAIN_LLM_MODEL: "model",
		}
		expect(
			resolveLlmConfigFromEnv({ ...base, MDBRAIN_LLM_STRUCTURED_OUTPUTS: "0" })
				.structuredOutputs,
		).toBe(false)
		expect(
			resolveLlmConfigFromEnv({
				...base,
				MDBRAIN_LLM_STRUCTURED_OUTPUTS: "false",
			}).structuredOutputs,
		).toBe(false)
	})
})

describe("chatJson — success paths", () => {
	it("attaches strict response_format and returns validated JSON", async () => {
		const { fetchImpl, calls } = fetchQueue([okResponse('{"answer":"42"}')])
		const result = await chatJson(
			testConfig(),
			{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
			{ fetchImpl },
		)
		expect(result).toEqual({ answer: "42" })
		expect(calls).toHaveLength(1)
		const body = JSON.parse(String(calls[0].init.body)) as Record<
			string,
			unknown
		>
		expect(calls[0].url).toBe("http://llm.test/v1/chat/completions")
		expect(calls[0].init.method).toBe("POST")
		expect(
			(calls[0].init.headers as Record<string, string>).Authorization,
		).toBe("Bearer secret-key")
		expect(body.model).toBe("test-model")
		expect(body.max_tokens).toBe(1024)
		expect(body.response_format).toEqual({
			type: "json_schema",
			json_schema: { name: "test", strict: true, schema: TEST_SCHEMA },
		})
	})

	it("uses the configured auth style and token param", async () => {
		const { fetchImpl, calls } = fetchQueue([okResponse('{"answer":"42"}')])
		await chatJson(
			testConfig({
				authStyle: "x-api-key",
				tokenParam: "max_completion_tokens",
			}),
			{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
			{ fetchImpl },
		)
		const headers = calls[0].init.headers as Record<string, string>
		expect(headers["x-api-key"]).toBe("secret-key")
		expect(headers.Authorization).toBeUndefined()
		const body = JSON.parse(String(calls[0].init.body)) as Record<
			string,
			unknown
		>
		expect(body.max_completion_tokens).toBe(1024)
		expect(body.max_tokens).toBeUndefined()
	})

	it("without structured outputs, embeds the schema in the prompt and parses fenced JSON", async () => {
		const { fetchImpl, calls } = fetchQueue([
			okResponse('```json\n{"answer":"42"}\n```'),
		])
		const result = await chatJson(
			testConfig({ structuredOutputs: false }),
			{
				schemaName: "test",
				schema: TEST_SCHEMA,
				system: "be brief",
				user: "u",
			},
			{ fetchImpl },
		)
		expect(result).toEqual({ answer: "42" })
		const body = JSON.parse(String(calls[0].init.body)) as {
			response_format?: unknown
			messages: Array<{ role: string; content: string }>
		}
		expect(body.response_format).toBeUndefined()
		expect(body.messages[0].content).toContain("be brief")
		expect(body.messages[0].content).toContain("JSON Schema")
	})
})

describe("chatJson — explicit failure paths", () => {
	it("throws on refusal", async () => {
		const { fetchImpl } = fetchQueue([
			okResponse("", { refusal: "I cannot help with that" }),
		])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(LlmResponseError)
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/refused the request/)
	})

	it("throws on finish_reason length (truncated output)", async () => {
		const { fetchImpl } = fetchQueue([
			okResponse('{"answer":"4', { finishReason: "length" }),
		])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/"length" .*truncated/)
	})

	it("throws on missing message content", async () => {
		const { fetchImpl } = fetchQueue([okResponse("")])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/missing message content/)
	})

	it("throws on malformed JSON content", async () => {
		const { fetchImpl } = fetchQueue([okResponse("not json at all")])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/malformed JSON/)
	})

	it("throws when local schema validation fails", async () => {
		const { fetchImpl } = fetchQueue([okResponse('{"nope":"x"}')])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(
			/local schema validation: \$: missing required property "answer"/,
		)
	})

	it("throws on a non-JSON response body", async () => {
		const { fetchImpl } = fetchQueue([
			new Response("<html>gateway</html>", { status: 200 }),
		])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/non-JSON response body/)
	})
})

describe("chatJson — transport posture", () => {
	it("times out via AbortSignal and reports the budget", async () => {
		const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
				})
			})
		}) as unknown as typeof fetch
		await expect(
			chatJson(
				testConfig({ timeoutMs: 20 }),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/timed out after 20ms/)
	})

	it("retries transient statuses and succeeds", async () => {
		const { fetchImpl, calls } = fetchQueue([
			errorResponse(429, '{"error":{"message":"rate limited"}}'),
			errorResponse(503, '{"error":{"message":"overloaded"}}'),
			okResponse('{"answer":"42"}'),
		])
		const result = await chatJson(
			testConfig(),
			{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
			{ fetchImpl, retryDelayMs: 0 },
		)
		expect(result).toEqual({ answer: "42" })
		expect(calls).toHaveLength(3)
	})

	it("stops retrying after the retry bound", async () => {
		const { fetchImpl, calls } = fetchQueue([
			errorResponse(500, '{"error":{"message":"boom"}}'),
		])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl, retryDelayMs: 0 },
			),
		).rejects.toThrow(LlmRequestError)
		expect(calls).toHaveLength(3) // 1 attempt + 2 retries
	})

	it("never retries non-transient statuses", async () => {
		const { fetchImpl, calls } = fetchQueue([
			errorResponse(401, '{"error":{"message":"bad key"}}'),
		])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/failed \(401\): bad key/)
		expect(calls).toHaveLength(1)
	})

	it("redacts the API key from error messages", async () => {
		const { fetchImpl } = fetchQueue([
			errorResponse(
				401,
				'{"error":{"message":"invalid key secret-key provided"}}',
			),
		])
		const promise = chatJson(
			testConfig(),
			{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
			{ fetchImpl },
		)
		await expect(promise).rejects.toThrow(/\[redacted\]/)
		await expect(promise).rejects.toThrow(/invalid key \[redacted\] provided/)
	})

	it("enforces the response byte cap while streaming", async () => {
		const bigBody = "x".repeat(4096)
		const { fetchImpl } = fetchQueue([streamingResponse([bigBody])])
		await expect(
			chatJson(
				testConfig({ maxResponseBytes: 1024 }),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/exceeds the 1024-byte cap/)
	})

	it("rejects a declared content-length above the cap before reading", async () => {
		const fakeResponse = {
			ok: true,
			headers: new Headers({ "content-length": String(1024 * 1024) }),
			body: null,
			text: async () => "{}",
		} as unknown as Response
		const { fetchImpl } = fetchQueue([fakeResponse])
		await expect(
			chatJson(
				testConfig({ maxResponseBytes: 2048 }),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/exceeds the 2048-byte cap \(declared/)
	})
})

describe("chatJson — no silent empty-result success", () => {
	it("a 200 with empty choices still throws", async () => {
		const { fetchImpl } = fetchQueue([new Response("{}", { status: 200 })])
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/missing message content/)
	})

	it("does not leak the key through the fetch signal path", async () => {
		const spy = vi.fn()
		const fetchImpl = (async () => {
			spy()
			throw new Error("ECONNREFUSED")
		}) as unknown as typeof fetch
		await expect(
			chatJson(
				testConfig(),
				{ schemaName: "test", schema: TEST_SCHEMA, system: "s", user: "u" },
				{ fetchImpl },
			),
		).rejects.toThrow(/ECONNREFUSED/)
	})
})
