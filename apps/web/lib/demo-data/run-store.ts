// The one place the web server opens the demo control database. It reads one
// manifest by id and nothing else: no write, no filter from the browser, no
// other collection or database. Server-only: the driver and the connection
// string never reach a browser bundle.

import { MongoClient } from "mongodb"
import type { DemoRunEnv, RunManifestSource } from "./proxy-run.js"

export const CONTROL_DATABASE = "mdbrain_demo_control"
const MANIFESTS = "demo_run_manifests"
const SELECTION_TIMEOUT_MS = 5_000

// The fields the public projection needs. A failure's stored text is not among
// them, so it never leaves the database.
const PROJECTION = {
	state: 1,
	scopeRef: 1,
	agentId: 1,
	createdAt: 1,
	readyAt: 1,
	usedAt: 1,
	failedAt: 1,
	"corpus.eventsPlanned": 1,
	"corpus.pagesPlanned": 1,
	eventsWritten: 1,
	pagesWritten: 1,
	"agentRun.state": 1,
	"agentRun.startedAt": 1,
	"agentRun.endedAt": 1,
	"agentRun.usage": 1,
	"agentRun.stepsRecorded": 1,
	"agentRun.reusedPage": 1,
	"agentRun.pendingProposal": 1,
	"agentRun.steps": 1,
} as const

// A MongoClient is a pool, and the driver's guidance is one per process, reused
// across requests. Next re-evaluates a route's modules on a dev reload, and a
// module-level client would be orphaned each time with its pool open, so the
// client is held on globalThis under a fixed key in every mode.
const CLIENT_KEY = Symbol.for("mdbrain.demo.control-client")
type Holder = typeof globalThis & { [CLIENT_KEY]?: MongoClient }

/** The process's one client for the control database. Creating it opens no
 * connection: the driver connects on the first operation. */
export function controlClient(
	uri: string,
	timeoutMs: number = SELECTION_TIMEOUT_MS,
): MongoClient {
	const holder = globalThis as Holder
	const held = holder[CLIENT_KEY]
	if (held !== undefined) {
		return held
	}
	const client = new MongoClient(uri, {
		appName: "mdbrain-demo-web",
		maxPoolSize: 5,
		serverSelectionTimeoutMS: timeoutMs,
		connectTimeoutMS: timeoutMs,
	})
	holder[CLIENT_KEY] = client
	return client
}

export function controlDb(
	uri: string,
	timeoutMs: number = SELECTION_TIMEOUT_MS,
) {
	return controlClient(uri, timeoutMs).db(CONTROL_DATABASE)
}

export function createRunManifestSource(
	env: DemoRunEnv,
	timeoutMs: number = SELECTION_TIMEOUT_MS,
): RunManifestSource {
	return (runId) =>
		controlDb(env.controlUri, timeoutMs)
			.collection<{ _id: string }>(MANIFESTS)
			.findOne({ _id: runId }, { projection: PROJECTION })
}
