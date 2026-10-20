// Query parsing for GET /v1/wiki/changes. Anything that is not exactly what the
// parameter documents is a 400 that names the parameter; the engine then clamps
// a page size above its maximum and reports the value it used.

export type WikiChangesQuery = {
	since?: Date
	until?: Date
	cursor?: string
	limit?: number
	maxClaims?: number
}

// ISO 8601 with a zone designator. A "+" in an offset must be percent-encoded
// in a query string (it decodes to a space), so Z is the form to prefer.
const INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

function instant(raw: string): Date | undefined {
	if (!INSTANT.test(raw)) return undefined
	const date = new Date(raw)
	return Number.isNaN(date.getTime()) ? undefined : date
}

function positiveInteger(raw: string): number | undefined {
	if (!/^\d+$/.test(raw)) return undefined
	const value = Number(raw)
	return Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

export function parseWikiChangesQuery(
	read: (name: string) => string | undefined,
): { value: WikiChangesQuery } | { error: string } {
	const value: WikiChangesQuery = {}
	for (const name of ["since", "until"] as const) {
		const raw = read(name)
		if (raw === undefined) continue
		const parsed = instant(raw)
		if (!parsed) {
			return {
				error: `${name} must be an ISO 8601 instant with a zone, such as 2026-10-01T10:00:00Z`,
			}
		}
		value[name] = parsed
	}
	for (const name of ["limit", "maxClaims"] as const) {
		const raw = read(name)
		if (raw === undefined) continue
		const parsed = positiveInteger(raw)
		if (parsed === undefined) {
			return { error: `${name} must be a positive integer` }
		}
		value[name] = parsed
	}
	const cursor = read("cursor")
	if (cursor !== undefined) {
		if (cursor === "") return { error: "cursor must not be empty" }
		value.cursor = cursor
	}
	return { value }
}
