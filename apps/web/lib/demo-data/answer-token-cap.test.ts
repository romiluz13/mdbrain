// The answer lane's input cap in tokens: the transport counts the exact
// request with Anthropic's token-counting endpoint before it sends it.
import { TransportInputRefusedError } from "@mdbrain/lib/budget"
import { describe, expect, it } from "vitest"
import { tokenCappedFetch } from "./answer-token-cap.js"

const MESSAGES_URL = "https://api.anthropic.com/v1/messages"
const COUNT_URL = "https://api.anthropic.com/v1/messages/count_tokens"

const request = {
	model: "claude-haiku-5-5",
	max_tokens: 1000,
	system: [{ type: "text", text: "You answer one visitor question." }],
	messages: [
		{ role: "user", content: [{ type: "text", text: "Is it safe?" }] },
	],
	tools: [
		{
			name: "search_brain",
			description: "Search the stored pages",
			input_schema: { type: "object", properties: {} },
		},
	],
	tool_choice: { type: "auto" },
}

type Sent = { url: string; init: RequestInit }

function upstream(count: () => Response | Promise<Response>) {
	const sent: Sent[] = []
	const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input)
		sent.push({ url, init: init ?? {} })
		if (url.endsWith("/count_tokens")) return count()
		return new Response(JSON.stringify({ ok: true }), { status: 200 })
	}) as typeof fetch
	return { base, sent }
}

const counted = (tokens: number) => () =>
	new Response(JSON.stringify({ input_tokens: tokens }), { status: 200 })

const post = (body: unknown) => ({
	method: "POST",
	headers: { "x-api-key": "test-key", "content-type": "application/json" },
	body: JSON.stringify(body),
})

describe("tokenCappedFetch", () => {
	it("counts the exact request with the same headers, then sends it unchanged", async () => {
		const { base, sent } = upstream(counted(2_900))
		const capped = tokenCappedFetch({ maxInputTokens: 8_000, fetch: base })
		const init = post(request)
		const response = await capped(MESSAGES_URL, init)
		expect(response.status).toBe(200)
		expect(sent.map((s) => s.url)).toEqual([COUNT_URL, MESSAGES_URL])
		const { max_tokens: _max, ...countable } = request
		expect(JSON.parse(String(sent[0]?.init.body))).toEqual(countable)
		expect(sent[0]?.init.headers).toEqual(init.headers)
		expect(sent[1]?.init).toBe(init)
	})

	it("refuses before sending a request counted over the cap less its 2% estimate margin", async () => {
		const { base, sent } = upstream(counted(7_841))
		const capped = tokenCappedFetch({ maxInputTokens: 8_000, fetch: base })
		await expect(capped(MESSAGES_URL, post(request))).rejects.toBeInstanceOf(
			TransportInputRefusedError,
		)
		expect(sent.map((s) => s.url)).toEqual([COUNT_URL])
		const { base: atMargin, sent: sentAtMargin } = upstream(counted(7_840))
		await tokenCappedFetch({ maxInputTokens: 8_000, fetch: atMargin })(
			MESSAGES_URL,
			post(request),
		)
		expect(sentAtMargin.map((s) => s.url)).toEqual([COUNT_URL, MESSAGES_URL])
	})

	it("falls back to the byte bound when the count cannot be had", async () => {
		for (const failure of [
			() => new Response("overloaded", { status: 529 }),
			() => new Response(JSON.stringify({ input_tokens: "many" })),
			() => {
				throw new TypeError("fetch failed")
			},
		]) {
			const small = upstream(failure)
			await tokenCappedFetch({ maxInputTokens: 8_000, fetch: small.base })(
				MESSAGES_URL,
				post(request),
			)
			expect(small.sent.map((s) => s.url)).toEqual([COUNT_URL, MESSAGES_URL])

			const large = upstream(failure)
			const big = {
				...request,
				messages: [{ role: "user", content: "x".repeat(7_000) }],
			}
			await expect(
				tokenCappedFetch({ maxInputTokens: 8_000, fetch: large.base })(
					MESSAGES_URL,
					post(big),
				),
			).rejects.toBeInstanceOf(TransportInputRefusedError)
			expect(large.sent.map((s) => s.url)).toEqual([COUNT_URL])
		}
	})

	it("sends nothing when the count is aborted", async () => {
		const controller = new AbortController()
		const { base, sent } = upstream(() => {
			controller.abort()
			throw new DOMException("aborted", "AbortError")
		})
		const capped = tokenCappedFetch({ maxInputTokens: 8_000, fetch: base })
		await expect(
			capped(MESSAGES_URL, { ...post(request), signal: controller.signal }),
		).rejects.toThrow(/aborted/)
		expect(sent.map((s) => s.url)).toEqual([COUNT_URL])
	})

	it("refuses a messages request whose body it cannot read, and passes other requests through", async () => {
		const { base, sent } = upstream(counted(1))
		const capped = tokenCappedFetch({ maxInputTokens: 8_000, fetch: base })
		await expect(
			capped(MESSAGES_URL, { method: "POST", body: "not json" }),
		).rejects.toBeInstanceOf(TransportInputRefusedError)
		await capped("https://api.anthropic.com/v1/models", { method: "GET" })
		expect(sent.map((s) => s.url)).toEqual([
			"https://api.anthropic.com/v1/models",
		])
	})

	it("caps every POST whatever the base URL, and refuses a call it cannot read", async () => {
		const { base, sent } = upstream(counted(9_000))
		const capped = tokenCappedFetch({ maxInputTokens: 8_000, fetch: base })
		await expect(
			capped("https://gateway.example/anthropic/messages", post(request)),
		).rejects.toBeInstanceOf(TransportInputRefusedError)
		expect(sent.map((s) => s.url)).toEqual([
			"https://gateway.example/anthropic/messages/count_tokens",
		])
		for (const unreadable of [
			() => capped(new Request(MESSAGES_URL, post(request))),
			() => capped(MESSAGES_URL),
		]) {
			await expect(unreadable()).rejects.toBeInstanceOf(
				TransportInputRefusedError,
			)
		}
		expect(sent).toHaveLength(1)
	})

	it("refuses a body with a field the count would not see", async () => {
		const { base, sent } = upstream(counted(1))
		const capped = tokenCappedFetch({ maxInputTokens: 8_000, fetch: base })
		await expect(
			capped(MESSAGES_URL, post({ ...request, container: "skills" })),
		).rejects.toBeInstanceOf(TransportInputRefusedError)
		expect(sent).toEqual([])
	})
})
