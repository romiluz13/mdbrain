import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { StateRead } from "../../lib/demo-presenter/client.js"
import { pollMs, readEffect, usePresenter } from "./use-presenter.js"

const presenter: StateRead = {
	mode: "presenter",
	csrf: "csrf-1",
	lease: { slotIndex: 13, name: "Live", expiresAt: "2026-10-23T12:30:00.000Z" },
	request: null,
}

describe("readEffect", () => {
	it("takes a presenter state in with its CSRF token", () => {
		expect(readEffect(presenter, false)).toEqual({
			kind: "settled",
			snapshot: presenter,
			presenting: true,
			csrf: "csrf-1",
		})
	})

	it("takes a public state in, drops the token, and no longer presents", () => {
		expect(readEffect({ mode: "public" }, true)).toEqual({
			kind: "settled",
			snapshot: { mode: "public" },
			presenting: false,
			csrf: "",
		})
	})

	it("keeps a presenter on screen when one read fails", () => {
		expect(readEffect({ mode: "unavailable" }, true)).toEqual({ kind: "lost" })
	})

	it("shows a visitor the public page when the first read fails, never a presenter control", () => {
		expect(readEffect({ mode: "unavailable" }, false)).toEqual({
			kind: "public",
		})
	})
})

describe("pollMs", () => {
	it("watches closely while a run is queued or claimed, and keeps alive otherwise", () => {
		expect(pollMs("queued")).toBeLessThan(pollMs(undefined))
		expect(pollMs("claimed")).toBe(pollMs("queued"))
		expect(pollMs("done")).toBe(pollMs(undefined))
		expect(pollMs("failed")).toBe(pollMs(undefined))
	})
})

describe("usePresenter on first render", () => {
	it("reads as loading, with no lease, no request and no message, until the server says who is looking", () => {
		let seen: ReturnType<typeof usePresenter> | undefined
		function Probe() {
			seen = usePresenter()
			return null
		}
		renderToString(createElement(Probe))
		expect(seen).toMatchObject({
			mode: "loading",
			lease: null,
			request: null,
			busy: null,
			message: null,
		})
	})
})
