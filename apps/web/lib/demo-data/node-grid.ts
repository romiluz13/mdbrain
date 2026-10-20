// A uniform grid over the projected node positions, so a pointer asks "which
// node is here" in constant time instead of scanning every node.

export class NodeGrid {
	private readonly cells = new Map<number, number[]>()

	constructor(
		private readonly x: Float32Array,
		private readonly y: Float32Array,
		private readonly cell: number,
	) {
		for (let i = 0; i < x.length; i++) {
			const key = this.key(this.col(x[i] as number), this.col(y[i] as number))
			const bucket = this.cells.get(key)
			if (bucket) {
				bucket.push(i)
			} else {
				this.cells.set(key, [i])
			}
		}
	}

	private col(value: number): number {
		return Math.floor(value / this.cell)
	}

	private key(col: number, row: number): number {
		return (col + 32768) * 65536 + (row + 32768)
	}

	/** Index of the nearest node within `reach` pixels of (px, py), else -1. */
	nearest(px: number, py: number, reach: number): number {
		const span = Math.ceil(reach / this.cell)
		const col = this.col(px)
		const row = this.col(py)
		let best = -1
		let bestDistance = reach * reach
		for (let c = col - span; c <= col + span; c++) {
			for (let r = row - span; r <= row + span; r++) {
				const bucket = this.cells.get(this.key(c, r))
				if (!bucket) {
					continue
				}
				for (const i of bucket) {
					const dx = (this.x[i] as number) - px
					const dy = (this.y[i] as number) - py
					const distance = dx * dx + dy * dy
					if (
						distance < bestDistance ||
						(distance === bestDistance && best !== -1 && i < best)
					) {
						bestDistance = distance
						best = i
					}
				}
			}
		}
		return best
	}
}
