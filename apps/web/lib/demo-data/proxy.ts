// Server-side read proxy for the /demo data layer (ticket 12, part 1).
//
// One place translates demo reads into a fixed allowlist of upstream API
// reads. The read key, the scope and the scopeRef live only in server
// environment variables; the caller can never set or see them. Everything
// outside the allowlist - other methods, writes, admin routes, principal
// parameters from the caller, unknown or repeated parameters, unsafe path
// segments - is refused before any upstream call is made.
//
// Slugs follow the API's own rules. A wiki-page or wiki-overview slug may be
// hierarchical, given either in the raw-slash form (teams/support) or as the
// single percent-encoded component the SDK sends (teams%2Fsupport). Routing
// happens on the raw path the way the API's router works - literal slashes
// separate route segments, an encoded separator stays inside the slug - and
// every decoded segment is checked; the slug is then forwarded with the
// API's own encoding rules.

import { parseCitationMarker } from "@mdbrain/client"

export interface DemoProxyEnv {
	apiBaseUrl: string
	readKey: string
	scope: string
	scopeRef: string
	/** The agent the pinned run's events were written under. Event citations
	 * confirm their source through recall, which searches as this agent. */
	agentId: string
}

/** The demo read operations this proxy forwards, with the upstream route and
 * the demo chapter that reads them. This is the whole allowlist. */
export const DEMO_READ_OPERATIONS: ReadonlyArray<{
	operation: string
	upstream: string
	chapter: string
}> = [
	{ operation: "wiki-list", upstream: "GET /v1/wiki", chapter: "map" },
	{ operation: "wiki-page", upstream: "GET /v1/wiki/:slug", chapter: "entity" },
	{
		operation: "wiki-overview",
		upstream: "GET /v1/wiki/overview/:slug",
		chapter: "entity",
	},
	{
		operation: "wiki-changes",
		upstream: "GET /v1/wiki/changes",
		chapter: "what changed",
	},
	{
		operation: "wiki-lint",
		upstream: "GET /v1/wiki/lint",
		chapter: "contradictions",
	},
	{ operation: "cite", upstream: "GET /v1/cite", chapter: "sources" },
	// The one POST: a fixed-shape governed read. The caller sends a GET with a
	// bounded question; the proxy builds the whole upstream body itself.
	{
		operation: "wiki-search",
		upstream: "POST /v1/wiki/search",
		chapter: "ask",
	},
]

/** Principal-naming parameters. The server sets these from its own env; a
 * caller passing any of them - even the pinned value - is refused. */
export const DEMO_PROXY_FORBIDDEN_PARAMS: readonly string[] = [
	"scope",
	"scopeRef",
	"agentId",
	"containerTag",
]

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

const SCOPE_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/
const CURSOR_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/
const SEARCH_QUERY_MAX = 200
const SEARCH_RESULTS_DEFAULT = 6

/** Reads the proxy's server-only env. Returns null when any variable is
 * missing or malformed; the route answers 503 in that case. */
