import { describe, expect, it } from "vitest"
import { MdbrainClientError } from "@mdbrain/client"
import { isTerminalSeedFailure, withRetries } from "./retries.js"

function apiError(
	status: number,
	code: string,
	message: string,
	retryAfterMs?: number,
): MdbrainClientError {
	const envelope = {
		error: {
			code,
			message,
			...(retryAfterMs === undefined ? {} : { retryAfterMs }),
		},
	}
	return new MdbrainClientError(status, JSON.stringify(envelope))
}

function deliveryPending(message = "Memory delivery is delivering") {
	return apiError(503, "MEMORY_DELIVERY_PENDING", message)
}

function fakeSleep(): {
	log: number[]
	sleep: (ms: number) => Promise<void>
} {
	const log: number[] = []
	return { log, sleep: async (ms: number) => void log.push(ms) }
}

describe("withRetries on in-flight memory deliveries", () => {
	it("waits out an in-flight delivery with a growing backoff and observes the receipt", async () => {
		const { log, sleep } = fakeSleep()
		let calls = 0
		const result = await withRetries(
			async () => {
				calls++
				if (calls <= 8) throw deliveryPending()
				return { eventId: "evt-1" }
			},
			{ sleep },
		)
		expect(result).toEqual({ eventId: "evt-1" })
		expect(calls).toBe(9)
		expect(log.slice(0, 5)).toEqual([5000, 8000, 12800, 20480, 30000])
		expect(log.every((ms) => ms <= 30000)).toBe(true)
		expect(log.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(180000)
	})

	it("gives up on an in-flight delivery after about three minutes of backing off", async () => {
		const { log, sleep } = fakeSleep()
		let calls = 0
		await expect(
			withRetries(
				async () => {
					calls++
					throw deliveryPending()
				},
				{ sleep },
			),
		).rejects.toThrow("MEMORY_DELIVERY_PENDING")
		const waited = log.reduce((sum, ms) => sum + ms, 0)
		expect(waited).toBeGreaterThan(150000)
		expect(waited).toBeLessThanOrEqual(180000)
	})

	it("honors retryAfterMs on an in-flight delivery instead of the growth", async () => {
		const { log, sleep } = fakeSleep()
		let calls = 0
		await withRetries(
			async () => {
				calls++
				if (calls <= 2) {
					throw apiError(
						503,
						"MEMORY_DELIVERY_PENDING",
						"Memory delivery is delivering",
						15000,
					)
				}
				return "ok"
			},
			{ sleep },
		)
		expect(log).toEqual([15000, 15000])
	})

	it("retries DELIVERY_LEASE_LOST (409) with the same patience", async () => {
		const { log, sleep } = fakeSleep()
		let calls = 0
		const result = await withRetries(
			async () => {
				calls++
				if (calls <= 2) {
					throw apiError(
						409,
						"DELIVERY_LEASE_LOST",
						"Memory delivery is claimed by another worker",
					)
				}
				return "ok"
			},
			{ sleep },
		)
		expect(result).toBe("ok")
		expect(log).toEqual([5000, 8000])
	})

	it("fails closed when the delivery dead-lettered", async () => {
		const { log, sleep } = fakeSleep()
		await expect(
			withRetries(
				async () => {
					throw deliveryPending("Memory delivery is dead-letter")
				},
				{ sleep },
			),
		).rejects.toThrow("dead-letter")
		expect(log).toEqual([])
	})

	it("fails closed when the delivery ended in conflict state", async () => {
		const { log, sleep } = fakeSleep()
		await expect(
			withRetries(
				async () => {
					throw deliveryPending("Memory delivery is conflict")
				},
				{ sleep },
			),
		).rejects.toThrow("conflict")
		expect(log).toEqual([])
	})
})

describe("withRetries keeps the existing policies", () => {
	it("keeps the short policy for ordinary 503s", async () => {
		const { log, sleep } = fakeSleep()
		let calls = 0
		await expect(
			withRetries(
				async () => {
					calls++
					throw apiError(503, "UNAVAILABLE", "upstream unavailable")
				},
				{ sleep },
			),
		).rejects.toThrow("UNAVAILABLE")
		expect(calls).toBe(6)
		expect(log).toEqual([1000, 1000, 1000, 1000, 1000])
	})

	it("stays fail-closed on IDEMPOTENCY_CONFLICT", async () => {
		const { log, sleep } = fakeSleep()
		await expect(
			withRetries(
				async () => {
					throw apiError(
						409,
						"IDEMPOTENCY_CONFLICT",
						"delivery operation conflicts with its original payload",
					)
				},
				{ sleep },
			),
		).rejects.toThrow("IDEMPOTENCY_CONFLICT")
		expect(log).toEqual([])
	})
})

describe("isTerminalSeedFailure", () => {
	it.each([
		[
			"a dead-lettered delivery",
			deliveryPending("Memory delivery is dead-letter"),
		],
		["a conflicted delivery", deliveryPending("Memory delivery is conflict")],
		["a validation refusal", apiError(400, "VALIDATION_ERROR", "bad page")],
		["a rejected key", apiError(401, "UNAUTHORIZED", "no key")],
		["a forbidden scope", apiError(403, "FORBIDDEN", "scope not granted")],
	])("treats %s as terminal", (_name, error) => {
		expect(isTerminalSeedFailure(error)).toBe(true)
	})

	it.each([
		["an in-flight delivery", deliveryPending()],
		["a lost delivery lease", apiError(409, "DELIVERY_LEASE_LOST", "lease")],
		[
			"a slug conflict seen on resume",
			apiError(409, "DUPLICATE_SLUG", "exists"),
		],
		["a rate limit", apiError(429, "RATE_LIMITED", "slow down")],
		["a server error", apiError(500, "INTERNAL", "boom")],
		[
			"a deadline",
			new MdbrainClientError(0, "", "deadline", "DEADLINE_EXCEEDED"),
		],
		["a network failure", new TypeError("fetch failed")],
	])("leaves %s resumable", (_name, error) => {
		expect(isTerminalSeedFailure(error)).toBe(false)
	})
})
