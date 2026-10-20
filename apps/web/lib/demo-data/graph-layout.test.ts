import { describe, expect, it } from "vitest"
import { layoutRadial, type LayoutNode } from "./graph-layout.js"

const ORDER = ["account", "person", "team", "product"]

function nodes(count: number): LayoutNode[] {
	const groups = ["account", "account", "account", "person", "team", "product"]
	return Array.from({ length: count }, (_, index) => ({
		slug: `page-${String(index).padStart(5, "0")}`,
		group: groups[index % groups.length] as string,
		degree: (index * 7) % 11,
	}))
}

describe("layoutRadial", () => {
	it("keeps every node inside the unit disc and puts the hub at the center", () => {
		const input = nodes(250)
		const { x, y } = layoutRadial(input, 3, ORDER)
		expect(x).toHaveLength(250)
		expect(y).toHaveLength(250)
		for (let i = 0; i < 250; i++) {
			expect(Math.hypot(x[i] as number, y[i] as number)).toBeLessThanOrEqual(
				1.0001,
			)
		}
		expect([x[3], y[3]]).toEqual([0, 0])
	})

	it("is deterministic: the same pages always land in the same places", () => {
		const a = layoutRadial(nodes(109), 0, ORDER)
		const b = layoutRadial(nodes(109), 0, ORDER)
		expect(Array.from(a.x)).toEqual(Array.from(b.x))
		expect(Array.from(a.y)).toEqual(Array.from(b.y))
	})

	it("keeps nodes apart at the 250-node budget, so labels and hit targets stay legible", () => {
		const { x, y } = layoutRadial(nodes(250), 0, ORDER)
		let min = Number.POSITIVE_INFINITY
		for (let i = 0; i < 250; i++) {
			for (let j = i + 1; j < 250; j++) {
				min = Math.min(
					min,
					Math.hypot(
						(x[i] as number) - (x[j] as number),
						(y[i] as number) - (y[j] as number),
					),
				)
			}
		}
		expect(min).toBeGreaterThan(0.012)
	})

	it("places the more connected pages of a group nearer the center", () => {
		const input: LayoutNode[] = [
			{ slug: "hub", group: "account", degree: 9 },
			{ slug: "low", group: "person", degree: 1 },
			{ slug: "mid", group: "person", degree: 5 },
			{ slug: "top", group: "person", degree: 8 },
		]
		const { x, y } = layoutRadial(input, 0, ORDER)
		const radius = (i: number) => Math.hypot(x[i] as number, y[i] as number)
		expect(radius(3)).toBeLessThan(radius(2))
		expect(radius(2)).toBeLessThan(radius(1))
	})

	it("puts a group in its own sector: no two groups share an angle", () => {
		const input = nodes(120)
		const { x, y } = layoutRadial(input, 0, ORDER)
		const ranges = new Map<string, [number, number]>()
		input.forEach((node, i) => {
			if (i === 0) return
			// Measured from the first sector's start (straight up) so a sector
			// that crosses the atan2 seam still reads as one range.
			const angle =
				(Math.atan2(y[i] as number, x[i] as number) +
					Math.PI / 2 +
					4 * Math.PI) %
				(2 * Math.PI)
			const range = ranges.get(node.group) ?? [angle, angle]
			ranges.set(node.group, [
				Math.min(range[0], angle),
				Math.max(range[1], angle),
			])
		})
		const spans = [...ranges.values()].sort((a, b) => a[0] - b[0])
		for (let i = 1; i < spans.length; i++) {
			expect((spans[i] as [number, number])[0]).toBeGreaterThan(
				(spans[i - 1] as [number, number])[1] - 1e-6,
			)
		}
	})

	it("handles no nodes and a single node", () => {
		expect(layoutRadial([], 0, ORDER).x).toHaveLength(0)
		const one = layoutRadial(
			[{ slug: "a", group: "account", degree: 0 }],
			0,
			ORDER,
		)
		expect([one.x[0], one.y[0]]).toEqual([0, 0])
	})

	it("does not grow quadratically: five thousand nodes lay out well inside a second", () => {
		const input = nodes(5000)
		const started = performance.now()
		layoutRadial(input, 0, ORDER)
		expect(performance.now() - started).toBeLessThan(1000)
	})
})
