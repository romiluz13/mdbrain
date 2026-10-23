"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangesView, WikiMapView } from "../../lib/demo-data/loaders.js"
import {
	boundaries,
	buildTimeline,
	stateAt,
	type Boundaries,
	type PlaybackState,
	type Timeline,
} from "../../lib/demo-data/playback.js"
import type { RunRecord } from "../../lib/demo-data/run-record.js"

/** The chapter whose phase the cursor jumps to on arrival. */
export type PlaybackPhase =
	| "sources"
	| "agents"
	| "contradiction"
	| "approval"
	| "end"

export type Playback =
	| { status: "off" }
	/** The history could not be derived and verified against the API: the page
	 * shows the final state and a chronological feed, and says so. */
	| { status: "fallback"; reason: string }
	| {
			status: "ready"
			timeline: Timeline
			state: PlaybackState
			boundaries: Boundaries | null
			playing: boolean
			setCursor: (cursor: number) => void
			step: (by: number) => void
			toggle: () => void
			jump: (phase: PlaybackPhase) => void
	  }

const TICK_MS = 700

/** The cursor held on a frame: a whole number from the first to the last. */
export function clampCursor(value: number, total: number): number {
	return Math.max(1, Math.min(total, Math.trunc(value)))
}

/** The frame a chapter's jump lands on. A run that recorded no contradiction
 * or approval falls back to where the agents ended. */
export function jumpTarget(
	phase: PlaybackPhase,
	marks: Boundaries | null,
	total: number,
): number {
	const target =
		phase === "sources"
			? marks?.sourcesEnd
			: phase === "agents"
				? marks?.agentsEnd
				: phase === "contradiction"
					? (marks?.contradiction ?? marks?.agentsEnd)
					: phase === "approval"
						? (marks?.approval ?? marks?.agentsEnd)
						: total
	return clampCursor(target ?? total, total)
}

/** One tick of playback: the next frame, and whether that was the last. */
export function nextFrame(
	current: number,
	total: number,
): { cursor: number; done: boolean } {
	return current >= total
		? { cursor: total, done: true }
		: { cursor: current + 1, done: false }
}

/** The recording's cursor. Built only from reads the page already made, so a
 * frame costs no request. Off while the data is not all here, or for a
 * presenter, whose page is live. */
export function usePlayback(input: {
	enabled: boolean
	map: WikiMapView | null
	changes: ChangesView | null
	run: RunRecord | null
	/** When the detector recorded the run's contradiction, if one is recorded. */
	detectedAt?: string
}): Playback {
	const { enabled, map, changes, run, detectedAt } = input
	const built = useMemo(
		() => (enabled && map && changes ? buildTimeline(map, changes) : null),
		[enabled, map, changes],
	)
	const timeline = built?.ok ? built.timeline : null
	const total = timeline?.points.length ?? 0
	const [cursor, setCursorState] = useState(0)
	const [playing, setPlaying] = useState(false)
	const seeded = useRef(false)

	// The first time a timeline exists the cursor sits at the end, so the final
	// state is what a visitor sees before they scrub.
	useEffect(() => {
		if (total === 0) {
			seeded.current = false
		} else if (!seeded.current) {
			seeded.current = true
			setCursorState(total)
		}
	}, [total])

	const setCursor = useCallback(
		(next: number) => {
			setPlaying(false)
			setCursorState(clampCursor(next, total))
		},
		[total],
	)

	useEffect(() => {
		if (!playing) return
		const timer = setInterval(() => {
			setCursorState((current) => {
				const frame = nextFrame(current, total)
				if (frame.done) setPlaying(false)
				return frame.cursor
			})
		}, TICK_MS)
		return () => clearInterval(timer)
	}, [playing, total])

	const marks = useMemo(
		() =>
			timeline ? boundaries(timeline, run ?? undefined, detectedAt) : null,
		[timeline, run, detectedAt],
	)

	const jump = useCallback(
		(phase: PlaybackPhase) => {
			setPlaying(false)
			setCursorState(jumpTarget(phase, marks, total))
		},
		[marks, total],
	)

	const state = useMemo(
		() => (timeline ? stateAt(timeline, cursor || total) : null),
		[timeline, cursor, total],
	)

	const step = useCallback(
		(by: number) => {
			setPlaying(false)
			setCursorState((current) => clampCursor((current || total) + by, total))
		},
		[total],
	)
	const toggle = useCallback(() => {
		if (!playing && (cursor || total) >= total) setCursorState(1)
		setPlaying(!playing)
	}, [playing, cursor, total])

	return useMemo<Playback>(() => {
		if (!enabled || built === null) return { status: "off" }
		if (!built.ok) return { status: "fallback", reason: built.reason }
		if (!state) return { status: "off" }
		return {
			status: "ready",
			timeline: built.timeline,
			state,
			boundaries: marks,
			playing,
			setCursor,
			step,
			toggle,
			jump,
		}
	}, [enabled, built, state, marks, playing, setCursor, step, toggle, jump])
}
