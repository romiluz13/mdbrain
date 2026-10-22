import { describe, expect, it, vi } from "vitest"
import { createViewStateStore } from "./view-state.js"

function setup(options: { webgl?: boolean; stored?: "3d" | "2d" | null } = {}) {
	const detect = vi.fn(() => options.webgl ?? true)
	const write = vi.fn()
	const store = createViewStateStore({
		detect,
		read: () => options.stored ?? null,
		write,
	})
	return { store, detect, write }
}

describe("the shared graph view state", () => {
	it("knows nothing until it is armed, so the server and the first client render agree", () => {
		const { store, detect } = setup()
		expect(store.get()).toEqual({
			webgl: null,
			degraded: null,
			preference: null,
		})
		expect(detect).not.toHaveBeenCalled()
	})

	it("arms once: asks the browser and the saved choice a single time, however often it is called", () => {
		const { store, detect } = setup({ webgl: true, stored: "2d" })
		store.arm()
		store.arm()
		expect(detect).toHaveBeenCalledTimes(1)
		expect(store.get()).toEqual({
			webgl: true,
			degraded: null,
			preference: "2d",
		})
	})

	it("hands out the same snapshot until something changes, as a subscriber needs", () => {
		const { store } = setup()
		store.arm()
		expect(store.get()).toBe(store.get())
		const before = store.get()
		store.degrade("slow")
		expect(store.get()).not.toBe(before)
	})

	it("keeps the first reason 3D was given up, and tells subscribers once", () => {
		const { store } = setup()
		store.arm()
		const heard = vi.fn()
		store.subscribe(heard)
		store.degrade("context-lost")
		store.degrade("slow")
		expect(store.get().degraded).toBe("context-lost")
		expect(heard).toHaveBeenCalledTimes(1)
	})

	it("remembers the viewer's choice in storage and tells subscribers", () => {
		const { store, write } = setup()
		store.arm()
		const heard = vi.fn()
		const stop = store.subscribe(heard)
		store.choose("2d")
		expect(write).toHaveBeenCalledWith("2d")
		expect(store.get().preference).toBe("2d")
		expect(heard).toHaveBeenCalledTimes(1)
		stop()
		store.choose("3d")
		expect(heard).toHaveBeenCalledTimes(1)
	})
})
