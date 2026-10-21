// Which demo reads exist and what each may carry: the route table, the
// parameter specs, and the checks on a slug or a parameter value. The proxy
// in ./proxy.ts decides nothing about shape; it asks this file.

import { parseCitationMarker } from "@mdbrain/client"

// Raw first-segment names after /wiki whose sub-routes are not part of the
// read allowlist: the revisions reads and the okf interchange names. They
// are refused at any raw depth. `lint` and `changes` are readable operations
// on their own and page-slug prefixes beyond that (mirroring the API's
// wildcard route) and so does `search`, the governed question read; `overview`
// beyond the overview route is a page slug too, while bare `overview` names no
// readable page.
const REFUSED_SUBROUTE_SEGMENTS: readonly string[] = [
	"revisions",
	"okf-import",
	"okf-export",
]

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/
const CURSOR_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/
const SEARCH_QUERY_MAX = 200

type ParamSpec =
	| { kind: "int"; min: number; max: number }
	| { kind: "enum"; values: readonly string[] }
	| { kind: "token" }
	| { kind: "cursor" }
	| { kind: "datetime" }
	| { kind: "text" }
	| { kind: "citation"; markerKind: "event" | "wiki" }

type QuerySpec = {
	required?: Record<string, ParamSpec>
	optional?: Record<string, ParamSpec>
}

/** One allowlisted read, or null when nothing matches. The `slugRoute` form
 * carries a raw slug: the caller decodes it, checks every segment and
 * forwards it with the API's own encoding rules (one percent-encoded
 * component, the form the SDK sends). */
export type MatchedOperation =
	| {
			operation: string
			upstreamPath: string
			query: QuerySpec
			/** The upstream read is a POST whose body the proxy builds. */
			search?: true
	  }
	| {
			operation: string
			slugRoute: "/v1/wiki" | "/v1/wiki/overview"
			rawSlug: string
			query: QuerySpec
	  }

const INT_LIMIT_1_100 = { kind: "int", min: 1, max: 100 } as const
const INT_SKIP = { kind: "int", min: 0, max: 1_000_000 } as const
const TOKEN = { kind: "token" } as const
const CURSOR = { kind: "cursor" } as const
const DATETIME = { kind: "datetime" } as const

function enumSpec(values: readonly string[]): ParamSpec {
	return { kind: "enum", values }
}

/** Routes the raw (still percent-encoded) segments after /api/demo/v1 the
 * way the API's own router does: literal slashes separate route segments,
 * while an encoded separator (%2F) stays inside one segment and so names a
 * hierarchical page slug. Returns null when nothing allowlisted matches. */
export function matchOperation(rawParts: string[]): MatchedOperation | null {
	const [head, second, ...tail] = rawParts
	if (head === "wiki" && second === undefined) {
		return {
			operation: "wiki-list",
			upstreamPath: "/v1/wiki",
			query: {
				optional: {
					limit: INT_LIMIT_1_100,
					skip: INT_SKIP,
					kind: TOKEN,
					trustTier: TOKEN,
					state: TOKEN,
				},
			},
		}
	}
	if (head === "cite" && second === undefined) {
		return {
			operation: "cite",
			upstreamPath: "/v1/cite",
			query: {
				required: {
					marker: { kind: "citation", markerKind: "event" },
					citedBy: { kind: "citation", markerKind: "wiki" },
				},
			},
		}
	}
	if (head !== "wiki" || second === undefined) {
		return null
	}
	if (REFUSED_SUBROUTE_SEGMENTS.includes(second)) {
		return null
	}
	if (tail.length === 0) {
		if (second === "changes") {
			return {
				operation: "wiki-changes",
				upstreamPath: "/v1/wiki/changes",
				query: {
					required: { since: DATETIME },
					optional: {
						until: DATETIME,
						cursor: CURSOR,
						limit: INT_LIMIT_1_100,
						maxClaims: { kind: "int", min: 1, max: 50 },
					},
				},
			}
		}
		if (second === "lint") {
			return {
				operation: "wiki-lint",
				upstreamPath: "/v1/wiki/lint",
				query: { optional: { limit: INT_LIMIT_1_100, kind: TOKEN } },
			}
		}
		if (second === "search") {
			return {
				operation: "wiki-search",
				upstreamPath: "/v1/wiki/search",
				search: true,
				query: {
					required: { query: { kind: "text" } },
					optional: { maxResults: { kind: "int", min: 1, max: 10 } },
				},
			}
		}
		if (second === "overview") {
			return null
		}
		return {
			operation: "wiki-page",
			slugRoute: "/v1/wiki",
			rawSlug: second,
			query: {
				optional: {
					kind: TOKEN,
					format: enumSpec(["json"]),
					transclude: enumSpec(["true", "false"]),
				},
			},
		}
	}
	if (second === "overview") {
		return {
			operation: "wiki-overview",
			slugRoute: "/v1/wiki/overview",
			rawSlug: tail.join("/"),
			query: {
				optional: {
					maxBacklinks: INT_LIMIT_1_100,
					maxNeighbors: INT_LIMIT_1_100,
					maxNeighborClaims: { kind: "int", min: 1, max: 50 },
					maxRevisions: { kind: "int", min: 1, max: 25 },
					maxContradictions: { kind: "int", min: 1, max: 50 },
				},
			},
		}
	}
	return {
		operation: "wiki-page",
		slugRoute: "/v1/wiki",
		rawSlug: [second, ...tail].join("/"),
		query: {
			optional: {
				kind: TOKEN,
				format: enumSpec(["json"]),
				transclude: enumSpec(["true", "false"]),
			},
		},
	}
}

