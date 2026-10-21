import { describe, expect, it } from "vitest"
import { layoutSphere } from "./graph-layout3.js"
import type { LayoutNode } from "./graph-layout.js"

const GROUPS = ["account", "person", "product", "policy", "incident"]

function nodes(count: number): LayoutNode[] {
	return Array.from({ length: count }, (_, i) => ({
		slug: `page-${String(i).padStart(3, "0")}`,
		group: GROUPS[i % GROUPS.length] as string,
		degree: (i * 7) % 9,
	}))
}

const dist = (
	l: { x: Float32Array; y: Float32Array; z: Float32Array },
	i: number,
) => Math.hypot(l.x[i] as number, l.y[i] as number, l.z[i] as number)

describe("layoutSphere", () => {
	it("is deterministic: the same input gives the same coordinates", () => {
		const input = nodes(110)
		const a = layoutSphere(input, 0, GROUPS)
		const b = layoutSphere(input, 0, GROUPS)
		expect([...a.x]).toEqual([...b.x])
		expect([...a.y]).toEqual([...b.y])
		expect([...a.z]).toEqual([...b.z])
	})

	it("gives every node a finite coordinate inside the unit sphere", () => {
		const layout = layoutSphere(nodes(250), 3, GROUPS)
		expect(layout.x.length).toBe(250)
		for (let i = 0; i < 250; i++) {
			for (const axis of [layout.x, layout.y, layout.z]) {
				expect(Number.isFinite(axis[i])).toBe(true)
			}
			expect(dist(layout, i)).toBeLessThanOrEqual(1.0001)
		}
	})

	it("puts the hub at the origin", () => {
		const layout = layoutSphere(nodes(110), 5, GROUPS)
		expect(dist(layout, 5)).toBe(0)
	})

	it("keeps pages of one group together and the groups apart", () => {
		const input = nodes(150)
		const layout = layoutSphere(input, 0, GROUPS)
		const centroid = (group: string) => {
			const members = input
				.map((node, i) => (node.group === group && i !== 0 ? i : -1))
				.filter((i) => i >= 0)
			const sum = [0, 0, 0]
			for (const i of members) {
				sum[0] = (sum[0] as number) + (layout.x[i] as number)
				sum[1] = (sum[1] as number) + (layout.y[i] as number)
				sum[2] = (sum[2] as number) + (layout.z[i] as number)
			}
			return sum.map((value) => value / members.length)
		}
		const centroids = GROUPS.map(centroid)
		for (let i = 0; i < centroids.length; i++) {
			for (let j = i + 1; j < centroids.length; j++) {
				const a = centroids[i] as number[]
				const b = centroids[j] as number[]
				expect(
					Math.hypot(
						(a[0] as number) - (b[0] as number),
						(a[1] as number) - (b[1] as number),
						(a[2] as number) - (b[2] as number),
					),
				).toBeGreaterThan(0.3)
			}
		}
	})

	it("places the most connected page of a group nearest the core", () => {
		const input: LayoutNode[] = [
			{ slug: "hub", group: "account", degree: 9 },
			{ slug: "a", group: "person", degree: 1 },
			{ slug: "b", group: "person", degree: 6 },
			{ slug: "c", group: "person", degree: 3 },
		]
		const layout = layoutSphere(input, 0, ["account", "person"])
		expect(dist(layout, 2)).toBeLessThan(dist(layout, 3))
		expect(dist(layout, 3)).toBeLessThan(dist(layout, 1))
	})

	it("never lets two pages share a position", () => {
		const layout = layoutSphere(nodes(250), 0, GROUPS)
		const seen = new Set<string>()
		for (let i = 0; i < 250; i++) {
			seen.add(
				[layout.x[i], layout.y[i], layout.z[i]]
					.map((value) => (value as number).toFixed(4))
					.join(","),
			)
		}
		expect(seen.size).toBe(250)
	})

	it("handles an empty graph, a lone hub and a group it was not told about", () => {
		expect(layoutSphere([], 0, GROUPS).x.length).toBe(0)
		const lone = layoutSphere(
			[{ slug: "a", group: "account", degree: 0 }],
			0,
			GROUPS,
		)
		expect(dist(lone, 0)).toBe(0)
		const odd = layoutSphere(
			[
				{ slug: "a", group: "account", degree: 2 },
				{ slug: "b", group: "mystery", degree: 1 },
			],
			0,
			GROUPS,
		)
		expect(Number.isFinite(odd.x[1])).toBe(true)
		expect(dist(odd, 1)).toBeGreaterThan(0)
	})

	it("does its work in well under a second for the largest graph it is asked to draw", () => {
		const started = performance.now()
		layoutSphere(nodes(250), 0, GROUPS)
		expect(performance.now() - started).toBeLessThan(200)
	})
})
