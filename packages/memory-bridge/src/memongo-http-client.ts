import { createHash, randomUUID } from "node:crypto"
import {
	getMemongoOperationPolicy,
	type MemongoOperationName,
	type MemongoOperationPolicy,
} from "./memongo-operation-policy.js"

export type MemongoFailureCode =
	| "VALIDATION"
	| "UNAUTHENTICATED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "IDEMPOTENCY_CONFLICT"
	| "RATE_LIMITED"
	| "UPSTREAM_UNAVAILABLE"
	| "DEADLINE_EXCEEDED"
	| "OUTCOME_UNKNOWN"
	| "INCOMPATIBLE_CONTRACT"
	| "MALFORMED_RESPONSE"
	| "INTERNAL"

export type MemongoWriteOutcome = "not-applied" | "applied" | "unknown"

export class MemongoHttpError extends Error {
	constructor(
		message: string,
		readonly code: MemongoFailureCode,
		readonly retryable: boolean,
		readonly outcome: MemongoWriteOutcome,
		readonly status?: number,
		readonly retryAfterMs?: number,
	) {
		super(message)
		this.name = "MemongoHttpError"
	}
}

export type MemongoHttpClientOptions = {
	baseUrl: string
	tenantApiKey: string
	controlApiKey?: string
	expectedVersion: string
	expectedContractSha256: string
	compatibilityTtlMs?: number
	timeoutMs?: number
	allowInsecureLocal?: boolean
	fetchImpl?: typeof fetch
}

export type MemongoRequest = {
	operation: MemongoOperationName
	body?: Record<string, unknown>
	query?: Readonly<Record<string, string | number | boolean | null | undefined>>
	idempotencyKey?: string
	requestId?: string
	signal?: AbortSignal
	timeoutMs?: number
	validate: (value: unknown) => boolean
}

type OpenApiDocument = {
	openapi: string
	info: { version: string }
}

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue }

function isOpenApiDocument(value: unknown): value is OpenApiDocument {
	if (!value || typeof value !== "object") return false
	const document = value as {
		openapi?: unknown
		info?: { version?: unknown }
	}
	return (
		typeof document.openapi === "string" &&
		typeof document.info?.version === "string"
	)
}

function canonicalize(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalize(value[key])]),
		)
	}
	return value
}

function normalizedBaseUrl(raw: string, allowInsecureLocal: boolean): URL {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new MemongoHttpError(
			"Memongo URL is invalid",
			"VALIDATION",
			false,
			"not-applied",
		)
	}
	if (url.username || url.password) {
		throw new MemongoHttpError(
			"Memongo URL must not contain credentials",
			"VALIDATION",
			false,
			"not-applied",
		)
	}
	if (url.protocol === "https:") return url
	const isLoopback =
		url.hostname === "localhost" ||
		url.hostname === "127.0.0.1" ||
		url.hostname === "[::1]" ||
		url.hostname === "::1"
	if (url.protocol === "http:" && allowInsecureLocal && isLoopback) return url
	throw new MemongoHttpError(
		"Memongo requires HTTPS; plain HTTP is allowed only for explicit loopback development",
		"VALIDATION",
		false,
		"not-applied",
	)
}

function isWrite(policy?: MemongoOperationPolicy): boolean {
	return policy?.kind === "write"
}

function isRetryable(policy?: MemongoOperationPolicy): boolean {
	return policy?.retry !== "never"
}

function retryAfterMs(headers: Headers): number | undefined {
	const value = headers.get("retry-after")
	if (!value) return undefined
	const seconds = Number(value)
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp)
		? Math.max(0, timestamp - Date.now())
		: undefined
}

