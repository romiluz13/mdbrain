// The one place React, GSAP and the R3F frame loop meet. It owns no rendering.
//
// Owners, one per property: GSAP tweens `pose` (the group's shift and turn and
// the camera distance); the frame loop alone advances `drift`. A flight holds
// the drift first, so no property ever has two writers at once.

import { type Pose, homePose } from "./camera-pose.js"

/** Slow enough that a full turn takes about a minute and a half. */
export const DRIFT_RADIANS_PER_SECOND = 0.07
/** Ambient motion rests after this long, so an idle page asks for no frames. */
export const DRIFT_SECONDS = 10
const OPENING_YAW = 0.5

export type SceneStore = {
	/** Tweened by GSAP; read by the frame loop. */
	pose: Pose
	/** The resting pose, which a camera flight returns to. */
	home: Pose
	/** Advanced only by `advance`, which only the frame loop calls. */
	drift: number
	/** How far the stored link between the framed pages is drawn, 0 to 1.
	 * Tweened by GSAP. */
	lit: number
	/** Where the camera looks from, in radians about the vertical axis. Written
	 * by the frame loop, read by whatever frames a pair. */
	azimuth: number
	/** Moves the resting pose to suit a stage of this width over height. */
	setAspect: (aspect: number) => void
	/** Starts, or restarts, a window of drift. */
	wake: () => void
	/** Holds the drift still (during a flight) or lets it be woken again. */
	hold: (on: boolean) => void
	isHeld: () => boolean
	/** Ends the current window of drift, for when the viewer takes hold. */
	rest: () => void
	/** False while the viewer asks for reduced motion. */
	allowMotion: (on: boolean) => void
	/** One frame's step. True while the drift still wants frames. */
	advance: (deltaSeconds: number) => boolean
	subscribe: (listener: () => void) => () => void
	/** Asks for a frame. */
	invalidate: () => void
	listenerCount: () => number
	dispose: () => void
}

export function createSceneStore(aspect: number): SceneStore {
	const listeners = new Set<() => void>()
	let remaining = 0
	let held = false
	let allowed = true
	const store: SceneStore = {
		pose: homePose(aspect, OPENING_YAW),
		home: homePose(aspect, OPENING_YAW),
		drift: 0,
		lit: 0,
		azimuth: 0,
		setAspect(next) {
			const resting = homePose(next, store.home.yaw)
			const atHome = store.pose.d === store.home.d
			store.home.d = resting.d
			if (atHome) {
				store.pose.d = resting.d
			}
		},
		wake() {
			if (allowed && !held) {
				remaining = DRIFT_SECONDS
			}
		},
		hold(on) {
			held = on
			if (on) {
				remaining = 0
			}
		},
		isHeld: () => held,
		rest() {
			remaining = 0
		},
		allowMotion(on) {
			allowed = on
			if (!on) {
				remaining = 0
			}
		},
		advance(deltaSeconds) {
			if (remaining <= 0 || held || !allowed) {
				return false
			}
			store.drift += deltaSeconds * DRIFT_RADIANS_PER_SECOND
			remaining -= deltaSeconds
			return remaining > 0
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		invalidate() {
			for (const listener of listeners) {
				listener()
			}
		},
		listenerCount: () => listeners.size,
		dispose() {
			remaining = 0
			listeners.clear()
		},
	}
	return store
}
