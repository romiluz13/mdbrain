"use client"

import { useSyncExternalStore } from "react"
import {
	readViewPreference,
	writeViewPreference,
} from "../../../lib/demo-data/view-preference.js"
import {
	type ViewState,
	createViewStateStore,
} from "../../../lib/demo-data/view-state.js"
import { detectWebgl } from "../../../lib/demo-data/webgl-support.js"

export const viewStore = createViewStateStore({
	detect: () => detectWebgl(),
	read: () => readViewPreference(),
	write: (value) => writeViewPreference(value),
})

const UNKNOWN: ViewState = { webgl: null, degraded: null, preference: null }

/** The page-wide view state; the server and the first client render both see
 * "not asked yet". */
export function useViewState(): ViewState {
	return useSyncExternalStore(viewStore.subscribe, viewStore.get, () => UNKNOWN)
}
