import { describe, expect, it } from "vitest"
import { createPacer } from "./pacing.js"

describe("createPacer", () => {
	it("spaces consecutive starts by the interval", async () => {
		let clock = 1000
		const sleeps: number[] = []
		const pacer = createPacer({
			intervalMs: 100,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms)
				clock += ms
			},
		})
		await pacer.take()
		await pacer.take()
		await pacer.take()
		expect(sleeps).toEqual([100, 100])
	})

	it("does not wait when the interval has already elapsed", async () => {
		let clock = 1000
		const sleeps: number[] = []
		const pacer = createPacer({
			intervalMs: 100,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms)
				clock += ms
			},
		})
		await pacer.take()
		clock += 250
		await pacer.take()
		expect(sleeps).toEqual([])
	})

	it("never sleeps with a zero interval", async () => {
		const sleeps: number[] = []
		const pacer = createPacer({
			intervalMs: 0,
			now: () => 1000,
			sleep: async (ms) => {
				sleeps.push(ms)
			},
		})
		await pacer.take()
		await pacer.take()
		await pacer.take()
		expect(sleeps).toEqual([])
	})

	it("derives the interval from startsPerMinute", async () => {
		let clock = 0
		const sleeps: number[] = []
		const pacer = createPacer({
			startsPerMinute: 90,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms)
				clock += ms
			},
		})
		await pacer.take()
		await pacer.take()
		expect(sleeps).toEqual([60000 / 90])
	})

	it("throws on a non-positive startsPerMinute", () => {
		expect(() => createPacer({ startsPerMinute: 0 })).toThrow(/startsPerMinute/)
		expect(() => createPacer({ startsPerMinute: -5 })).toThrow(
			/startsPerMinute/,
		)
	})

	it("reserves one start per concurrent taker", async () => {
		const clock = 1000
		const sleeps: number[] = []
		const pacer = createPacer({
			intervalMs: 100,
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms)
			},
		})
		// Three takers arrive at the same instant; the pacer must hand out
		// distinct reserved starts instead of letting them burst together.
		await Promise.all([pacer.take(), pacer.take(), pacer.take()])
		expect(sleeps).toEqual([100, 200])
	})
})
