import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { GRAPH_INK } from "./graph-ink.js"

const css = readFileSync(
	resolve(process.cwd(), "app/demo/demo.module.css"),
	"utf8",
)
const token = (name: string) =>
	new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase()

describe("the colors a canvas cannot read from CSS", () => {
	it("are the values of the demo's own tokens, so the 2D map, the 3D map and the page agree", () => {
		expect(GRAPH_INK.signal).toBe(token("signal"))
		expect(GRAPH_INK.scope).toBe(token("scope"))
		expect(GRAPH_INK.scopeInk).toBe(token("scope-ink"))
		expect(GRAPH_INK.edge).toBe(token("scope-ink-2"))
	})
})
