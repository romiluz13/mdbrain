// The browser's side of the presenter API: a thin fetch wrapper with no key and
// no scope in it. The session is the HttpOnly cookie the browser sends on its
// own; the CSRF token comes from the state read and rides in a header on every
// action. If the state cannot be read as a presenter's, the answer is public,
// so a visitor never gets a presenter control by a failed read.

import { CSRF_HEADER } from "./session-names.js"

export type LeaseView = { slotIndex: number; name: string; expiresAt: string }
/** "Slot 13" for a slot still holding its default name, else "Slot 13, Board
 * demo". */
export function leaseLabel(lease: LeaseView): string {
	return lease.name === "" || lease.name === `Slot ${lease.slotIndex}`
		? `Slot ${lease.slotIndex}`
		: `Slot ${lease.slotIndex}, ${lease.name}`
}

export type RequestView = {
	state: "queued" | "claimed" | "done" | "failed"
	requestedAt: string
	failureReason?: string
}
export type PresenterSnapshot =
	| { mode: "public" }
	| {
			mode: "presenter"
			csrf: string
			lease: LeaseView | null
			request: RequestView | null
	  }

export type ActionResult =
	| { ok: true; body: Record<string, unknown> }
	| { ok: false; status: number; code: string; message: string }

const BASE = "/api/demo/presenter"

export function createPresenterClient(
	fetchImpl: typeof fetch = (input, init) => fetch(input, init),
	base: string = BASE,
) {
	async function send(
		path: string,
		body: unknown,
		csrf: string | null,
	): Promise<ActionResult> {
		try {
			const response = await fetchImpl(`${base}/${path}`, {
				method: "POST",
				credentials: "same-origin",
				cache: "no-store",
				headers: {
					"content-type": "application/json",
					...(csrf !== null ? { [CSRF_HEADER]: csrf } : {}),
				},
				body: JSON.stringify(body),
			})
			const parsed = (await response.json().catch(() => ({}))) as {
				error?: { code?: string; message?: string }
			} & Record<string, unknown>
			if (response.ok) return { ok: true, body: parsed }
			return {
				ok: false,
				status: response.status,
				code: parsed.error?.code ?? "REFUSED",
				message: parsed.error?.message ?? "The server refused the request.",
			}
		} catch {
			return {
				ok: false,
				status: 0,
				code: "UNREACHABLE",
				message: "The server could not be reached.",
			}
		}
	}

	return {
		async state(): Promise<PresenterSnapshot> {
			try {
				const response = await fetchImpl(`${base}/state`, {
					credentials: "same-origin",
					cache: "no-store",
				})
				if (!response.ok) return { mode: "public" }
				const body = (await response.json()) as Partial<PresenterSnapshot> & {
					csrf?: unknown
				}
				return body.mode === "presenter" && typeof body.csrf === "string"
					? (body as PresenterSnapshot)
					: { mode: "public" }
			} catch {
				return { mode: "public" }
			}
		},
		signIn: (token: string) => send("session", { token }, null),
		post: (path: string, body: unknown, csrf: string) => send(path, body, csrf),
		async get(path: string): Promise<ActionResult> {
			try {
				const response = await fetchImpl(`${base}/${path}`, {
					credentials: "same-origin",
					cache: "no-store",
				})
				const parsed = (await response.json().catch(() => ({}))) as {
					error?: { code?: string; message?: string }
				} & Record<string, unknown>
				return response.ok
					? { ok: true, body: parsed }
					: {
							ok: false,
							status: response.status,
							code: parsed.error?.code ?? "REFUSED",
							message:
								parsed.error?.message ?? "The server refused the request.",
						}
			} catch {
				return {
					ok: false,
					status: 0,
					code: "UNREACHABLE",
					message: "The server could not be reached.",
				}
			}
		},
	}
}

export type PresenterClient = ReturnType<typeof createPresenterClient>
