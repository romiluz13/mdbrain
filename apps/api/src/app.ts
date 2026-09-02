import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import type { MemoryScope } from "@mdbrain/lib"
import { mdbrainBridgeCheckReadiness } from "@mdbrain/memory-bridge"
import type { ApiEnvironment, AuthorizedRequestScope } from "./api-context.js"
import { openApiSpec } from "./openapi-spec.js"
import {
	authorizePrincipalRequest,
	createDevelopmentPrincipal,
	parseScopedApiKeyPolicies,
	resolveBearerPrincipal,
	timingSafeBearerEquals,
	type ApiPrincipal,
	type PrincipalCapability,
} from "./principal.js"
import { createV1Router } from "./routes/v1.js"
import { checkWikiStoreReadiness } from "./wiki-store-runtime.js"

let unauthenticatedApiWarningEmitted = false
const MEMORY_SCOPES = new Set<MemoryScope>([
	"session",
	"user",
	"agent",
	"workspace",
	"tenant",
	"global",
])
const SCOPE_VALIDATION_MESSAGE =
	"scope must be session|user|agent|workspace|tenant|global"
const READINESS_CACHE_MS = 1_000
const MEMONGO_READINESS_DEPENDENCIES = new Set([
	"contract",
	"retrieval",
	"control",
	"embedding",
	"vector",
])

export { parseScopedApiKeyPolicies, timingSafeBearerEquals }

export function resetUnauthenticatedApiWarningForTests(): void {
	unauthenticatedApiWarningEmitted = false
}

function memongoReadinessDependency(error: unknown): string {
	if (!error || typeof error !== "object") return "memongo"
	const dependency = Reflect.get(error, "dependency")
	return typeof dependency === "string" &&
		MEMONGO_READINESS_DEPENDENCIES.has(dependency)
		? `memongo.${dependency}`
		: "memongo"
}

async function checkReadinessDependencies() {
	return Promise.allSettled([
		mdbrainBridgeCheckReadiness(),
		checkWikiStoreReadiness(),
	])
}

async function readRequestScopeInput(
	c: Context<ApiEnvironment>,
): Promise<Record<string, unknown>> {
	const query = c.req.query() as Record<string, unknown>
	if (c.req.method === "GET" || c.req.method === "HEAD") {
		return query
	}
	const contentType = c.req.header("Content-Type") ?? ""
	if (!contentType.toLowerCase().includes("application/json")) {
		return query
	}
	const body = (await c.req.raw
		.clone()
		.json()
		.catch(() => ({}))) as unknown
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return query
	}
	return {
		...(body as Record<string, unknown>),
		requestQuery: query,
	}
}

function stringFieldValues(
	input: Record<string, unknown>,
	field: string,
	includeEmpty = false,
): string[] {
	const containers = [
		input,
		input.handle,
		input.entry,
		input.memory,
		input.params,
		input.requestQuery,
	].filter(
		(item): item is Record<string, unknown> =>
			!!item && typeof item === "object" && !Array.isArray(item),
	)
	const values = new Set<string>()
	for (const container of containers) {
		const value = container[field]
		if (typeof value === "string" && (includeEmpty || value.trim())) {
			values.add(value.trim())
		}
	}
	return [...values]
}

function isMemoryScope(value: string): value is MemoryScope {
	return MEMORY_SCOPES.has(value as MemoryScope)
}

async function authorizeScopedApiKey(
	c: Context<ApiEnvironment>,
	principal: ApiPrincipal,
): Promise<{
	forbidden: string | null
	validationError: string | null
	requestScope: AuthorizedRequestScope
}> {
	const input = await readRequestScopeInput(c)
	const agentIds = stringFieldValues(input, "agentId")
	const scopes = stringFieldValues(input, "scope", true)
	const explicitScopeRefs = stringFieldValues(input, "scopeRef")
	const scopeRefs =
		explicitScopeRefs.length > 0
			? explicitScopeRefs
			: stringFieldValues(input, "containerTag")
	const scope = scopes[0]
	const requestScope: AuthorizedRequestScope = {
		...(agentIds[0] ? { agentId: agentIds[0] } : {}),
		...(scope && isMemoryScope(scope) ? { scope } : {}),
		...(scopeRefs[0] ? { scopeRef: scopeRefs[0] } : {}),
	}
	const conflict =
		agentIds.length > 1
			? "conflicting agentId values are not allowed"
			: scopes.length > 1
				? "conflicting scope values are not allowed"
				: scopeRefs.length > 1
					? "conflicting scopeRef values are not allowed"
					: null
	return {
		requestScope,
		validationError:
			scope !== undefined && !isMemoryScope(scope)
				? SCOPE_VALIDATION_MESSAGE
				: null,
		forbidden:
			conflict ??
			authorizePrincipalRequest(principal, {
				...requestScope,
				capability: requiredCapability(c),
			}),
	}
}

