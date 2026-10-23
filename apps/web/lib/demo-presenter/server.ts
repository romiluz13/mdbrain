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
import type { LeaseDoc } from "./lease.js"
import type { PinDoc } from "./pin.js"
import type { RunRequestDoc } from "./run-requests.js"
import {
	createPresenterRuntime,
	type ControlStores,
	type PresenterRuntime,
} from "./runtime.js"
import type { SessionDoc } from "./session.js"

const RUNTIME_KEY = Symbol.for("mdbrain.demo.presenter-runtime")
type Holder = typeof globalThis & { [RUNTIME_KEY]?: PresenterRuntime }

const REVIEW_QUEUE_DEADLINE_MS = 15_000

function controlStores(uri: string): {
	stores: ControlStores
	ensureIndexes: () => Promise<void>
} {
	const db = controlClient(uri).db(CONTROL_DATABASE)
	const stores: ControlStores = {
		manifests: driverCollection<{ _id: string }>(
			db.collection(CONTROL_COLLECTIONS.manifests),
		),
		leases: driverCollection<LeaseDoc>(
			db.collection(CONTROL_COLLECTIONS.leases),
		),
		sessions: driverCollection<SessionDoc>(
			db.collection(CONTROL_COLLECTIONS.sessions),
		),
		runRequests: driverCollection<RunRequestDoc>(
			db.collection(CONTROL_COLLECTIONS.runRequests),
		),
		publicRun: driverCollection<PinDoc>(
			db.collection(CONTROL_COLLECTIONS.publicRun),
		),
	}
	// A presenter holds one lease only if the unique `presenterId` index exists,
	// so the runtime waits for both and stays off when either cannot be made.
	const ensureIndexes = async () => {
		await Promise.all([
			db
				.collection(CONTROL_COLLECTIONS.leases)
				.createIndex({ presenterId: 1 }, { unique: true }),
			db
				.collection(CONTROL_COLLECTIONS.sessions)
				.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
		])
	}
	return { stores, ensureIndexes }
}

export function presenterRuntime(
	env: Record<string, string | undefined> = process.env,
): PresenterRuntime {
	const holder = globalThis as Holder
	const held = holder[RUNTIME_KEY]
	if (held !== undefined) return held
	const config = readPresenterConfig(env)
	const control = config ? controlStores(config.controlUri) : null
	const runtime = createPresenterRuntime({
		config,
		baselineEnv: readDemoProxyEnv(env),
		baselineRun: readDemoRunEnv(env),
		stores: control?.stores ?? null,
		...(control ? { ensureIndexes: control.ensureIndexes } : {}),
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
