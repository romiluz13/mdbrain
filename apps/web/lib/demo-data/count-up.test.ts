import { describe, expect, it } from "vitest"
import { countAt } from "./count-up.js"

describe("countAt", () => {
	it("starts at zero and ends on the value it was given", () => {
		expect(countAt(110, 0)).toBe(0)
		expect(countAt(110, 1)).toBe(110)
		expect(countAt(288, 1)).toBe(288)
	})

	it("ends on the value for any progress at or past the end", () => {
		for (const progress of [1, 1.0000001, 2, Number.POSITIVE_INFINITY]) {
			expect(countAt(4521, progress)).toBe(4521)
		}
	})

	it("only rises between the start and the end, and never passes the value", () => {
		let last = -1
		for (let step = 0; step <= 100; step++) {
			const now = countAt(2379, step / 100)
			expect(now).toBeGreaterThanOrEqual(last)
			expect(now).toBeLessThanOrEqual(2379)
			expect(Number.isInteger(now)).toBe(true)
			last = now
		}
	})

	it("reads progress before the start or not a number as the start", () => {
		expect(countAt(50, -1)).toBe(0)
		expect(countAt(50, Number.NaN)).toBe(0)
	})

	it("shows zero for zero and one for one at every progress", () => {
		for (const progress of [0, 0.3, 0.99, 1]) {
			expect(countAt(0, progress)).toBe(0)
		}
		expect(countAt(1, 0.2)).toBeLessThanOrEqual(1)
		expect(countAt(1, 1)).toBe(1)
	})

	it("returns a value that is not a count as it is, so the API value is never rewritten", () => {
		expect(countAt(Number.NaN, 0.5)).toBeNaN()
		expect(countAt(-3, 0.5)).toBe(-3)
		expect(countAt(2.5, 0.5)).toBe(2.5)
	})
})
