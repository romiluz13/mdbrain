// A small, safe reader for the markdown stored in sources. It returns data,
// never HTML: the page renders the nodes as React elements, so text is escaped
// and nothing a source holds (a tag, a link, a script) becomes live. Only what
// the stored sources use is read: headings, bold and italic, inline and fenced
// code, bullet and numbered lists, tables, rules and paragraphs. Everything
// else stays as the plain text it was written as.
//
// Every text node, list item, table row and block carries its offset in the
// source, so the page can mark the phrase a claim rests on in place, and cut a
// source down to the unit that holds it.

export type Inline =
	| { kind: "text"; text: string; start: number }
	| { kind: "code"; text: string; start: number }
	| { kind: "strong" | "em"; children: Inline[]; start: number }

export type Span = { start: number; end: number }
export type ParagraphLine = Span & { inline: Inline[] }
export type ListItem = Span & {
	/** What the source wrote before the item: "-", "1.". */
	marker: string
	depth: number
	inline: Inline[]
}
export type TableCell = Span & { inline: Inline[] }
export type TableRow = Span & { cells: TableCell[] }

export type Block =
	| (Span & { kind: "heading"; level: number; inline: Inline[] })
	| (Span & { kind: "paragraph"; lines: ParagraphLine[] })
	| (Span & { kind: "list"; ordered: boolean; items: ListItem[] })
	| (Span & { kind: "table"; header: TableCell[]; rows: TableRow[] })
	| (Span & { kind: "code"; text: string })
	| (Span & { kind: "rule" })

const MAX_DEPTH = 3
const HEADING = /^(#{1,6})\s+(\S.*)$/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(\S.*)$/
const FENCE = /^\s*```/
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/

const isSpace = (char: string | undefined): boolean =>
	char === undefined || /\s/.test(char)
const isWordChar = (char: string | undefined): boolean =>
	char !== undefined && /[\p{L}\p{N}]/u.test(char)

function parseInline(source: string, from: number, to: number): Inline[] {
	const out: Inline[] = []
	let textStart = from
	let at = from
	const flush = (end: number) => {
		if (end > textStart) {
			out.push({
				kind: "text",
				text: source.slice(textStart, end),
				start: textStart,
			})
		}
	}
	const take = (node: Inline, next: number, opening: number) => {
		flush(opening)
		out.push(node)
		at = next
		textStart = next
	}
	while (at < to) {
		const char = source[at]
		if (char === "`") {
			const close = source.indexOf("`", at + 1)
			if (close > at + 1 && close < to) {
				take(
					{ kind: "code", text: source.slice(at + 1, close), start: at + 1 },
					close + 1,
					at,
				)
				continue
			}
		} else if (char === "*" && source[at + 1] === "*") {
			const close = source.indexOf("**", at + 2)
			if (close > at + 2 && close < to && !isSpace(source[at + 2])) {
				take(
					{
						kind: "strong",
						children: parseInline(source, at + 2, close),
						start: at,
					},
					close + 2,
					at,
				)
				continue
			}
		} else if (
			(char === "*" || char === "_") &&
			source[at + 1] !== char &&
			!isSpace(source[at + 1]) &&
			!isWordChar(source[at - 1])
		) {
			let close = at + 1
			while (close < to) {
				close = source.indexOf(char, close)
				if (close === -1 || close >= to) break
				if (
					source[close + 1] !== char &&
					!isSpace(source[close - 1]) &&
					!isWordChar(source[close + 1])
				) {
					break
				}
				close++
			}
			if (close > at + 1 && close !== -1 && close < to) {
				take(
					{
						kind: "em",
						children: parseInline(source, at + 1, close),
						start: at,
					},
					close + 1,
					at,
				)
				continue
			}
		}
		at++
	}
	flush(to)
	return out
}

/** The cells of a table line, as source ranges with the edge pipes dropped. */
function cellRanges(line: string, base: number): Span[] {
	const first = line.length - line.trimStart().length
	const last = line.trimEnd().length
	let from = first + (line[first] === "|" ? 1 : 0)
	const to = last - (last > from && line[last - 1] === "|" ? 1 : 0)
	const cells: Span[] = []
	for (let at = from; at <= to; at++) {
		if (at === to || (line[at] === "|" && line[at - 1] !== "\\")) {
			let start = from
			let end = at
			while (start < end && /\s/.test(line[start] ?? "")) start++
			while (end > start && /\s/.test(line[end - 1] ?? "")) end--
			cells.push({ start: base + start, end: base + end })
			from = at + 1
		}
	}
	return cells
}

