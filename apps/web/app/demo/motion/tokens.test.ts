import { describe, expect, it } from "vitest"
import { DURATION, EASE, rowStagger, STAGGER } from "./tokens.js"

/** From the first row starting to the last row landing. */
const streamSeconds = (count: number) =>
	DURATION.arrive + Math.max(0, count - 1) * rowStagger(count)

describe("motion tokens", () => {
	it("keeps every move between 300 and 600 ms", () => {
		for (const [name, seconds] of Object.entries(DURATION)) {
			expect(seconds, name).toBeGreaterThanOrEqual(0.3)
			expect(seconds, name).toBeLessThanOrEqual(0.6)
		}
	})

	it("names a GSAP ease for each kind of move, the stamp's with a little overshoot", () => {
		expect(EASE.out).toBe("power3.out")
		expect(EASE.inOut).toBe("power3.inOut")
		expect(EASE.stamp).toMatch(/^back\.out\(/)
	})

	it("keeps a run of staggered rows inside the one-second budget of a stream", () => {
		expect(streamSeconds(10)).toBeLessThanOrEqual(1)
		expect(streamSeconds(40)).toBeLessThanOrEqual(1)
	})

	it("starts rows in record order, later rows later", () => {
		expect(STAGGER.rows).toBeGreaterThan(0)
		expect(streamSeconds(1)).toBe(DURATION.arrive)
		expect(streamSeconds(5)).toBeGreaterThan(streamSeconds(2))
	})
})
