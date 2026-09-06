// Shared OpenAI-compatible LLM adapter for maintenance tooling (agreed plan
// W3), extracted from the live-tested callModel pattern in
// scripts/real-agent-smoke.ts.
//
// Transport: POST {BASE_URL}/chat/completions with three auth styles
// (MDBRAIN_LLM_AUTH_STYLE) and two token-count parameters
// (MDBRAIN_LLM_TOKEN_PARAM) — the knobs real-agent-smoke needed across
// providers. Structured output: response_format json_schema (strict) when
// enabled; model-gated upstream, so MDBRAIN_LLM_STRUCTURED_OUTPUTS=0 falls
// back to a prompt-embedded schema. Every response is validated locally
// regardless (scripts/lib/json-schema.ts).
//
// Safety posture: one AbortSignal timeout bounds all attempts; retries only
// on transient HTTP status (429/500/502/503/504, max 2); response bodies are
// size-capped; error messages never echo the API key.

import { validateJsonSchema, type JsonSchema } from "./json-schema.js"

export type LlmAuthStyle = "authorization-bearer" | "api-key" | "x-api-key"
export type LlmTokenParam = "max_tokens" | "max_completion_tokens"

export interface LlmConfig {
	baseUrl: string
	apiKey: string
	model: string
	authStyle: LlmAuthStyle
	tokenParam: LlmTokenParam
	/** Total budget for all attempts of one call (default 60s). */
	timeoutMs: number
	/** Response body cap in bytes (default 256 KiB). */
	maxResponseBytes: number
	/** Attach response_format json_schema (strict). Default true; disable
	 *  for models without Structured Outputs support. */
	structuredOutputs: boolean
}

export const DEFAULT_LLM_TIMEOUT_MS = 60_000
export const DEFAULT_LLM_MAX_RESPONSE_BYTES = 256 * 1024
const MAX_RETRIES = 2
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const DEFAULT_RETRY_DELAY_MS = 250

/** Environment resolution failed (missing/invalid MDBRAIN_LLM_*). */
export class LlmConfigError extends Error {
	constructor(detail: string) {
		super(detail)
		this.name = "LlmConfigError"
	}
}

/** Transport failure: non-transient or exhausted-transient HTTP status,
 *  network error, or timeout. Message is key-redacted. */
export class LlmRequestError extends Error {
	constructor(detail: string) {
		super(detail)
		this.name = "LlmRequestError"
	}
}

/** Payload failure: refusal, non-stop finish_reason, malformed JSON, or
 *  local schema validation violations. No silent empty-result success. */
export class LlmResponseError extends Error {
	constructor(detail: string) {
		super(detail)
		this.name = "LlmResponseError"
	}
}

/** Resolves the MDBRAIN_LLM_* environment contract. Throws LlmConfigError
 *  naming every missing or invalid variable — never a silent default. */
export function resolveLlmConfigFromEnv(
	env: Record<string, string | undefined> = process.env,
): LlmConfig {
	const baseUrl = env.MDBRAIN_LLM_BASE_URL?.trim() ?? ""
	const apiKey = env.MDBRAIN_LLM_API_KEY?.trim() ?? ""
	const model = env.MDBRAIN_LLM_MODEL?.trim() ?? ""
	const missing: string[] = []
	if (!baseUrl) missing.push("MDBRAIN_LLM_BASE_URL")
	if (!apiKey) missing.push("MDBRAIN_LLM_API_KEY")
	if (!model) missing.push("MDBRAIN_LLM_MODEL")
	if (missing.length > 0) {
		throw new LlmConfigError(
			`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`,
		)
	}

	const authStyleRaw = env.MDBRAIN_LLM_AUTH_STYLE?.trim()
	const authStyle =
		authStyleRaw === undefined || authStyleRaw === ""
			? "authorization-bearer"
			: authStyleRaw
	if (
		authStyle !== "authorization-bearer" &&
		authStyle !== "api-key" &&
		authStyle !== "x-api-key"
	) {
		throw new LlmConfigError(
			"MDBRAIN_LLM_AUTH_STYLE must be authorization-bearer, api-key, or x-api-key.",
		)
	}

	const tokenParamRaw = env.MDBRAIN_LLM_TOKEN_PARAM?.trim()
	const tokenParam =
		tokenParamRaw === undefined || tokenParamRaw === ""
			? "max_tokens"
			: tokenParamRaw
	if (tokenParam !== "max_tokens" && tokenParam !== "max_completion_tokens") {
		throw new LlmConfigError(
			"MDBRAIN_LLM_TOKEN_PARAM must be max_tokens or max_completion_tokens.",
		)
	}

	const timeoutMs = parsePositiveInt(
		env.MDBRAIN_LLM_TIMEOUT_MS,
		DEFAULT_LLM_TIMEOUT_MS,
		"MDBRAIN_LLM_TIMEOUT_MS",
	)
	const maxResponseBytes = parsePositiveInt(
		env.MDBRAIN_LLM_MAX_RESPONSE_BYTES,
		DEFAULT_LLM_MAX_RESPONSE_BYTES,
		"MDBRAIN_LLM_MAX_RESPONSE_BYTES",
	)
	const structuredRaw = env.MDBRAIN_LLM_STRUCTURED_OUTPUTS?.trim().toLowerCase()
	const structuredOutputs = !(
		structuredRaw === "0" || structuredRaw === "false"
	)

	return {
		baseUrl,
		apiKey,
		model,
		authStyle,
		tokenParam,
		timeoutMs,
		maxResponseBytes,
		structuredOutputs,
	}
}

