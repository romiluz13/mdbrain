// The run public mode plays back (ticket 14). It is pinned by an explicit
// presenter action, never automatically, and only a completed run can be: a
// failed or incomplete run stays labeled and never becomes the public default.
// The pin is one document in the control database, so a restart or a second
// web instance reads the same run.

import { DuplicateKeyError, type ControlCollection } from "./collections.js"
import type { LeaseManifest, ManifestReader } from "./lease.js"

export type PinDoc = {
	_id: "public"
	runId: string
	pinnedAt: string
	pinnedBy: string
}

export class PinError extends Error {
	name = "PinError"
	constructor(
		readonly code: "RUN_NOT_FOUND" | "RUN_NOT_COMPLETE" | "RUN_NOT_READABLE",
		message: string,
	) {
		super(message)
	}
}

export function createPinService(deps: {
	pins: ControlCollection<PinDoc>
	manifests: ManifestReader
	/** Whether the server can read this run: a pin it cannot read would leave
	 * public mode on another run while the page says it pinned this one. */
	readable: (manifest: LeaseManifest) => boolean
	now: () => Date
}) {
	return {
		get: (): Promise<PinDoc | null> => deps.pins.findOne({ _id: "public" }),

		async pin(runId: string, presenterId: string): Promise<PinDoc> {
			const manifest = await deps.manifests.get(runId)
			if (!manifest) {
				throw new PinError("RUN_NOT_FOUND", "that run has no stored record")
			}
			if (manifest.agentRunState !== "complete") {
				throw new PinError(
					"RUN_NOT_COMPLETE",
					"only a run whose agents finished can be pinned for public mode",
				)
			}
			if (!deps.readable(manifest)) {
				throw new PinError(
					"RUN_NOT_READABLE",
					"this server has no read key for that run's slot, so it could not play it back",
				)
			}
			const fields = {
				runId,
				pinnedAt: deps.now().toISOString(),
				pinnedBy: presenterId,
			}
			const replaced = await deps.pins.findOneAndUpdate(
				{ _id: "public" },
				{ $set: fields },
				{ returnDocument: "after" },
			)
			if (replaced) return replaced
			const doc: PinDoc = { _id: "public", ...fields }
			try {
				await deps.pins.insertOne(doc)
				return doc
			} catch (error) {
				if (!(error instanceof DuplicateKeyError)) throw error
				const winner = await deps.pins.findOneAndUpdate(
					{ _id: "public" },
					{ $set: fields },
					{ returnDocument: "after" },
				)
				return winner ?? doc
			}
		},
	}
}

export type PinService = ReturnType<typeof createPinService>
