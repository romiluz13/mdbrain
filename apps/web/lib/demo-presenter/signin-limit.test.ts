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
	it("allows an address until it has failed the limit within the window", () => {
		let clock = new Date("2026-10-23T12:00:00Z")
		const limiter = createSignInLimiter({ now: () => clock })
		for (let failure = 0; failure < 10; failure++) {
			expect(limiter.check("a")).toBe("ok")
			limiter.fail("a")
		}
		expect(limiter.check("a")).toBe("limited")
		expect(limiter.check("b")).toBe("ok")
		clock = new Date(clock.getTime() + 60_001)
		expect(limiter.check("a")).toBe("ok")
	})

	it("refuses a missing address", () => {
		expect(
			createSignInLimiter({ now: () => new Date() }).check(undefined),
		).toBe("no-address")
	})

	it("forgets addresses whose window has passed", () => {
		let clock = new Date("2026-10-23T12:00:00Z")
		const limiter = createSignInLimiter({ now: () => clock })
		limiter.fail("a")
		clock = new Date(clock.getTime() + 61_000)
		limiter.check("b")
		expect(limiter.size()).toBe(0)
	})
})
