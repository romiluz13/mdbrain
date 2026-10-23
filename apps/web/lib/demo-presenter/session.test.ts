import { describe, expect, it } from "vitest"
import {
	CSRF_HEADER,
	SESSION_COOKIE,
	authorizeMutation,
	authorizeSession,
	createSessionService,
	sessionCookie,
	verifyPresenterToken,
	type SessionDoc,
} from "./session.js"
import { MemoryCollection } from "./testing/memory-collection.js"

const NOW = new Date("2026-10-23T12:00:00.000Z")
const TTL_MS = 8 * 3_600_000
const TOKEN = "presenter-token-0123456789abcdef"
const ORIGIN = "http://demo.test"

function rig() {
	const sessions = new MemoryCollection<SessionDoc>()
	let clock = NOW
	const make = () =>
		createSessionService({ sessions, now: () => clock, ttlMs: TTL_MS })
	return {
		sessions,
		service: make(),
		restart: make,
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

function post(
	path: string,
	over: {
		cookie?: string
		csrf?: string
		origin?: string | null
		type?: string
		method?: string
		headers?: Record<string, string>
	} = {},
) {
	const headers: Record<string, string> = {
		"content-type": over.type ?? "application/json",
		...over.headers,
	}
	if (over.origin !== null) headers.origin = over.origin ?? ORIGIN
	if (over.cookie) headers.cookie = `${SESSION_COOKIE}=${over.cookie}`
	if (over.csrf) headers[CSRF_HEADER] = over.csrf
	return new Request(`${ORIGIN}${path}`, {
		method: over.method ?? "POST",
		headers,
		body: "{}",
	})
}

describe("verifyPresenterToken", () => {
	it("accepts the configured token and nothing else", () => {
		expect(verifyPresenterToken(TOKEN, TOKEN)).toBe(true)
		expect(verifyPresenterToken(`${TOKEN}x`, TOKEN)).toBe(false)
		expect(verifyPresenterToken(TOKEN.slice(0, -1), TOKEN)).toBe(false)
		expect(verifyPresenterToken("", TOKEN)).toBe(false)
		expect(verifyPresenterToken(TOKEN, "")).toBe(false)
	})
})

describe("sessions", () => {
	it("opens a session, stores only a digest of the cookie value, and looks it up", async () => {
		const { service, sessions } = rig()
		const opened = await service.open()
		expect(opened.csrf.length).toBeGreaterThanOrEqual(24)
		expect([...sessions.docs.keys()]).not.toContain(opened.sessionId)
		expect(JSON.stringify([...sessions.docs.values()])).not.toContain(
			opened.sessionId,
		)
		expect(await service.lookup(opened.sessionId)).toMatchObject({
			presenterId: opened.presenterId,
			csrf: opened.csrf,
		})
	})

	it("gives every session its own presenter id and csrf token", async () => {
		const { service } = rig()
		const a = await service.open()
		const b = await service.open()
		expect(a.presenterId).not.toBe(b.presenterId)
		expect(a.csrf).not.toBe(b.csrf)
	})

	it("refuses an unknown or expired session and ends one on close", async () => {
		const { service, tick } = rig()
		const opened = await service.open()
		expect(await service.lookup("not-a-session")).toBeNull()
		expect(await service.lookup("")).toBeNull()
		tick(TTL_MS - 1)
		expect(await service.lookup(opened.sessionId)).not.toBeNull()
		tick(2)
		expect(await service.lookup(opened.sessionId)).toBeNull()
		const other = await service.open()
		await service.close(other.sessionId)
		expect(await service.lookup(other.sessionId)).toBeNull()
	})

	it("refuses a cookie of the wrong shape without asking the store", async () => {
		const sessions = new MemoryCollection<SessionDoc>()
		const asked: unknown[] = []
		const findOne = sessions.findOne.bind(sessions)
		sessions.findOne = async (filter) => {
			asked.push(filter)
			return findOne(filter)
		}
		const service = createSessionService({ sessions, now: () => NOW })
		const opened = await service.open()
		for (const forged of [
			"x".repeat(42),
			"x".repeat(44),
			`${opened.sessionId.slice(0, 42)}=`,
			`${opened.sessionId.slice(0, 42)}!`,
			"a".repeat(10_000),
		]) {
			expect(await service.lookup(forged)).toBeNull()
		}
		expect(asked).toEqual([])
		expect(await service.lookup(opened.sessionId)).not.toBeNull()
		expect(asked).toHaveLength(1)
	})

	it("survives a restart of the service", async () => {
		const { service, restart } = rig()
		const opened = await service.open()
		expect(await restart().lookup(opened.sessionId)).toMatchObject({
			presenterId: opened.presenterId,
		})
	})
})

describe("authorizeSession (reads)", () => {
	it("needs only the cookie", async () => {
		const { service } = rig()
		const opened = await service.open()
		const ok = await authorizeSession(
			new Request(`${ORIGIN}/api/demo/presenter/session`, {
				headers: { cookie: `${SESSION_COOKIE}=${opened.sessionId}` },
			}),
			service,
		)
		expect(ok).toMatchObject({ ok: true, presenterId: opened.presenterId })
		const none = await authorizeSession(
			new Request(`${ORIGIN}/api/demo/presenter/session`),
			service,
		)
		expect(none).toMatchObject({
			ok: false,
			status: 401,
			code: "NOT_PRESENTER",
		})
	})
})

describe("authorizeMutation (CSRF)", () => {
	it("accepts a same-origin JSON POST carrying the session cookie and the csrf token", async () => {
		const { service } = rig()
		const opened = await service.open()
		const result = await authorizeMutation(
			post("/api/demo/presenter/lease", {
				cookie: opened.sessionId,
				csrf: opened.csrf,
			}),
			service,
		)
		expect(result).toMatchObject({ ok: true, presenterId: opened.presenterId })
	})

	it("refuses a request with no session cookie", async () => {
		const { service } = rig()
		const opened = await service.open()
		const result = await authorizeMutation(
			post("/api/demo/presenter/lease", { csrf: opened.csrf }),
			service,
		)
		expect(result).toMatchObject({
			ok: false,
			status: 401,
			code: "NOT_PRESENTER",
		})
	})

	it("refuses a missing, wrong or another session's csrf token", async () => {
		const { service } = rig()
		const mine = await service.open()
		const theirs = await service.open()
		for (const csrf of [undefined, "wrong", theirs.csrf, mine.csrf.slice(1)]) {
			const result = await authorizeMutation(
				post("/api/demo/presenter/lease", { cookie: mine.sessionId, csrf }),
				service,
			)
			expect(result).toMatchObject({
				ok: false,
				status: 403,
				code: "CSRF_TOKEN",
			})
		}
	})

	it("refuses a request from another origin or with no Origin header", async () => {
		const { service } = rig()
		const opened = await service.open()
		for (const origin of [
			"http://evil.test",
			"http://demo.test.evil.test",
			null,
		]) {
			const result = await authorizeMutation(
				post("/api/demo/presenter/lease", {
					cookie: opened.sessionId,
					csrf: opened.csrf,
					origin,
				}),
				service,
			)
			expect(result).toMatchObject({
				ok: false,
				status: 403,
				code: "CSRF_ORIGIN",
			})
		}
	})

	it("takes the forwarded host as the host when a proxy sits in front", async () => {
		const { service } = rig()
		const opened = await service.open()
		const result = await authorizeMutation(
			post("/api/demo/presenter/lease", {
				cookie: opened.sessionId,
				csrf: opened.csrf,
				origin: "https://demo.example.com",
				headers: { "x-forwarded-host": "demo.example.com" },
			}),
			service,
		)
		expect(result.ok).toBe(true)
	})

	it("refuses a body that is not JSON, because a form post would skip the preflight", async () => {
		const { service } = rig()
		const opened = await service.open()
		for (const type of [
			"text/plain",
			"application/x-www-form-urlencoded",
			"multipart/form-data",
		]) {
			const result = await authorizeMutation(
				post("/api/demo/presenter/lease", {
					cookie: opened.sessionId,
					csrf: opened.csrf,
					type,
				}),
				service,
			)
			expect(result).toMatchObject({ ok: false, status: 415, code: "NOT_JSON" })
		}
	})

	it("refuses a method that is not POST", async () => {
		const { service } = rig()
		const opened = await service.open()
		const result = await authorizeMutation(
			post("/api/demo/presenter/lease", {
				cookie: opened.sessionId,
				csrf: opened.csrf,
				method: "PUT",
			}),
			service,
		)
		expect(result).toMatchObject({
			ok: false,
			status: 405,
			code: "METHOD_NOT_ALLOWED",
		})
	})
})

describe("sessionCookie", () => {
	it("is HttpOnly, SameSite=Strict, scoped to the demo API, and Secure only over https", () => {
		const http = sessionCookie("abc", TTL_MS, false)
		expect(http).toContain(`${SESSION_COOKIE}=abc`)
		expect(http).toContain("HttpOnly")
		expect(http).toContain("SameSite=Strict")
		expect(http).toContain("Path=/api/demo")
		expect(http).toContain(`Max-Age=${TTL_MS / 1000}`)
		expect(http).not.toContain("Secure")
		expect(sessionCookie("abc", TTL_MS, true)).toContain("Secure")
		expect(sessionCookie("", 0, false)).toContain("Max-Age=0")
	})
})
