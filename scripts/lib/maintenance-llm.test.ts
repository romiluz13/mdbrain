// maintenance-llm.ts tests — the adapters must faithfully bridge the
// OpenAI-compatible transport to the wiki-engine maintenance contracts.

import { describe, expect, it } from "vitest"
import { asDreamerClassifier, asLlmGenerateFn } from "./maintenance-llm.js"
import { LlmResponseError, type LlmConfig } from "./openai-compatible-llm.js"

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

/** Fake fetch returning a fixed chat completion content. */
function fakeFetch(content: string): {
	fetchImpl: typeof fetch
	bodies: Array<Record<string, unknown>>
} {
	const bodies: Array<Record<string, unknown>> = []
	const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
		return new Response(
			JSON.stringify({
				choices: [
					{ message: { content, refusal: null }, finish_reason: "stop" },
				],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		)
	}) as unknown as typeof fetch
	return { fetchImpl, bodies }
}

describe("asLlmGenerateFn (git-diff regeneration)", () => {
	it("maps the LLM payload to LlmGenerateFn output and sends source context", async () => {
		const content = JSON.stringify({
			title: null,
			summary: "A connector module.",
			body: "# Connector\n\nDoes things.",
			claims: [
				{ text: "The connector exports one class.", confidence: 0.9 },
				{ text: "Ingest is not implemented.", confidence: null },
			],
		})
		const { fetchImpl, bodies } = fakeFetch(content)
		const generate = asLlmGenerateFn(testConfig(), { fetchImpl })

		const result = await generate({
			sourceFile: "src/wiki-connectors.ts",
			changedSnippet: "export class ObsidianConnector {}",
			currentPage: {
				title: "Connectors",
				summary: "old",
				body: "old body",
				claims: [{ text: "Ingest is not implemented." }],
			},
		})

		expect(result).toEqual({
			title: undefined,
			summary: "A connector module.",
			body: "# Connector\n\nDoes things.",
			claims: [
				{ text: "The connector exports one class.", confidence: 0.9 },
				{ text: "Ingest is not implemented.", confidence: undefined },
			],
		})

		const body = bodies[0] as {
			response_format: { json_schema: { name: string; strict: boolean } }
			messages: Array<{ role: string; content: string }>
		}
		expect(body.response_format.json_schema.name).toBe(
			"git_diff_page_regeneration",
		)
		expect(body.response_format.json_schema.strict).toBe(true)
		const user = JSON.parse(
			body.messages.find((m) => m.role === "user")?.content ?? "{}",
		) as Record<string, unknown>
		expect(user.sourceFile).toBe("src/wiki-connectors.ts")
		expect(user.currentPage).toEqual({
			title: "Connectors",
			summary: "old",
			body: "old body",
			claims: [{ text: "Ingest is not implemented." }],
		})
	})

	it("omits currentPage when the input has none", async () => {
		const content = JSON.stringify({
			title: "New Page",
			summary: "s",
			body: "b",
			claims: [],
		})
		const { fetchImpl, bodies } = fakeFetch(content)
		const generate = asLlmGenerateFn(testConfig(), { fetchImpl })
		await generate({
			sourceFile: "src/new.ts",
			changedSnippet: "new stuff",
		})
		const user = JSON.parse(
			(
				bodies[0] as { messages: Array<{ role: string; content: string }> }
			).messages.find((m) => m.role === "user")?.content ?? "{}",
		) as Record<string, unknown>
		expect(user.currentPage).toBeNull()
	})
})

describe("asDreamerClassifier (phases 3 + 4)", () => {
	it("returns the classification and sends event + similar page", async () => {
		const content = JSON.stringify({
			injection: "update",
			claims: [{ text: "The API now supports batching.", confidence: 0.85 }],
		})
		const { fetchImpl, bodies } = fakeFetch(content)
		const classifier = asDreamerClassifier(testConfig(), { fetchImpl })

		const result = await classifier({
			event: { id: "evt-1", text: "We shipped batch support today." },
			existingPage: {
				title: "API",
				summary: "s",
				body: "old",
				claims: [{ text: "The API supports single requests." }],
			},
		})

		expect(result).toEqual({
			injection: "update",
			claims: [{ text: "The API now supports batching.", confidence: 0.85 }],
		})

		const body = bodies[0] as {
			response_format: { json_schema: { name: string } }
			messages: Array<{ role: string; content: string }>
		}
		expect(body.response_format.json_schema.name).toBe(
			"dreamer_event_classification",
		)
		const user = JSON.parse(
			body.messages.find((m) => m.role === "user")?.content ?? "{}",
		) as Record<string, unknown>
		expect(user.event).toEqual({
			id: "evt-1",
			text: "We shipped batch support today.",
		})
		expect(user.existingPage).toEqual({
			title: "API",
			summary: "s",
			body: "old",
			claims: [{ text: "The API supports single requests." }],
		})
	})

	it("propagates refusal as LlmResponseError (no silent empty classification)", async () => {
		const fetchImpl = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: { content: null, refusal: "not allowed" },
							finish_reason: "stop",
						},
					],
				}),
				{ status: 200 },
			)) as unknown as typeof fetch
		const classifier = asDreamerClassifier(testConfig(), { fetchImpl })
		await expect(
			classifier({ event: { id: "evt-2", text: "hello" } }),
		).rejects.toThrow(LlmResponseError)
	})
})
