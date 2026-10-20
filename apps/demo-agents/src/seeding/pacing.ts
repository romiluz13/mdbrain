/** Request pacing shared by the seeder and the live check.
 *
 * The demo API rate-limits every client IP to 100 request starts per minute
 * by default. The pacer keeps every attempt (including retries) inside that
 * budget by spacing consecutive starts by a fixed interval. */
import type { Pacer } from "./seed.js"

export type PacerOptions = {
	/** Minimum spacing between consecutive starts, in milliseconds. */
	intervalMs?: number
	/** Convenience for intervalMs: starts allowed per minute. */
	startsPerMinute?: number
	/** Injectable clock, milliseconds since epoch. Defaults to Date.now. */
	now?: () => number
	/** Injectable sleep. Defaults to a real setTimeout-based sleep. */
	sleep?: (ms: number) => Promise<void>
}

export function createPacer(options: PacerOptions = {}): Pacer {
	const intervalMs = resolveIntervalMs(options)
	const now = options.now ?? Date.now
	const sleep =
		options.sleep ??
		((ms: number) =>
			new Promise<void>((resolve) => {
				setTimeout(resolve, ms)
			}))
	let nextAllowedAt = Number.NEGATIVE_INFINITY
	return {
		async take(): Promise<void> {
			// Reserve a start synchronously before any await, so concurrent
			// takers receive distinct slots instead of bursting together.
			const reservedAt = Math.max(now(), nextAllowedAt)
			nextAllowedAt = reservedAt + intervalMs
			if (reservedAt > now()) {
				await sleep(reservedAt - now())
			}
		},
	}
}

function resolveIntervalMs(options: PacerOptions): number {
	if (options.intervalMs !== undefined) {
		if (options.intervalMs < 0 || !Number.isFinite(options.intervalMs)) {
			throw new RangeError(
				`intervalMs must be non-negative, got ${options.intervalMs}`,
			)
		}
		return options.intervalMs
	}
	if (options.startsPerMinute !== undefined) {
		if (
			options.startsPerMinute <= 0 ||
			!Number.isFinite(options.startsPerMinute)
		) {
			throw new RangeError(
				`startsPerMinute must be a positive number, got ${options.startsPerMinute}`,
			)
		}
		return 60000 / options.startsPerMinute
	}
	return 0
}
