import { describe, expect, it } from "vitest"
import { handlePresenterRequest } from "./presenter-api.js"
import {
	call,
	ORIGIN,
	rig,
	seeded,
	signIn,
	TOKEN,
} from "./testing/presenter-rig.js"

const NOT_CONFIGURED = {
	error: {
		code: "PRESENTER_NOT_CONFIGURED",
		message: "Presenter mode is not configured on this server.",
	},
}

describe("presenter API: a server that is not ready", () => {
	it("answers the fixed not-configured message to every action, and public to the state read", async () => {
		const context = rig([seeded(13)])
		const session = await signIn(context.services)
		const unready = { ...context.services, ready: async () => false }
		for (const path of ["session", "lease", "run", "pin", "proposals/decide"]) {
			const { status, body } = await call(unready, {
				path,
				session,
				body: { token: TOKEN },
			})
			expect(status).toBe(503)
			expect(body).toEqual(NOT_CONFIGURED)
		}
		const listed = await call(unready, {
			method: "GET",
			path: "proposals",
			session,
		})
		expect(listed.status).toBe(503)
		const state = await call(unready, { method: "GET", path: "state", session })
		expect(state.body).toEqual({ mode: "public" })
	})

	it("does not lease or touch a store while it is not ready", async () => {
		const context = rig([seeded(13)])
		const session = await signIn(context.services)
		const unready = { ...context.services, ready: async () => false }
		await call(unready, { path: "lease", session })
		expect(context.leaseStore.docs.size).toBe(0)
	})
})

describe("presenter API: the sign-in body", () => {
	const signInRequest = (init: {
		headers?: Record<string, string>
		body: BodyInit
	}) =>
		new Request(`${ORIGIN}/api/demo/presenter/session`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: ORIGIN,
				"x-forwarded-for": "203.0.113.9",
				...init.headers,
			},
			body: init.body,
			// @ts-expect-error Node's fetch needs duplex for a stream body
			duplex: "half",
		})

	function chunked(sizes: number[]) {
		const state = { pulled: 0, cancelled: false }
		const stream = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					const size = sizes[state.pulled]
					state.pulled += 1
					if (size === undefined) {
						controller.close()
						return
					}
					controller.enqueue(new TextEncoder().encode("x".repeat(size)))
				},
				cancel() {
					state.cancelled = true
				},
			},
			// Pull only when the handler asks, so "pulled" counts what it read.
			{ highWaterMark: 0 },
		)
		return { stream, state }
	}

	it("refuses a declared size over the cap before reading any of it", async () => {
		const { services } = rig([seeded(13)])
		const { stream, state } = chunked([1_000_000])
		const response = await handlePresenterRequest(
			signInRequest({ headers: { "content-length": "1000000" }, body: stream }),
			["session"],
			services,
		)
		expect(response.status).toBe(413)
		expect(state.pulled).toBe(0)
	})

	it("stops reading a body that never declared its size once it is over the cap", async () => {
		const { services } = rig([seeded(13)])
		const { stream, state } = chunked([1_500, 1_500, 1_500, 1_500, 1_500])
		const response = await handlePresenterRequest(
			signInRequest({ body: stream }),
			["session"],
			services,
		)
		expect(response.status).toBe(413)
		expect(state.pulled).toBeLessThan(5)
		expect(state.cancelled).toBe(true)
	})

	it("still signs in a normal body", async () => {
		const { services } = rig([seeded(13)])
		const response = await handlePresenterRequest(
			signInRequest({ body: JSON.stringify({ token: TOKEN }) }),
			["session"],
			services,
		)
		expect(response.status).toBe(200)
	})
})

describe("presenter API: failed sign-ins", () => {
	const wrong = (address: string | null = "203.0.113.9") => ({
		path: "session",
		body: { token: "not-the-token" },
		address,
	})

	it("refuses an address after 10 wrong tokens in a minute, even with the right one, until the minute is up", async () => {
		const context = rig([seeded(13)])
		for (let attempt = 0; attempt < 10; attempt++) {
			expect((await call(context.services, wrong())).status).toBe(401)
		}
		const blocked = await call(context.services, {
			path: "session",
			body: { token: TOKEN },
		})
		expect(blocked.status).toBe(429)
		expect(blocked.response.headers.get("retry-after")).toBe("60")
		context.tick(61_000)
		const later = await call(context.services, {
			path: "session",
			body: { token: TOKEN },
		})
		expect(later.status).toBe(200)
	})

	it("counts each address on its own, and the first hop of a forwarded list", async () => {
		const context = rig([seeded(13)])
		for (let attempt = 0; attempt < 10; attempt++) {
			await call(context.services, wrong("198.51.100.1, 10.0.0.1"))
		}
		expect(
			(
				await call(context.services, {
					path: "session",
					body: { token: TOKEN },
					address: "198.51.100.1, 10.9.9.9",
				})
			).status,
		).toBe(429)
		expect(
			(
				await call(context.services, {
					path: "session",
					body: { token: TOKEN },
					address: "198.51.100.2",
				})
			).status,
		).toBe(200)
	})

	it("does not count a successful sign-in", async () => {
		const context = rig([seeded(13)])
		for (let attempt = 0; attempt < 12; attempt++) {
			expect(
				(
					await call(context.services, {
						path: "session",
						body: { token: TOKEN },
					})
				).status,
			).toBe(200)
		}
	})

	it("fails closed when the request carries no client address", async () => {
		const context = rig([seeded(13)])
		const refused = await call(context.services, {
			path: "session",
			body: { token: TOKEN },
			address: null,
		})
		expect(refused.status).toBe(403)
		expect(refused.body).toMatchObject({ error: { code: "NO_CLIENT_ADDRESS" } })
	})
})
