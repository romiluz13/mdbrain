import { describe, expect, it } from "vitest"
import {
	FOV_DEGREES,
	nearestTurn,
	HOME_DISTANCE,
	MIN_DISTANCE,
	framePair,
	homeDistance,
	type Vec3,
} from "./camera-pose.js"

const rotateY = (point: Vec3, yaw: number): Vec3 => [
	point[0] * Math.cos(yaw) + point[2] * Math.sin(yaw),
	point[1],
	-point[0] * Math.sin(yaw) + point[2] * Math.cos(yaw),
]

/** Where a world point sits on screen for a camera orbiting the origin at the
 * given azimuth, in units of the vertical half-field at the pose's distance. */
function onScreen(
	pose: { gx: number; gy: number; gz: number; yaw: number; d: number },
	local: Vec3,
	azimuth: number,
	aspect: number,
) {
	const turned = rotateY(local, pose.yaw)
	const world: Vec3 = [
		turned[0] + pose.gx,
		turned[1] + pose.gy,
		turned[2] + pose.gz,
	]
	const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)]
	const toward: Vec3 = [Math.sin(azimuth), 0, Math.cos(azimuth)]
	const x = world[0] * right[0] + world[2] * right[2]
	const depth = pose.d - (world[0] * toward[0] + world[2] * toward[2])
	const half = Math.tan((FOV_DEGREES * Math.PI) / 360) * depth
	return { x: x / (half * aspect), y: world[1] / half }
}

const PAIRS: Array<[Vec3, Vec3]> = [
	[
		[0.5, 0.2, 0.1],
		[-0.4, -0.1, 0.3],
	],
	[
		[0.1, 0.6, -0.5],
		[0.2, -0.3, 0.6],
	],
	[
		[-0.6, 0, 0],
		[0.6, 0, 0],
	],
	[
		[0, 0, 0.7],
		[0, 0, -0.7],
	],
	[
		[0.3, 0.3, 0.3],
		[0.31, 0.3, 0.3],
	],
]

describe("framePair", () => {
	it("brings the middle of the pair to the middle of the view", () => {
		for (const [a, b] of PAIRS) {
			for (const azimuth of [0, 0.9, -2.2, 3.1]) {
				const pose = framePair({ a, b, azimuth, aspect: 1 })
				const middle: Vec3 = [
					(a[0] + b[0]) / 2,
					(a[1] + b[1]) / 2,
					(a[2] + b[2]) / 2,
				]
				const seen = onScreen(pose, middle, azimuth, 1)
				expect(Math.abs(seen.x)).toBeLessThan(1e-6)
				expect(Math.abs(seen.y)).toBeLessThan(1e-6)
			}
		}
	})

	it("turns the pair side-on to the camera, with the first page on the left", () => {
		for (const [a, b] of PAIRS.slice(0, 4)) {
			for (const azimuth of [0, 0.9, -2.2, 3.1]) {
				const pose = framePair({ a, b, azimuth, aspect: 1.6 })
				const left = onScreen(pose, a, azimuth, 1.6)
				const right = onScreen(pose, b, azimuth, 1.6)
				expect(left.x).toBeLessThan(right.x)
				// side-on: both pages sit at the same depth from the camera
				const depthOf = (point: Vec3) => {
					const turned = rotateY(point, pose.yaw)
					return (
						(turned[0] + pose.gx) * Math.sin(azimuth) +
						(turned[2] + pose.gz) * Math.cos(azimuth)
					)
				}
				expect(Math.abs(depthOf(a) - depthOf(b))).toBeLessThan(1e-6)
			}
		}
	})

	it("keeps both pages inside the stage for a wide, a square and a tall stage", () => {
		for (const aspect of [0.7, 1, 1.78]) {
			for (const [a, b] of PAIRS) {
				const pose = framePair({ a, b, azimuth: 0.4, aspect })
				for (const point of [a, b]) {
					const seen = onScreen(pose, point, 0.4, aspect)
					expect(Math.abs(seen.x)).toBeLessThanOrEqual(0.86)
					expect(Math.abs(seen.y)).toBeLessThanOrEqual(0.86)
				}
			}
		}
	})

	it("never comes closer than the minimum distance or farther than home", () => {
		for (const [a, b] of PAIRS) {
			const pose = framePair({ a, b, azimuth: 0, aspect: 1 })
			expect(pose.d).toBeGreaterThanOrEqual(MIN_DISTANCE)
			expect(pose.d).toBeLessThanOrEqual(homeDistance(1) + 1e-9)
		}
		const same = framePair({
			a: [0.3, 0.3, 0.3],
			b: [0.3, 0.3, 0.3],
			azimuth: 0,
			aspect: 1,
		})
		expect(same.d).toBe(MIN_DISTANCE)
		for (const value of Object.values(same)) {
			expect(Number.isFinite(value)).toBe(true)
		}
	})

	it("comes closer than home when the pair is near each other", () => {
		const pose = framePair({
			a: [0.2, 0.1, 0],
			b: [0.35, 0.15, 0.05],
			azimuth: 0,
			aspect: 1,
		})
		expect(pose.d).toBeLessThan(HOME_DISTANCE)
	})
})

describe("homeDistance", () => {
	it("shows the whole sphere on a square stage at the hero distance", () => {
		expect(homeDistance(1)).toBe(HOME_DISTANCE)
	})

	it("backs off on a stage taller than wide so the sphere's width still fits", () => {
		expect(homeDistance(0.6)).toBeGreaterThan(HOME_DISTANCE)
		const half = Math.tan((FOV_DEGREES * Math.PI) / 360) * homeDistance(0.6)
		expect(half * 0.6).toBeGreaterThanOrEqual(1.1)
	})
})

describe("nearestTurn", () => {
	it("picks the turn of the target that is closest to where the camera is", () => {
		const full = Math.PI * 2
		expect(nearestTurn(0.1, 0.1 + full * 3)).toBeCloseTo(0.1, 9)
		expect(nearestTurn(full * 5 + 0.2, 0.4)).toBeCloseTo(full * 5 + 0.4, 9)
		expect(nearestTurn(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 9)
	})

	it("is the target itself when it is already the nearest", () => {
		expect(nearestTurn(1, 1.5)).toBeCloseTo(1.5, 9)
	})
})