function parsePositiveInt(
	raw: string | undefined,
	fallback: number,
	name: string,
): number {
	if (raw === undefined || raw.trim() === "") return fallback
	const parsed = Number(raw)
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new LlmConfigError(`${name} must be a positive integer.`)
	}
	return parsed
}

/** Auth headers per the configured style. */
export function authHeaders(config: LlmConfig): Record<string, string> {
	switch (config.authStyle) {
		case "authorization-bearer":
			return { Authorization: `Bearer ${config.apiKey}` }
		case "api-key":
			return { "api-key": config.apiKey }
		case "x-api-key":
			return { "x-api-key": config.apiKey }
	}
}

/** The chat-completions endpoint URL for a base URL. */
export function chatCompletionsUrl(config: LlmConfig): string {
	return `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`
}

export interface ChatJsonParams {
	/** Schema name sent to providers that support Structured Outputs. */
	schemaName: string
	/** The JSON Schema the response must satisfy (strict profile). */
	schema: JsonSchema
	system: string
	user: string
	maxTokens?: number
}

export interface ChatJsonOptions {
	/** Fetch implementation (injectable for tests). */
	fetchImpl?: typeof fetch
	/** Delay between retries (tests pass 0). */
	retryDelayMs?: number
}

interface ChatCompletionPayload {
	choices?: Array<{
		message?: {
			content?: string | null
			refusal?: string | null
		}
		finish_reason?: string
	}>
	error?: { message?: string }
}

/** One structured chat-completions call returning locally-validated JSON.
 *  Throws LlmRequestError (transport) or LlmResponseError (payload). */
