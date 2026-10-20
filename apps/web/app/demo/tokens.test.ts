import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const CSS_DIR = join(process.cwd(), "app", "demo")
const css = readFileSync(join(CSS_DIR, "demo.module.css"), "utf8")

function sourceFiles(dir: string, extension: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			return sourceFiles(path, extension)
		}
		return extension.test(entry.name) && !/\.test\./.test(entry.name)
			? [path]
			: []
	})
}

const allCss = sourceFiles(CSS_DIR, /\.module\.css$/)
	.map((file) => readFileSync(file, "utf8"))
	.join("\n")

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
		expect(allCss).not.toMatch(/(^|[;{\s])color:\s*var\(--ok\)/)
		expect(allCss).not.toMatch(/(^|[;{\s])color:\s*var\(--signal\)/)
	})
})

/** The opening tags of the given elements, found by walking past braces and
 * quotes so an arrow function inside an attribute does not end the tag early. */
function openingTags(source: string, names: string[]): string[] {
	const tags: string[] = []
	const start = new RegExp(`<(${names.join("|")})\\b`, "g")
	for (const match of source.matchAll(start)) {
		let depth = 0
		let quote = ""
		let end = match.index
		for (; end < source.length; end++) {
			const char = source[end] as string
			if (quote) {
				quote = char === quote ? "" : quote
			} else if (char === '"' || char === "'" || char === "`") {
				quote = char
			} else if (char === "{") {
				depth++
			} else if (char === "}") {
				depth--
			} else if (char === ">" && depth === 0) {
				break
			}
		}
		tags.push(source.slice(match.index, end + 1))
	}
	return tags
}

/** Whether some rule of `sheet` with a selector that `match` accepts sets a
 * minimum height of the 44 px target, directly or through `composes` from
 * another CSS module. */
function hasTargetRule(
	sheet: string,
	match: (selector: string) => boolean,
): boolean {
	for (const rule of sheet
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = (rule[1] as string).split(",").map((s) => s.trim())
		if (!selectors.some(match)) {
			continue
		}
		const body = rule[2] as string
		if (/min-height:\s*(var\(--target\)|44px)/.test(body)) {
			return true
		}
		for (const inherited of body.matchAll(
			/composes:\s*([\w\s]+?)\s+from\s+"([^"]+)"/g,
		)) {
			const other = readFileSync(join(CSS_DIR, inherited[2] as string), "utf8")
			const names = (inherited[1] as string).trim().split(/\s+/)
			if (
				hasTargetRule(other, (selector) =>
					names.some((n) => selector === `.${n}`),
				)
			) {
				return true
			}
		}
	}
	return false
}

describe("demo touch targets", () => {
	it("declares one 44 px target size", () => {
		expect(css).toMatch(/--target:\s*44px/)
	})

	it("gives every button, select and input a class, or a descendant rule, that sets the 44 px minimum in the module its file imports", () => {
		const missing: string[] = []
		const seen = new Set<string>()
		for (const file of sourceFiles(CSS_DIR, /\.tsx$/)) {
			const source = readFileSync(file, "utf8")
			const imported = source.match(/import styles from "([^"]+\.module\.css)"/)
			const tags = openingTags(source, ["button", "select", "input"])
			if (tags.length === 0) {
				continue
			}
			expect(imported, `${file} has controls but no CSS module`).not.toBeNull()
			const sheet = readFileSync(
				join(dirname(file), (imported as RegExpMatchArray)[1] as string),
				"utf8",
			)
			for (const tag of tags) {
				const named = [...tag.matchAll(/styles\.(\w+)/g)].map((m) => m[1])
				const element = (tag.match(/^<(\w+)/) as RegExpMatchArray)[1] as string
				const targets =
					named.length > 0
						? named.map((name) => ({
								what: `${file}: .${name}`,
								ok: hasTargetRule(sheet, (selector) => selector === `.${name}`),
							}))
						: [
								{
									what: `${file}: classless <${element}>`,
									ok: hasTargetRule(sheet, (selector) =>
										new RegExp(`(^|\\s)${element}(:[\\w-]+)*$`).test(selector),
									),
								},
							]
				for (const { what, ok } of targets) {
					seen.add(what)
					if (!ok) {
						missing.push(what)
					}
				}
			}
		}
		expect(seen.size).toBeGreaterThan(8)
		expect(missing, "controls without a 44 px minimum").toEqual([])
	})
})
