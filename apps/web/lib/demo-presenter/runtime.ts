// Builds the presenter services and the target resolver from their stores. The
// driver-bound stores come from ./server.ts; tests pass memory stores, so this
// wiring is exercised without a database.

import type { DemoProxyEnv } from "../demo-data/proxy.js"
import type { DemoRunEnv } from "../demo-data/proxy-run.js"
import type { ControlCollection } from "./collections.js"
import { readKeyOf, type PresenterConfig } from "./config.js"
import {
	createLeaseService,
	manifestReader,
	readyManifestSource,
	type LeaseDoc,
} from "./lease.js"
import { createPinService, type PinDoc } from "./pin.js"
import type { PresenterServices } from "./presenter-api.js"
import { createProposalService, type ProposalsClient } from "./proposals.js"
import { createRunRequestService, type RunRequestDoc } from "./run-requests.js"
import {
	createSessionService,
	verifyPresenterToken,
	type SessionDoc,
} from "./session.js"
import { createTargetResolver, type TargetResolver } from "./target.js"

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
	const readable = (manifest: { slotIndex: number }) =>
		readKeyOf(config, manifest.slotIndex) !== undefined
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
		// A slot the server cannot read would lease and then answer 503.
		manifests: {
			listReady: async () => (await readySlots.listReady()).filter(readable),
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
			now,
		}),
	}
}
