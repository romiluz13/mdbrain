// Spherical layout for the /demo brain in 3D: one direction on a sphere per
// page group, the most connected pages of a group nearest the center, the hub at
// the origin. Pure and deterministic, O(n log n) (a sort per group), like the
// flat layout it sits beside, so it never costs the main thread a pairwise pass.

import type { LayoutNode } from "./graph-layout.js"

export type Layout3 = {
	/** Unit-sphere coordinates, indexed like the input nodes. */
	x: Float32Array
	y: Float32Array
	z: Float32Array
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
// Keeps the innermost pages clear of the hub's own mark.
const CORE_RADIUS = 0.16

type Vec = [number, number, number]

const cross = (a: Vec, b: Vec): Vec => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
]

const unit = (a: Vec): Vec => {
	const length = Math.hypot(a[0], a[1], a[2]) || 1
	return [a[0] / length, a[1] / length, a[2] / length]
}

/** The i-th of `count` evenly spread directions on a sphere. */
function direction(i: number, count: number): Vec {
	const y = 1 - (2 * (i + 0.5)) / count
	const ring = Math.sqrt(Math.max(0, 1 - y * y))
	const angle = i * GOLDEN_ANGLE
	return [ring * Math.cos(angle), y, ring * Math.sin(angle)]
}

export function layoutSphere(
	nodes: readonly LayoutNode[],
	hub: number,
	groupOrder: readonly string[],
): Layout3 {
	const x = new Float32Array(nodes.length)
	const y = new Float32Array(nodes.length)
	const z = new Float32Array(nodes.length)
	const byGroup = new Map<string, number[]>()
	for (const group of groupOrder) {
		byGroup.set(group, [])
	}
	nodes.forEach((node, position) => {
		if (position === hub) {
			return
		}
		const members = byGroup.get(node.group)
		if (members) {
			members.push(position)
		} else {
			byGroup.set(node.group, [position])
		}
	})
	const groups = [...byGroup.values()].filter((members) => members.length > 0)
	if (groups.length === 0) {
		return { x, y, z }
	}
	// A group's cone widens with its share of the pages, so a crowd of pages
	// spreads through the volume instead of piling on its axis.
	const total = groups.reduce((sum, members) => sum + members.length, 0)
	const capOf = (members: number[]) =>
		Math.min(
			1.05,
			Math.max(0.36, 0.32 + 0.85 * Math.sqrt(members.length / total)),
		)
	groups.forEach((members, at) => {
		const axis = direction(at, groups.length)
		const helper: Vec = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
		const u = unit(cross(helper, axis))
		const v = cross(axis, u)
		members.sort((a, b) => {
			const left = nodes[a] as LayoutNode
			const right = nodes[b] as LayoutNode
			return (
				right.degree - left.degree ||
				(left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0)
			)
		})
		members.forEach((position, rank) => {
			const share = (rank + 0.5) / members.length
			const radius = CORE_RADIUS + (1 - CORE_RADIUS) * Math.sqrt(share)
			const tilt = capOf(members) * Math.sqrt(share)
			const turn = rank * GOLDEN_ANGLE
			const along = Math.cos(tilt)
			const across = Math.sin(tilt)
			x[position] =
				radius *
				(along * axis[0] +
					across * (Math.cos(turn) * u[0] + Math.sin(turn) * v[0]))
			y[position] =
				radius *
				(along * axis[1] +
					across * (Math.cos(turn) * u[1] + Math.sin(turn) * v[1]))
			z[position] =
				radius *
				(along * axis[2] +
					across * (Math.cos(turn) * u[2] + Math.sin(turn) * v[2]))
		})
	})
	return { x, y, z }
}
