import { MdbrainClientError } from "@mdbrain/client"
import type { Pacer } from "./seed.js"

export type RetryOptions = {
	pacer?: Pacer
	sleep?: (ms: number) => Promise<void>
	/** Default 5 retries for 429/503/retryable envelopes. */
	maxRetries?: number
	/** Default 1000ms backoff when the envelope carries no retryAfterMs. */
	retryDelayMs?: number
}

/** Runs one API call under the shared pacer with bounded retries: 429,
 * 503, or an envelope marked retryable back off (honoring retryAfterMs)
 * and try again; everything else fails closed immediately. */
export async function withRetries<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const pacer = options.pacer ?? { async take() {} }
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
	const maxRetries = options.maxRetries ?? 5
	const retryDelayMs = options.retryDelayMs ?? 1000
	let tries = 0
	for (;;) {
		await pacer.take()
		try {
			return await fn()
		} catch (error) {
			if (!isRetryable(error) || tries >= maxRetries) throw error
			await sleep(retryDelayFor(error, retryDelayMs))
			tries++
		}
	}
}

export function isRetryable(error: unknown): boolean {
	return (
		error instanceof MdbrainClientError &&
		(error.status === 429 ||
			error.status === 503 ||
			error.envelope?.retryable === true)
	)
}

function retryDelayFor(error: unknown, fallbackMs: number): number {
	const ms =
		error instanceof MdbrainClientError
			? error.envelope?.retryAfterMs
			: undefined
	return typeof ms === "number" && ms >= 0 ? ms : fallbackMs
}

/** A repeated explicit create: the seeder reconciles this via wikiGet. */
export function isDuplicateSlug(error: unknown): boolean {
	return (
		error instanceof MdbrainClientError &&
		error.status === 409 &&
		error.envelope?.code === "DUPLICATE_SLUG"
	)
}
