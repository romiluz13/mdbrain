// The two reads of the pinned run that no API route serves: its record, from
// the demo control database, and the confirmation of one agent step, through
// governed recall. Both are fixed paths the proxy owns. The browser names no
// run, no filter and no query text: the run is pinned by server env, and a step
// is named by its number alone, its recall query built here from the stored
// manifest entry.

import {
	proxyError,
	unreachableResponse,
	upstreamFailureResponse,
} from "./proxy-errors.js"
import type { DemoProxyEnv } from "./proxy.js"
import {
	AGENT_ROLE_LABELS,
	projectRunRecord,
	type AgentStep,
	type RunProjection,
} from "./run-record.js"

export interface DemoRunEnv {
	/** The control database's connection string. It stays on the server. */
	controlUri: string
	runId: string
}

/** Reads the stored manifest of one run by its id, or null when there is none. */
export type RunManifestSource = (runId: string) => Promise<unknown | null>

export interface RunReadDeps {
	run: DemoRunEnv | null
	manifest: RunManifestSource
}

export const RUN_PATH = "/api/demo/v1/run"
const STEP_PATH = `${RUN_PATH}/step`

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MONGO_URI_PATTERN = /^mongodb(\+srv)?:\/\/\S+$/
const STEP_NUMBER_PATTERN = /^[1-9]\d{0,3}$/
const RECALL_RESULTS = 10
const STEP_TEXT_MAX = 400

/** Reads the run read's server-only env. Null when either value is missing or
 * malformed; the run paths then answer "not configured" and nothing else
 * changes. */
export function readDemoRunEnv(
	env: Record<string, string | undefined>,
): DemoRunEnv | null {
	const controlUri = (env.MDBRAIN_DEMO_CONTROL_URI ?? "").trim()
	const runId = (env.MDBRAIN_DEMO_RUN_ID ?? "").trim()
	if (!MONGO_URI_PATTERN.test(controlUri) || !ID_PATTERN.test(runId)) {
		return null
	}
	return { controlUri, runId }
}

export function isRunPath(pathname: string): boolean {
	const path = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
	return path === RUN_PATH || path === STEP_PATH
}

const json = (body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	})

const notConfigured = (): Response =>
	proxyError(
		503,
		"RUN_NOT_CONFIGURED",
		"The pinned run's record is not configured on this server.",
	)

async function projectedRecord(
	deps: RunReadDeps & { run: DemoRunEnv },
	env: DemoProxyEnv,
): Promise<
	{ response: Response } | { projection: RunProjection & { ok: true } }
> {
	let doc: unknown
	try {
		doc = await deps.manifest(deps.run.runId)
	} catch {
		return {
			response: proxyError(
				502,
				"RUN_UNREACHABLE",
				"The pinned run's record could not be read.",
			),
		}
	}
	if (doc === null || doc === undefined) {
		return {
			response: proxyError(
				404,
				"RUN_NOT_FOUND",
				"The pinned run has no stored record.",
			),
		}
	}
	const projection = projectRunRecord(doc, {
		scopeRef: env.scopeRef,
		agentId: env.agentId,
	})
	if (!projection.ok) {
		return {
			response:
				projection.code === "RUN_RECORD_MISMATCH"
					? proxyError(
							502,
							"RUN_RECORD_MISMATCH",
							"The stored record does not belong to the pinned run.",
						)
					: proxyError(
							502,
							"RUN_RECORD_MALFORMED",
							"The pinned run's record could not be understood.",
						),
		}
	}
	return { projection }
}

/** What the step body starts with, exactly as the step recorder writes it
 * (apps/demo-agents/src/agents/events.ts). */
function stepOpening(runId: string, step: AgentStep): string {
	return `[${runId}] ${AGENT_ROLE_LABELS[step.role]} — ${step.name}`
}

function hitIsEvent(
	result: unknown,
	eventId: string,
	env: DemoProxyEnv,
): result is Record<string, unknown> {
	if (typeof result !== "object" || result === null) {
		return false
	}
	const hit = result as Record<string, unknown>
	return (
		hit.canonicalId === `event:${eventId}` &&
		(hit.scope === undefined || hit.scope === env.scope) &&
		(hit.scopeRef === undefined || hit.scopeRef === env.scopeRef)
	)
}

