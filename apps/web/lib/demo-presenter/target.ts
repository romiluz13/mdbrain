// Which run a /api/demo/v1 read is about, decided on the server for every
// request. The browser names no scope, agent or run:
//   - a signed-in presenter who holds a lease reads their leased slot, with
//     that slot's own read key;
//   - everyone else reads the pinned run: the one a presenter pinned (read key
//     from the key ring, scope and agent from the run's own record), else the
//     run the server env pins, as before.
// A slot with no read key is refused rather than read with another key.

import type { DemoProxyEnv } from "../demo-data/proxy.js"
import type { DemoRunEnv } from "../demo-data/proxy-run.js"
import { readKeyOf, type PresenterConfig } from "./config.js"
import type { LeaseManifest, LeaseService, ManifestReader } from "./lease.js"
import type { PinService } from "./pin.js"
import { sessionIdOf, type SessionService } from "./session.js"

export type DemoTarget = {
	mode: "public" | "presenter"
	env: DemoProxyEnv
	run: DemoRunEnv | null
}

export type TargetResult =
	| { ok: true; target: DemoTarget }
	| {
			ok: false
			status: 503
			code: "PROXY_NOT_CONFIGURED" | "SLOT_NOT_READABLE"
			message: string
	  }

export type TargetDeps = {
	config: PresenterConfig | null
	/** Today's env-pinned run: the fallback when nothing is pinned. */
	baselineEnv: DemoProxyEnv | null
	baselineRun: DemoRunEnv | null
	sessions: SessionService
	leases: Pick<LeaseService, "current">
	manifests: ManifestReader
	pins: Pick<PinService, "get">
	now: () => Date
	/** How long the pinned run is remembered before the pin is read again. */
	pinTtlMs?: number
}

const PIN_TTL_MS = 5_000

const notReadable = (message: string): TargetResult => ({
	ok: false,
	status: 503,
	code: "SLOT_NOT_READABLE",
	message,
})

function slotTarget(
	config: PresenterConfig,
	manifest: LeaseManifest,
	mode: DemoTarget["mode"],
): TargetResult {
	const readKey = readKeyOf(config, manifest.slotIndex)
	if (!readKey) return notReadable("this slot has no read key on the server")
	return {
		ok: true,
		target: {
			mode,
			env: {
				apiBaseUrl: config.apiBaseUrl,
				readKey,
				scope: "workspace",
				scopeRef: manifest.scopeRef,
				agentId: manifest.agentId,
			},
			run: { controlUri: config.controlUri, runId: manifest.runId },
		},
	}
}

export function createTargetResolver(deps: TargetDeps) {
	const pinTtlMs = deps.pinTtlMs ?? PIN_TTL_MS
	let pinned: { at: number; result: TargetResult } | undefined

	async function publicTarget(): Promise<TargetResult> {
		const now = deps.now().getTime()
		if (pinned && now - pinned.at < pinTtlMs) return pinned.result
		let result: TargetResult | undefined
		if (deps.config) {
			const pin = await deps.pins.get()
			const manifest = pin ? await deps.manifests.get(pin.runId) : null
			if (manifest && manifest.agentRunState === "complete") {
				const slot = slotTarget(deps.config, manifest, "public")
				if (slot.ok) result = slot
			}
		}
		result ??= deps.baselineEnv
			? {
					ok: true,
					target: {
						mode: "public",
						env: deps.baselineEnv,
						run: deps.baselineRun,
					},
				}
			: {
					ok: false,
					status: 503,
					code: "PROXY_NOT_CONFIGURED",
					message: "the demo read proxy is missing its server configuration",
				}
		pinned = { at: now, result }
		return result
	}

	return {
		async resolve(request: Request): Promise<TargetResult> {
			const sessionId = sessionIdOf(request)
			if (deps.config && sessionId !== "") {
				const session = await deps.sessions.lookup(sessionId)
				const lease = session
					? await deps.leases.current(session.presenterId)
					: null
				if (lease) {
					const manifest = await deps.manifests.get(lease.runId)
					// The page says it is live on this slot, so a slot that cannot be
					// read is an error, not the public run.
					return manifest
						? slotTarget(deps.config, manifest, "presenter")
						: notReadable("this slot's run record could not be read")
				}
			}
			return publicTarget()
		},
	}
}

export type TargetResolver = ReturnType<typeof createTargetResolver>
