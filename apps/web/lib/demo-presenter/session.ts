// Presenter token, session and CSRF protection for the presenter routes.
//
// Next 16 compares Origin to Host only for Server Actions; a Route Handler
// gets no CSRF check from the framework (node_modules/next/dist/docs/01-app/
// 02-guides/data-security.md, "Allowed origins"). So every presenter route
// carries its own, layered the way that guide describes plus a token:
//   1. the method is POST and the body is JSON, which a cross-site form cannot
//      send without a CORS preflight the routes never answer;
//   2. the Origin header names this host (or the forwarded host);
//   3. the session cookie is HttpOnly, SameSite=Strict and scoped to the demo
//      API;
//   4. the request carries the session's own CSRF token in a header, which a
//      page on another origin can neither read nor set.
// Sessions live in the demo control database, so a restart or a second web
// instance shares them. The database holds a digest of the cookie value, never
// the value.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { ControlCollection } from "./collections.js"

import { CSRF_HEADER, SESSION_COOKIE } from "./session-names.js"

export { CSRF_HEADER, SESSION_COOKIE }
export const DEFAULT_SESSION_TTL_MS = 8 * 3_600_000

export type SessionDoc = {
	_id: string
	csrf: string
	createdAt: Date
	expiresAt: Date
}

export type Session = {
	presenterId: string
	csrf: string
	expiresAt: Date
}

const digest = (value: string): Buffer =>
	createHash("sha256").update(value).digest()

function safeEqual(a: string, b: string): boolean {
	return timingSafeEqual(digest(a), digest(b)) && a.length === b.length
}

/** Compares digests, so the comparison takes the same time for any input. */
export function verifyPresenterToken(
	provided: string,
	expected: string,
): boolean {
	return expected !== "" && provided !== "" && safeEqual(provided, expected)
}

export type SessionDeps = {
	sessions: ControlCollection<SessionDoc>
	now: () => Date
	ttlMs?: number
}

export function createSessionService(deps: SessionDeps) {
	const ttlMs = deps.ttlMs ?? DEFAULT_SESSION_TTL_MS
	const idOf = (sessionId: string) => digest(sessionId).toString("hex")

	return {
		async open(): Promise<Session & { sessionId: string }> {
			const sessionId = randomBytes(32).toString("base64url")
			const csrf = randomBytes(24).toString("base64url")
			const now = deps.now()
			const expiresAt = new Date(now.getTime() + ttlMs)
			await deps.sessions.insertOne({
				_id: idOf(sessionId),
				csrf,
				createdAt: now,
				expiresAt,
			})
			return { sessionId, presenterId: idOf(sessionId), csrf, expiresAt }
		},
		async lookup(sessionId: string): Promise<Session | null> {
			if (sessionId === "") return null
			const doc = await deps.sessions.findOne({
				_id: idOf(sessionId),
				expiresAt: { $gt: deps.now() },
			})
			return doc
				? { presenterId: doc._id, csrf: doc.csrf, expiresAt: doc.expiresAt }
				: null
		},
		async close(sessionId: string): Promise<void> {
			await deps.sessions.deleteOne({ _id: idOf(sessionId) })
		},
	}
}

export type SessionService = ReturnType<typeof createSessionService>

export type Authorized = { ok: true } & Session
export type Refused = {
	ok: false
	status: 401 | 403 | 405 | 415
	code:
		| "NOT_PRESENTER"
		| "CSRF_ORIGIN"
		| "CSRF_TOKEN"
		| "NOT_JSON"
		| "METHOD_NOT_ALLOWED"
}

function cookieValue(request: Request, name: string): string {
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const at = part.indexOf("=")
		if (at > 0 && part.slice(0, at).trim() === name) {
			return part.slice(at + 1).trim()
		}
	}
	return ""
}

export function sessionIdOf(request: Request): string {
	return cookieValue(request, SESSION_COOKIE)
}

/** A read by a presenter: the session cookie is the whole check. */
export async function authorizeSession(
	request: Request,
	sessions: SessionService,
): Promise<Authorized | Refused> {
	const session = await sessions.lookup(sessionIdOf(request))
	return session
		? { ok: true, ...session }
		: { ok: false, status: 401, code: "NOT_PRESENTER" }
}

function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin")
	if (!origin) return false
	let originHost: string
	try {
		originHost = new URL(origin).host
	} catch {
		return false
	}
	const hosts = [
		request.headers.get("host"),
		request.headers.get("x-forwarded-host"),
		new URL(request.url).host,
	]
	return hosts.some((host) => host !== null && host === originHost)
}

/** The origin and body-type checks that need no session: a same-origin POST
 * with a JSON body. Sign-in uses them alone, since it has no session yet. */
export function checkSameOriginJson(request: Request): Refused | null {
	if (request.method.toUpperCase() !== "POST") {
		return { ok: false, status: 405, code: "METHOD_NOT_ALLOWED" }
	}
	if (!sameOrigin(request)) {
		return { ok: false, status: 403, code: "CSRF_ORIGIN" }
	}
	const type = (request.headers.get("content-type") ?? "").toLowerCase()
	if (!type.startsWith("application/json")) {
		return { ok: false, status: 415, code: "NOT_JSON" }
	}
	return null
}

/** A presenter action: a same-origin JSON POST with the session cookie and
 * that session's CSRF token. */
export async function authorizeMutation(
	request: Request,
	sessions: SessionService,
): Promise<Authorized | Refused> {
	if (request.method.toUpperCase() !== "POST") {
		return { ok: false, status: 405, code: "METHOD_NOT_ALLOWED" }
	}
	const session = await sessions.lookup(sessionIdOf(request))
	if (!session) return { ok: false, status: 401, code: "NOT_PRESENTER" }
	const refused = checkSameOriginJson(request)
	if (refused) return refused
	const sent = request.headers.get(CSRF_HEADER) ?? ""
	if (!safeEqual(sent, session.csrf)) {
		return { ok: false, status: 403, code: "CSRF_TOKEN" }
	}
	return { ok: true, ...session }
}

/** The Set-Cookie value. Secure goes on only over https, so a local http dev
 * server can still sign in; the cookie value is never readable by the page. */
export function sessionCookie(
	value: string,
	maxAgeMs: number,
	secure: boolean,
): string {
	return [
		`${SESSION_COOKIE}=${value}`,
		"Path=/api/demo",
		`Max-Age=${Math.floor(maxAgeMs / 1000)}`,
		"HttpOnly",
		"SameSite=Strict",
		...(secure ? ["Secure"] : []),
	].join("; ")
}
