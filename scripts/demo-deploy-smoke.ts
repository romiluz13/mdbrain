// Deployed-stack smoke for the demo (ticket 17, decisions D23, D26, D28).
// Runs against the real deployed web and API origins and answers five
// questions:
//
//  1. D23(1) - the dedicated read key reads the pinned scope, and is refused
//     on a write and on another scope.
//  2. D23(2) - every public proxy refusal answers the fixed error envelope.
//  3. the F1 read-key gate - /v1/principal/self shows exactly one read-only
//     workspace grant, and the answer never echoes the key.
//  4. D28 - the edge rate rules block past their limits with 429.
//  5. the answer route - 415 non-JSON, 403 cross-site, and "off" while the
//     token ceiling is unset.
//
// The read key is only sent to the API origin (and its bearer form never to
// the web origin), never logged, and scrubbed from any answer that echoes it.

import { pathToFileURL } from "node:url"

/** Minimal fetch shape so tests can pass a fake without network access. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type DeploySmokeOptions = {
	/** Deployed demo web origin, e.g. https://demo.example.org (no trailing slash). */
	readonly web: string
	/** Deployed API origin that backs the demo reads. */
	readonly api: string
	/** Dedicated read-only API key created per D23(1). Never printed. */
	readonly readKey: string
	/** The pinned run's scopeRef, e.g. demo-run-12. */
	readonly scopeRef: string
	/** D28 edge limit for /api/demo/v1/* requests per minute per IP. */
	readonly v1Limit: number
	/** D28 edge limit for /api/demo/answers requests per minute per IP. */
	readonly answersLimit: number
	/** Skip the two edge rate-limit probes (small plans or manual runs). */
	readonly skipRate: boolean
}

export type SmokeResult = {
	readonly name: string
	readonly ok: boolean
	readonly detail: string
}

const REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_V1_LIMIT = 120
const DEFAULT_ANSWERS_LIMIT = 10
/** Probed "other" scope: run 0 predates the current demo slots. */
const OTHER_SCOPE_REF = "demo-run-0"

const USAGE = `usage (repo root): bun scripts/demo-deploy-smoke.ts --web <origin> --api <origin> (--key <read key> | DEMO_DEPLOY_READ_KEY) --scope-ref <pinned run>

  --v1-limit <n>       D28 edge limit on /api/demo/v1/* per minute (default 120)
  --answers-limit <n>  D28 edge limit on /api/demo/answers per minute (default 10)
  --skip-rate          skip the two edge rate-limit probes

The read key is only sent to the API origin and is never printed.`

function pass(name: string, detail: string): SmokeResult {
	return { name, ok: true, detail }
}

