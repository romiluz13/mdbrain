"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

/** Starts the four reads and hands each result to `patch` as it lands. */
function readAll(
	upstream: DemoDataUpstream,
	signal: AbortSignal,
	patch: (part: Partial<DemoData>) => void,
) {
	void loadWikiMap(upstream, signal).then((map) => patch({ map }))
	// Not behind the page list: a visitor who jumps to chapter 7 sees its rows
	// as soon as this read returns, not after the pages have all been read.
	void loadWikiChangesFromStart(upstream, signal).then((changes) =>
		patch({ changes }),
	)
	void loadContradictionCase(upstream, signal).then((contradiction) =>
		patch({ contradiction }),
	)
	void loadRunRecord(upstream, signal).then((run) => patch({ run }))
}

export function useDemoData(upstream: DemoDataUpstream = DEMO_UPSTREAM): {
	data: DemoData
	reload: () => void
	/** Reads everything again without clearing what is on screen, for a live
	 * run that is still writing. A read that fails keeps the last good one. */
	refresh: () => void
} {
	const [data, setData] = useState<DemoData>(INITIAL)
	const [attempt, setAttempt] = useState(0)
	const softRead = useRef<AbortController | null>(null)

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
		readAll(upstream, controller.signal, patch)
		return () => {
			live = false
			controller.abort()
		}
	}, [upstream, attempt])

	const reload = useCallback(() => setAttempt((count) => count + 1), [])

	const refresh = useCallback(() => {
		softRead.current?.abort()
		const controller = new AbortController()
		softRead.current = controller
		readAll(upstream, controller.signal, (part) => {
			if (controller.signal.aborted) return
			setData((current) => {
				const next = { ...current }
				for (const key of Object.keys(part) as Array<keyof DemoData>) {
					const incoming = part[key]
					// A transient failure must not wipe a screen that was fine.
					if (incoming?.kind === "error" && current[key].kind !== "loading") {
						continue
					}
					;(next as Record<string, unknown>)[key] = incoming
				}
				return next
			})
		})
	}, [upstream])
	useEffect(() => () => softRead.current?.abort(), [])

	return { data, reload, refresh }
}
