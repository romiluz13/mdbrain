// The viewer's reduced-motion setting, for every animation on /demo. GSAP's
// matchMedia() attaches a `change` listener per condition that neither revert()
// nor kill() ever removes, so the conditions are registered here, once, and
// components subscribe to this store instead of making their own.

import gsap from "gsap"

/** Where tests and the bounds check read how much motion is still to run. */
export const MOTION_SEAM = Symbol.for("mdbrain.demo.motion")

export type MotionSeam = {
	/** Tweens GSAP has yet to finish, nested ones included. */
	tweens: () => number
	reduced: () => boolean
}

const listeners = new Set<() => void>()
let reduced = false

// Registered when this module loads in a browser, once for the page's life.
if (typeof window !== "undefined") {
	const seam: MotionSeam = {
		tweens: () => gsap.globalTimeline.getChildren(true, true, false).length,
		reduced: () => reduced,
	}
	Reflect.set(window, MOTION_SEAM, seam)
	gsap.matchMedia().add(
		{
			full: "(prefers-reduced-motion: no-preference)",
			reduced: "(prefers-reduced-motion: reduce)",
		},
		(context) => {
			const next = context.conditions?.reduced === true
			if (next !== reduced) {
				reduced = next
				for (const listener of [...listeners]) {
					listener()
				}
			}
		},
	)
}

/** True while the viewer asks for reduced motion. */
export function motionReduced(): boolean {
	return reduced
}

export function subscribeMotion(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
