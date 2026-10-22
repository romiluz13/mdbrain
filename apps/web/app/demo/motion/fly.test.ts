import { afterEach, describe, expect, it, vi } from "vitest"
import { framePair } from "../../../lib/demo-data/camera-pose.js"
import { createSceneStore } from "../../../lib/demo-data/scene-store.js"
import { createFlight } from "./fly.js"

const A: [number, number, number] = [0.5, 0.2, 0.1]
const B: [number, number, number] = [-0.4, -0.1, 0.3]

afterEach(() => {
	vi.restoreAllMocks()
})

describe("the camera flight", () => {
	it("flies to the pose that frames the pair and lights the stored link on arrival", () => {
		const store = createSceneStore(1.5)
		store.azimuth = 0.4
		const flight = createFlight(store)
		const move = flight.frame(A, B, 1.5, true)
		move.progress(1)
		const wanted = framePair({ a: A, b: B, azimuth: 0.4, aspect: 1.5 })
		expect(store.pose.gx).toBeCloseTo(wanted.gx, 6)
		expect(store.pose.gy).toBeCloseTo(wanted.gy, 6)
		expect(store.pose.gz).toBeCloseTo(wanted.gz, 6)
		expect(store.pose.d).toBeCloseTo(wanted.d, 6)
		expect(store.lit).toBe(1)
	})

	it("leaves the link dark when no link is stored between the pair", () => {
		const store = createSceneStore(1)
		const flight = createFlight(store)
		flight.frame(A, B, 1, false).progress(1)
		expect(store.lit).toBe(0)
	})

	it("holds the drift still while the camera is framed, and lets the scene settle once it is back", () => {
		const store = createSceneStore(1)
		const flight = createFlight(store)
		flight.frame(A, B, 1, true).progress(1)
		expect(store.isHeld()).toBe(true)
		flight.release()?.progress(1)
		expect(store.isHeld()).toBe(false)
	})

	it("turns the short way, never spinning, whatever the drift has added", () => {
		const store = createSceneStore(1)
		store.drift = 25
		const flight = createFlight(store)
		const before = store.pose.yaw
		flight.frame(A, B, 1, false).progress(1)
		expect(Math.abs(store.pose.yaw - before)).toBeLessThanOrEqual(
			Math.PI + 1e-9,
		)
		const wanted = framePair({ a: A, b: B, azimuth: 0, aspect: 1 })
		const full = Math.PI * 2
		const gap = (store.pose.yaw + store.drift - wanted.yaw) / full
		expect(Math.abs(gap - Math.round(gap))).toBeLessThan(1e-6)
	})

	it("reverses the move: stepping back lands exactly where the camera started", () => {
		const store = createSceneStore(1.3)
		store.drift = 0.2
		const start = { ...store.pose }
		const flight = createFlight(store)
		flight.frame(A, B, 1.3, true).progress(1)
		flight.release()?.progress(1)
		expect(store.pose.gx).toBeCloseTo(start.gx, 9)
		expect(store.pose.gy).toBeCloseTo(start.gy, 9)
		expect(store.pose.gz).toBeCloseTo(start.gz, 9)
		expect(store.pose.d).toBeCloseTo(start.d, 9)
		expect(store.pose.yaw).toBeCloseTo(start.yaw, 9)
		expect(store.lit).toBe(0)
	})

	it("steps back from the middle of the flight to the same start", () => {
		const store = createSceneStore(1)
		const start = { ...store.pose }
		const flight = createFlight(store)
		flight.frame(A, B, 1, true).progress(0.4)
		flight.release()?.progress(1)
		expect(store.pose.d).toBeCloseTo(start.d, 9)
		expect(store.pose.yaw).toBeCloseTo(start.yaw, 9)
		expect(store.lit).toBe(0)
	})

	it("has nothing to reverse before a flight, and stops cleanly when told to", () => {
		const store = createSceneStore(1)
		const flight = createFlight(store)
		expect(flight.release()).toBeNull()
		const move = flight.frame(A, B, 1, true)
		flight.kill()
		expect(move.isActive()).toBe(false)
	})

	it("says when the camera is under way, and when it has arrived or been stopped", () => {
		const store = createSceneStore(1)
		const flight = createFlight(store)
		expect(flight.active()).toBe(false)
		const move = flight.frame(A, B, 1, true)
		expect(flight.active()).toBe(true)
		move.progress(1)
		expect(flight.active()).toBe(false)
		const back = flight.release()
		expect(flight.active()).toBe(true)
		flight.kill()
		expect(flight.active()).toBe(false)
		expect(back?.isActive()).toBe(false)
	})

	it("asks for a frame on every step, so a scene that renders on demand keeps up", () => {
		const store = createSceneStore(1)
		const frames = vi.fn()
		store.subscribe(frames)
		const move = createFlight(store).frame(A, B, 1, true)
		move.progress(0.5)
		move.progress(1)
		expect(frames).toHaveBeenCalled()
	})

	it("takes no more than a second there or back, each move inside the 300 to 600 ms band", () => {
		const store = createSceneStore(1)
		const flight = createFlight(store)
		const there = flight.frame(A, B, 1, true)
		expect(there.duration()).toBeLessThanOrEqual(1)
		const tweens = there.getChildren(false, true, false)
		expect(tweens.length).toBeGreaterThan(0)
		for (const child of tweens) {
			expect(child.duration()).toBeGreaterThanOrEqual(0.3)
			expect(child.duration()).toBeLessThanOrEqual(0.6)
		}
		there.progress(1)
		const back = flight.release()
		expect(back?.duration()).toBeLessThanOrEqual(1)
		const returning = back?.getChildren(false, true, false) ?? []
		expect(returning.length).toBeGreaterThan(0)
		for (const child of returning) {
			expect(child.duration()).toBeGreaterThanOrEqual(0.3)
			expect(child.duration()).toBeLessThanOrEqual(0.6)
		}
	})
})
