"use client"

import { useCallback, useEffect, useState } from "react"
import {
	loadWikiChangesFromStart,
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

export function useDemoData(upstream: DemoDataUpstream = DEMO_UPSTREAM): {
	data: DemoData
	reload: () => void
} {
	const [data, setData] = useState<DemoData>(INITIAL)
	const [attempt, setAttempt] = useState(0)

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the reads when the visitor retries
	useEffect(() => {
		// React's dev double mount (and any remount) would otherwise leave the
		// first run's read chain running beside the new one, doubling every
		// request; the abort retires it with the cleanup.
		const controller = new AbortController()
		let live = true
		const patch = (part: Partial<DemoData>) => {
			if (live) {
				setData((current) => ({ ...current, ...part }))
			}
		}
		setData(INITIAL)
		void loadWikiMap(upstream, controller.signal).then((map) => patch({ map }))
		// Not behind the page list: a visitor who jumps to chapter 7 sees its rows
		// as soon as this read returns, not after the pages have all been read.
		void loadWikiChangesFromStart(upstream, controller.signal).then((changes) =>
			patch({ changes }),
		)
		void loadContradictionCase(upstream, controller.signal).then(
			(contradiction) => patch({ contradiction }),
		)
		void loadRunRecord(upstream, controller.signal).then((run) =>
			patch({ run }),
		)
		return () => {
			live = false
			controller.abort()
		}
	}, [upstream, attempt])

	const reload = useCallback(() => setAttempt((count) => count + 1), [])
	return { data, reload }
}
