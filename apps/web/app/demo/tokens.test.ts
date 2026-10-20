import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CSS_DIR = join(process.cwd(), "app", "demo")
const css = readFileSync(join(CSS_DIR, "demo.module.css"), "utf8")

function token(name: string): string {
	const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`))
	if (!match) {
		throw new Error(
			`token --${name} is not defined as a hex color in demo.module.css`,
		)
	}
	return match[1] as string
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4
	}) as [number, number, number]
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	]
	return (high + 0.05) / (low + 0.05)
}

// Text pairs the demo actually sets: [text token, surface token].
const TEXT_PAIRS: Array<[string, string]> = [
	["ink", "panel"],
	["ink", "bg"],
	["ink", "inset"],
	["ink", "rail"],
	["ink-2", "panel"],
	["ink-2", "bg"],
	["ink-2", "inset"],
	["ink-2", "rail"],
	["signal-ink", "panel"],
	["signal-ink", "bg"],
	["signal-ink", "signal-tint"],
	["ok-ink", "panel"],
	["ok-ink", "bg"],
	["ok-ink", "ok-tint"],
	["scope-ink", "scope"],
	["scope-ink-2", "scope"],
]

describe("demo color tokens", () => {
	it.each(TEXT_PAIRS)("%s text on %s is at least 4.5:1", (text, surface) => {
		expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5)
	})

	it("keeps focus indicators at 3:1 on every surface they sit on", () => {
		for (const surface of ["panel", "bg", "inset", "rail"]) {
			expect(contrast(token("focus"), token(surface))).toBeGreaterThanOrEqual(3)
		}
		expect(
			contrast(token("focus-dark"), token("scope")),
		).toBeGreaterThanOrEqual(3)
	})

	it("never sets text in the --ok fill color, which is only 3.5 to 4.9:1 on the demo surfaces", () => {
		expect(css).not.toMatch(/(^|[;{\s])color:\s*var\(--ok\)/)
		expect(css).not.toMatch(/(^|[;{\s])color:\s*var\(--signal\)/)
	})
})

describe("demo touch targets", () => {
	const all = ["demo", "chapters", "graph", "citation"]
		.map((name) => readFileSync(join(CSS_DIR, `${name}.module.css`), "utf8"))
		.join("\n")

	it("declares one 44 px target size and gives every control class at least that", () => {
		expect(css).toMatch(/--target:\s*44px/)
		expect(all).toMatch(/min-height:\s*var\(--target\)/)
	})
})
