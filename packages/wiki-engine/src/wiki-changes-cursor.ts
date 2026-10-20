// @mdbrain/wiki-engine — the changes feed cursor.
//
// Opaque to clients. It freezes the window (since, until) and names the last
// revision RETURNED, so the next page is everything strictly after that
// position in (createdAt, pageSlug, revision) order. It can only ever name a
// revision the caller was shown: a revision the caller may not read is never
// returned, so it is never a position.

import { WikiChangesRequestError } from "./wiki-changes-types.js"

export type WikiChangesPosition = {
	createdAt: Date
	pageSlug: string
	revision: number
}

export type WikiChangesCursor = {
	since: Date
	until: Date
	after: WikiChangesPosition
}

const VERSION = 1

export function encodeWikiChangesCursor(cursor: WikiChangesCursor): string {
	return Buffer.from(
		JSON.stringify({
			v: VERSION,
			s: cursor.since.toISOString(),
			u: cursor.until.toISOString(),
			t: cursor.after.createdAt.toISOString(),
			p: cursor.after.pageSlug,
			r: cursor.after.revision,
		}),
	).toString("base64url")
}

function instant(value: unknown): Date | undefined {
	if (typeof value !== "string") return undefined
	const date = new Date(value)
	return Number.isNaN(date.getTime()) || date.toISOString() !== value
		? undefined
		: date
}

export function decodeWikiChangesCursor(token: string): WikiChangesCursor {
	const invalid = () => new WikiChangesRequestError("cursor is not valid")
	let raw: unknown
	try {
		raw = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
	} catch {
		throw invalid()
	}
	if (typeof raw !== "object" || raw === null) throw invalid()
	const fields = raw as Record<string, unknown>
	const since = instant(fields.s)
	const until = instant(fields.u)
	const createdAt = instant(fields.t)
	if (
		fields.v !== VERSION ||
		!since ||
		!until ||
		!createdAt ||
		typeof fields.p !== "string" ||
		fields.p === "" ||
		!Number.isSafeInteger(fields.r) ||
		(fields.r as number) < 1
	) {
		throw invalid()
	}
	return {
		since,
		until,
		after: { createdAt, pageSlug: fields.p, revision: fields.r as number },
	}
}
