import { describe, expect, it, vi } from "vitest"
import { createPresenterClient, leaseLabel } from "./client.js"

function fakeFetch(...answers: Array<{ status?: number; body: unknown }>) {
	const queue = [...answers]
	return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
		const next = queue.shift() ?? { body: {} }
		return new Response(JSON.stringify(next.body), {
			status: next.status ?? 200,
			headers: { "content-type": "application/json" },
		})
	})
}

describe("presenter client", () => {
	it("reads the state with the session cookie and nothing else", async () => {
		const fetchImpl = fakeFetch({ body: { mode: "public" } })
		const client = createPresenterClient(fetchImpl)
		expect(await client.state()).toEqual({ mode: "public" })
		const [url, init] = fetchImpl.mock.calls[0]!
		expect(url).toBe("/api/demo/presenter/state")
		expect(init).toMatchObject({
			credentials: "same-origin",
			cache: "no-store",
		})
		expect((init?.method ?? "GET").toUpperCase()).toBe("GET")
	})

	it("answers unavailable when the state cannot be read, so the page can tell a blip from a visitor", async () => {
		const client = createPresenterClient(
			vi.fn(async () => {
				throw new Error("offline")
			}),
		)
		expect(await client.state()).toEqual({ mode: "unavailable" })
		const broken = createPresenterClient(fakeFetch({ status: 500, body: {} }))
		expect(await broken.state()).toEqual({ mode: "unavailable" })
		const odd = createPresenterClient(
			fakeFetch({ body: { mode: "presenter" } }),
		)
		expect(await odd.state()).toEqual({ mode: "unavailable" })
	})

	it("posts JSON with the csrf token and returns the body", async () => {
		const fetchImpl = fakeFetch({
			body: { lease: { slotIndex: 13, name: "Slot 13", expiresAt: "x" } },
		})
		const client = createPresenterClient(fetchImpl)
		const result = await client.post("lease", { name: "Acme" }, "csrf-1")
		expect(result).toMatchObject({
			ok: true,
			body: { lease: { slotIndex: 13 } },
		})
		const [url, init] = fetchImpl.mock.calls[0]!
		expect(url).toBe("/api/demo/presenter/lease")
		expect(init?.method).toBe("POST")
		expect(init?.credentials).toBe("same-origin")
		expect(init?.headers).toMatchObject({
			"content-type": "application/json",
			"x-demo-csrf": "csrf-1",
		})
		expect(init?.body).toBe(JSON.stringify({ name: "Acme" }))
	})

	it("returns a refusal's code and message", async () => {
		const client = createPresenterClient(
			fakeFetch({
				status: 409,
				body: {
					error: {
						code: "NO_SLOT_AVAILABLE",
						message: "no fully seeded slot is free",
					},
				},
			}),
		)
		expect(await client.post("lease", {}, "c")).toEqual({
			ok: false,
			status: 409,
			code: "NO_SLOT_AVAILABLE",
			message: "no fully seeded slot is free",
		})
	})

	it("reports an unreachable server as a plain failure", async () => {
		const client = createPresenterClient(
			vi.fn(async () => {
				throw new Error("offline")
			}),
		)
		expect(await client.post("run", {}, "c")).toMatchObject({
			ok: false,
			code: "UNREACHABLE",
		})
	})

	it("signs in without a csrf token", async () => {
		const fetchImpl = fakeFetch({ body: { csrf: "t" } })
		const client = createPresenterClient(fetchImpl)
		expect(await client.signIn("token")).toMatchObject({ ok: true })
		const init = fetchImpl.mock.calls[0]![1]!
		expect(JSON.parse(init.body as string)).toEqual({ token: "token" })
		expect(init.headers).not.toHaveProperty("x-demo-csrf")
	})
})

describe("leaseLabel", () => {
	it("names the slot alone while it holds its default name, and with the presenter's name once renamed", () => {
		const base = { slotIndex: 13, expiresAt: "2026-10-23T12:30:00.000Z" }
		expect(leaseLabel({ ...base, name: "Slot 13" })).toBe("Slot 13")
		expect(leaseLabel({ ...base, name: "" })).toBe("Slot 13")
		expect(leaseLabel({ ...base, name: "Board demo" })).toBe(
			"Slot 13, Board demo",
		)
	})
})
