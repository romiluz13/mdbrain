// Radial layout for the /demo brain map: one angular sector per page group,
// the most connected pages of a group nearest the center, the hub at the
// origin. Pure and deterministic, O(n log n) (a sort per group), so it can run
// in a Worker and never costs the main thread a pairwise pass.

export type LayoutNode = { slug: string; group: string; degree: number }

export type Layout = {
	/** Unit-disc coordinates, indexed like the input nodes. */
	x: Float32Array
	y: Float32Array
}

const FULL_TURN = Math.PI * 2
const GOLDEN = 0.6180339887498949
// Keeps the innermost ring clear of the hub's own mark.
const CORE_RADIUS = 0.14
const SECTOR_GAP = 0.07

function fraction(value: number): number {
	return value - Math.floor(value)
}

export function layoutRadial(
	nodes: readonly LayoutNode[],
	hub: number,
	groupOrder: readonly string[],
): Layout {
	const x = new Float32Array(nodes.length)
	const y = new Float32Array(nodes.length)
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
	const sectors = [...byGroup.values()].filter((members) => members.length > 0)
	const placed = sectors.reduce((total, members) => total + members.length, 0)
	if (placed === 0) {
		return { x, y }
	}
	const gap = sectors.length > 1 ? SECTOR_GAP : 0
	const available = FULL_TURN - gap * sectors.length
	let start = -Math.PI / 2
	for (const members of sectors) {
		const width = (available * members.length) / placed
		members.sort((a, b) => {
			const left = nodes[a] as LayoutNode
			const right = nodes[b] as LayoutNode
			return (
				right.degree - left.degree ||
				(left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0)
			)
		})
		const margin = width * 0.06
		members.forEach((position, rank) => {
			const radius =
				CORE_RADIUS +
				(1 - CORE_RADIUS) * Math.sqrt((rank + 0.5) / members.length)
			const angle = start + margin + (width - 2 * margin) * fraction((rank + 1) * GOLDEN)
			x[position] = Math.cos(angle) * radius
			y[position] = Math.sin(angle) * radius
		})
		start += width + gap
	}
	return { x, y }
}
