// Pure view models for the /demo chapters: derived values only, no reads and
// no rendering. Everything here is computed from loader results.

import type { MdbrainWikiClaim } from "@mdbrain/client"

const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"are",
	"was",
	"were",
	"this",
	"that",
	"with",
	"from",
	"has",
	"have",
	"does",
	"not",
	"its",
	"our",
	"you",
	"can",
])

function words(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9$%.,-]+/g) ?? [])
		.map((word) => word.replace(/^[.,-]+|[.,-]+$/g, ""))
		.filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

/** The claims of a page, most relevant to the question first: by the number of
 *  distinct question words each claim shares, then confidence, then page order.
 *  A claim that shares no word keeps its place behind the ones that do. */
export function rankClaims(
	query: string,
	claims: readonly MdbrainWikiClaim[],
): MdbrainWikiClaim[] {
	const wanted = new Set(words(query))
	const scored = claims.map((claim, index) => {
		const have = new Set(words(claim.text))
		let overlap = 0
		for (const word of wanted) {
			if (have.has(word)) {
				overlap += 1
			}
		}
		return { claim, index, overlap }
	})
	scored.sort(
		(a, b) =>
			b.overlap - a.overlap ||
			b.claim.confidence - a.claim.confidence ||
			a.index - b.index,
	)
	return scored.map((entry) => entry.claim)
}
