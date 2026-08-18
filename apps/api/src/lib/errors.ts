import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { redactSecrets } from "@mdbrain/lib"

export type ApiErrorBody = {
	error: {
		code: string
		message: string
		retryable?: boolean
		outcome?: string
		retryAfterMs?: number
	}
}

export function apiErrorJson(
	code: string,
	message: string,
	details: {
		retryable?: boolean
		outcome?: string
		retryAfterMs?: number
	} = {},
): ApiErrorBody {
	return { error: { code, message, ...details } }
}

export function jsonError(
	c: Context,
	status: ContentfulStatusCode,
	code: string,
	message: string,
	details?: {
		retryable?: boolean
		outcome?: string
		retryAfterMs?: number
	},
) {
	// Redact secrets (MongoDB URIs, API keys, bearer tokens) from error
	// messages before returning to clients. Internal errors often contain
	// connection strings or driver diagnostics that must not leak.
	return c.json(apiErrorJson(code, redactSecrets(message), details), status)
}
