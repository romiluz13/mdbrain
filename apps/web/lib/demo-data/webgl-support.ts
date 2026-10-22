// Whether this browser can draw the 3D brain at all. Opening a WebGL context
// costs a few milliseconds and a slot in the browser's small pool of them, so
// the question is asked once per page and the answer kept.

type ProbeCanvas = { getContext: (kind: string) => unknown }
type ProbeContext = {
	getExtension: (name: string) => { loseContext: () => void } | null
}

let answer: boolean | null = null

export function resetWebglDetection(): void {
	answer = null
}

export function detectWebgl(
	makeCanvas: () => ProbeCanvas = () => document.createElement("canvas"),
): boolean {
	if (answer !== null) {
		return answer
	}
	try {
		const canvas = makeCanvas()
		const context = (canvas.getContext("webgl2") ??
			canvas.getContext("webgl")) as ProbeContext | null
		context?.getExtension("WEBGL_lose_context")?.loseContext()
		answer = context !== null && context !== undefined
	} catch {
		answer = false
	}
	return answer
}
