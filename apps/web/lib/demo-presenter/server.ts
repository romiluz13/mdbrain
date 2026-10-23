// The driver-bound side of the presenter runtime: the one place that opens the
// control collections and the review-queue client. Server-only: the driver, the
// connection string, the admin key and the read-key ring never reach a browser
// bundle. The runtime is built once per process and held on globalThis, as the
// control client is, so a dev reload does not orphan it.

import { MdbrainClient } from "@mdbrain/client"
import { readDemoProxyEnv } from "../demo-data/proxy.js"
import { readDemoRunEnv } from "../demo-data/proxy-run.js"
import { CONTROL_DATABASE, controlClient } from "../demo-data/run-store.js"
import { CONTROL_COLLECTIONS, driverCollection } from "./collections.js"
import { readPresenterConfig } from "./config.js"
import {
	createPresenterRuntime,
	type ControlStores,
	type PresenterRuntime,
} from "./runtime.js"

const RUNTIME_KEY = Symbol.for("mdbrain.demo.presenter-runtime")
type Holder = typeof globalThis & { [RUNTIME_KEY]?: PresenterRuntime }

const REVIEW_QUEUE_DEADLINE_MS = 15_000

function controlStores(uri: string): ControlStores {
	const db = controlClient(uri).db(CONTROL_DATABASE)
	const stores = {
		manifests: driverCollection(db.collection(CONTROL_COLLECTIONS.manifests)),
		leases: driverCollection(db.collection(CONTROL_COLLECTIONS.leases)),
		sessions: driverCollection(db.collection(CONTROL_COLLECTIONS.sessions)),
		runRequests: driverCollection(
			db.collection(CONTROL_COLLECTIONS.runRequests),
		),
		publicRun: driverCollection(db.collection(CONTROL_COLLECTIONS.publicRun)),
	} as ControlStores
	// A presenter holds one lease, and a session ends on its own. Best effort:
	// slot exclusivity itself rests on the lease's unique `_id`.
	void db
		.collection(CONTROL_COLLECTIONS.leases)
		.createIndex({ presenterId: 1 }, { unique: true })
		.catch(() => undefined)
	void db
		.collection(CONTROL_COLLECTIONS.sessions)
		.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
		.catch(() => undefined)
	return stores
}

export function presenterRuntime(
	env: Record<string, string | undefined> = process.env,
): PresenterRuntime {
	const holder = globalThis as Holder
	const held = holder[RUNTIME_KEY]
	if (held !== undefined) return held
	const config = readPresenterConfig(env)
	const runtime = createPresenterRuntime({
		config,
		baselineEnv: readDemoProxyEnv(env),
		baselineRun: readDemoRunEnv(env),
		stores: config ? controlStores(config.controlUri) : null,
		proposalsClient: config
			? new MdbrainClient({
					baseUrl: config.apiBaseUrl,
					apiKey: config.adminKey,
					maxRetries: 0,
					defaultDeadlineMs: REVIEW_QUEUE_DEADLINE_MS,
				})
			: null,
	})
	holder[RUNTIME_KEY] = runtime
	return runtime
}