export async function chatJson<T>(
	config: LlmConfig,
	params: ChatJsonParams,
	options: ChatJsonOptions = {},
): Promise<T> {
	const fetchImpl = options.fetchImpl ?? fetch
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), config.timeoutMs)
	const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

	const body: Record<string, unknown> = {
		model: config.model,
		temperature: 0,
		messages: [
			{ role: "system", content: params.system },
			{ role: "user", content: params.user },
		],
	}
	body[config.tokenParam] = params.maxTokens ?? 1024
	if (config.structuredOutputs) {
		body.response_format = {
			type: "json_schema",
			json_schema: {
				name: params.schemaName,
				strict: true,
				schema: params.schema,
			},
		}
	} else {
		// Unstructured fallback: the schema rides in the system prompt so the
		// model still knows the exact contract; local validation enforces it.
		body.messages = [
			{
				role: "system",
				content: `${params.system}\n\nRespond with ONLY a JSON object (no prose, no code fences) that exactly matches this JSON Schema:\n${JSON.stringify(params.schema)}`,
			},
			{ role: "user", content: params.user },
		]
	}

	try {
		let attempt = 0
		let response: Response
		let errorText: string | undefined
		while (true) {
			try {
				response = await fetchImpl(chatCompletionsUrl(config), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...authHeaders(config),
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				})
			} catch (err) {
				if (controller.signal.aborted) {
					throw new LlmRequestError(
						`LLM request timed out after ${config.timeoutMs}ms`,
					)
				}
				throw new LlmRequestError(
					`LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
			if (response.ok) break
			errorText = await readBodyCapped(response, config, errorContext)
			if (TRANSIENT_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
				attempt++
				await delay(retryDelayMs)
				continue
			}
			throw new LlmRequestError(
				`LLM chat completion failed (${response.status}): ${redact(extractErrorMessage(errorText, response.status), config)}`,
			)
		}

		const text = await readBodyCapped(response, config, contentContext)
		let payload: ChatCompletionPayload
		try {
			payload = JSON.parse(text) as ChatCompletionPayload
		} catch {
			throw new LlmResponseError(
				`LLM returned a non-JSON response body: ${redact(text.slice(0, 120), config)}`,
			)
		}
		const choice = payload.choices?.[0]
		if (choice?.message?.refusal) {
			throw new LlmResponseError(
				`LLM refused the request: ${redact(choice.message.refusal, config)}`,
			)
		}
		const content = choice?.message?.content
		if (typeof content !== "string" || content.length === 0) {
			throw new LlmResponseError(
				"LLM chat completion is missing message content",
			)
		}
		if (
			choice?.finish_reason !== undefined &&
			choice.finish_reason !== "stop"
		) {
			throw new LlmResponseError(
				`LLM chat completion finished with "${choice.finish_reason}" (expected "stop"; "length" means the response was truncated — raise maxTokens)`,
			)
		}

		const parsed = parseJsonContent(content, config)
		const violations = validateJsonSchema(params.schema, parsed)
		if (violations.length > 0) {
			throw new LlmResponseError(
				`LLM output failed local schema validation: ${violations.join("; ")}`,
			)
		}
		return parsed as T
	} finally {
		clearTimeout(timer)
	}
}

/** Parses model content as JSON, tolerating markdown code fences some
 *  unstructured models wrap around the payload. */
function parseJsonContent(content: string, config: LlmConfig): unknown {
	let trimmed = content.trim()
	if (trimmed.startsWith("```")) {
		const firstNewline = trimmed.indexOf("\n")
		if (firstNewline !== -1) {
			trimmed = trimmed.slice(firstNewline + 1)
		}
		if (trimmed.trimEnd().endsWith("```")) {
			trimmed = trimmed.trimEnd().slice(0, -3)
		}
		trimmed = trimmed.trim()
	}
	try {
		return JSON.parse(trimmed)
	} catch {
		throw new LlmResponseError(
			`LLM returned malformed JSON: ${redact(trimmed.slice(0, 120), config)}`,
		)
	}
}

const errorContext = "error body"
const contentContext = "response body"

/** Reads a response body with a hard byte cap. */
async function readBodyCapped(
	response: Response,
	config: LlmConfig,
	kind: string,
): Promise<string> {
	const declared = Number(response.headers.get("content-length"))
	if (
		Number.isFinite(declared) &&
		declared > 0 &&
		declared > config.maxResponseBytes
	) {
		throw new LlmResponseError(
			`LLM ${kind} exceeds the ${config.maxResponseBytes}-byte cap (declared ${declared} bytes)`,
		)
	}
	const reader = response.body?.getReader()
	if (!reader) return response.text()
	const decoder = new TextDecoder()
	let out = ""
	let bytes = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		bytes += value.byteLength
		if (bytes > config.maxResponseBytes) {
			await reader.cancel()
			throw new LlmResponseError(
				`LLM ${kind} exceeds the ${config.maxResponseBytes}-byte cap`,
			)
		}
		out += decoder.decode(value, { stream: true })
	}
	out += decoder.decode()
	return out
}

function extractErrorMessage(text: string, status: number): string {
	try {
		const parsed = JSON.parse(text) as { error?: { message?: string } }
		if (parsed.error?.message) return parsed.error.message
	} catch {
		// fall through to raw text
	}
	const raw = text.trim().slice(0, 200)
	return raw || `HTTP ${status} with an empty body`
}

/** Strips the API key from any message before it surfaces. */
function redact(text: string, config: LlmConfig): string {
	if (!config.apiKey) return text
	return text.split(config.apiKey).join("[redacted]")
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
