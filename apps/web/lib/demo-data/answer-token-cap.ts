// The answer lane's input cap, enforced in tokens (spec: an 8,000-token
// context). The model's transport counts the exact Messages request with
// Anthropic's free token-counting endpoint and refuses it before sending;
// the budget middleware runs with inputCap "transport" and keeps the same
// reservation. When no count can be had, the byte bound applies instead,
// which never admits more than the token cap would.
import { TransportInputRefusedError } from "@mdbrain/lib/budget"

/** The count is an estimate that can differ from the billed input by a small
 * amount, so a request is sent only when it counts at most 98% of the cap and
 * the call's reservation still covers what it bills. */
const ESTIMATE_MARGIN = 0.02

/** The hidden tool-use system prompt the byte fallback adds, as the budget's
 * own byte bound does (packages/lib/src/budget.ts). */
const TOOL_PROMPT_ALLOWANCE_TOKENS = 1024

const COUNTED_FIELDS = [
	"model",
	"system",
	"messages",
	"tools",
	"tool_choice",
	"thinking",
] as const

/** Fields the provider may send that carry no input the count misses. A
 * body with any other field is refused, so the count cannot run low. */
const UNCOUNTED_FIELDS = new Set([
	"max_tokens",
	"stream",
	"temperature",
	"top_p",
	"top_k",
	"stop_sequences",
	"metadata",
])

export function tokenCappedFetch(options: {
	maxInputTokens: number
	fetch?: typeof fetch
}): typeof fetch {
	const send = options.fetch ?? globalThis.fetch
	const limit = Math.floor(options.maxInputTokens * (1 - ESTIMATE_MARGIN))

	async function count(
		url: string,
		init: RequestInit,
		request: Record<string, unknown>,
	): Promise<number | undefined> {
		const body: Record<string, unknown> = {}
		for (const field of COUNTED_FIELDS) {
			if (request[field] !== undefined) body[field] = request[field]
		}
		let response: Response
		try {
			response = await send(`${url}/count_tokens`, {
				method: "POST",
				headers: init.headers,
				body: JSON.stringify(body),
				signal: init.signal,
			})
		} catch (error) {
			if (init.signal?.aborted) throw error
			return undefined
		}
		if (!response.ok) return undefined
		const parsed = (await response.json().catch(() => null)) as {
			input_tokens?: unknown
		} | null
		const tokens = parsed?.input_tokens
		return typeof tokens === "number" &&
			Number.isSafeInteger(tokens) &&
			tokens >= 0
			? tokens
			: undefined
	}

	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		// Fail closed: the middleware leaves this transport the cap, so every
		// POST is counted whatever the base URL, and a call whose body cannot be
		// read here is never sent.
		if (input instanceof Request || !init) {
			throw new TransportInputRefusedError(
				"the model request cannot be read before it is sent",
			)
		}
		const url = String(input)
		if ((init.method ?? "GET").toUpperCase() !== "POST") {
			return send(input, init)
		}
		let request: Record<string, unknown>
		try {
			request = JSON.parse(String(init.body)) as Record<string, unknown>
		} catch {
			throw new TransportInputRefusedError(
				"the model request body cannot be counted",
			)
		}
		const unknown = Object.keys(request).filter(
			(field) =>
				!UNCOUNTED_FIELDS.has(field) &&
				!(COUNTED_FIELDS as readonly string[]).includes(field),
		)
		if (unknown.length > 0) {
			throw new TransportInputRefusedError(
				`the model request carries fields the count would not see: ${unknown.join(", ")}`,
			)
		}
		const tokens = await count(url, init, request)
		if (tokens !== undefined) {
			if (tokens > limit) {
				throw new TransportInputRefusedError(
					`model call counted ${tokens} input tokens, over the ${limit}-token cap`,
				)
			}
			return send(input, init)
		}
		console.warn(
			"demo answers: no token count came back, so the byte bound applies",
		)
		const tools = Array.isArray(request.tools) && request.tools.length > 0
		const bound =
			Buffer.byteLength(String(init.body), "utf8") +
			(tools ? TOOL_PROMPT_ALLOWANCE_TOKENS : 0)
		if (bound > limit) {
			throw new TransportInputRefusedError(
				`model call could not be counted and its byte bound ${bound} exceeds the ${limit}-token cap`,
			)
		}
		return send(input, init)
	}) as typeof fetch
}
