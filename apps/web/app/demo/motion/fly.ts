// The camera flight for chapter 5: GSAP carries the scene store's pose to the
// frame that holds two pages side by side, and carries it back when the reader
// steps back. GSAP is the only writer of the pose while the drift is held, so no
// property has two owners.

import gsap from "gsap"
import {
	type Pose,
	type Vec3,
	copyPose,
	framePair,
	nearestTurn,
} from "../../../lib/demo-data/camera-pose.js"
import type { SceneStore } from "../../../lib/demo-data/scene-store.js"

const FLIGHT_SECONDS = 0.8
const LIGHT_SECONDS = 0.5
const LIGHT_AT = 0.5
const DIM_SECONDS = 0.3

export function createFlight(store: SceneStore) {
	let rest: Pose | null = null
	let move: gsap.core.Timeline | null = null
	let flying = false
	const kill = () => {
		move?.kill()
		move = null
		flying = false
	}
	const begin = (onComplete?: () => void) => {
		flying = true
		return gsap.timeline({
			onUpdate: store.invalidate,
			onComplete: () => {
				flying = false
				onComplete?.()
			},
		})
	}
	return {
		/** Flies to the frame that holds the pair; lights the stored link between
		 * them as the camera arrives when there is one. */
		frame(a: Vec3, b: Vec3, aspect: number, link: boolean) {
			kill()
			rest ??= copyPose(store.pose)
			store.hold(true)
			const target = framePair({ a, b, azimuth: store.azimuth, aspect })
			// The drift is already part of what the viewer sees, so the pose turns
			// by what is left, and by the short way.
			const yaw = nearestTurn(store.pose.yaw, target.yaw - store.drift)
			move = begin()
			move.to(store.pose, {
				gx: target.gx,
				gy: target.gy,
				gz: target.gz,
				yaw,
				d: target.d,
				duration: FLIGHT_SECONDS,
				ease: "power3.inOut",
			})
			if (link) {
				move.to(
					store,
					{ lit: 1, duration: LIGHT_SECONDS, ease: "power2.out" },
					LIGHT_AT,
				)
			}
			return move
		},
		/** The move reversed: back to where the camera was, link dimmed. Null when
		 * nothing was flown. */
		release() {
			if (rest === null) {
				return null
			}
			kill()
			const back = rest
			rest = null
			move = begin(() => store.hold(false))
			move.to(store, { lit: 0, duration: DIM_SECONDS, ease: "power2.in" }, 0)
			move.to(
				store.pose,
				{ ...back, duration: FLIGHT_SECONDS, ease: "power3.inOut" },
				0,
			)
			return move
		},
		/** True while the camera is under way: the frames are then continuous. */
		active: () => flying,
		kill,
	}
}
