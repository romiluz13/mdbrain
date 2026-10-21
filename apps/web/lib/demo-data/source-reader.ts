// Reads a claim's sources one at a time and remembers what it read. A cite is
// a governed recall that can take seconds, so a screen asks for each source on
// its own and shows it as it lands, and a source read once is not read again
// while the page is open.

import type { MdbrainWikiClaim } from "@mdbrain/client"
import type { DemoDataUpstream } from "./loaders.js"
import {
	loadSource,
	type SourceRef,
	type SourceView,
} from "./loaders-chapters.js"

export interface SourceReader {
	/** Reads one source of a claim, or joins the read already under way. */
	read(claim: MdbrainWikiClaim, ref: SourceRef): Promise<SourceView>
	/** What has already been read, so a screen can paint it without a flash of
	 * loading. */
	peek(claim: MdbrainWikiClaim, ref: SourceRef): SourceView | undefined
}

// A cite is keyed by the claim that cites and the event cited: the same event
// cited through two claims is two reads.
const keyOf = (claim: MdbrainWikiClaim, ref: SourceRef): string =>
	`${claim.marker ?? claim.id}\u0000${ref.marker}`

export function createSourceReader(upstream: DemoDataUpstream): SourceReader {
	const reading = new Map<string, Promise<SourceView>>()
	const settled = new Map<string, SourceView>()
	return {
		read(claim, ref) {
			const key = keyOf(claim, ref)
			const known = settled.get(key)
			if (known !== undefined) {
				return Promise.resolve(known)
			}
			const joined = reading.get(key)
			if (joined !== undefined) {
				return joined
			}
			const started = loadSource(upstream, claim, ref).then((view) => {
				reading.delete(key)
				// An unavailable source is a failed read, not an answer: asking
				// again reads it again.
				if (view.status === "resolved") {
					settled.set(key, view)
				}
				return view
			})
			reading.set(key, started)
			return started
		},
		peek(claim, ref) {
			return settled.get(keyOf(claim, ref))
		},
	}
}
