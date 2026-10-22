import { describe, expect, it } from "vitest"
import {
	SCENE_BUDGET,
	chooseView,
	createFrameMonitor,
	type ViewInput,
} from "./scene-gate.js"

const CAN_RUN: ViewInput = {
	webgl: true,
	reducedMotion: false,
	preference: null,
	nodes: 110,
	edges: 288,
	degraded: null,
}

describe("chooseView", () => {
	it("chooses 3D when WebGL is there, motion is allowed and nothing has gone wrong", () => {
		expect(chooseView(CAN_RUN)).toEqual({ view: "3d" })
	})

	it("chooses 3D at the budget and 2D one node or one link past it", () => {
		expect(chooseView({ ...CAN_RUN, ...SCENE_BUDGET }).view).toBe("3d")
		expect(chooseView({ ...CAN_RUN, nodes: SCENE_BUDGET.nodes + 1 })).toEqual({
			view: "2d",
			reason: "over-budget",
		})
		expect(chooseView({ ...CAN_RUN, edges: SCENE_BUDGET.edges + 1 })).toEqual({
			view: "2d",
			reason: "over-budget",
		})
	})

	it("budgets 250 nodes and about 625 links, as the direction sets", () => {
		expect(SCENE_BUDGET).toEqual({ nodes: 250, edges: 625 })
	})

	it("falls back to 2D with the reason for each way 3D cannot run", () => {
		expect(chooseView({ ...CAN_RUN, webgl: false })).toEqual({
			view: "2d",
			reason: "no-webgl",
		})
		expect(chooseView({ ...CAN_RUN, reducedMotion: true })).toEqual({
			view: "2d",
			reason: "reduced-motion",
		})
		expect(chooseView({ ...CAN_RUN, degraded: "slow" })).toEqual({
			view: "2d",
			reason: "slow",
		})
		expect(chooseView({ ...CAN_RUN, degraded: "context-lost" })).toEqual({
			view: "2d",
			reason: "context-lost",
		})
		expect(chooseView({ ...CAN_RUN, degraded: "failed" })).toEqual({
			view: "2d",
			reason: "failed",
		})
	})

	it("honors the viewer's choice of 2D, and a choice of 3D changes nothing", () => {
		expect(chooseView({ ...CAN_RUN, preference: "2d" })).toEqual({
			view: "2d",
			reason: "chosen",
		})
		expect(chooseView({ ...CAN_RUN, preference: "3d" })).toEqual({ view: "3d" })
	})

	it("never lets a stored 3D preference override reduced motion or a missing WebGL", () => {
		expect(
			chooseView({ ...CAN_RUN, preference: "3d", reducedMotion: true }).view,
		).toBe("2d")
		expect(
			chooseView({ ...CAN_RUN, preference: "3d", webgl: false }).view,
		).toBe("2d")
	})

	it("stays 2D, with no reason, until WebGL has been looked for", () => {
		expect(chooseView({ ...CAN_RUN, webgl: null })).toEqual({
			view: "2d",
			reason: null,
		})
	})

	it("names reduced motion before a missing WebGL, because that is the viewer's own setting", () => {
		expect(
			chooseView({ ...CAN_RUN, reducedMotion: true, webgl: false }),
		).toEqual({ view: "2d", reason: "reduced-motion" })
	})
})

describe("createFrameMonitor", () => {
	const feedSeconds = (
		monitor: ReturnType<typeof createFrameMonitor>,
		seconds: number,
		fps: number,
		hidden = false,
	) => {
		let verdict: ReturnType<typeof monitor.feed> = null
		const frames = Math.round(seconds * fps)
		for (let i = 0; i < frames; i++) {
			verdict = monitor.feed(1 / fps, hidden) ?? verdict
		}
		return verdict
	}

	it("keeps a scene that holds its frame rate", () => {
		const monitor = createFrameMonitor()
		expect(feedSeconds(monitor, 10, 60)).toBeNull()
	})

	it("degrades after three consecutive slow seconds, not before", () => {
		const monitor = createFrameMonitor()
		expect(feedSeconds(monitor, 2.5, 10)).toBeNull()
		expect(feedSeconds(monitor, 1.5, 10)).toBe("slow")
	})

	it("starts counting again after one good second", () => {
		const monitor = createFrameMonitor()
		expect(feedSeconds(monitor, 2.5, 10)).toBeNull()
		expect(feedSeconds(monitor, 1.5, 60)).toBeNull()
		expect(feedSeconds(monitor, 2.5, 10)).toBeNull()
	})

	it("does not count a hidden tab, or a stall longer than half a second", () => {
		const hidden = createFrameMonitor()
		expect(feedSeconds(hidden, 10, 5, true)).toBeNull()
		const stalled = createFrameMonitor()
		for (let i = 0; i < 10; i++) {
			expect(stalled.feed(0.9, false)).toBeNull()
		}
	})

	it("forgets what it saw when the scene goes idle", () => {
		const monitor = createFrameMonitor()
		expect(feedSeconds(monitor, 2.5, 10)).toBeNull()
		monitor.reset()
		expect(feedSeconds(monitor, 2.5, 10)).toBeNull()
	})
})
