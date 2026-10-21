// Camera math for the 3D brain, kept out of the render loop so it can be tested
// on its own. The camera orbits the origin at a distance; the world group is
// turned and shifted so whatever the chapter is about sits at that origin.

export type Vec3 = [number, number, number]

/** The pose GSAP tweens: the group's shift and turn, and the camera distance. */
export type Pose = {
	gx: number
	gy: number
	gz: number
	/** The group's turn about the vertical axis, drift excluded. */
	yaw: number
	d: number
}

export const FOV_DEGREES = 42
export const HOME_DISTANCE = 3
export const MIN_DISTANCE = 1.3
/** The sphere's radius is 1; this much margin keeps its edge pages in view. */
const SPHERE_MARGIN = 1.15
/** How much of the half-field the pair may fill, and the room kept around it. */
const FIT = 0.62
const PAD = 0.12

const tanHalfFov = Math.tan((FOV_DEGREES * Math.PI) / 360)

/** Far enough that the whole sphere shows, on a stage of any shape. */
export function homeDistance(aspect: number): number {
	const width = aspect > 0 ? aspect : 1
	return Math.max(HOME_DISTANCE, SPHERE_MARGIN / (tanHalfFov * width))
}

/** The resting pose: the whole brain, nothing shifted. */
export function homePose(aspect: number, yaw = 0): Pose {
	return { gx: 0, gy: 0, gz: 0, yaw, d: homeDistance(aspect) }
}

type Frame = { a: Vec3; b: Vec3; azimuth: number; aspect: number }

/** The pose that frames two pages: their middle at the center, turned side-on to
 * a camera at `azimuth` with the first page on the left, close enough to fill
 * the stage and no closer than the minimum or farther than home. */
export function framePair({ a, b, azimuth, aspect }: Frame): Pose {
	const dx = b[0] - a[0]
	const dy = b[1] - a[1]
	const dz = b[2] - a[2]
	let yaw = azimuth + Math.atan2(dz, dx)
	const turnedX = dx * Math.cos(yaw) + dz * Math.sin(yaw)
	const turnedZ = -dx * Math.sin(yaw) + dz * Math.cos(yaw)
	if (turnedX * Math.cos(azimuth) - turnedZ * Math.sin(azimuth) < 0) {
		yaw += Math.PI
	}
	const mx = (a[0] + b[0]) / 2
	const my = (a[1] + b[1]) / 2
	const mz = (a[2] + b[2]) / 2
	const cos = Math.cos(yaw)
	const sin = Math.sin(yaw)
	const width = aspect > 0 ? aspect : 1
	const across = Math.hypot(dx, dz) / 2 + PAD
	const up = Math.abs(dy) / 2 + PAD
	const wanted = Math.max(
		MIN_DISTANCE,
		across / (FIT * tanHalfFov * width),
		up / (FIT * tanHalfFov),
	)
	return {
		gx: -(mx * cos + mz * sin),
		gy: -my,
		gz: -(-mx * sin + mz * cos),
		yaw,
		d: Math.min(wanted, homeDistance(width)),
	}
}

/** The angle equal to `target` (a full turn apart at most) that is nearest
 * `current`, so a tween turns the short way and never spins. */
export function nearestTurn(current: number, target: number): number {
	const full = Math.PI * 2
	return target + Math.round((current - target) / full) * full
}
