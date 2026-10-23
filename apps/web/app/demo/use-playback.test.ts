import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ChangesView, WikiMapView } from "../../lib/demo-data/loaders.js"
import type { Boundaries } from "../../lib/demo-data/playback.js"
import {
	clampCursor,
	jumpTarget,
	nextFrame,
	usePlayback,
} from "./use-playback.js"

const mocks = vi.hoisted(() => {
	const timeline = { points: [{}, {}, {}, {}] }
	const marks = {
		sourcesEnd: 2,
		agentsEnd: 3,
		approval: 4,
		contradiction: null,
	}
	return {
		timeline,
		marks,
		built: vi.fn(
			(): { ok: true; timeline: unknown } | { ok: false; reason: string } => ({
				ok: true,
				timeline,
			}),
		),
		stateAt: vi.fn((_timeline: unknown, cursor: number) => ({ cursor })),
	}
})

vi.mock("../../lib/demo-data/playback.js", () => ({
	buildTimeline: () => mocks.built(),
	stateAt: (timeline: unknown, cursor: number) =>
		mocks.stateAt(timeline, cursor),
	boundaries: () => mocks.marks,
}))

const { timeline, marks, built, stateAt } = mocks

const map = {} as WikiMapView
const changes = {} as ChangesView

function firstRender(input: Parameters<typeof usePlayback>[0]) {
	let seen: ReturnType<typeof usePlayback> | undefined
	function Probe() {
		seen = usePlayback(input)
		return null
	}
	renderToString(createElement(Probe))
	if (!seen) throw new Error("the hook never rendered")
	return seen
}

describe("clampCursor", () => {
	it("keeps the cursor on a frame: whole numbers from the first to the last", () => {
		expect(clampCursor(0, 4)).toBe(1)
		expect(clampCursor(-3, 4)).toBe(1)
		expect(clampCursor(9, 4)).toBe(4)
		expect(clampCursor(2.9, 4)).toBe(2)
	})
})

describe("jumpTarget", () => {
	it("maps each phase to its boundary, never past the recording", () => {
		expect(jumpTarget("sources", marks, 4)).toBe(2)
		expect(jumpTarget("agents", marks, 4)).toBe(3)
		expect(jumpTarget("approval", marks, 4)).toBe(4)
		expect(jumpTarget("end", marks, 4)).toBe(4)
	})

	it("falls back to the end of the agents when the run recorded no contradiction or approval", () => {
		const bare: Boundaries = { ...marks, approval: null, contradiction: null }
		expect(jumpTarget("contradiction", bare, 4)).toBe(3)
		expect(jumpTarget("approval", bare, 4)).toBe(3)
	})

	it("goes to the end when there are no boundaries to jump to", () => {
		expect(jumpTarget("sources", null, 4)).toBe(4)
		expect(jumpTarget("agents", null, 4)).toBe(4)
	})

	it("stays on a frame when a boundary lies outside the recording", () => {
		expect(jumpTarget("agents", { ...marks, agentsEnd: 40 }, 4)).toBe(4)
		expect(jumpTarget("sources", { ...marks, sourcesEnd: 0 }, 4)).toBe(1)
	})
})

describe("nextFrame", () => {
	it("advances one frame while playing", () => {
		expect(nextFrame(1, 4)).toEqual({ cursor: 2, done: false })
		expect(nextFrame(3, 4)).toEqual({ cursor: 4, done: false })
	})

	it("stops on the last frame and does not run past it", () => {
		expect(nextFrame(4, 4)).toEqual({ cursor: 4, done: true })
		expect(nextFrame(5, 4)).toEqual({ cursor: 4, done: true })
	})
})

describe("usePlayback on first render", () => {
	it("is off unless the page asks for a recording, so a presenter's live page has none", () => {
		expect(firstRender({ enabled: false, map, changes, run: null })).toEqual({
			status: "off",
		})
	})

	it("is off while the map or the change feed has not arrived", () => {
		expect(
			firstRender({ enabled: true, map: null, changes, run: null }),
		).toEqual({ status: "off" })
		expect(
			firstRender({ enabled: true, map, changes: null, run: null }),
		).toEqual({ status: "off" })
	})

	it("says so when the history cannot be derived, and offers no controls", () => {
		built.mockReturnValueOnce({ ok: false, reason: "The feed was cut short." })
		expect(firstRender({ enabled: true, map, changes, run: null })).toEqual({
			status: "fallback",
			reason: "The feed was cut short.",
		})
	})

	it("is ready on the final frame, paused, with the boundaries for the chapters to jump to", () => {
		stateAt.mockClear()
		const playback = firstRender({ enabled: true, map, changes, run: null })
		expect(playback).toMatchObject({
			status: "ready",
			playing: false,
			boundaries: marks,
			state: { cursor: 4 },
		})
		expect(stateAt).toHaveBeenCalledWith(timeline, 4)
	})
})