export function readDemoProxyEnv(
	env: Record<string, string | undefined>,
): DemoProxyEnv | null {
	const apiBaseUrl = (env.MDBRAIN_DEMO_API_BASE_URL ?? "").trim()
	const readKey = env.MDBRAIN_DEMO_READ_KEY ?? ""
	const scopeRef = (env.MDBRAIN_DEMO_SCOPE_REF ?? "").trim()
	const scope = (env.MDBRAIN_DEMO_SCOPE ?? "").trim() || "workspace"
	const agentId = (env.MDBRAIN_DEMO_AGENT_ID ?? "").trim()
	if (!apiBaseUrl || !readKey || !scopeRef || !agentId) {
		return null
	}
	let base: URL
	try {
		base = new URL(apiBaseUrl)
	} catch {
		return null
	}
	if (base.protocol !== "http:" && base.protocol !== "https:") {
		return null
	}
	if (
		!SCOPE_REF_PATTERN.test(scopeRef) ||
		!SCOPE_REF_PATTERN.test(scope) ||
		!SCOPE_REF_PATTERN.test(agentId)
	) {
		return null
	}
	return {
		apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
		readKey,
		scope,
		scopeRef,
		agentId,
	}
}

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
type MatchedOperation =
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
function matchOperation(rawParts: string[]): MatchedOperation | null {
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
function decodeSlug(raw: string): string | null {
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

function validateParam(
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

function proxyError(status: number, code: string, message: string): Response {
	return new Response(JSON.stringify({ error: { code, message } }), {
		status,
		headers: { "content-type": "application/json" },
	})
}

/** Handles one demo read request against the given env. `fetchImpl` is
 * injectable so tests and the live check can observe or redirect the
 * upstream call. Never logs; the read key appears in no output. */
export async function handleDemoRead(
	request: Request,
	env: DemoProxyEnv,
	fetchImpl: typeof fetch,
): Promise<Response> {
	const method = request.method.toUpperCase()
	if (method !== "GET") {
		return proxyError(
			405,
			"METHOD_NOT_ALLOWED",
			"the demo proxy only forwards GET reads",
		)
	}
	const url = new URL(request.url)
	const pathname = url.pathname
	// Route on the raw path, the way the API's router does: literal slashes
	// separate route segments, an encoded separator stays inside a slug.
	if (!pathname.startsWith("/api/demo/v1/")) {
		return proxyError(404, "UNKNOWN_OPERATION", "no demo read operation here")
	}
	let route = pathname.slice("/api/demo/v1/".length)
	if (route.endsWith("/")) {
		route = route.slice(0, -1)
	}
	const matched = matchOperation(route.split("/"))
	if (!matched) {
		return proxyError(
			404,
			"UNKNOWN_OPERATION",
			`no demo read operation at ${pathname}`,
		)
	}
	let upstreamPath: string
	if ("rawSlug" in matched) {
		const slug = decodeSlug(matched.rawSlug)
		if (slug === null) {
			return proxyError(400, "UNSAFE_PATH", "the slug is not a safe page path")
		}
		upstreamPath = `${matched.slugRoute}/${encodeURIComponent(slug)}`
	} else {
		upstreamPath = matched.upstreamPath
	}
	for (const name of DEMO_PROXY_FORBIDDEN_PARAMS) {
		if (url.searchParams.has(name)) {
			return proxyError(
				400,
				"UNKNOWN_PARAMETER",
				`${name} is set by the server and cannot come from the caller`,
			)
		}
	}
	for (const name of Object.keys(matched.query.required ?? {})) {
		if (!url.searchParams.has(name)) {
			return proxyError(
				400,
				"INVALID_PARAMETER",
				`${name} is required for ${matched.operation}`,
			)
		}
	}
	const forwarded = new URLSearchParams()
	for (const key of url.searchParams.keys()) {
		const values = url.searchParams.getAll(key)
		if (values.length > 1) {
			return proxyError(
				400,
				"INVALID_PARAMETER",
				`${key} must be given at most once`,
			)
		}
		const spec = matched.query.required?.[key] ?? matched.query.optional?.[key]
		if (!spec) {
			return proxyError(
				400,
				"UNKNOWN_PARAMETER",
				`unknown query parameter ${key} for ${matched.operation}`,
			)
		}
		const validated = validateParam(key, values[0], spec)
		if (!validated.ok) {
			return proxyError(400, "INVALID_PARAMETER", validated.reason)
		}
		forwarded.set(key, values[0])
	}
	const upstreamUrl = new URL(`${env.apiBaseUrl}${upstreamPath}`)
	let init: RequestInit
	if ("search" in matched) {
		// One fixed-shape read: the text lane (no model, no embedding), the
		// server's scope, a bounded result count. The caller supplies only the
		// question and may lower the count.
		init = {
			method: "POST",
			headers: {
				authorization: `Bearer ${env.readKey}`,
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				scope: env.scope,
				scopeRef: env.scopeRef,
				query: (forwarded.get("query") ?? "").trim(),
				recipe: "text",
				maxResults: Number(
					forwarded.get("maxResults") ?? SEARCH_RESULTS_DEFAULT,
				),
			}),
		}
	} else {
		upstreamUrl.searchParams.set("scope", env.scope)
		upstreamUrl.searchParams.set("scopeRef", env.scopeRef)
		// Only the citation read uses it: the other wiki reads hand it to a
		// handle lookup that ignores it, so sending it there would only widen
		// what the key's grant has to allow.
		if (matched.operation === "cite") {
			upstreamUrl.searchParams.set("agentId", env.agentId)
		}
		for (const [key, value] of forwarded) {
			upstreamUrl.searchParams.set(key, value)
		}
		init = {
			method: "GET",
			headers: {
				authorization: `Bearer ${env.readKey}`,
				accept: "application/json",
			},
		}
	}
	let response: Response
	try {
		response = await fetchImpl(upstreamUrl, init)
	} catch (error) {
		const raw =
			error instanceof Error
				? error.message
				: "the upstream could not be reached"
		return proxyError(502, "UPSTREAM_UNREACHABLE", redact(raw, env.readKey))
	}
	const body = redact(await response.text(), env.readKey)
	return new Response(body, {
		status: response.status,
		headers: {
			"content-type":
				response.headers.get("content-type") ?? "application/json",
		},
	})
}

function redact(text: string, secret: string): string {
	if (!secret) {
		return text
	}
	return text.split(secret).join("[redacted]")
}
