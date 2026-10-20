import { MdbrainClientError } from "@mdbrain/client"
import type { Pacer } from "./seed.js"

export type RetryOptions = {
	pacer?: Pacer
	sleep?: (ms: number) => Promise<void>
	/** Default 5 retries for 429/503/retryable envelopes. */
	maxRetries?: number
	/** Default 1000ms backoff when the envelope carries no retryAfterMs. */
	retryDelayMs?: number
	/** Default 180000ms total patience for one in-flight memory delivery. */
	deliveryBudgetMs?: number
}

/** Error codes that mean "the same write is still running under our
 *  idempotency key; ask again later with the same key": the API's 503
 *  MEMORY_DELIVERY_PENDING (apps/api/src/routes/v1.ts, the
 *  MemoryDeliveryDispatchError catch — this key's delivery is claimed,
 *  usually by the background reconciler racing our own request between
 *  record and begin) and the 409 DELIVERY_LEASE_LOST (another worker owns
 *  the claim; the same-key retry observes the claimant's outcome). */
const IN_FLIGHT_DELIVERY_CODES = new Set([
	"MEMORY_DELIVERY_PENDING",
	"DELIVERY_LEASE_LOST",
])

/** Delivery states that are finished and can never produce a receipt
 *  (packages/wiki-engine/src/memory-delivery.ts: `confirmed`, `promoted`,
 *  `dead-letter` and `conflict` are terminal; the first two return their
 *  receipt on replay). The API replays a dead-lettered or conflicted
 *  delivery as 503 MEMORY_DELIVERY_PENDING with the terminal state in the
 *  message ("Memory delivery is dead-letter"), so the seeder must fail the
 *  seed instead of spending its retry patience on a write that can no
 *  longer succeed. */
const TERMINAL_DELIVERY_STATES = ["dead-letter", "conflict"] as const

/** A memory delivery that ended in a terminal failure state: the seed must
 *  fail on it, not retry it. */
export function isTerminalDeliveryFailure(error: unknown): boolean {
	if (
		!(error instanceof MdbrainClientError) ||
		error.envelope?.code !== "MEMORY_DELIVERY_PENDING"
	) {
		return false
	}
	const message = error.envelope.message
	return TERMINAL_DELIVERY_STATES.some((state) =>
		message.endsWith(`is ${state}`),
	)
}

/** "The same write is still running": retry later with the same
 *  idempotency key. */
export function isInFlightDelivery(error: unknown): boolean {
	return (
		error instanceof MdbrainClientError &&
		IN_FLIGHT_DELIVERY_CODES.has(error.envelope?.code ?? "") &&
		!isTerminalDeliveryFailure(error)
	)
}

/** Backoff for an in-flight delivery: one live delivery takes about 40s
 *  end to end, so the wait grows from about 5s to about 30s rather than
 *  following the 1s plain-retry cadence. */
function deliveryBackoffMs(attempt: number): number {
	return Math.min(30_000, Math.round(5_000 * 1.6 ** attempt))
}

/** Runs one API call under the shared pacer with bounded retries: 429,
 *  503, or an envelope marked retryable back off (honoring retryAfterMs)
 *  and try again. An in-flight memory delivery (MEMORY_DELIVERY_PENDING,
 *  DELIVERY_LEASE_LOST) is retried patiently — the same write is still
 *  running under our idempotency key, so we wait it out with a growing
 *  backoff inside a total budget. A delivery that ended in a terminal
 *  failure state fails the seed immediately; everything else fails
 *  closed. */
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
	const deliveryBudgetMs = options.deliveryBudgetMs ?? 180_000
	let tries = 0
	let deliveryTries = 0
	let deliveryWaitedMs = 0
	for (;;) {
		await pacer.take()
		try {
			return await fn()
		} catch (error) {
			// A terminal delivery state can never produce a receipt: fail
			// the seed now instead of waiting out the budget.
			if (isTerminalDeliveryFailure(error)) throw error
			if (isInFlightDelivery(error)) {
				const delay = retryDelayFor(error, deliveryBackoffMs(deliveryTries))
				if (deliveryWaitedMs + delay > deliveryBudgetMs) throw error
				await sleep(delay)
				deliveryWaitedMs += delay
				deliveryTries++
				continue
			}
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