function statusError(
	status: number,
	headers: Headers,
	policy?: MemongoOperationPolicy,
): MemongoHttpError {
	const write = isWrite(policy)
	if (status === 400) {
		return new MemongoHttpError(
			"Memongo rejected the request",
			"VALIDATION",
			false,
			"not-applied",
			status,
		)
	}
	if (status === 401) {
		return new MemongoHttpError(
			"Memongo authentication failed",
			"UNAUTHENTICATED",
			false,
			"not-applied",
			status,
		)
	}
	if (status === 403) {
		return new MemongoHttpError(
			"Memongo authorization failed",
			"FORBIDDEN",
			false,
			"not-applied",
			status,
		)
	}
	if (status === 404) {
		return new MemongoHttpError(
			"Memongo resource was not found",
			"NOT_FOUND",
			false,
			"not-applied",
			status,
		)
	}
	if (status === 409 || status === 422) {
		if (!policy || policy.idempotency === "none") {
			return new MemongoHttpError(
				"Memongo rejected the request",
				"VALIDATION",
				false,
				"not-applied",
				status,
			)
		}
		return new MemongoHttpError(
			"Memongo rejected an idempotency key or payload conflict",
			"IDEMPOTENCY_CONFLICT",
			false,
			"not-applied",
			status,
		)
	}
	if (status === 429) {
		return new MemongoHttpError(
			"Memongo rate limit exceeded",
			"RATE_LIMITED",
			isRetryable(policy),
			"not-applied",
			status,
			retryAfterMs(headers),
		)
	}
	if (status >= 500) {
		return new MemongoHttpError(
			"Memongo is unavailable",
			"UPSTREAM_UNAVAILABLE",
			isRetryable(policy),
			write ? "unknown" : "not-applied",
			status,
		)
	}
	return new MemongoHttpError(
		"Memongo request failed",
		"INTERNAL",
		false,
		"not-applied",
		status,
	)
}

export class MemongoHttpClient {
	readonly #baseUrl: URL
	readonly #tenantApiKey: string
	readonly #controlApiKey?: string
	readonly #expectedVersion: string
	readonly #expectedContractSha256: string
	readonly #compatibilityTtlMs: number
	readonly #timeoutMs: number
	readonly #fetch: typeof fetch
	#compatibility?: Promise<void>
	#compatibilityVerifiedAt?: number

