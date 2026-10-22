// What every 3D-capable graph on /demo agrees on: whether this browser can draw
// 3D, why 3D was given up if it was, and the viewer's saved choice. One store
// for the page, so a chapter that finds 3D too slow spares the next one the
// same discovery.

import type { Degraded } from "./scene-gate.js"
import type { ViewPreference } from "./view-preference.js"

export type ViewState = {
	/** null until armed. */
	webgl: boolean | null
	degraded: Degraded | null
	preference: ViewPreference | null
}

type Deps = {
	detect: () => boolean
	read: () => ViewPreference | null
	write: (value: ViewPreference) => void
}

export function createViewStateStore(deps: Deps) {
	const listeners = new Set<() => void>()
	let state: ViewState = { webgl: null, degraded: null, preference: null }
	let armed = false
	const set = (next: ViewState) => {
		state = next
		for (const listener of [...listeners]) {
			listener()
		}
	}
	return {
		get: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		/** Asks the browser and the saved choice, once. Call after the first paint. */
		arm() {
			if (armed) {
				return
			}
			armed = true
			set({ ...state, webgl: deps.detect(), preference: deps.read() })
		},
		degrade(why: Degraded) {
			if (state.degraded === null) {
				set({ ...state, degraded: why })
			}
		},
		choose(value: ViewPreference) {
			deps.write(value)
			set({ ...state, preference: value })
		},
	}
}
