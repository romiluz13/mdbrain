const MAX_EXCERPT_CHARS = 600
const WINDOW_CHARS = 240

/** Picks the note for event evidence per the 311 contract: a verbatim,
 * distinctive excerpt (1-2 sentences) of the rendered body that contains the
 * claim's anchor. The note doubles as the recall query, so it must survive
 * case variants (the corpus has one anchor that differs in case from the
 * rendered body) and markdown tables (anchors that sit in table cells). */
export function chooseExcerpt(body: string, anchor: string): string {
	const needle = anchor.trim()
	if (!needle) return fallbackOpening(body)
	const raw = body
	const match = raw.match(new RegExp(escapeRegExp(needle), "i"))
	if (!match || match.index === undefined) return fallbackOpening(raw)

	// A table row is its own excerpt unit: sentence splitting across pipes
	// produces junk, so the row (minus edge pipes) is the excerpt.
	const lineStart = raw.lastIndexOf("\n", match.index) + 1
	const lineEndIndex = raw.indexOf("\n", match.index)
	const line = raw.slice(
		lineStart,
		lineEndIndex === -1 ? raw.length : lineEndIndex,
	)
	if (line.includes("|")) {
		const row = collapse(line).replace(/^\|/, "").replace(/\|$/, "").trim()
		if (row) return capToWindow(collapse(raw), needle, row)
	}

	// Prose: collapse whitespace (keeps words verbatim, makes soft-wrapped
	// sentences contiguous), then expand to sentence boundaries.
	const flat = collapse(raw)
	const flatIndex = flat.toLowerCase().indexOf(needle.toLowerCase())
	if (flatIndex === -1) return fallbackOpening(raw)
	const start = sentenceStart(flat, flatIndex)
	const end = sentenceEnd(flat, flatIndex + needle.length)
	const sentence = flat.slice(start, end).trim()
	if (!sentence) return fallbackOpening(raw)
	return capToWindow(flat, needle, sentence)
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

function sentenceStart(flat: string, index: number): number {
	for (let i = index - 1; i > 0; i--) {
		if (/[.!?]/.test(flat[i] ?? "") && /\s/.test(flat[i + 1] ?? "")) {
			return i + 1
		}
	}
	return 0
}

function sentenceEnd(flat: string, index: number): number {
	for (let i = index; i < flat.length; i++) {
		if (/[.!?]/.test(flat[i] ?? "")) return i + 1
	}
	return flat.length
}

function capToWindow(flat: string, needle: string, excerpt: string): string {
	if (excerpt.length <= MAX_EXCERPT_CHARS) return excerpt
	const index = flat.toLowerCase().indexOf(needle.toLowerCase())
	const from = Math.max(0, index - WINDOW_CHARS)
	const to = Math.min(flat.length, index + needle.length + WINDOW_CHARS)
	let window = flat.slice(from, to)
	if (from > 0) window = window.replace(/^\S*\s/, "")
	if (to < flat.length) window = window.replace(/\s\S*$/, "")
	return window.trim()
}

function fallbackOpening(body: string): string {
	const flat = collapse(body)
	const sentences = flat.match(/[^.!?]*[.!?]+/g)
	if (sentences) {
		const opening = sentences
			.slice(0, 2)
			.map((sentence) => sentence.trim())
			.join(" ")
		if (opening) return capToWindow(flat, flat.slice(0, 1), opening)
	}
	return flat.slice(0, MAX_EXCERPT_CHARS).trim()
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
