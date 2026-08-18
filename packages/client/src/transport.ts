export type MdbrainClientOptions = {
	/** Mdbrain API base URL (e.g. http://127.0.0.1:3847). */
	baseUrl?: string
	/** Optional Bearer token; also reads `MDBRAIN_API_KEY` when unset. */
	apiKey?: string
	/** Max retries for 429/503 (default 2). */
	maxRetries?: number
	/** Total request budget in milliseconds (default 10,000). */
	defaultDeadlineMs?: number
}

export type MdbrainRequestOptions = {
	/** Overrides the client deadline for this call. */
	timeoutMs?: number
	/** Cancels this call without affecting other client requests. */
	signal?: AbortSignal
}

/** Thrown when the Mdbrain HTTP API returns a non-OK status. */
export class MdbrainClientError extends Error {
	readonly status: number
	readonly body: string
	readonly code?: "DEADLINE_EXCEEDED" | "REQUEST_ABORTED"

	constructor(
		status: number,
		body: string,
		message?: string,
		code?: "DEADLINE_EXCEEDED" | "REQUEST_ABORTED",
	) {
		super(message ?? `Mdbrain API ${status}: ${body || "(empty)"}`)
		this.name = "MdbrainClientError"
		this.status = status
		this.body = body
		this.code = code
	}
}

const DEFAULT_DEADLINE_MS = 10_000

type RequestContext = {
	signal: AbortSignal
	abortKind: () => "caller" | "deadline" | undefined
	remainingMs: () => number
	cleanup: () => void
}

export function resolveDeadlineMs(
	opts: MdbrainClientOptions,
	requestOptions: MdbrainRequestOptions = {},
): number {
	const timeoutMs =
		requestOptions.timeoutMs ?? opts.defaultDeadlineMs ?? DEFAULT_DEADLINE_MS
	if (
		!Number.isFinite(timeoutMs) ||
		timeoutMs < 0 ||
		timeoutMs > 2_147_483_647
	) {
		throw new TypeError(
			"timeoutMs must be between 0 and 2,147,483,647 milliseconds",
		)
	}
	return timeoutMs
}

function createRequestContext(
	opts: MdbrainClientOptions,
	requestOptions: MdbrainRequestOptions = {},
): RequestContext {
	const timeoutMs = resolveDeadlineMs(opts, requestOptions)
	const controller = new AbortController()
	const deadlineAt = Date.now() + timeoutMs
	let kind: "caller" | "deadline" | undefined
	const callerSignal = requestOptions.signal
	const abortFromCaller = () => {
		if (!controller.signal.aborted) {
			kind = "caller"
			controller.abort()
		}
	}
	if (callerSignal?.aborted) {
		abortFromCaller()
	} else {
		callerSignal?.addEventListener("abort", abortFromCaller, { once: true })
	}

	let timer: ReturnType<typeof setTimeout> | undefined
	if (timeoutMs === 0) {
		if (!controller.signal.aborted) {
			kind = "deadline"
			controller.abort()
		}
	} else {
		timer = setTimeout(() => {
			if (!controller.signal.aborted) {
				kind = "deadline"
				controller.abort()
			}
		}, timeoutMs)
	}

	return {
		signal: controller.signal,
		abortKind: () => kind,
		remainingMs: () => Math.max(0, deadlineAt - Date.now()),
		cleanup: () => {
			if (timer) {
				clearTimeout(timer)
			}
			callerSignal?.removeEventListener("abort", abortFromCaller)
		},
	}
}

function requestAbortError(kind: "caller" | "deadline"): MdbrainClientError {
	if (kind === "deadline") {
		return new MdbrainClientError(
			408,
			"Request deadline exceeded",
			"Mdbrain request deadline exceeded",
			"DEADLINE_EXCEEDED",
		)
	}
	return new MdbrainClientError(
		499,
		"Request canceled",
		"Mdbrain request canceled",
		"REQUEST_ABORTED",
	)
}

function resolveBaseUrl(opts: MdbrainClientOptions): string {
	const raw =
		opts.baseUrl ?? process.env.MDBRAIN_API_URL ?? "http://127.0.0.1:3847"
	return raw.replace(/\/$/, "")
}

function resolveApiKey(opts: MdbrainClientOptions): string | undefined {
	return opts.apiKey ?? process.env.MDBRAIN_API_KEY ?? undefined
}

type RetryPolicy = "safe" | "same-key" | "never"

function retryDelayMs(response: Response, attempt: number): number {
	const retryAfter = response.headers.get("retry-after")
	if (retryAfter) {
		const seconds = Number(retryAfter)
		if (Number.isFinite(seconds) && seconds >= 0) {
			return seconds * 1_000
		}
		const at = Date.parse(retryAfter)
		if (Number.isFinite(at)) {
			return Math.max(0, at - Date.now())
		}
	}
	return 200 * 2 ** attempt
}

