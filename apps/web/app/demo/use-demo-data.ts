"use client"

import { useCallback, useEffect, useState } from "react"
import {
	loadWikiChanges,
	loadWikiMap,
	type ChangesView,
	type DemoDataUpstream,
	type WikiMapView,
} from "../../lib/demo-data/loaders.js"
import {
	loadContradictionCase,
	type ContradictionCase,
} from "../../lib/demo-data/loaders-chapters.js"
import { loadRunRecord } from "../../lib/demo-data/loaders-run.js"
import type { RunRecord } from "../../lib/demo-data/run-record.js"
import type { DataState } from "../../lib/demo-data/states.js"
import { earliestIngestion } from "../../lib/demo-data/views.js"

/** The page reads through the same-origin demo proxy: it injects the key and
 * the pinned run, so the browser sends neither. */
export const DEMO_UPSTREAM: DemoDataUpstream = {
	apiBaseUrl: "/api/demo",
	readKey: "",
}

export type DemoData = {
	map: DataState<WikiMapView>
	contradiction: DataState<ContradictionCase>
	changes: DataState<ChangesView>
	/** The pinned run's own record: its arrivals and what its agents did. */
	run: DataState<RunRecord>
}

const LOADING = { kind: "loading" } as const

const INITIAL: DemoData = {
	map: LOADING,
	contradiction: LOADING,
	changes: LOADING,
	run: LOADING,
}

/** One second before the first stored page, so the first revision is inside
 * the window whatever the bound's inclusivity. */
function windowStart(firstIngestion: string): string {
	return new Date(Date.parse(firstIngestion) - 1000).toISOString()
}

export function useDemoData(upstream: DemoDataUpstream = DEMO_UPSTREAM): {
	data: DemoData
	reload: () => void
} {
	const [data, setData] = useState<DemoData>(INITIAL)
	const [attempt, setAttempt] = useState(0)

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the reads when the visitor retries
	useEffect(() => {
		let live = true
		const patch = (part: Partial<DemoData>) => {
			if (live) {
				setData((current) => ({ ...current, ...part }))
			}
		}
		setData(INITIAL)
		void loadWikiMap(upstream).then(async (map) => {
			patch({ map })
			if (map.kind !== "ready") {
				patch({
					changes:
						map.kind === "empty"
							? map
							: {
									kind: "error",
									code: "NO_WINDOW_START",
									message:
										"the page list could not be read, so the first stored revision is unknown",
								},
				})
				return
			}
			const first = earliestIngestion(map.data)
			patch({
				changes:
					first === null
						? { kind: "empty" }
						: await loadWikiChanges(upstream, windowStart(first)),
			})
		})
		void loadContradictionCase(upstream).then((contradiction) =>
			patch({ contradiction }),
		)
		void loadRunRecord(upstream).then((run) => patch({ run }))
		return () => {
			live = false
		}
	}, [upstream, attempt])

	const reload = useCallback(() => setAttempt((count) => count + 1), [])
	return { data, reload }
}
