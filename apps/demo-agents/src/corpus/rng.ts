// mulberry32: small, fast and stable across platforms, so a seed always
// yields the same world.
export type Rng = {
	next(): number
	int(min: number, max: number): number
	pick<T>(items: readonly T[]): T
	sample<T>(items: readonly T[], count: number): T[]
	chance(probability: number): boolean
}

export function createRng(seed: number): Rng {
	let state = seed >>> 0
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	const int = (min: number, max: number) =>
		min + Math.floor(next() * (max - min + 1))
	const pick = <T>(items: readonly T[]): T => {
		const item = items[Math.floor(next() * items.length)]
		if (item === undefined) throw new Error("pick from an empty list")
		return item
	}
	const sample = <T>(items: readonly T[], count: number): T[] => {
		const copy = [...items]
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(next() * (i + 1))
			;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
		}
		return copy.slice(0, count)
	}
	return { next, int, pick, sample, chance: (p) => next() < p }
}
