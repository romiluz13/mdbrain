import { MdbrainClientError } from "@mdbrain/client"

export type ErrorKind =
	| "unauthorized"
	| "forbidden"
	| "conflict"
	| "duplicate"
	| "not-found"
	| "validation"
	| "unavailable"
	| "throttled"
	| "network"
	| "timeout"
	| "other"

export type DescribedError = {
	kind: ErrorKind
	headline: string
	detail?: string
	/** API error code when the server sent an envelope. */
	code?: string
	status?: number
	retryAfterMs?: number
}

/** Thrown for work that finished after its connection was replaced. Callers
 *  drop it silently; it never reaches the screen. */
export class StaleConnectionError extends Error {
	constructor() {
		super("The connection changed before this response arrived.")
		this.name = "StaleConnectionError"
	}
}

export function isStale(error: unknown): boolean {
	return (
		error instanceof StaleConnectionError ||
		(error instanceof MdbrainClientError && error.code === "REQUEST_ABORTED")
	)
}

export function describeError(error: unknown): DescribedError {
	if (!(error instanceof MdbrainClientError)) {
		return {
			kind: "network",
			headline: "Could not reach the API.",
			detail:
				error instanceof Error
					? error.message
					: "Check the base URL, that the API is running, and that it allows this origin.",
		}
	}
	if (error.code === "DEADLINE_EXCEEDED") {
		return {
			kind: "timeout",
			headline: "The API did not answer in time.",
			detail: "Nothing is known about whether the request was applied.",
		}
	}
	const code = error.envelope?.code
	const detail = error.envelope?.message
	const base = { code, status: error.status, detail }
	if (error.status === 401) {
		return {
			...base,
			kind: "unauthorized",
			headline: "The API rejected this key.",
		}
	}
	if (error.status === 403) {
		return {
			...base,
			kind: "forbidden",
			headline: "This key is not allowed to do that in this scope.",
		}
	}
	if (code === "REVISION_CONFLICT") {
		return {
			...base,
			kind: "conflict",
			headline: "Someone saved a newer revision first.",
		}
	}
	if (
		code === "DUPLICATE_SLUG" ||
		(error.status === 409 && code?.includes("DUPLICATE"))
	) {
		return {
			...base,
			kind: "duplicate",
			headline: "A page with this slug already exists in this scope.",
		}
	}
	if (error.status === 404) {
		return { ...base, kind: "not-found", headline: "Not found in this scope." }
	}
	if (error.status === 429 || code === "RATE_LIMITED") {
		return {
			...base,
			kind: "throttled",
			headline: "The API is rate limiting this key.",
			retryAfterMs: error.envelope?.retryAfterMs,
		}
	}
	if (error.status === 400) {
		return {
			...base,
			kind: "validation",
			headline: "The API rejected the request.",
		}
	}
	if (error.status === 503 || code === "SEARCH_UNAVAILABLE") {
		return {
			...base,
			kind: "unavailable",
			headline: "This service is unavailable right now.",
			retryAfterMs: error.envelope?.retryAfterMs,
		}
	}
	return {
		...base,
		kind: "other",
		headline: `The API returned HTTP ${error.status}.`,
	}
}
