// What a stored source's text says about itself: the role label Memongo stores
// in front of an event, and a human label from its first heading or line.

import { highlightPhrase } from "./highlight.js"
import {
	type Block,
	type Span,
	excerptBlocks,
	parseMarkdown,
	plainText,
} from "./markdown.js"

const ROLE_LABEL = /^(User|Assistant|System|Tool): /
const LABEL_LIMIT = 80
// A source this short is shown whole: cutting it down would hide nothing.
const SHORT_SOURCE = 320

/** Memongo stores an event as a message, so its text opens with the role that
 * wrote it ("User: "). That is where the source came from, not part of what it
 * says: it is returned apart, and the body is what follows. Text that does not
 * open with a role label comes back whole. */
export function splitRoleLabel(stored: string): {
	role?: string
	body: string
} {
	const found = ROLE_LABEL.exec(stored)
	if (found?.[1] === undefined) {
		return { body: stored }
	}
	return { role: found[1], body: stored.slice(found[0].length) }
}

function firstLine(block: Block): string | undefined {
	switch (block.kind) {
		case "heading":
			return plainText(block.inline)
		case "paragraph":
			return block.lines[0] ? plainText(block.lines[0].inline) : undefined
		case "list":
			return block.items[0] ? plainText(block.items[0].inline) : undefined
		case "code":
			return block.text.split("\n")[0]
		default:
			return undefined
	}
}

/** A label for a source, taken from the source and never made up: its first
 * heading, or else its first line, with the markdown marks removed and a long
 * line shortened at a word. Undefined when the source has no text to take one
 * from. */
export function sourceLabel(body: string): string | undefined {
	const blocks = parseMarkdown(body)
	const heading = blocks.find((block) => block.kind === "heading")
	const label = (
		heading ? firstLine(heading) : blocks.map(firstLine).find(Boolean)
	)?.trim()
	if (label === undefined || label === "") {
		return undefined
	}
	if (label.length <= LABEL_LIMIT) {
		return label
	}
	const cut = label.slice(0, LABEL_LIMIT)
	return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd()}…`
}

export type SourceView = {
	role?: string
	label?: string
	blocks: Block[]
	/** The phrase of the source the claim rests on, as offsets in the body. */
	mark: Span | null
	/** The one unit that holds the mark, or the opening when nothing is marked;
	 * null when the source is short enough to show whole. */
	excerpt: Block[] | null
}

/** A stored source as the page shows it: the role apart from the body, a
 * label, the body read as markdown, the phrase the claim rests on marked, and
 * for a long source the excerpt that holds it. */
export function viewSource(stored: string, claimText: string): SourceView {
	const { role, body } = splitRoleLabel(stored)
	const blocks = parseMarkdown(body)
	const marked = highlightPhrase(body, claimText).find((part) => part.mark)
	const mark = marked
		? { start: marked.start, end: marked.start + marked.text.length }
		: null
	const label = sourceLabel(body)
	return {
		...(role !== undefined ? { role } : {}),
		...(label !== undefined ? { label } : {}),
		blocks,
		mark,
		excerpt: body.length <= SHORT_SOURCE ? null : excerptBlocks(blocks, mark),
	}
}
