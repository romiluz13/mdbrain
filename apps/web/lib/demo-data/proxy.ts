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

import {
	proxyError,
	unreachableResponse,
	upstreamFailureResponse,
} from "./proxy-errors.js"
import { decodeSlug, matchOperation, validateParam } from "./proxy-routes.js"
import { handleDemoRunRead, isRunPath, type RunReadDeps } from "./proxy-run.js"

export interface DemoProxyEnv {
	apiBaseUrl: string
	readKey: string
	scope: string
	scopeRef: string
	/** The agent the pinned run's events were written under. An event citation
	 * resolves the event in this agent's scope. */
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
	// The pinned run's own record: read from the control database by the
	// server, not forwarded. See ./proxy-run.ts.
	{
		operation: "run-record",
		upstream: "findOne, control database",
		chapter: "sources and agents",
	},
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

const SCOPE_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
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

/** Handles one demo read request against the given env. `fetchImpl` is
 * injectable so tests and the live check can observe or redirect the
 * upstream call. Never logs; the read key appears in no output. */
export async function handleDemoRead(
	request: Request,
	env: DemoProxyEnv,
	fetchImpl: typeof fetch,
	run?: RunReadDeps,
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
	if (isRunPath(pathname)) {
		return handleDemoRunRead(
			request,
			env,
			run ?? { run: null, manifest: async () => null },
		)
	}
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
	// A failure while the body is still being read is as unreachable as one
	// before the answer: no transport text may reach the browser from either.
	try {
		const response = await fetchImpl(upstreamUrl, init)
		if (!response.ok) {
			return await upstreamFailureResponse(response)
		}
		const body = redact(await response.text(), env.readKey)
		return new Response(body, {
			status: response.status,
			headers: {
				"content-type":
					response.headers.get("content-type") ?? "application/json",
			},
		})
	} catch {
		return unreachableResponse()
	}
}

function redact(text: string, secret: string): string {
	if (!secret) {
		return text
	}
	return text.split(secret).join("[redacted]")
}
