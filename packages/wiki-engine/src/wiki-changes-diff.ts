// @mdbrain/wiki-engine — claim-level diff for the changes feed.
//
// Claims are matched by id between a revision and the one before it.
//   added   id in the new snapshot, not in the previous one
//   removed id in the previous snapshot, not in the new one (a claim set to
//           status "superseded" is still present: that is a change, not a removal)
//   changed id in both, and one of COMPARED_CLAIM_FIELDS differs
// updatedAt and validFrom are not compared: the write path restamps both on every
// patched claim (validFrom ?? now, updatedAt: now), so a claim a writer re-sends
// unchanged must not read as a change. writerAgent is on the revision's editor;
// sourceMemId is migration provenance.

import type { WikiChangeClaim, WikiChangeClaims } from "./wiki-changes-types.js"

export const COMPARED_CLAIM_FIELDS = [
	"text",
	"status",
	"confidence",
	"evidence",
	"derivedFrom",
	"supersedesClaimId",
	"validTo",
] as const

function canonical(value: unknown): string {
	if (value instanceof Date) return `date:${value.toISOString()}`
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
	}
	return JSON.stringify(value) ?? "undefined"
}

// A stored evidence entry may carry a marker the client echoed back; markers are
// derived on the way out, so they are not part of what the claim says.
function comparable(field: string, value: unknown): string {
	if (field === "evidence" && Array.isArray(value)) {
		return canonical(
			value.map((entry) => {
				if (typeof entry !== "object" || entry === null) return entry
				const { marker: _marker, ...rest } = entry as Record<string, unknown>
				return rest
			}),
		)
	}
	return canonical(value)
}

function byId(claims: WikiChangeClaim[]): Map<string, WikiChangeClaim> {
	const map = new Map<string, WikiChangeClaim>()
	for (const claim of claims) {
		if (typeof claim.id === "string" && !map.has(claim.id)) {
			map.set(claim.id, claim)
		}
	}
	return map
}

export function diffClaims(
	before: WikiChangeClaim[],
	after: WikiChangeClaim[],
	maxClaims: number,
): WikiChangeClaims {
	const previous = byId(before)
	const next = byId(after)
	const added = [...next].filter(([id]) => !previous.has(id)).map(([, c]) => c)
	const removed = [...previous]
		.filter(([id]) => !next.has(id))
		.map(([, c]) => c)
	const changed: WikiChangeClaims["changed"] = []
	for (const [id, claim] of next) {
		const prior = previous.get(id)
		if (!prior) continue
		const fields = COMPARED_CLAIM_FIELDS.filter(
			(field) =>
				comparable(field, prior[field]) !== comparable(field, claim[field]),
		)
		if (fields.length > 0) {
			changed.push({ id, fields: [...fields], before: prior, after: claim })
		}
	}
	return {
		added: added.slice(0, maxClaims),
		changed: changed.slice(0, maxClaims),
		removed: removed.slice(0, maxClaims),
		counts: {
			added: added.length,
			changed: changed.length,
			removed: removed.length,
		},
		truncated:
			added.length > maxClaims ||
			changed.length > maxClaims ||
			removed.length > maxClaims,
	}
}
