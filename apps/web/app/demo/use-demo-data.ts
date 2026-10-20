"use client"

import { useCallback, useEffect, useState } from "react"
import {
	loadRunSources,
	loadWikiChanges,
	loadWikiMap,
	type ChangesView,
	type DemoDataUpstream,
	type RunSourcesView,
	type WikiMapView,
} from "../../lib/demo-data/loaders.js"
import {
	loadAgentActivity,
	loadContradictionCase,
	type ContradictionCase,
} from "../../lib/demo-data/loaders-chapters.js"
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
	sources: DataState<RunSourcesView>
	agents: DataState<never>
}

const LOADING = { kind: "loading" } as const

const INITIAL: DemoData = {
	map: LOADING,
	contradiction: LOADING,
	changes: LOADING,
	sources: LOADING,
	agents: loadAgentActivity(),
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
		void loadRunSources(upstream).then((sources) => patch({ sources }))
		return () => {
			live = false
		}
	}, [upstream, attempt])

	const reload = useCallback(() => setAttempt((count) => count + 1), [])
	return { data, reload }
}
