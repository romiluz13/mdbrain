import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { corpusDir } from "../../e2e/demo-upstream.js"
import {
	excerptBlocks,
	parseMarkdown,
	plainText,
	type Block,
	type Inline,
} from "./markdown.js"

const text = (inline: Inline[]): string => plainText(inline)

describe("parseMarkdown", () => {
	it("reads headings, bold labels and paragraphs, keeping each line of a paragraph", () => {
		const blocks = parseMarkdown(
			"# Release notes\n\n**Owner:** Priya Kaplan\n**Effective:** July 1, 2026\n\nThe notes follow.",
		)
		expect(blocks.map((block) => block.kind)).toEqual([
			"heading",
			"paragraph",
			"paragraph",
		])
		const [heading, labels] = blocks
		expect(heading?.kind === "heading" && text(heading.inline)).toBe(
			"Release notes",
		)
		expect(
			labels?.kind === "paragraph" && labels.lines.map((l) => text(l.inline)),
		).toEqual(["Owner: Priya Kaplan", "Effective: July 1, 2026"])
	})

	it("reads unordered and ordered lists, keeping the stored numbers", () => {
		const blocks = parseMarkdown("- first\n- second\n\n1. one\n3. three")
		const [bullets, numbered] = blocks
		expect(bullets).toMatchObject({ kind: "list", ordered: false })
		expect(numbered).toMatchObject({ kind: "list", ordered: true })
		expect(
			numbered?.kind === "list" && numbered.items.map((item) => item.marker),
		).toEqual(["1.", "3."])
		expect(
			bullets?.kind === "list" &&
				bullets.items.map((item) => text(item.inline)),
		).toEqual(["first", "second"])
	})

	it("reads a table with its header and rows", () => {
		const blocks = parseMarkdown(
			"| Product | Price |\n|---|---|\n| Track | $14 |\n| Predict | $9 |",
		)
		const table = blocks[0]
		expect(table?.kind).toBe("table")
		if (table?.kind !== "table") return
		expect(table.header.map((cell) => text(cell.inline))).toEqual([
			"Product",
			"Price",
		])
		expect(
			table.rows.map((row) => row.cells.map((cell) => text(cell.inline))),
		).toEqual([
			["Track", "$14"],
			["Predict", "$9"],
		])
	})

	it("reads a rule, a code fence and inline code, and leaves HTML and links as plain text", () => {
		const blocks = parseMarkdown(
			"---\n\n```\nGET /v1/wiki\n```\n\nUse `limit` <b>now</b> [site](https://example.test)",
		)
		expect(blocks.map((block) => block.kind)).toEqual([
			"rule",
			"code",
			"paragraph",
		])
		expect(blocks[1]).toMatchObject({ kind: "code", text: "GET /v1/wiki" })
		const paragraph = blocks[2]
		if (paragraph?.kind !== "paragraph") throw new Error("not a paragraph")
		const line = paragraph.lines[0]?.inline ?? []
		expect(
			line.some((node) => node.kind === "code" && node.text === "limit"),
		).toBe(true)
		expect(text(line)).toContain("<b>now</b> [site](https://example.test)")
	})

	it("gives every text node the offset it has in the source, so a mark can be placed", () => {
		const source = "# Title\n\n**Subject:** the renewal is at risk\n- a point"
		const check = (inline: Inline[]) => {
			for (const node of inline) {
				if (node.kind === "text" || node.kind === "code") {
					expect(source.slice(node.start, node.start + node.text.length)).toBe(
						node.text,
					)
				} else if (node.kind === "strong" || node.kind === "em") {
					check(node.children)
				}
			}
		}
		for (const block of parseMarkdown(source)) {
			if (block.kind === "heading") {
				check(block.inline)
			} else if (block.kind === "paragraph") {
				for (const line of block.lines) {
					check(line.inline)
				}
			} else if (block.kind === "list") {
				for (const item of block.items) {
					check(item.inline)
				}
			}
		}
	})

	it("never reads a block out of text that is not one", () => {
		expect(parseMarkdown("")).toEqual([])
		const blocks = parseMarkdown(
			"User: not a heading # here\nsnake_case_name stays",
		)
		expect(blocks).toHaveLength(1)
		expect(
			blocks[0]?.kind === "paragraph" && text(blocks[0].lines[1]?.inline ?? []),
		).toBe("snake_case_name stays")
	})
})

