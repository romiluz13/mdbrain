import { describe, expect, it } from "vitest"
import { clientAddress, createSignInLimiter } from "./signin-limit.js"

const headers = (init: Record<string, string>) => new Headers(init)

describe("clientAddress", () => {
	it("prefers the edge's own header, then the first forwarded hop", () => {
		expect(
			clientAddress(
				headers({
					"cf-connecting-ip": "198.51.100.7",
					"x-forwarded-for": "203.0.113.1",
				}),
			),
		).toBe("198.51.100.7")
		expect(
			clientAddress(headers({ "x-forwarded-for": " 203.0.113.1 , 10.0.0.1" })),
		).toBe("203.0.113.1")
	})

	it("is undefined when neither header says", () => {
		expect(clientAddress(headers({}))).toBeUndefined()
		expect(clientAddress(headers({ "x-forwarded-for": " , " }))).toBeUndefined()
	})
})

describe("createSignInLimiter", () => {
	it("allows an address ten attempts within the window, counting each when it begins", () => {
		let clock = new Date("2026-10-23T12:00:00Z")
		const limiter = createSignInLimiter({ now: () => clock })
		for (let attempt = 0; attempt < 10; attempt++) {
			expect(limiter.begin("a")).toBe("ok")
		}
		expect(limiter.begin("a")).toBe("limited")
		expect(limiter.begin("b")).toBe("ok")
		clock = new Date(clock.getTime() + 60_001)
		expect(limiter.begin("a")).toBe("ok")
	})

	it("gives an attempt back when it succeeds", () => {
		const limiter = createSignInLimiter({ now: () => new Date() })
		for (let attempt = 0; attempt < 30; attempt++) {
			expect(limiter.begin("a")).toBe("ok")
			limiter.succeed("a")
		}
		expect(limiter.size()).toBe(0)
	})

	it("refuses a missing address", () => {
		expect(
			createSignInLimiter({ now: () => new Date() }).begin(undefined),
		).toBe("no-address")
	})

	it("forgets addresses whose window has passed", () => {
		let clock = new Date("2026-10-23T12:00:00Z")
		const limiter = createSignInLimiter({ now: () => clock, maxTracked: 4 })
		limiter.begin("a")
		clock = new Date(clock.getTime() + 61_000)
		for (const address of ["b", "c", "d", "e"]) limiter.begin(address)
		expect(limiter.size()).toBe(4)
	})

	it("holds a bounded number of addresses when a client rotates its header", () => {
		const limiter = createSignInLimiter({
			now: () => new Date("2026-10-23T12:00:00Z"),
			maxTracked: 100,
		})
		for (let address = 0; address < 500; address++) {
			expect(
				limiter.begin(`10.0.${Math.floor(address / 256)}.${address % 256}`),
			).toBe("ok")
		}
		expect(limiter.size()).toBeLessThanOrEqual(100)
		for (let attempt = 0; attempt < 10; attempt++) limiter.begin("198.51.100.7")
		expect(limiter.begin("198.51.100.7")).toBe("limited")
	})

	it("tells a limited address when to come back", () => {
		let clock = new Date("2026-10-23T12:00:00Z")
		const limiter = createSignInLimiter({ now: () => clock })
		for (let attempt = 0; attempt < 10; attempt++) limiter.begin("a")
		clock = new Date(clock.getTime() + 20_000)
		expect(limiter.retryAfterSeconds("a")).toBe(40)
		expect(limiter.retryAfterSeconds("b")).toBe(0)
	})
})
