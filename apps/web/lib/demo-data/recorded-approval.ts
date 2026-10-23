// What the recording says about the run's proposed page. Public mode shows this
// as a recorded fact; it has no way to decide anything. The proposal counts as
// approved when its page is among the stored pages, because no wiki read
// returns a page that is still waiting for a reviewer.

import type { WikiMapView } from "./loaders.js"
import type { Boundaries, Timeline } from "./playback.js"
import type { RunRecord } from "./run-record.js"

export type RecordedApproval =
	| { kind: "none" }
	| { kind: "pending"; title: string }
	| { kind: "approved"; title: string; at?: string }

/** Null while the run's record or the page list is not known. */
export function recordedApproval(
	run: RunRecord | null,
	map: WikiMapView | null,
	timeline?: Timeline | null,
	marks?: Boundaries | null,
): RecordedApproval | null {
	if (run === null || map === null) return null
	const proposal = run.agentRun?.pendingProposal
	if (!proposal) return { kind: "none" }
	if (!map.pages.some((page) => page.slug === proposal.slug)) {
		return { kind: "pending", title: proposal.title }
	}
	const point =
		marks?.approval != null ? timeline?.points[marks.approval - 1] : undefined
	return {
		kind: "approved",
		title: proposal.title,
		...(point ? { at: point.at } : {}),
	}
}
