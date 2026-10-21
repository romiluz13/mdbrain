import { describe, expect, it } from "vitest"
import { DURATION, EASE, STAGGER, entrySeconds } from "./tokens.js"

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
		expect(entrySeconds(10)).toBeLessThanOrEqual(1)
		expect(entrySeconds(40)).toBeLessThanOrEqual(1)
	})

	it("starts rows in record order, later rows later", () => {
		expect(STAGGER.rows).toBeGreaterThan(0)
		expect(entrySeconds(1)).toBe(DURATION.arrive)
		expect(entrySeconds(5)).toBeGreaterThan(entrySeconds(2))
	})
})
