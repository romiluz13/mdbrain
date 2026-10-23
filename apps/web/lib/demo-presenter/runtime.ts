// Builds the presenter services and the target resolver from their stores. The
// driver-bound stores come from ./server.ts; tests pass memory stores, so this
// wiring is exercised without a database.

import type { DemoProxyEnv } from "../demo-data/proxy.js"
import {
	createReadKeyCheck,
	type ReadKeyCheck,
} from "../demo-data/proxy-principal.js"
import type { DemoRunEnv } from "../demo-data/proxy-run.js"
import { createAdminKeyCheck, type AdminKeyCheck } from "./admin-key.js"
import type { ControlCollection } from "./collections.js"
import type { PresenterConfig } from "./config.js"
import {
	createLeaseService,
	isFullySeeded,
	manifestReader,
	readyManifestSource,
	type LeaseDoc,
	type LeaseManifest,
} from "./lease.js"
import { createPinService, type PinDoc } from "./pin.js"
import type { PresenterServices } from "./presenter-api.js"
import { createProposalService, type ProposalsClient } from "./proposals.js"
import { createRunRequestService, type RunRequestDoc } from "./run-requests.js"
import { createSignInLimiter } from "./signin-limit.js"
import {
	createSessionService,
	verifyPresenterToken,
	type SessionDoc,
} from "./session.js"
import { createTargetResolver, slotEnv, type TargetResolver } from "./target.js"

export type ControlStores = {
	manifests: ControlCollection<{ _id: string }>
	leases: ControlCollection<LeaseDoc>
	sessions: ControlCollection<SessionDoc>
	runRequests: ControlCollection<RunRequestDoc>
	publicRun: ControlCollection<PinDoc>
}

export type PresenterRuntime = {
	/** Null when presenter mode is not configured. */
	services: PresenterServices | null
	resolver: TargetResolver
}

export function createPresenterRuntime(input: {
	config: PresenterConfig | null
	baselineEnv: DemoProxyEnv | null
	baselineRun: DemoRunEnv | null
	stores: ControlStores | null
	proposalsClient: ProposalsClient | null
	now?: () => Date
	/** How a slot's key is asked what it can do; tests pass a fake. */
	readKeyCheck?: ReadKeyCheck
	adminKeyCheck?: AdminKeyCheck
	fetchImpl?: typeof fetch
	/** Creates the control collections' indexes. The lease's one-per-presenter
	 * index is what makes "a presenter holds one slot" true, so presenter mode
	 * stays off until this has succeeded. Tests with memory stores omit it. */
	ensureIndexes?: () => Promise<void>
}): PresenterRuntime {
	const now = input.now ?? (() => new Date())
	const { config, stores } = input
	if (!config || !stores || !input.proposalsClient) {
		// Without the presenter config only today's env-pinned run is served.
		const unavailable = {
			current: async () => null,
		}
		return {
			services: null,
			resolver: createTargetResolver({
				config: null,
				baselineEnv: input.baselineEnv,
				baselineRun: input.baselineRun,
				sessions: {
					open: async () => {
						throw new Error("presenter mode is not configured")
					},
					lookup: async () => null,
					close: async () => undefined,
				},
				leases: unavailable,
				manifests: { get: async () => null },
				pins: { get: async () => null },
				now,
			}),
		}
	}
	const manifests = manifestReader(stores.manifests)
	const checkReadKey = input.readKeyCheck ?? createReadKeyCheck()
	const fetchImpl = input.fetchImpl ?? fetch
	const checkAdminKey = input.adminKeyCheck ?? createAdminKeyCheck()
	const ensureIndexes = input.ensureIndexes ?? (async () => undefined)
	let indexed = false
	// Presenter mode runs only with its indexes in place and a review key that
	// can do nothing but administer; anything else answers "not configured".
	// An index that failed is tried again on the next request, never skipped.
	const ready = async (): Promise<boolean> => {
		if (!indexed) {
			try {
				await ensureIndexes()
				indexed = true
			} catch {
				return false
			}
		}
		return checkAdminKey(
			{ apiBaseUrl: config.apiBaseUrl, adminKey: config.adminKey },
			fetchImpl,
		)
	}
	// A slot is readable only when its ring key is an exact read-only reader of
	// the slot's own scope: the same gate the read proxy holds every key to.
	const readable = async (manifest: LeaseManifest) => {
		const env = slotEnv(config, manifest)
		return env !== undefined && (await checkReadKey(env, fetchImpl))
	}
	const pins = createPinService({
		pins: stores.publicRun,
		manifests,
		readable,
		now,
	})
	const sessions = createSessionService({ sessions: stores.sessions, now })
	const readySlots = readyManifestSource(stores.manifests)
	const leases = createLeaseService({
		leases: stores.leases,
		// A slot the server cannot read as a visitor would leases and then answers
		// 503, so only fully seeded slots with an exact reader key are offered.
		manifests: {
			listReady: async () => {
				const seeded = (await readySlots.listReady()).filter(isFullySeeded)
				const verdicts = await Promise.all(seeded.map(readable))
				return seeded.filter((_, index) => verdicts[index])
			},
		},
		pinnedRunId: async () => (await pins.get())?.runId,
		now,
	})
	return {
		services: {
			verifyToken: (provided) => verifyPresenterToken(provided, config.token),
			sessions,
			leases,
			manifests,
			runRequests: createRunRequestService({
				requests: stores.runRequests,
				now,
			}),
			pins,
			proposals: createProposalService(input.proposalsClient),
			signIns: createSignInLimiter({ now }),
			ready,
			now,
		},
		resolver: createTargetResolver({
			config,
			baselineEnv: input.baselineEnv,
			baselineRun: input.baselineRun,
			sessions,
			leases,
			manifests,
			pins,
			ready,
			now,
		}),
	}
}
