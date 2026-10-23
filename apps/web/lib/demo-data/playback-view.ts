// The chapter data at a playback cursor: the page list, the change feed and the
// recorded contradiction as they stood when the cursor's revision was stored.
// Chapters read the cursor's view through the same DemoData shape they read the
// final one in, so they need no knowledge of playback.

import type { ChangesView, WikiMapView } from "./loaders.js"
import type { ContradictionCase } from "./loaders-chapters.js"
import {
	changesAt,
	cursorAt,
	mapAt,
	type PlaybackState,
	type Timeline,
} from "./playback.js"
import type { DataState } from "./states.js"

type Parts = {
	map: DataState<WikiMapView>
	changes: DataState<ChangesView>
	contradiction: DataState<ContradictionCase>
}

export function viewAt<T extends Parts>(
	data: T,
	state: PlaybackState,
	timeline: Timeline,
): T {
	const contradiction = data.contradiction
	const recordedAt =
		contradiction.kind === "ready"
			? cursorAt(timeline, contradiction.data.detectedAt)
			: null
	const recorded = recordedAt === null || state.cursor >= recordedAt
	return {
		...data,
		map:
			data.map.kind === "ready"
				? { kind: "ready", data: mapAt(data.map.data, state, recorded) }
				: data.map,
		changes:
			data.changes.kind === "ready"
				? {
						kind: "ready",
						data: changesAt(data.changes.data, timeline, state.cursor),
					}
				: data.changes,
		contradiction: recorded ? contradiction : { kind: "empty" },
	}
}