function sleep(ms: number, context: RequestContext): Promise<void> {
	if (context.signal.aborted) {
		return Promise.reject(requestAbortError(context.abortKind() ?? "caller"))
	}
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer)
			reject(requestAbortError(context.abortKind() ?? "caller"))
		}
		const timer = setTimeout(() => {
			context.signal.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		context.signal.addEventListener("abort", onAbort, { once: true })
	})
}

function buildHeaders(
	opts: MdbrainClientOptions,
	method: string,
): Record<string, string> {
	const key = resolveApiKey(opts)
	const headers: Record<string, string> = {}
	if (key) {
		headers.Authorization = `Bearer ${key}`
	}
	if (method !== "GET" && method !== "HEAD") {
		headers["Content-Type"] = "application/json"
	}
	return headers
}

async function apiFetch<T>(
	opts: MdbrainClientOptions,
	path: string,
	init: RequestInit,
	retryPolicy: RetryPolicy,
	requestOptions?: MdbrainRequestOptions,
): Promise<T> {
	const url = `${resolveBaseUrl(opts)}${path}`
	const method = (init.method ?? "GET").toUpperCase()
	const maxRetries = opts.maxRetries ?? 2
	let attempt = 0
	const context = createRequestContext(opts, requestOptions)
	const waitForTransportRetry = async (): Promise<boolean> => {
		if (retryPolicy === "never" || attempt >= maxRetries) {
			return false
		}
		const delayMs = 200 * 2 ** attempt
		if (delayMs >= context.remainingMs()) {
			return false
		}
		attempt += 1
		await sleep(delayMs, context)
		return true
	}
	try {
		for (;;) {
			if (context.signal.aborted) {
				throw requestAbortError(context.abortKind() ?? "caller")
			}
			let res: Response
			try {
				res = await fetch(url, {
					...init,
					headers: { ...buildHeaders(opts, method), ...init.headers },
					signal: context.signal,
				})
			} catch (error) {
				const abortKind = context.abortKind()
				if (abortKind) {
					throw requestAbortError(abortKind)
				}
				if (await waitForTransportRetry()) {
					continue
				}
				throw error
			}
			if (res.ok) {
				try {
					return (await res.json()) as T
				} catch (error) {
					if (error instanceof TypeError && (await waitForTransportRetry())) {
						continue
					}
					throw error
				}
			}
			let text: string
			try {
				text = await res.text()
			} catch (error) {
				if (error instanceof TypeError && (await waitForTransportRetry())) {
					continue
				}
				throw error
			}
			if (
				retryPolicy !== "never" &&
				(res.status === 429 || res.status === 503) &&
				attempt < maxRetries
			) {
				const delayMs = retryDelayMs(res, attempt)
				if (delayMs >= context.remainingMs()) {
					throw new MdbrainClientError(res.status, text)
				}
				attempt += 1
				await sleep(delayMs, context)
				continue
			}
			throw new MdbrainClientError(res.status, text)
		}
	} catch (error) {
		const abortKind = context.abortKind()
		if (abortKind && !(error instanceof MdbrainClientError && error.code)) {
			throw requestAbortError(abortKind)
		}
		throw error
	} finally {
		context.cleanup()
	}
}

export async function apiPost<T>(
	opts: MdbrainClientOptions,
	path: string,
	body: Record<string, unknown>,
	headers?: Record<string, string>,
	retryPolicy: RetryPolicy = "never",
	requestOptions?: MdbrainRequestOptions,
): Promise<T> {
	return apiFetch<T>(
		opts,
		path,
		{
			method: "POST",
			body: JSON.stringify(body),
			headers,
		},
		retryPolicy,
		requestOptions,
	)
}

export async function apiGet<T>(
	opts: MdbrainClientOptions,
	path: string,
	requestOptions?: MdbrainRequestOptions,
): Promise<T> {
	return apiFetch<T>(opts, path, { method: "GET" }, "safe", requestOptions)
}

export async function apiPatch<T>(
	opts: MdbrainClientOptions,
	path: string,
	body: Record<string, unknown>,
	requestOptions?: MdbrainRequestOptions,
): Promise<T> {
	return apiFetch<T>(
		opts,
		path,
		{
			method: "PATCH",
			body: JSON.stringify(body),
		},
		"never",
		requestOptions,
	)
}

export async function apiDelete<T>(
	opts: MdbrainClientOptions,
	path: string,
	requestOptions?: MdbrainRequestOptions,
): Promise<T> {
	return apiFetch<T>(opts, path, { method: "DELETE" }, "never", requestOptions)
}