function fail(name: string, detail: string): SmokeResult {
	return { name, ok: false, detail }
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** One-line, capped body excerpt for failure details. */
function snippet(body: string): string {
	const flat = body.replace(/\s+/g, " ").trim()
	return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat
}

/** Removes every occurrence of the secret so details can never carry it. */
function redact(text: string, secret: string): string {
	return text.split(secret).join("[redacted]")
}

type FetchOutcome =
	| { ok: true; response: Response }
	| { ok: false; error: string }

async function fetchResponse(
	fetchImpl: FetchLike,
	url: string,
	init?: RequestInit,
): Promise<FetchOutcome> {
	try {
		const response = await fetchImpl(url, {
			...init,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		return { ok: true, response }
	} catch (error) {
		return { ok: false, error: errorMessage(error) }
	}
}

async function readBody(response: Response): Promise<string> {
	try {
		return await response.text()
	} catch {
		return "<no body>"
	}
}

function parseJson(body: string): unknown | undefined {
	try {
		return JSON.parse(body) as unknown
	} catch {
		return undefined
	}
}

/** The demo public error envelope: {"error":{"code","message"}} (D23(2)). */
function parseEnvelope(
	body: string,
): { code: string; message: string } | undefined {
	const parsed = parseJson(body)
	if (typeof parsed !== "object" || parsed === null) {
		return undefined
	}
	const error = (parsed as { error?: unknown }).error
	if (typeof error !== "object" || error === null) {
		return undefined
	}
	const { code, message } = error as { code?: unknown; message?: unknown }
	if (typeof code !== "string" || typeof message !== "string") {
		return undefined
	}
	return { code, message }
}

function bearer(readKey: string): Record<string, string> {
	return { authorization: `Bearer ${readKey}` }
}

// -- D23(1): the dedicated key reads the pinned scope ----------------------------------

export async function checkPinnedScopeRead(
	web: string,
	fetchImpl: FetchLike,
): Promise<SmokeResult> {
	const outcome = await fetchResponse(fetchImpl, `${web}/api/demo/v1/wiki`)
	if (!outcome.ok) {
		return fail(
			"pinned-scope read",
			`GET /api/demo/v1/wiki could not reach the demo web origin: ${outcome.error}`,
		)
	}
	const body = await readBody(outcome.response)
	if (outcome.response.status !== 200) {
		return fail(
			"pinned-scope read",
			`GET /api/demo/v1/wiki -> ${outcome.response.status} ${snippet(body)}`,
		)
	}
	if (parseJson(body) === undefined) {
		return fail(
			"pinned-scope read",
			`GET /api/demo/v1/wiki answered 200 with a non-JSON body: ${snippet(body)}`,
		)
	}
	return pass(
		"pinned-scope read",
		"GET /api/demo/v1/wiki -> 200 (pinned wiki list)",
	)
}

export async function checkRunRead(
	web: string,
	fetchImpl: FetchLike,
): Promise<SmokeResult> {
	const outcome = await fetchResponse(fetchImpl, `${web}/api/demo/v1/run`)
	if (!outcome.ok) {
		return fail(
			"run record read",
			`GET /api/demo/v1/run could not reach the demo web origin: ${outcome.error}`,
		)
	}
	const body = await readBody(outcome.response)
	if (outcome.response.status !== 200) {
		return fail(
			"run record read",
			`GET /api/demo/v1/run -> ${outcome.response.status} ${snippet(body)}`,
		)
	}
	if (parseJson(body) === undefined) {
		return fail(
			"run record read",
			`GET /api/demo/v1/run answered 200 with a non-JSON body: ${snippet(body)}`,
		)
	}
	return pass(
		"run record read",
		"GET /api/demo/v1/run -> 200 (pinned run record)",
	)
}

// -- D23(2): public refusals keep the fixed envelope ----------------------------------

export async function checkPublicEnvelope(
	web: string,
	fetchImpl: FetchLike,
): Promise<SmokeResult> {
	const probes = [
		{
			label: "unknown path",
			method: "GET",
			url: `${web}/api/demo/v1/no-such-operation`,
			status: 404,
			code: "UNKNOWN_OPERATION",
			message: "no demo read operation at /api/demo/v1/no-such-operation",
		},
		{
			label: "server-set parameter",
			method: "GET",
			url: `${web}/api/demo/v1/wiki?scope=workspace`,
			status: 400,
			code: "UNKNOWN_PARAMETER",
			message: "scope is set by the server and cannot come from the caller",
		},
		{
			label: "non-GET method",
			method: "POST",
			url: `${web}/api/demo/v1/wiki`,
			status: 405,
			code: "METHOD_NOT_ALLOWED",
			message: "the demo proxy only forwards GET reads",
		},
	] as const
	for (const probe of probes) {
		const outcome = await fetchResponse(fetchImpl, probe.url, {
			method: probe.method,
		})
		if (!outcome.ok) {
			return fail(
				"public error envelope",
				`${probe.label} probe could not reach the demo web origin: ${outcome.error}`,
			)
		}
		const body = await readBody(outcome.response)
		const envelope = parseEnvelope(body)
		if (
			outcome.response.status !== probe.status ||
			envelope === undefined ||
			envelope.code !== probe.code ||
			envelope.message !== probe.message
		) {
			return fail(
				"public error envelope",
				`${probe.label} probe: expected ${probe.status} ${probe.code} with the fixed message, ` +
					`got ${outcome.response.status} ${snippet(body)}`,
			)
		}
	}
	return pass(
		"public error envelope",
		"unknown path, server-set parameter and non-GET method all answer the fixed envelope",
	)
}

// -- F1 gate: the read key is exactly a reader of the pinned scope ---------------------

export async function checkPrincipalSelf(
	api: string,
	readKey: string,
	fetchImpl: FetchLike,
	expectedScopeRef?: string,
): Promise<SmokeResult> {
	const outcome = await fetchResponse(fetchImpl, `${api}/v1/principal/self`, {
		headers: bearer(readKey),
	})
	if (!outcome.ok) {
		return fail(
			"read-key gate",
			`GET /v1/principal/self could not reach the API origin: ${outcome.error}`,
		)
	}
	const body = await readBody(outcome.response)
	const shown = redact(snippet(body), readKey)
	if (body.includes(readKey)) {
		return fail(
			"read-key gate",
			`the principal answer echoed the read key: ${shown}`,
		)
	}
	if (outcome.response.status !== 200) {
		return fail(
			"read-key gate",
			`GET /v1/principal/self -> ${outcome.response.status} ${shown}`,
		)
	}
	const principal = parseJson(body)
	if (typeof principal !== "object" || principal === null) {
		return fail(
			"read-key gate",
			`the principal answer is not a JSON object: ${shown}`,
		)
	}
	const { subjectId, trustTier, capabilities, grants } = principal as {
		subjectId?: unknown
		trustTier?: unknown
		capabilities?: unknown
		grants?: unknown
	}
	if (typeof subjectId !== "string" || typeof trustTier !== "string") {
		return fail(
			"read-key gate",
			`the principal answer has no subjectId/trustTier: ${shown}`,
		)
	}
	if (trustTier !== "standard" && trustTier !== "restricted") {
		return fail(
			"read-key gate",
			`the read key resolves to trust tier ${JSON.stringify(trustTier)}, not standard or restricted`,
		)
	}
	if (
		!Array.isArray(capabilities) ||
		capabilities.length !== 1 ||
		capabilities[0] !== "read"
	) {
		return fail(
			"read-key gate",
			`the read key grants capabilities ${JSON.stringify(capabilities)}, not exactly ["read"]`,
		)
	}
	if (!Array.isArray(grants) || grants.length !== 1) {
		return fail(
			"read-key gate",
			`the read key carries ${Array.isArray(grants) ? grants.length : 0} grants, not exactly one`,
		)
	}
	const grant = grants[0] as { scope?: unknown; scopeRef?: unknown }
	if (grant.scope !== "workspace") {
		return fail(
			"read-key gate",
			`the read key's grant scope is ${JSON.stringify(grant.scope)}, not workspace`,
		)
	}
	if (expectedScopeRef !== undefined && grant.scopeRef !== expectedScopeRef) {
		return fail(
			"read-key gate",
			`the read key's grant covers ${JSON.stringify(grant.scopeRef)}, not the pinned ${expectedScopeRef}`,
		)
	}
	return pass(
		"read-key gate",
		`the key is a ${trustTier} reader with one workspace grant (subject ${subjectId})`,
	)
}

export async function checkWriteRefused(
	api: string,
	readKey: string,
	scopeRef: string,
	fetchImpl: FetchLike,
): Promise<SmokeResult> {
	const outcome = await fetchResponse(
		fetchImpl,
		`${api}/v1/wiki?scope=workspace&scopeRef=${encodeURIComponent(scopeRef)}`,
		{
			method: "POST",
			headers: {
				...bearer(readKey),
				"content-type": "application/json",
			},
			body: JSON.stringify({
				role: "write",
				body: "demo deploy smoke write probe; the API must refuse this",
			}),
		},
	)
	if (!outcome.ok) {
		return fail(
			"write refused",
			`POST /v1/wiki could not reach the API origin: ${outcome.error}`,
		)
	}
	const body = await readBody(outcome.response)
	const shown = redact(snippet(body), readKey)
	const envelope = parseEnvelope(body)
	if (
		outcome.response.status !== 403 ||
		envelope === undefined ||
		envelope.code !== "FORBIDDEN" ||
		envelope.message !== "capability is not allowed for this API key"
	) {
		return fail(
			"write refused",
			`POST /v1/wiki in the pinned scope -> ${outcome.response.status} ${shown}; ` +
				`expected 403 FORBIDDEN "capability is not allowed for this API key"`,
		)
	}
	return pass(
		"write refused",
		"the write in the pinned scope is refused (FORBIDDEN, capability)",
	)
}

export async function checkOtherScopeRefused(
	api: string,
	readKey: string,
	fetchImpl: FetchLike,
): Promise<SmokeResult> {
	const outcome = await fetchResponse(
		fetchImpl,
		`${api}/v1/wiki?scope=workspace&scopeRef=${OTHER_SCOPE_REF}`,
		{ headers: bearer(readKey) },
	)
	if (!outcome.ok) {
		return fail(
			"other scope refused",
			`GET /v1/wiki could not reach the API origin: ${outcome.error}`,
		)
	}
	const body = await readBody(outcome.response)
	const shown = redact(snippet(body), readKey)
	const envelope = parseEnvelope(body)
	if (
		outcome.response.status !== 403 ||
		envelope === undefined ||
		envelope.code !== "FORBIDDEN" ||
		envelope.message !== "scope and scopeRef are not allowed for this API key"
	) {
		return fail(
			"other scope refused",
			`GET /v1/wiki in workspace ${OTHER_SCOPE_REF} -> ${outcome.response.status} ${shown}; ` +
				`expected 403 FORBIDDEN "scope and scopeRef are not allowed for this API key"`,
		)
	}
	return pass(
		"other scope refused",
		`the other scope (workspace ${OTHER_SCOPE_REF}) is refused (FORBIDDEN, scope)`,
	)
}

// -- the answer route guards and off state ----------------------------------------------

export async function checkAnswerGuards(
	web: string,
	fetchImpl: FetchLike,
): Promise<SmokeResult> {
	const outcome = await fetchResponse(fetchImpl, `${web}/api/demo/answers`, {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: "deploy smoke probe",
	})
	if (!outcome.ok) {
		return fail(
			"answer route guards",
			`POST /api/demo/answers could not reach the demo web origin: ${outcome.error}`,
		)
	}
	const body = await readBody(outcome.response)
	const media = parseEnvelope(body)
	if (
		outcome.response.status !== 415 ||
		media?.code !== "ANSWER_UNSUPPORTED_MEDIA"
	) {
		return fail(
			"answer route guards",
			`the text/plain probe -> ${outcome.response.status} ${snippet(body)}; ` +
				`expected 415 ANSWER_UNSUPPORTED_MEDIA`,
		)
	}
	const cross = await fetchResponse(fetchImpl, `${web}/api/demo/answers`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"sec-fetch-site": "cross-site",
		},
		body: JSON.stringify({ question: "deploy smoke probe" }),
	})
	if (!cross.ok) {
		return fail(
			"answer route guards",
			`the cross-site probe could not reach the demo web origin: ${cross.error}`,
		)
	}
	const crossBody = await readBody(cross.response)
	const crossEnvelope = parseEnvelope(crossBody)
	if (
		cross.response.status !== 403 ||
		crossEnvelope?.code !== "ANSWER_CROSS_SITE"
	) {
		return fail(
			"answer route guards",
			`the cross-site probe -> ${cross.response.status} ${snippet(crossBody)}; ` +
				`expected 403 ANSWER_CROSS_SITE`,
		)
	}
	const off = await fetchResponse(fetchImpl, `${web}/api/demo/answers`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ question: "deploy smoke probe" }),
	})
	if (!off.ok) {
		return fail(
			"answer route guards",
			`the lane probe could not reach the demo web origin: ${off.error}`,
		)
	}
	const offBody = await readBody(off.response)
	if (off.response.status === 503) {
		const notConfigured = parseEnvelope(offBody)
		return fail(
			"answer route guards",
			`the answer route is not configured on the server (503 ` +
				`${notConfigured?.code ?? "no envelope"}); run the smoke after the answer lane is configured`,
		)
	}
	const offState = parseJson(offBody)
	const state =
		typeof offState === "object" && offState !== null
			? (offState as { state?: unknown }).state
			: undefined
	if (off.response.status !== 200 || state !== "off") {
		return fail(
			"answer route guards",
			`the lane probe -> ${off.response.status} ${snippet(offBody)}; ` +
				`expected 200 {"state":"off"} (run the smoke before the token ceiling is enabled)`,
		)
	}
	return pass(
		"answer route guards",
		"415 on non-JSON, 403 on cross-site, and the lane answers off",
	)
}

