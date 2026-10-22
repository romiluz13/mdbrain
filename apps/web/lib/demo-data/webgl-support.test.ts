import { beforeEach, describe, expect, it, vi } from "vitest"
import { detectWebgl, resetWebglDetection } from "./webgl-support.js"

type Context = {
	getExtension: (name: string) => { loseContext: () => void } | null
}

function canvasWith(context: Context | null | "throws") {
	return {
		getContext: vi.fn((kind: string) => {
			if (context === "throws") {
				throw new Error("blocked")
			}
			return kind === "webgl2" || kind === "webgl" ? context : null
		}),
	}
}

describe("detectWebgl", () => {
	beforeEach(() => {
		resetWebglDetection()
	})

	it("is true when the browser hands out a context, and gives that context back", () => {
		const lose = vi.fn()
		const canvas = canvasWith({ getExtension: () => ({ loseContext: lose }) })
		expect(detectWebgl(() => canvas)).toBe(true)
		expect(lose).toHaveBeenCalledTimes(1)
	})

	it("is true even when the context has no way to be released early", () => {
		expect(detectWebgl(() => canvasWith({ getExtension: () => null }))).toBe(
			true,
		)
	})

	it("is false when the browser has no WebGL, or refuses to say", () => {
		expect(detectWebgl(() => canvasWith(null))).toBe(false)
		resetWebglDetection()
		expect(detectWebgl(() => canvasWith("throws"))).toBe(false)
	})

	it("asks the browser once and remembers, so no page opens a second throwaway context", () => {
		const make = vi.fn(() => canvasWith({ getExtension: () => null }))
		expect(detectWebgl(make)).toBe(true)
		expect(detectWebgl(make)).toBe(true)
		expect(detectWebgl(make)).toBe(true)
		expect(make).toHaveBeenCalledTimes(1)
	})
})