const READ_POST_PATHS = new Set([
	"/v1/search",
	"/v1/search-kb",
	"/v1/recall-conversation",
	"/v1/lifecycle/get",
	"/v1/lifecycle/history",
	"/v1/search-detailed",
	"/v1/hydrate-active-slate",
	"/v1/discovery-projection",
	"/v1/context-bundle",
	"/v1/profile",
	"/v1/wiki/search",
])

const WRITE_POST_PATHS = new Set([
	"/v1/lifecycle/update",
	"/v1/procedures/outcome",
	"/v1/memory/feedback",
	"/v1/add",
	"/v1/write-event",
	"/v1/extract",
	"/v1/write-structured",
	"/v1/write-procedure",
	"/v1/wiki",
	"/v1/wiki/okf-import",
])

function requiredCapability(c: Context<ApiEnvironment>): PrincipalCapability {
	const path = c.req.path
	if (path.startsWith("/v1/admin/")) {
		return "administer"
	}
	if (path === "/v1/wiki/okf-export") return "export"
	if (
		path === "/v1/lifecycle/delete" ||
		(c.req.method === "DELETE" && c.req.query("hard") === "true")
	) {
		return "hard-delete"
	}
	if (c.req.method === "GET" || c.req.method === "HEAD") return "read"
	if (c.req.method === "PATCH" || c.req.method === "DELETE") return "write"
	if (READ_POST_PATHS.has(path)) return "read"
	if (WRITE_POST_PATHS.has(path)) return "write"
	return "administer"
}

/**
 * Graceful shutdown: Process-level graceful shutdown orchestrator.
 *
 * Registers listeners for SIGTERM / SIGINT that:
 *  1. Stop accepting new HTTP connections (`closeServer`).
 *  2. Close the remote memory gateway and independent wiki store.
 *  3. Call `exit(0)` when both succeed, or `exit(1)` if the timeout elapses
 *     first — never block the container runtime's kill window indefinitely.
 *
 * Server and bridge close are awaited in sequence (server first, so no new
 * requests land while the bridge is shutting down). The function accepts
 * the process and an `exit` function as injected dependencies so the test
 * suite can drive it without actually exiting.
 */
export type GracefulShutdownOptions = {
	signals: readonly NodeJS.Signals[]
	process: NodeJS.Process
	closeServer: () => Promise<void>
	closeBridge: () => Promise<void>
	exit: (code: number) => void
	/** Hard deadline for the full shutdown sequence before force-exit. */
	timeoutMs?: number
}

export function registerGracefulShutdown(
	options: GracefulShutdownOptions,
): void {
	const {
		signals,
		process: proc,
		closeServer,
		closeBridge,
		exit,
		timeoutMs = 10_000,
	} = options
	let shuttingDown = false

	const runShutdown = (signal: NodeJS.Signals): void => {
		if (shuttingDown) {
			return
		}
		shuttingDown = true

		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			// Cannot wait any longer — exit non-zero so orchestrators know we
			// shed work under duress instead of exiting cleanly.
			try {
				exit(1)
			} catch {
				// exit() may be a stub; ignore.
			}
		}, timeoutMs)
		// setTimeout handles have .unref() in Node — do not hold the event loop.
		if (
			typeof (timer as unknown as { unref?: () => void }).unref === "function"
		) {
			;(timer as unknown as { unref: () => void }).unref()
		}

		;(async () => {
			try {
				await closeServer()
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				console.error(`graceful shutdown: closeServer failed: ${msg}`)
			}
			try {
				await closeBridge()
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				console.error(`graceful shutdown: closeBridge failed: ${msg}`)
			}
			if (timedOut) {
				return
			}
			clearTimeout(timer)
			try {
				exit(0)
			} catch {
				// exit() may be a stub; ignore.
			}
			void signal // marker — signal identity recorded via the event only
		})()
	}

	for (const signal of signals) {
		proc.on(signal, () => runShutdown(signal))
	}
}

