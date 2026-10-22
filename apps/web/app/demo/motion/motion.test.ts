import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MotionSeam } from "./motion.js"

type Listener = (event: { matches: boolean }) => void

function fakeWindow(initiallyReduced: boolean) {
	const lists = new Map<
		string,
		{ matches: boolean; listeners: Set<Listener>; media: string }
	>()
	const added: string[] = []
	let reduced = initiallyReduced
	const matchesOf = (query: string) =>
		query.endsWith(": reduce)") ? reduced : !reduced
	const window = {
		matchMedia(query: string) {
			let entry = lists.get(query)
			if (!entry) {
				entry = {
					matches: matchesOf(query),
					listeners: new Set(),
					media: query,
				}
				lists.set(query, entry)
			}
			const held = entry
			return {
				get matches() {
					return held.matches
				},
				media: query,
				addEventListener: (_type: string, listener: Listener) => {
					added.push(query)
					held.listeners.add(listener)
				},
				removeEventListener: (_type: string, listener: Listener) => {
					held.listeners.delete(listener)
				},
				addListener: (listener: Listener) => {
					added.push(query)
					held.listeners.add(listener)
				},
				removeListener: (listener: Listener) => {
					held.listeners.delete(listener)
				},
			}
		},
		setTimeout,
		requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
		cancelAnimationFrame: clearTimeout,
	}
	return {
		window,
		added,
		// A browser re-evaluates every media query before it fires any change event.
		change(nextReduced: boolean) {
			reduced = nextReduced
			for (const [query, entry] of lists) {
				entry.matches = matchesOf(query)
			}
			for (const entry of lists.values()) {
				for (const listener of [...entry.listeners]) {
					listener({ matches: entry.matches })
				}
			}
		},
	}
}

async function load(initiallyReduced: boolean) {
	vi.resetModules()
	const fake = fakeWindow(initiallyReduced)
	vi.stubGlobal("window", fake.window)
	vi.stubGlobal("document", { hidden: false })
	const motion = await import("./motion.js")
	return { ...fake, motion }
}

describe("the reduced-motion store", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("reads the setting before anything is drawn", async () => {
		const calm = await load(true)
		expect(calm.motion.motionReduced()).toBe(true)
		const lively = await load(false)
		expect(lively.motion.motionReduced()).toBe(false)
	})

	it("follows the setting when it changes while the page is open, and tells subscribers", async () => {
		const { motion, change } = await load(false)
		const heard = vi.fn()
		motion.subscribeMotion(heard)
		change(true)
		expect(motion.motionReduced()).toBe(true)
		expect(heard).toHaveBeenCalled()
		// GSAP ignores a second change in the same two milliseconds.
		vi.advanceTimersByTime(10)
		change(false)
		expect(motion.motionReduced()).toBe(false)
	})

	it("registers its media conditions once, however many components subscribe and leave", async () => {
		const { motion, added } = await load(false)
		motion.motionReduced()
		const first = added.length
		expect(first).toBeGreaterThan(0)
		for (let i = 0; i < 25; i++) {
			const stop = motion.subscribeMotion(() => undefined)
			motion.motionReduced()
			stop()
		}
		expect(added.length).toBe(first)
		expect(first).toBeLessThanOrEqual(2)
	})

	it("stops telling a subscriber that has left", async () => {
		const { motion, change } = await load(false)
		const heard = vi.fn()
		const stop = motion.subscribeMotion(heard)
		stop()
		change(true)
		expect(heard).not.toHaveBeenCalled()
	})
})

describe("the motion seam", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("counts the tweens that are still to run, so a test can tell when the page has settled", async () => {
		const { motion, window } = await load(false)
		motion.motionReduced()
		const seam = Reflect.get(window, motion.MOTION_SEAM) as MotionSeam
		expect(seam.reduced()).toBe(false)
		const idle = seam.tweens()
		const gsap = (await import("gsap")).default
		const tween = gsap.to({ value: 0 }, { value: 1, duration: 1 })
		expect(seam.tweens()).toBe(idle + 1)
		tween.progress(1)
		vi.advanceTimersByTime(100)
		expect(seam.tweens()).toBe(idle)
	})

	it("reports a reduced-motion setting that changes", async () => {
		const { motion, window, change } = await load(false)
		motion.motionReduced()
		const seam = Reflect.get(window, motion.MOTION_SEAM) as MotionSeam
		change(true)
		expect(seam.reduced()).toBe(true)
	})
})
