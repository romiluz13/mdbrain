// When the 3D brain may run, and when the flat one is shown instead. Pure: the
// scene reports what it saw and this decides. The 2D graph is a first-class mode,
// not an error state, so every way out of 3D is an ordinary answer here.

/** What the 3D scene can carry on any device: the direction's measured budget. */
export const SCENE_BUDGET = { nodes: 250, edges: 625 } as const

export type Degraded = "slow" | "context-lost" | "failed"

export type ViewInput = {
	/** null until the browser has been asked once. */
	webgl: boolean | null
	reducedMotion: boolean
	/** The viewer's remembered choice, if they made one. */
	preference: "3d" | "2d" | null
	nodes: number
	edges: number
	degraded: Degraded | null
}

export type FlatReason =
	| "reduced-motion"
	| "no-webgl"
	| "over-budget"
	| "chosen"
	| Degraded

export type ViewChoice =
	| { view: "3d" }
	| { view: "2d"; reason: FlatReason | null }

export function chooseView(input: ViewInput): ViewChoice {
	if (input.reducedMotion) {
		return { view: "2d", reason: "reduced-motion" }
	}
	if (input.webgl === null) {
		return { view: "2d", reason: null }
	}
	if (!input.webgl) {
		return { view: "2d", reason: "no-webgl" }
	}
	if (input.degraded !== null) {
		return { view: "2d", reason: input.degraded }
	}
	if (input.nodes > SCENE_BUDGET.nodes || input.edges > SCENE_BUDGET.edges) {
		return { view: "2d", reason: "over-budget" }
	}
	if (input.preference === "2d") {
		return { view: "2d", reason: "chosen" }
	}
	return { view: "3d" }
}

const SLOW_FPS = 18
const SLOW_WINDOWS = 3
const WINDOW_SECONDS = 1
// A longer gap than this is a stall (a tab switch, a heavy load), not slowness.
const STALL_SECONDS = 0.5

export type FrameMonitor = {
	/** Feeds one frame. Answers "slow" once, after three one-second windows in a
	 * row under 18 fps; a hidden tab and a stall are not counted. */
	feed: (deltaSeconds: number, hidden: boolean) => "slow" | null
	reset: () => void
}

export function createFrameMonitor(): FrameMonitor {
	let seconds = 0
	let frames = 0
	let streak = 0
	const reset = () => {
		seconds = 0
		frames = 0
		streak = 0
	}
	return {
		reset,
		feed(deltaSeconds, hidden) {
			if (hidden || deltaSeconds > STALL_SECONDS) {
				reset()
				return null
			}
			seconds += deltaSeconds
			frames += 1
			if (seconds < WINDOW_SECONDS) {
				return null
			}
			streak = frames / seconds < SLOW_FPS ? streak + 1 : 0
			seconds = 0
			frames = 0
			return streak >= SLOW_WINDOWS ? "slow" : null
		},
	}
}