describe("a stored source of any shape", () => {
	const quickly = (source: string): number => {
		const started = performance.now()
		parseMarkdown(source)
		return performance.now() - started
	}

	it.each([
		["a line of emphasis marks that never close", " _a".repeat(32_000)],
		[
			"a table row followed by a line of spaces",
			`| a |\n${" ".repeat(40_000)}`,
		],
		[
			"a bold mark on every line and one at the end",
			`${"**a\n".repeat(20_000)}**`,
		],
		["backticks that never close", "`a ".repeat(30_000)],
		["emphasis marks nested without end", "*a _b ".repeat(10_000)],
	])("is read in under a second: %s", (_name, source) => {
		expect(quickly(source)).toBeLessThan(1000)
	})

	it("reads a source written with CRLF line ends as the same blocks", () => {
		const lf = "# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |"
		const crlf = lf.replaceAll("\n", "\r\n")
		const kinds = (blocks: Block[]) => blocks.map((block) => block.kind)
		expect(kinds(parseMarkdown(crlf))).toEqual(kinds(parseMarkdown(lf)))
		const [heading] = parseMarkdown(crlf)
		expect(heading?.kind === "heading" && text(heading.inline)).toBe("Title")
	})

	it("keeps the offsets of the stored text when it has CRLF line ends", () => {
		const stored = "# Title\r\n\r\nA claim here."
		const paragraph = parseMarkdown(stored)[1]
		const line =
			paragraph?.kind === "paragraph" ? paragraph.lines[0] : undefined
		const node = line?.inline[0]
		expect(
			node?.kind === "text" &&
				stored.slice(node.start, node.start + node.text.length),
		).toBe("A claim here.")
	})
})

describe("excerptBlocks", () => {
	const source =
		"# Title\n\n**Owner:** Priya\n\nIntro paragraph.\n\n- alpha point\n- beta point\n- gamma point\n\n| A | B |\n|---|---|\n| x | y |\n| the marked cell | z |"
	const blocks = parseMarkdown(source)
	const at = (needle: string): { start: number; end: number } => ({
		start: source.indexOf(needle),
		end: source.indexOf(needle) + needle.length,
	})
	const flat = (excerpt: Block[]): string =>
		JSON.stringify(excerpt.map((block) => block.kind))

	it("keeps only the list item that holds the mark", () => {
		const excerpt = excerptBlocks(blocks, at("beta"))
		expect(flat(excerpt)).toBe('["list"]')
		const list = excerpt[0]
		expect(
			list?.kind === "list" && list.items.map((item) => text(item.inline)),
		).toEqual(["beta point"])
	})

	it("keeps the table's header with the one row that holds the mark", () => {
		const excerpt = excerptBlocks(blocks, at("marked cell"))
		const table = excerpt[0]
		expect(table?.kind).toBe("table")
		expect(
			table?.kind === "table" &&
				table.rows.map((row) => row.cells.map((cell) => text(cell.inline))),
		).toEqual([["the marked cell", "z"]])
		expect(
			table?.kind === "table" && table.header.map((cell) => text(cell.inline)),
		).toEqual(["A", "B"])
	})

	it("keeps the one line of a paragraph that holds the mark", () => {
		const excerpt = excerptBlocks(blocks, at("Priya"))
		const paragraph = excerpt[0]
		expect(
			paragraph?.kind === "paragraph" &&
				paragraph.lines.map((line) => text(line.inline)),
		).toEqual(["Owner: Priya"])
	})

	it("opens with the first two units when nothing is marked", () => {
		expect(flat(excerptBlocks(blocks, null))).toBe('["heading","paragraph"]')
	})
})

describe("every stored source of the corpus", () => {
	const bodies = readFileSync(join(corpusDir(), "records.jsonl"), "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => (JSON.parse(line) as { body: string }).body)
	const words = (value: string): string[] =>
		value.match(/[\p{L}\p{N}]+/gu) ?? []

	const textOf = (blocks: Block[]): string =>
		blocks
			.flatMap((block): string[] => {
				switch (block.kind) {
					case "heading":
						return [plainText(block.inline)]
					case "paragraph":
						return block.lines.map((line) => plainText(line.inline))
					case "list":
						return block.items.map(
							(item) => `${item.marker} ${plainText(item.inline)}`,
						)
					case "table":
						return [
							...block.header.map((cell) => plainText(cell.inline)),
							...block.rows.flatMap((row) =>
								row.cells.map((cell) => plainText(cell.inline)),
							),
						]
					case "code":
						return [block.text]
					default:
						return []
				}
			})
			.join(" ")

	it("is read without losing or reordering a word", () => {
		expect(bodies.length).toBeGreaterThan(100)
		for (const body of bodies) {
			expect(words(textOf(parseMarkdown(body)))).toEqual(words(body))
		}
	})

	it("is cut to an excerpt that is a part of the source, in the source's order", () => {
		for (const body of bodies.slice(0, 200)) {
			const blocks = parseMarkdown(body)
			const middle = Math.floor(body.length / 2)
			const excerpt = excerptBlocks(blocks, { start: middle, end: middle + 1 })
			const wanted = words(textOf(excerpt))
			const all = words(body)
			let at = 0
			for (const word of wanted) {
				at = all.indexOf(word, at)
				expect(at, `${word} is not in the source`).not.toBe(-1)
			}
		}
	})
})