// -- D28: the edge rate rules block past their limits -----------------------------------

export type RateProbe = {
	readonly name: string
	readonly path: string
	readonly method: "GET" | "POST"
	readonly contentType?: string
	readonly body?: string
	readonly limit: number
	/** Extra requests beyond the limit before giving up on the 429. */
	readonly headroom: number
}

export async function checkEdgeRateLimit(
	web: string,
	fetchImpl: FetchLike,
	probe: RateProbe,
): Promise<SmokeResult> {
	const url = `${web}${probe.path}`
	const maxRequests = probe.limit + probe.headroom
	let lastStatus = 0
	let lastBody = ""
	for (let attempt = 1; attempt <= maxRequests; attempt++) {
		const init: RequestInit = { method: probe.method }
		if (probe.contentType !== undefined) {
			init.headers = { "content-type": probe.contentType }
		}
		if (probe.body !== undefined) {
			init.body = probe.body
		}
		const outcome = await fetchResponse(fetchImpl, url, init)
		if (!outcome.ok) {
			return fail(
				probe.name,
				`request ${attempt} to ${probe.path} could not reach the demo web origin: ${outcome.error}`,
			)
		}
		lastStatus = outcome.response.status
		lastBody = await readBody(outcome.response)
		if (lastStatus === 429) {
			return pass(
				probe.name,
				`the edge blocked request ${attempt} to ${probe.path} with 429 (limit ${probe.limit}/min)`,
			)
		}
	}
	return fail(
		probe.name,
		`no 429 arrived within ${maxRequests} requests to ${probe.path}; ` +
			`the last answer was ${lastStatus} ${snippet(lastBody)}`,
	)
}

