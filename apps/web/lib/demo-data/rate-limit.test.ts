// Ticket 351: the per-client limit the demo's reads and answers pass through
// before any upstream call, control read or model call. The Workers binding
// counts per client address; off Workers there is no binding and no limit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { limitByClient, limiterBinding } from "./rate-limit.js"

const cf = vi.hoisted(() => ({
	env: {} as Record<string, unknown>,
	getCloudflareContext: vi.fn(),
}))

vi.mock("@opennextjs/cloudflare", () => ({
	getCloudflareContext: cf.getCloudflareContext,
}))

const MESSAGE = "Too many reads in a short time. Try again shortly."

function fakeLimiter(success: boolean) {
	return {
		limit: vi.fn(async (_options: { key: string }) => ({ success })),
	}
}

const visit = (headers: Record<string, string> = {}) =>
	new Request("http://demo.local/api/demo/v1/wiki", { headers })

beforeEach(() => {
	cf.env = {}
	cf.getCloudflareContext.mockImplementation(() => ({ env: cf.env }))
})

afterEach(() => {
	vi.unstubAllGlobals()
	cf.getCloudflareContext.mockClear()
})

describe("limitByClient", () => {
	it("passes a request through when there is no binding", async () => {
		expect(await limitByClient(visit(), undefined, MESSAGE)).toBeNull()
	})

	it("refuses a limited client with the proxy envelope, a retry hint and no store", async () => {
		const limiter = fakeLimiter(false)
		const response = await limitByClient(visit(), limiter, MESSAGE)
		expect(response?.status).toBe(429)
		expect(response?.headers.get("content-type")).toBe("application/json")
		expect(response?.headers.get("retry-after")).toBe("60")
		expect(response?.headers.get("cache-control")).toBe("no-store")
		expect(await response?.json()).toEqual({
			error: { code: "RATE_LIMITED", message: MESSAGE },
		})
	})

	it("lets an allowed client through", async () => {
		const limiter = fakeLimiter(true)
		expect(await limitByClient(visit(), limiter, MESSAGE)).toBeNull()
		expect(limiter.limit).toHaveBeenCalledTimes(1)
	})

	it("keys the limit by the edge's client address", async () => {
		const limiter = fakeLimiter(true)
		await limitByClient(
			visit({ "cf-connecting-ip": "203.0.113.9" }),
			limiter,
			MESSAGE,
		)
		expect(limiter.limit).toHaveBeenCalledWith({ key: "203.0.113.9" })
	})

	it("keys a request with no client address as unknown", async () => {
		const limiter = fakeLimiter(true)
		await limitByClient(visit(), limiter, MESSAGE)
		expect(limiter.limit).toHaveBeenCalledWith({ key: "unknown" })
	})
})

describe("limiterBinding", () => {
	it("returns no binding and reads no context off Workers", () => {
		cf.env = { DEMO_READ_LIMITER: fakeLimiter(false) }
		expect(limiterBinding("DEMO_READ_LIMITER")).toBeUndefined()
		expect(cf.getCloudflareContext).not.toHaveBeenCalled()
	})

	it("returns the named binding on Workers", () => {
		vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" })
		const limiter = fakeLimiter(true)
		cf.env = { DEMO_READ_LIMITER: limiter }
		expect(limiterBinding("DEMO_READ_LIMITER")).toBe(limiter)
		expect(limiterBinding("DEMO_ANSWER_LIMITER")).toBeUndefined()
	})
})
