// Marks the part of a stored source text that a claim rests on, for the
// evidence slips: the longest run of claim words (two or more) that appears
// in the source, matched case-insensitively. The source text is returned
// whole and unchanged; only a segment flag says which part to mark.

/** `start` is the segment's offset in the source text, a stable key. */
export type TextSegment = { text: string; mark: boolean; start: number }

const WORD = /[\p{L}\p{N}$%][\p{L}\p{N}$%.,'’-]*[\p{L}\p{N}$%]|[\p{L}\p{N}$%]/gu
const MIN_RUN = 2
const MAX_RUN = 10

type Token = { word: string; start: number; end: number }

function tokens(text: string): Token[] {
	return [...text.matchAll(WORD)].map((match) => ({
		word: match[0].toLowerCase(),
		start: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
	}))
}

export function highlightPhrase(source: string, claim: string): TextSegment[] {
	if (source === "") {
		return []
	}
	const sourceTokens = tokens(source)
	const claimTokens = tokens(claim)
	for (let run = Math.min(claimTokens.length, MAX_RUN); run >= MIN_RUN; run--) {
		for (let from = 0; from + run <= claimTokens.length; from++) {
			const wanted = claimTokens
				.slice(from, from + run)
				.map((token) => token.word)
			for (let at = 0; at + run <= sourceTokens.length; at++) {
				if (
					wanted.every(
						(word, offset) => sourceTokens[at + offset]?.word === word,
					)
				) {
					const start = (sourceTokens[at] as Token).start
					const end = (sourceTokens[at + run - 1] as Token).end
					return [
						...(start > 0
							? [{ text: source.slice(0, start), mark: false, start: 0 }]
							: []),
						{ text: source.slice(start, end), mark: true, start },
						...(end < source.length
							? [{ text: source.slice(end), mark: false, start: end }]
							: []),
					]
				}
			}
		}
	}
	return [{ text: source, mark: false, start: 0 }]
}