export function parseMarkdown(source: string): Block[] {
	const blocks: Block[] = []
	const rows: Array<{ text: string; start: number }> = []
	let offset = 0
	for (const text of source.split("\n")) {
		rows.push({ text, start: offset })
		offset += text.length + 1
	}
	let paragraph: ParagraphLine[] = []
	const closeParagraph = () => {
		const first = paragraph[0]
		const last = paragraph[paragraph.length - 1]
		if (first && last) {
			blocks.push({
				kind: "paragraph",
				lines: paragraph,
				start: first.start,
				end: last.end,
			})
		}
		paragraph = []
	}
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index]
		if (row === undefined) break
		const { text, start } = row
		const end = start + text.length
		const next = rows[index + 1]
		if (text.trim() === "") {
			closeParagraph()
		} else if (FENCE.test(text)) {
			closeParagraph()
			const body: string[] = []
			let close = index + 1
			while (close < rows.length && !FENCE.test(rows[close]?.text ?? "")) {
				body.push(rows[close]?.text ?? "")
				close++
			}
			const last = rows[Math.min(close, rows.length - 1)]
			blocks.push({
				kind: "code",
				text: body.join("\n"),
				start,
				end: last ? last.start + last.text.length : end,
			})
			index = close
		} else if (HEADING.test(text)) {
			closeParagraph()
			const [, marks = "", content = ""] = HEADING.exec(text) ?? []
			const from = start + text.indexOf(content, marks.length)
			blocks.push({
				kind: "heading",
				level: marks.length,
				inline: parseInline(source, from, end),
				start,
				end,
			})
		} else if (RULE.test(text)) {
			closeParagraph()
			blocks.push({ kind: "rule", start, end })
		} else if (
			text.trimStart().startsWith("|") &&
			next !== undefined &&
			SEPARATOR.test(next.text)
		) {
			closeParagraph()
			const cellsOf = (line: { text: string; start: number }) =>
				cellRanges(line.text, line.start).map(
					(range): TableCell => ({
						...range,
						inline: parseInline(source, range.start, range.end),
					}),
				)
			const header = cellsOf(row)
			const body: TableRow[] = []
			let at = index + 2
			while (at < rows.length) {
				const line = rows[at]
				if (line === undefined || !line.text.trimStart().startsWith("|")) break
				body.push({
					cells: cellsOf(line),
					start: line.start,
					end: line.start + line.text.length,
				})
				at++
			}
			const last = rows[at - 1]
			blocks.push({
				kind: "table",
				header,
				rows: body,
				start,
				end: last ? last.start + last.text.length : end,
			})
			index = at - 1
		} else if (ITEM.test(text)) {
			closeParagraph()
			const [, indent = "", marker = "", content = ""] = ITEM.exec(text) ?? []
			const item: ListItem = {
				marker,
				depth: Math.min(Math.floor(indent.length / 2), MAX_DEPTH),
				inline: parseInline(source, start + text.length - content.length, end),
				start,
				end,
			}
			const previous = blocks[blocks.length - 1]
			if (
				previous?.kind === "list" &&
				previous.ordered === /\d/.test(marker) &&
				previous.end + 1 === start
			) {
				previous.items.push(item)
				previous.end = end
			} else {
				blocks.push({
					kind: "list",
					ordered: /\d/.test(marker),
					items: [item],
					start,
					end,
				})
			}
		} else {
			const previous = blocks[blocks.length - 1]
			if (
				paragraph.length === 0 &&
				previous?.kind === "list" &&
				previous.end + 1 === start &&
				/^\s{2,}\S/.test(text)
			) {
				// A continuation line of the last list item.
				const item = previous.items[previous.items.length - 1]
				if (item) {
					item.inline.push(
						{ kind: "text", text: " ", start: item.end },
						...parseInline(
							source,
							start + text.length - text.trimStart().length,
							end,
						),
					)
					item.end = end
					previous.end = end
				}
			} else {
				const from = start + text.length - text.trimStart().length
				paragraph.push({
					inline: parseInline(source, from, end),
					start,
					end,
				})
			}
		}
	}
	closeParagraph()
	return blocks
}

export function plainText(inline: Inline[]): string {
	return inline
		.map((node) =>
			node.kind === "text" || node.kind === "code"
				? node.text
				: plainText(node.children),
		)
		.join("")
}

const holds = (unit: Span, at: number): boolean =>
	unit.start <= at && at < unit.end

/** The unit of the source that holds the mark, as blocks of their own: the list
 * item, the table row (with its header), the paragraph line or the heading. With
 * no mark, the opening of the source: its first two units. */
export function excerptBlocks(blocks: Block[], mark: Span | null): Block[] {
	if (mark === null) {
		return blocks.filter((block) => block.kind !== "rule").slice(0, 2)
	}
	for (const block of blocks) {
		if (!holds(block, mark.start)) continue
		switch (block.kind) {
			case "list": {
				const item = block.items.find((entry) => holds(entry, mark.start))
				return item
					? [{ ...block, items: [item], start: item.start, end: item.end }]
					: [block]
			}
			case "table": {
				const row = block.rows.find((entry) => holds(entry, mark.start))
				return row ? [{ ...block, rows: [row] }] : [block]
			}
			case "paragraph": {
				const line = block.lines.find((entry) => holds(entry, mark.start))
				return line
					? [{ ...block, lines: [line], start: line.start, end: line.end }]
					: [block]
			}
			default:
				return [block]
		}
	}
	return excerptBlocks(blocks, null)
}
