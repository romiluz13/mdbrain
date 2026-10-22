import { describe, expect, it } from "vitest"
import type { ViewChoice } from "./scene-gate.js"
import { describeView } from "./view-copy.js"

const flat = (
	reason: Extract<ViewChoice, { view: "2d" }>["reason"],
): ViewChoice => ({
	view: "2d",
	reason,
})

describe("describeView", () => {
	it("tells a mouse user how to turn the 3D map, and a touch user how to read it", () => {
		const mouse = describeView({ view: "3d" }, { coarse: false, drawn: true })
		const touch = describeView({ view: "3d" }, { coarse: true, drawn: true })
		expect(mouse.status).toMatch(/drag/i)
		expect(touch.status).not.toMatch(/drag/i)
		expect(touch.status).toMatch(/tap/i)
	})

	it("says the flat map is showing until the 3D map has drawn, and still offers the switch", () => {
		const loading = describeView(
			{ view: "3d" },
			{ coarse: false, drawn: false },
		)
		expect(loading.status).toMatch(/flat map/i)
		expect(loading.status).toMatch(/loading/i)
		expect(loading.status).not.toMatch(/drag/i)
		expect(loading.action).toBe("2d")
	})

	it("always offers the way back to the flat map from the 3D one", () => {
		expect(
			describeView({ view: "3d" }, { coarse: false, drawn: true }).action,
		).toBe("2d")
		expect(
			describeView({ view: "3d" }, { coarse: true, drawn: true }).action,
		).toBe("2d")
	})

	it("offers 3D again only where it was the viewer's own choice that made the map flat", () => {
		expect(
			describeView(flat("chosen"), { coarse: false, drawn: true }).action,
		).toBe("3d")
		for (const reason of [
			"reduced-motion",
			"no-webgl",
			"over-budget",
			"slow",
			"context-lost",
			"failed",
		] as const) {
			expect(
				describeView(flat(reason), { coarse: false, drawn: true }).action,
			).toBeNull()
		}
	})

	it("says why the map is flat in a sentence a visitor can follow", () => {
		const reasons = [
			"reduced-motion",
			"no-webgl",
			"over-budget",
			"slow",
			"context-lost",
			"failed",
			"chosen",
		] as const
		const sentences = reasons.map(
			(reason) =>
				describeView(flat(reason), { coarse: false, drawn: true }).status,
		)
		for (const sentence of sentences) {
			expect(sentence).toMatch(/^Flat map/)
			expect(sentence.length).toBeGreaterThan(20)
		}
		expect(new Set(sentences).size).toBe(reasons.length)
	})

	it("says nothing while it is still finding out what the device can do", () => {
		const waiting = describeView(flat(null), { coarse: false, drawn: true })
		expect(waiting.status).toBe("")
		expect(waiting.action).toBeNull()
	})
})
