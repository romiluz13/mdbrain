// Server-side read proxy for the /demo data layer (ticket 12, part 1).
//
// One place translates demo reads into a fixed allowlist of upstream API
// reads. The read key, the scope and the scopeRef live only in server
// environment variables; the caller can never set or see them. Everything
// outside the allowlist - other methods, writes, admin routes, principal
// parameters from the caller, unknown or repeated parameters, unsafe path
// segments - is refused before any upstream call is made.

import { parseCitationMarker } from "@mdbrain/client"

export interface DemoProxyEnv {
	apiBaseUrl: string
	readKey: string
	scope: string
	scopeRef: string
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
]

/** Principal-naming parameters. The server sets these from its own env; a
 * caller passing any of them - even the pinned value - is refused. */
export const DEMO_PROXY_FORBIDDEN_PARAMS: readonly string[] = [
	"scope",
	"scopeRef",
	"agentId",
	"containerTag",
]

// Slug segments that answer as GET sub-routes upstream (mirrors
// WIKI_RESERVED_SLUG_SEGMENTS in the API) plus the OKF interchange route
// names, which are POST routes and never demo pages.
const RESERVED_PAGE_SLUGS: readonly string[] = [
	"lint",
	"revisions",
	"overview",
	"changes",
	"okf-import",
	"okf-export",
]

const SCOPE_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/
const CURSOR_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/

/** Reads the proxy's server-only env. Returns null when any variable is
 * missing or malformed; the route answers 503 in that case. */
export function readDemoProxyEnv(
	env: Record<string, string | undefined>,
): DemoProxyEnv | null {
	const apiBaseUrl = (env.MDBRAIN_DEMO_API_BASE_URL ?? "").trim()
	const readKey = env.MDBRAIN_DEMO_READ_KEY ?? ""
	const scopeRef = (env.MDBRAIN_DEMO_SCOPE_REF ?? "").trim()
	const scope = (env.MDBRAIN_DEMO_SCOPE ?? "").trim() || "workspace"
	if (!apiBaseUrl || !readKey || !scopeRef) {
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
	if (!SCOPE_REF_PATTERN.test(scopeRef) || !SCOPE_REF_PATTERN.test(scope)) {
		return null
	}
	return {
		apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
		readKey,
		scope,
		scopeRef,
	}
}

type ParamSpec =
	| { kind: "int"; min: number; max: number }
	| { kind: "enum"; values: readonly string[] }
	| { kind: "token" }
	| { kind: "cursor" }
	| { kind: "datetime" }
	| { kind: "citation"; markerKind: "event" | "wiki" }

type QuerySpec = {
	required?: Record<string, ParamSpec>
	optional?: Record<string, ParamSpec>
}

type MatchedOperation = {
	operation: string
	upstreamPath: string
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

/** Maps decoded path segments after /api/demo/v1 to one allowlisted upstream
 * read, or null when nothing matches. */
function matchOperation(segments: string[]): MatchedOperation | null {
	const [first, second, third] = segments
	if (segments.length === 1 && first === "wiki") {
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
	if (segments.length === 2 && first === "wiki") {
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
		if (RESERVED_PAGE_SLUGS.includes(second)) {
			return null
		}
		return {
			operation: "wiki-page",
			upstreamPath: `/v1/wiki/${encodeURIComponent(second)}`,
			query: {
				optional: {
					kind: TOKEN,
					format: enumSpec(["json"]),
					transclude: enumSpec(["true", "false"]),
				},
			},
		}
	}
	if (segments.length === 3 && first === "wiki" && second === "overview") {
		return {
			operation: "wiki-overview",
			upstreamPath: `/v1/wiki/overview/${encodeURIComponent(third)}`,
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
	if (segments.length === 1 && first === "cite") {
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
	return null
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
	const rawSegments = url.pathname
		.split("/")
		.filter((segment) => segment !== "")
	if (
		rawSegments.length < 3 ||
		rawSegments[0] !== "api" ||
		rawSegments[1] !== "demo" ||
		rawSegments[2] !== "v1"
	) {
		return proxyError(404, "UNKNOWN_OPERATION", "no demo read operation here")
	}
	const segments: string[] = []
	for (const raw of rawSegments.slice(3)) {
		let decoded: string
		try {
			decoded = decodeURIComponent(raw)
		} catch {
			return proxyError(
				400,
				"UNSAFE_PATH",
				"path segment has invalid percent-encoding",
			)
		}
		if (!isSafeSegment(decoded)) {
			return proxyError(400, "UNSAFE_PATH", "path segment is not safe")
		}
		segments.push(decoded)
	}
	const matched = matchOperation(segments)
	if (!matched) {
		return proxyError(
			404,
			"UNKNOWN_OPERATION",
			`no demo read operation at ${url.pathname}`,
		)
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
	const upstreamUrl = new URL(`${env.apiBaseUrl}${matched.upstreamPath}`)
	upstreamUrl.searchParams.set("scope", env.scope)
	upstreamUrl.searchParams.set("scopeRef", env.scopeRef)
	for (const [key, value] of forwarded) {
		upstreamUrl.searchParams.set(key, value)
	}
	let response: Response
	try {
		response = await fetchImpl(upstreamUrl, {
			method: "GET",
			headers: {
				authorization: `Bearer ${env.readKey}`,
				accept: "application/json",
			},
		})
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
