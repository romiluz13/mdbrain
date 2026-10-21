import { describe, expect, it, vi } from "vitest"
import { HOME_DISTANCE } from "./camera-pose.js"
import {
	DRIFT_RADIANS_PER_SECOND,
	DRIFT_SECONDS,
	createSceneStore,
} from "./scene-store.js"

const run = (store: ReturnType<typeof createSceneStore>, seconds: number) => {
	let moving = false
	for (let t = 0; t < seconds; t += 1 / 60) {
		moving = store.advance(1 / 60)
	}
	return moving
}

describe("createSceneStore", () => {
	it("starts at home: nothing shifted, the whole brain in view", () => {
		const store = createSceneStore(1)
		expect(store.pose).toMatchObject({ gx: 0, gy: 0, gz: 0, d: HOME_DISTANCE })
		expect(store.drift).toBe(0)
	})

	it("drifts calmly: a full turn would take over a minute", () => {
		expect(DRIFT_RADIANS_PER_SECOND).toBeGreaterThan(0)
		expect((Math.PI * 2) / DRIFT_RADIANS_PER_SECOND).toBeGreaterThan(60)
	})

	it("drifts for ten seconds after it is woken, then rests and asks for no more frames", () => {
		const store = createSceneStore(1)
		store.wake()
		expect(run(store, DRIFT_SECONDS - 0.5)).toBe(true)
		expect(store.drift).toBeGreaterThan(0)
		expect(run(store, 1)).toBe(false)
		const resting = store.drift
		expect(store.advance(1 / 60)).toBe(false)
		expect(store.drift).toBe(resting)
	})

	it("rests until it is woken, and wakes again for a fresh window", () => {
		const store = createSceneStore(1)
		expect(store.advance(1 / 60)).toBe(false)
		expect(store.drift).toBe(0)
		store.wake()
		expect(run(store, DRIFT_SECONDS + 1)).toBe(false)
		const first = store.drift
		store.wake()
		expect(run(store, 2)).toBe(true)
		expect(store.drift).toBeGreaterThan(first)
	})

	it("stops at once and stays still while held, as during a camera flight", () => {
		const store = createSceneStore(1)
		store.wake()
		run(store, 1)
		store.hold(true)
		const held = store.drift
		expect(run(store, 2)).toBe(false)
		expect(store.drift).toBe(held)
		store.wake()
		expect(run(store, 1)).toBe(false)
		store.hold(false)
		store.wake()
		expect(run(store, 1)).toBe(true)
		expect(store.drift).toBeGreaterThan(held)
	})

	it("rests when the viewer takes hold of the scene, and can be woken again afterwards", () => {
		const store = createSceneStore(1)
		store.wake()
		run(store, 1)
		store.rest()
		const resting = store.drift
		expect(run(store, 1)).toBe(false)
		expect(store.drift).toBe(resting)
		store.wake()
		expect(run(store, 1)).toBe(true)
	})

	it("says whether it is held, and keeps the lit edge and the camera's azimuth for the scene to read", () => {
		const store = createSceneStore(1)
		expect(store.isHeld()).toBe(false)
		store.hold(true)
		expect(store.isHeld()).toBe(true)
		expect(store.lit).toBe(0)
		expect(store.azimuth).toBe(0)
	})

	it("never drifts when motion is not allowed, even if woken", () => {
		const store = createSceneStore(1)
		store.allowMotion(false)
		store.wake()
		expect(run(store, 3)).toBe(false)
		expect(store.drift).toBe(0)
		store.allowMotion(true)
		store.wake()
		expect(run(store, 1)).toBe(true)
	})

	it("tells every listener when a frame is wanted, and none after it is told to stop", () => {
		const store = createSceneStore(1)
		const first = vi.fn()
		const second = vi.fn()
		const stopFirst = store.subscribe(first)
		store.subscribe(second)
		store.invalidate()
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
		stopFirst()
		store.invalidate()
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(2)
	})

	it("holds no listener after dispose, and can be used again when a dev remount keeps it", () => {
		const store = createSceneStore(1)
		store.subscribe(() => undefined)
		store.subscribe(() => undefined)
		expect(store.listenerCount()).toBe(2)
		store.dispose()
		expect(store.listenerCount()).toBe(0)
		const again = vi.fn()
		store.subscribe(again)
		store.invalidate()
		expect(again).toHaveBeenCalledTimes(1)
	})
})