	constructor(options: MemongoHttpClientOptions) {
		this.#baseUrl = normalizedBaseUrl(
			options.baseUrl,
			options.allowInsecureLocal ?? false,
		)
		this.#tenantApiKey = options.tenantApiKey.trim()
		this.#controlApiKey = options.controlApiKey?.trim() || undefined
		this.#expectedVersion = options.expectedVersion.trim()
		this.#expectedContractSha256 = options.expectedContractSha256
			.trim()
			.toLowerCase()
		this.#compatibilityTtlMs = options.compatibilityTtlMs ?? 60_000
		this.#timeoutMs = options.timeoutMs ?? 10_000
		this.#fetch = options.fetchImpl ?? fetch
		if (!this.#tenantApiKey) {
			throw new MemongoHttpError(
				"Memongo tenant API key is required",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
		if (!/^[a-f0-9]{64}$/.test(this.#expectedContractSha256)) {
			throw new MemongoHttpError(
				"Memongo contract SHA-256 is required",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
		if (
			!Number.isFinite(this.#compatibilityTtlMs) ||
			this.#compatibilityTtlMs < 0
		) {
			throw new MemongoHttpError(
				"Memongo compatibility TTL must be a non-negative number",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
	}

	checkCompatibility(
		options: Pick<MemongoRequest, "signal" | "timeoutMs"> = {},
	): Promise<void> {
		if (
			this.#compatibilityVerifiedAt !== undefined &&
			Date.now() - this.#compatibilityVerifiedAt < this.#compatibilityTtlMs
		) {
			return Promise.resolve()
		}
		if (options.signal || options.timeoutMs !== undefined) {
			return this.#loadCompatibility(options).then(() => {
				this.#compatibilityVerifiedAt = Date.now()
			})
		}
		if (!this.#compatibility) {
			this.#compatibility = this.#loadCompatibility()
				.then(() => {
					this.#compatibilityVerifiedAt = Date.now()
				})
				.catch((error: unknown) => {
					this.#compatibilityVerifiedAt = undefined
					this.#compatibility = undefined
					throw error
				})
				.finally(() => {
					this.#compatibility = undefined
				})
		}
		return this.#compatibility
	}

	async #loadCompatibility(
		options: Pick<MemongoRequest, "signal" | "timeoutMs"> = {},
	): Promise<void> {
		const timeoutSignal = AbortSignal.timeout(
			options.timeoutMs ?? this.#timeoutMs,
		)
		const signal = options.signal
			? AbortSignal.any([options.signal, timeoutSignal])
			: timeoutSignal
		let response: Response
		try {
			response = await this.#fetch(new URL("/openapi.json", this.#baseUrl), {
				method: "GET",
				redirect: "error",
				headers: { accept: "application/json" },
				signal,
			})
		} catch {
			throw new MemongoHttpError(
				"Unable to verify the Memongo contract",
				"UPSTREAM_UNAVAILABLE",
				true,
				"not-applied",
			)
		}
		if (!response.ok) throw statusError(response.status, response.headers)
		const raw = await response.text()
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			throw new MemongoHttpError(
				"Memongo returned an invalid OpenAPI document",
				"INCOMPATIBLE_CONTRACT",
				false,
				"not-applied",
			)
		}
		const digest = createHash("sha256")
			.update(JSON.stringify(canonicalize(parsed as JsonValue)))
			.digest("hex")
		if (
			!isOpenApiDocument(parsed) ||
			parsed.info.version !== this.#expectedVersion ||
			digest !== this.#expectedContractSha256
		) {
			throw new MemongoHttpError(
				"Memongo version or contract digest is incompatible",
				"INCOMPATIBLE_CONTRACT",
				false,
				"not-applied",
			)
		}
	}

	async request<T>(request: MemongoRequest): Promise<T> {
		const policy = getMemongoOperationPolicy(request.operation)
		if (request.signal?.aborted) {
			throw new MemongoHttpError(
				"Memongo request was cancelled before dispatch",
				"DEADLINE_EXCEEDED",
				false,
				"not-applied",
			)
		}
		if (policy.idempotency === "header" && !request.idempotencyKey) {
			throw new MemongoHttpError(
				"Memongo operation requires an idempotency key",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
		if (policy.idempotency !== "header" && request.idempotencyKey) {
			throw new MemongoHttpError(
				"Memongo operation does not accept an idempotency header",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
		if (policy.method === "GET" && request.body !== undefined) {
			throw new MemongoHttpError(
				"Memongo GET operations do not accept a request body",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
		if (policy.method !== "GET" && request.query !== undefined) {
			throw new MemongoHttpError(
				"Memongo POST operations do not accept query parameters",
				"VALIDATION",
				false,
				"not-applied",
			)
		}
		await this.checkCompatibility({
			signal: request.signal,
			timeoutMs: request.timeoutMs,
		})
		const key =
			policy.credential === "tenant" ? this.#tenantApiKey : this.#controlApiKey
		if (!key) {
			throw new MemongoHttpError(
				"Memongo control-plane credentials are not configured",
				"FORBIDDEN",
				false,
				"not-applied",
			)
		}
		const controller = new AbortController()
		const timeout = setTimeout(
			() =>
				controller.abort(new DOMException("deadline exceeded", "TimeoutError")),
			request.timeoutMs ?? this.#timeoutMs,
		)
		const onAbort = () => controller.abort(request.signal?.reason)
		request.signal?.addEventListener("abort", onAbort, { once: true })
		const headers = new Headers({
			accept: "application/json",
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
			"x-request-id": request.requestId ?? randomUUID(),
		})
		if (request.idempotencyKey) {
			headers.set("idempotency-key", request.idempotencyKey)
		}
		const url = new URL(policy.path, this.#baseUrl)
		for (const [name, value] of Object.entries(request.query ?? {})) {
			if (value !== undefined && value !== null) {
				url.searchParams.set(name, String(value))
			}
		}
		try {
			const response = await this.#fetch(url, {
				method: policy.method,
				headers,
				body:
					request.body === undefined ? undefined : JSON.stringify(request.body),
				redirect: "error",
				signal: controller.signal,
			})
			if (!response.ok) {
				throw statusError(response.status, response.headers, policy)
			}
			let value: unknown
			try {
				value = await response.json()
			} catch {
				throw new MemongoHttpError(
					"Memongo returned malformed JSON",
					"MALFORMED_RESPONSE",
					false,
					isWrite(policy) ? "unknown" : "not-applied",
					response.status,
				)
			}
			if (!request.validate(value)) {
				throw new MemongoHttpError(
					"Memongo response did not match the accepted contract",
					"MALFORMED_RESPONSE",
					false,
					isWrite(policy) ? "unknown" : "not-applied",
					response.status,
				)
			}
			return value as T
		} catch (error) {
			if (error instanceof MemongoHttpError) throw error
			if (controller.signal.aborted || error instanceof DOMException) {
				const write = isWrite(policy)
				throw new MemongoHttpError(
					write
						? "Memongo write outcome is unknown after cancellation or timeout"
						: "Memongo request deadline exceeded",
					write ? "OUTCOME_UNKNOWN" : "DEADLINE_EXCEEDED",
					isRetryable(policy),
					write ? "unknown" : "not-applied",
				)
			}
			throw new MemongoHttpError(
				"Memongo is unavailable",
				"UPSTREAM_UNAVAILABLE",
				isRetryable(policy),
				isWrite(policy) ? "unknown" : "not-applied",
			)
		} finally {
			clearTimeout(timeout)
			request.signal?.removeEventListener("abort", onAbort)
		}
	}
}