function isSafeSegment(segment: string): boolean {
	if (
		segment === "" ||
		segment === "." ||
		segment === ".." ||
		segment.includes("/") ||
		segment.includes("\\")
	) {
		return false
	}
	return !CONTROL_CHARACTERS.test(segment)
}

/** Decodes a raw slug - the SDK's single percent-encoded component or the
 * raw-slash form - and checks every decoded segment. Returns null when the
 * slug decodes to anything unsafe: broken percent-encoding, empty, "." or
 * ".." segments, control characters or backslashes. */
export function decodeSlug(raw: string): string | null {
	let decoded: string
	try {
		decoded = decodeURIComponent(raw)
	} catch {
		return null
	}
	if (decoded.includes("\\")) {
		return null
	}
	for (const segment of decoded.split("/")) {
		if (!isSafeSegment(segment)) {
			return null
		}
	}
	return decoded
}

export function validateParam(
	name: string,
	value: string,
	spec: ParamSpec,
): { ok: true } | { ok: false; reason: string } {
	switch (spec.kind) {
		case "int": {
			const parsed = Number(value)
			if (!Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) {
				return {
					ok: false,
					reason: `${name} must be an integer between ${spec.min} and ${spec.max}`,
				}
			}
			return { ok: true }
		}
		case "enum": {
			if (!spec.values.includes(value)) {
				return {
					ok: false,
					reason: `${name} must be one of: ${spec.values.join(", ")}`,
				}
			}
			return { ok: true }
		}
		case "token": {
			if (!TOKEN_PATTERN.test(value)) {
				return {
					ok: false,
					reason: `${name} must be a short identifier without slashes or special characters`,
				}
			}
			return { ok: true }
		}
		case "cursor": {
			if (!CURSOR_PATTERN.test(value)) {
				return {
					ok: false,
					reason: `${name} must be a changes cursor token`,
				}
			}
			return { ok: true }
		}
		case "datetime": {
			if (value === "" || Number.isNaN(Date.parse(value))) {
				return { ok: false, reason: `${name} must be an ISO datetime` }
			}
			return { ok: true }
		}
		case "text": {
			const trimmed = value.trim()
			if (trimmed === "" || value.length > SEARCH_QUERY_MAX) {
				return {
					ok: false,
					reason: `${name} must be between 1 and ${SEARCH_QUERY_MAX} characters`,
				}
			}
			if (CONTROL_CHARACTERS.test(value)) {
				return {
					ok: false,
					reason: `${name} must not contain control characters`,
				}
			}
			return { ok: true }
		}
		case "citation": {
			const parsed = parseCitationMarker(value)
			if (!parsed.ok) {
				return { ok: false, reason: `${name} is not a citation marker` }
			}
			if (parsed.marker.kind !== spec.markerKind) {
				return {
					ok: false,
					reason: `${name} must be a ${spec.markerKind} citation marker`,
				}
			}
			return { ok: true }
		}
	}
}
