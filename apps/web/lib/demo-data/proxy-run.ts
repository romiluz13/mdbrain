// The one read of the pinned run that no API route serves: its record, from
// the demo control database. It is a fixed path the proxy owns. The browser
// names no run and no filter: the run is pinned by server env. The record names
// each arrival's and each step's event id, and the browser confirms those
// through the API's cite read.

import { proxyError } from "./proxy-errors.js"
import type { DemoProxyEnv } from "./proxy.js"
import { projectRunRecord, type RunProjection } from "./run-record.js"

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

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MONGO_URI_PATTERN = /^mongodb(\+srv)?:\/\/\S+$/

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
	return path === RUN_PATH
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

/** Handles `/api/demo/v1/run`. `deps.run` is null when the server has no run
 * env: the path then answers "not configured". */
export async function handleDemoRunRead(
	request: Request,
	env: DemoProxyEnv,
	deps: RunReadDeps,
): Promise<Response> {
	if (request.method.toUpperCase() !== "GET") {
		return proxyError(
			405,
			"METHOD_NOT_ALLOWED",
			"the demo proxy only forwards GET reads",
		)
	}
	const [unknown] = new URL(request.url).searchParams.keys()
	if (unknown !== undefined) {
		return proxyError(
			400,
			"UNKNOWN_PARAMETER",
			`unknown query parameter ${unknown} for run`,
		)
	}
	if (deps.run === null) {
		return notConfigured()
	}
	const found = await projectedRecord({ ...deps, run: deps.run }, env)
	return "response" in found ? found.response : json(found.projection.record)
}