export function createApp(): Hono<ApiEnvironment> {
	const app = new Hono<ApiEnvironment>()
	let readinessCache:
		| {
				expiresAt: number
				result: Awaited<ReturnType<typeof checkReadinessDependencies>>
		  }
		| undefined
	let readinessInFlight:
		| ReturnType<typeof checkReadinessDependencies>
		| undefined
	const loadReadiness = () => {
		const now = Date.now()
		if (readinessCache && readinessCache.expiresAt > now) {
			return Promise.resolve(readinessCache.result)
		}
		if (!readinessInFlight) {
			readinessInFlight = checkReadinessDependencies()
				.then((result) => {
					readinessCache = {
						expiresAt: Date.now() + READINESS_CACHE_MS,
						result,
					}
					return result
				})
				.finally(() => {
					readinessInFlight = undefined
				})
		}
		return readinessInFlight
	}

	const corsOrigins = process.env.MDBRAIN_API_CORS_ORIGINS?.trim()
	app.use(
		"/*",
		cors(
			corsOrigins
				? { origin: corsOrigins.split(",").map((o) => o.trim()) }
				: {},
		),
	)

	app.use("/v1/*", async (c, next) => {
		if (c.req.method !== "GET" && c.req.method !== "HEAD") {
			const contentType = c.req.header("Content-Type")
			const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
			const hasBody = c.req.raw.body !== null
			if ((hasBody || mediaType) && mediaType !== "application/json") {
				return c.json(
					{
						error: {
							code: "UNSUPPORTED_MEDIA_TYPE",
							message: "Content-Type must be application/json",
						},
					},
					415,
				)
			}
		}
		await next()
	})

	// Simple in-memory rate limiter (per-IP, sliding window).
	// No external deps — sufficient for single-instance dev/small-scale deploy.
	// Configure via MDBRAIN_API_RATE_LIMIT_MAX (default 100) and
	// MDBRAIN_API_RATE_LIMIT_WINDOW_MS (default 60000). Set MAX=0 to disable.
	// IP resolution: when MDBRAIN_API_TRUST_PROXY=true, trusts X-Forwarded-For
	// (for deployments behind a reverse proxy that overwrites the header).
	// Default: uses x-real-ip or "unknown" — does NOT trust X-Forwarded-For
	// to prevent header-spoofing bypass of the rate limit.
	const rateLimitWindowMs = Number(
		process.env.MDBRAIN_API_RATE_LIMIT_WINDOW_MS ?? 60_000,
	)
	const rateLimitMax = Number(process.env.MDBRAIN_API_RATE_LIMIT_MAX ?? 100)
	const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

	app.use("/v1/*", async (c, next) => {
		if (rateLimitMax <= 0) {
			await next()
			return
		}
		const trustProxy = process.env.MDBRAIN_API_TRUST_PROXY === "true"
		const ip = trustProxy
			? (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
				c.req.header("x-real-ip") ??
				"unknown")
			: (c.req.header("x-real-ip") ?? "unknown")
		const now = Date.now()
		const entry = rateLimitMap.get(ip)
		if (!entry || now > entry.resetAt) {
			rateLimitMap.set(ip, { count: 1, resetAt: now + rateLimitWindowMs })
			await next()
			return
		}
		entry.count++
		if (entry.count > rateLimitMax) {
			c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)))
			return c.json(
				{
					error: {
						code: "RATE_LIMITED",
						message: "Rate limit exceeded. Try again later.",
					},
				},
				429,
			)
		}
		await next()
	})

	const token = process.env.MDBRAIN_API_KEY?.trim()
	const scopedCredentials = parseScopedApiKeyPolicies()
	if (token && scopedCredentials.some((c) => c.token === token)) {
		throw new Error(
			"MDBRAIN_API_KEY duplicates a scoped API key token; tokens must be unique",
		)
	}
	if (token || scopedCredentials.length > 0) {
		app.use("/v1/*", async (c, next) => {
			const auth = c.req.header("Authorization") ?? ""
			const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : ""
			const principal = resolveBearerPrincipal({
				bearer,
				adminToken: token,
				adminSubjectId:
					process.env.MDBRAIN_API_ADMIN_SUBJECT_ID?.trim() || undefined,
				scopedCredentials,
			})
			if (!principal) {
				return c.json(
					{ error: { code: "UNAUTHORIZED", message: "unauthorized" } },
					401,
				)
			}
			const { forbidden, validationError, requestScope } =
				await authorizeScopedApiKey(c, principal)
			if (validationError) {
				return c.json(
					{
						error: {
							code: "VALIDATION_ERROR",
							message: validationError,
						},
					},
					400,
				)
			}
			if (forbidden) {
				return c.json({ error: { code: "FORBIDDEN", message: forbidden } }, 403)
			}
			c.set("principal", principal)
			c.set("authorizedRequestScope", requestScope)
			await next()
		})
	} else {
		const isProduction =
			process.env.NODE_ENV === "production" ||
			process.env.MDBRAIN_ENV === "production"
		if (isProduction) {
			throw new Error(
				"MDBRAIN_API_KEY is not set and MDBRAIN_API_SCOPED_KEYS is empty. Refusing to start in production mode with unauthenticated /v1 routes. Set MDBRAIN_API_KEY or MDBRAIN_API_SCOPED_KEYS, or set NODE_ENV=development.",
			)
		}
		// Fail-open development access is opt-in: staging/preview/QA or an
		// unset environment must not silently install a full-capability
		// principal just because the env is not named exactly "production".
		if (process.env.MDBRAIN_ALLOW_DEV_PRINCIPAL !== "1") {
			throw new Error(
				"MDBRAIN_API_KEY is not set and MDBRAIN_API_SCOPED_KEYS is empty, and the unauthenticated development principal is not explicitly allowed. Set MDBRAIN_API_KEY, set MDBRAIN_API_SCOPED_KEYS, or opt in to the development principal with MDBRAIN_ALLOW_DEV_PRINCIPAL=1 for trusted local development only.",
			)
		}
		if (!unauthenticatedApiWarningEmitted) {
			unauthenticatedApiWarningEmitted = true
			console.warn(
				"WARNING: MDBRAIN_ALLOW_DEV_PRINCIPAL=1 is set with no MDBRAIN_API_KEY and empty MDBRAIN_API_SCOPED_KEYS; /v1 routes run as the unauthenticated development principal. Use only for trusted local development.",
			)
		}
	}
	if (!token && scopedCredentials.length === 0) {
		app.use("/v1/*", async (c, next) => {
			const principal = createDevelopmentPrincipal()
			const { forbidden, validationError, requestScope } =
				await authorizeScopedApiKey(c, principal)
			if (validationError) {
				return c.json(
					{
						error: {
							code: "VALIDATION_ERROR",
							message: validationError,
						},
					},
					400,
				)
			}
			if (forbidden) {
				return c.json({ error: { code: "FORBIDDEN", message: forbidden } }, 403)
			}
			c.set("principal", principal)
			c.set("authorizedRequestScope", requestScope)
			await next()
		})
	}

	app.get("/health", (c) => c.json({ ok: true, service: "mdbrain-api" }))
	app.get("/ready", async (c) => {
		const [memongo, wiki] = await loadReadiness()
		const dependencies = [
			...(memongo.status === "rejected"
				? [memongoReadinessDependency(memongo.reason)]
				: []),
			...(wiki.status === "rejected" ? ["wiki"] : []),
		]
		if (memongo.status === "rejected" || wiki.status === "rejected") {
			return c.json(
				{
					ok: false,
					service: "mdbrain-api",
					error: {
						code: "DEPENDENCY_NOT_READY",
						message: "Memongo or the wiki store is not ready",
						dependencies,
					},
				},
				503,
			)
		}
		return c.json({
			ok: true,
			service: "mdbrain-api",
			memongo: memongo.value,
			wiki: wiki.value,
		})
	})
	app.get("/openapi.json", (c) => c.json(openApiSpec))
	app.route("/v1", createV1Router())

	return app
}