// -- the whole smoke --------------------------------------------------------------------

export async function runDeploySmoke(
	options: DeploySmokeOptions,
	fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<SmokeResult[]> {
	const results: SmokeResult[] = [
		await checkPinnedScopeRead(options.web, fetchImpl),
		await checkRunRead(options.web, fetchImpl),
		await checkPublicEnvelope(options.web, fetchImpl),
		await checkPrincipalSelf(
			options.api,
			options.readKey,
			fetchImpl,
			options.scopeRef,
		),
		await checkWriteRefused(
			options.api,
			options.readKey,
			options.scopeRef,
			fetchImpl,
		),
		await checkOtherScopeRefused(options.api, options.readKey, fetchImpl),
		await checkAnswerGuards(options.web, fetchImpl),
	]
	if (!options.skipRate) {
		results.push(
			await checkEdgeRateLimit(options.web, fetchImpl, {
				name: "answers rate limit",
				path: "/api/demo/answers",
				method: "POST",
				contentType: "text/plain",
				body: "deploy smoke rate probe",
				limit: options.answersLimit,
				headroom: 20,
			}),
			await checkEdgeRateLimit(options.web, fetchImpl, {
				name: "v1 reads rate limit",
				path: "/api/demo/v1/no-such-operation",
				method: "GET",
				limit: options.v1Limit,
				headroom: 60,
			}),
		)
	}
	return results
}

function readFlag(
	flags: Map<string, string>,
	flag: string,
): string | undefined {
	return flags.get(flag)
}

function parseLimit(
	flags: Map<string, string>,
	flag: string,
	fallback: number,
): number | undefined {
	const raw = flags.get(flag)
	if (raw === undefined) {
		return fallback
	}
	const value = Number(raw)
	if (!Number.isInteger(value) || value <= 0) {
		return undefined
	}
	return value
}

function httpOrigin(raw: string | undefined, flag: string): string | undefined {
	if (raw === undefined) {
		return undefined
	}
	if (!/^https?:\/\//.test(raw)) {
		return undefined
	}
	return raw.replace(/\/+$/, "")
}

export function parseDeploySmokeArgs(
	argv: string[],
	env: Record<string, string | undefined>,
): DeploySmokeOptions | { error: string } {
	const flags = new Map<string, string>()
	let skipRate = false
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? ""
		if (arg === "--skip-rate") {
			skipRate = true
			continue
		}
		const value = argv[index + 1]
		if (value === undefined) {
			return { error: `flag ${arg} needs a value` }
		}
		flags.set(arg, value)
		index++
	}
	const web = httpOrigin(readFlag(flags, "--web"), "--web")
	if (web === undefined) {
		if (!flags.has("--web")) {
			return {
				error:
					"usage: --web <origin> is required (the deployed demo web origin)",
			}
		}
		return {
			error: "usage: the --web origin must start with http:// or https://",
		}
	}
	const api = httpOrigin(readFlag(flags, "--api"), "--api")
	if (api === undefined) {
		if (!flags.has("--api")) {
			return {
				error: "usage: --api <origin> is required (the deployed API origin)",
			}
		}
		return {
			error: "usage: the --api origin must start with http:// or https://",
		}
	}
	const readKey = readFlag(flags, "--key") ?? env.DEMO_DEPLOY_READ_KEY
	if (readKey === undefined || readKey === "") {
		return {
			error:
				"usage: --key <read key> or DEMO_DEPLOY_READ_KEY is required (D23(1) read key)",
		}
	}
	const scopeRef = readFlag(flags, "--scope-ref")
	if (scopeRef === undefined || scopeRef === "") {
		return {
			error: "usage: --scope-ref <pinned run> is required (e.g. demo-run-12)",
		}
	}
	const v1Limit = parseLimit(flags, "--v1-limit", DEFAULT_V1_LIMIT)
	if (v1Limit === undefined) {
		return {
			error:
				"usage: --v1-limit must be a positive integer (requests per minute)",
		}
	}
	const answersLimit = parseLimit(
		flags,
		"--answers-limit",
		DEFAULT_ANSWERS_LIMIT,
	)
	if (answersLimit === undefined) {
		return {
			error:
				"usage: --answers-limit must be a positive integer (requests per minute)",
		}
	}
	return { web, api, readKey, scopeRef, v1Limit, answersLimit, skipRate }
}

async function main(): Promise<number> {
	const parsed = parseDeploySmokeArgs(process.argv.slice(2), process.env)
	if ("error" in parsed) {
		console.error(parsed.error)
		console.error(USAGE)
		return 2
	}
	console.error(
		`demo deploy smoke: web ${parsed.web}, api ${parsed.api}, scopeRef ${parsed.scopeRef}` +
			`${parsed.skipRate ? " (rate probes skipped)" : ""}`,
	)
	const results = await runDeploySmoke(parsed)
	let failures = 0
	for (const result of results) {
		if (result.ok) {
			console.log(`ok   ${result.name}: ${result.detail}`)
		} else {
			console.error(`FAIL ${result.name}: ${result.detail}`)
			failures++
		}
	}
	console.error(
		failures === 0
			? "demo deploy smoke: all checks passed"
			: `demo deploy smoke: ${failures} of ${results.length} checks failed`,
	)
	return failures === 0 ? 0 : 1
}

if (
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	void main().then((code) => {
		process.exit(code)
	})
}
