// What the bar under the map says: which map is showing, why it is the flat
// one when it is, and which switch to offer. Plain words for a visitor.

import type { ViewChoice } from "./scene-gate.js"

export type ViewAction = "2d" | "3d" | null

const FLAT_BECAUSE = {
	"reduced-motion": "Flat map, because this device asks for less motion.",
	"no-webgl": "Flat map, because this browser cannot draw 3D.",
	"over-budget":
		"Flat map, because this brain holds more pages than the 3D map carries.",
	slow: "Flat map, because 3D ran slowly on this device.",
	"context-lost": "Flat map, because the graphics context was lost.",
	failed: "Flat map, because 3D could not start.",
	chosen: "Flat map. Your choice is kept on this device.",
} as const

export function describeView(
	choice: ViewChoice,
	{ coarse }: { coarse: boolean },
): { status: string; action: ViewAction } {
	if (choice.view === "3d") {
		return {
			status: coarse
				? "3D map. Tap a page to read it."
				: "3D map. Drag to turn it; click a page to read it.",
			action: "2d",
		}
	}
	if (choice.reason === null) {
		return { status: "", action: null }
	}
	return {
		status: FLAT_BECAUSE[choice.reason],
		action: choice.reason === "chosen" ? "3d" : null,
	}
}