async function confirmStep(
	request: Request,
	env: DemoProxyEnv,
	deps: RunReadDeps & { run: DemoRunEnv },
	fetchImpl: typeof fetch,
): Promise<Response> {
	const params = new URL(request.url).searchParams
	for (const name of params.keys()) {
		if (name !== "n") {
			return proxyError(
				400,
				"UNKNOWN_PARAMETER",
				`unknown query parameter ${name} for run-step`,
			)
		}
	}
	const given = params.getAll("n")
	const [raw] = given
	if (
		given.length !== 1 ||
		raw === undefined ||
		!STEP_NUMBER_PATTERN.test(raw)
	) {
		return proxyError(
			400,
			"INVALID_PARAMETER",
			"n must be a step number, an integer from 1 to 9999",
		)
	}
	const n = Number(raw)
	const found = await projectedRecord(deps, env)
	if ("response" in found) {
		return found.response
	}
	const step = found.projection.record.agentRun?.steps?.find(
		(candidate) => candidate.n === n,
	)
	if (step === undefined) {
		return proxyError(
			404,
			"STEP_NOT_FOUND",
			"The run's record has no such step.",
		)
	}
	const prefix = `[${deps.run.runId}] `
	try {
		const response = await fetchImpl(new URL(`${env.apiBaseUrl}/v1/search`), {
			method: "POST",
			headers: {
				authorization: `Bearer ${env.readKey}`,
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				query: stepOpening(deps.run.runId, step),
				scope: env.scope,
				scopeRef: env.scopeRef,
				agentId: env.agentId,
				limit: RECALL_RESULTS,
			}),
		})
		if (!response.ok) {
			return await upstreamFailureResponse(response)
		}
		const body = (await response.json()) as {
			results?: unknown
			degradation?: { kind?: unknown; retryAfterMs?: unknown }
		}
		const results = Array.isArray(body.results) ? body.results : []
		const hit = results.find((result) => hitIsEvent(result, step.eventId, env))
		if (hit === undefined) {
			const delay = body.degradation?.retryAfterMs
			if (body.degradation?.kind === "throttled") {
				return proxyError(
					503,
					"CITATION_RECALL_DEGRADED",
					"Recall is busy, so the source could not be checked yet. Try again shortly.",
					typeof delay === "number" && Number.isFinite(delay) && delay >= 0
						? Math.min(Math.round(delay), 600_000)
						: undefined,
				)
			}
			return json({ n, confirmed: false })
		}
		const stored =
			typeof hit.text === "string"
				? hit.text
				: typeof hit.snippet === "string"
					? hit.snippet
					: undefined
		const shown = stored?.startsWith(prefix)
			? stored.slice(prefix.length)
			: stored
		return json({
			n,
			confirmed: true,
			...(shown !== undefined ? { text: shown.slice(0, STEP_TEXT_MAX) } : {}),
			...(typeof hit.timestamp === "string"
				? { businessTime: hit.timestamp }
				: {}),
		})
	} catch {
		return unreachableResponse()
	}
}

/** Handles `/api/demo/v1/run` and `/api/demo/v1/run/step`. `deps.run` is null
 * when the server has no run env: both paths then answer "not configured". */
export async function handleDemoRunRead(
	request: Request,
	env: DemoProxyEnv,
	deps: RunReadDeps,
	fetchImpl: typeof fetch,
): Promise<Response> {
	if (request.method.toUpperCase() !== "GET") {
		return proxyError(
			405,
			"METHOD_NOT_ALLOWED",
			"the demo proxy only forwards GET reads",
		)
	}
	const url = new URL(request.url)
	const configured = deps.run === null ? null : { ...deps, run: deps.run }
	const path = url.pathname.endsWith("/")
		? url.pathname.slice(0, -1)
		: url.pathname
	if (path === RUN_PATH) {
		const [unknown] = url.searchParams.keys()
		if (unknown !== undefined) {
			return proxyError(
				400,
				"UNKNOWN_PARAMETER",
				`unknown query parameter ${unknown} for run`,
			)
		}
		if (configured === null) {
			return notConfigured()
		}
		const found = await projectedRecord(configured, env)
		return "response" in found ? found.response : json(found.projection.record)
	}
	if (configured === null) {
		return notConfigured()
	}
	return confirmStep(request, env, configured, fetchImpl)
}
