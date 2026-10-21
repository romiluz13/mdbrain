import { describe, expect, it } from "vitest"
import { NodeGrid } from "./node-grid.js"

const grid = (points: Array<[number, number]>) =>
	new NodeGrid(
		Float32Array.from(points.map((p) => p[0])),
		Float32Array.from(points.map((p) => p[1])),
		24,
	)

describe("NodeGrid", () => {
	it("finds the nearest node within reach, across a cell border", () => {
		const g = grid([
			[10, 10],
			[40, 10],
			[200, 200],
		])
		expect(g.nearest(23, 10, 20)).toBe(0)
		expect(g.nearest(27, 10, 20)).toBe(1)
		expect(g.nearest(199, 203, 20)).toBe(2)
	})

	it("returns -1 when nothing is within reach", () => {
		const g = grid([[10, 10]])
		expect(g.nearest(100, 100, 20)).toBe(-1)
		expect(g.nearest(10, 40, 20)).toBe(-1)
	})

	it("breaks a tie toward the lower index and copes with negative and empty input", () => {
		const g = grid([
			[-5, -5],
			[5, -5],
		])
		expect(g.nearest(0, -5, 20)).toBe(0)
		expect(grid([]).nearest(0, 0, 20)).toBe(-1)
	})
})
