// Reads sources one at a time and remembers what it read. A screen asks for
// each source on its own and shows it as it lands, and a source read once is
// not read again while the page is open.

import type { MdbrainWikiClaim } from "@mdbrain/client"
import type { DemoDataUpstream } from "./loaders.js"
import {
	loadSource,
	type SourceRef,
	type SourceView,
} from "./loaders-chapters.js"

export interface SourceReader {
	/** Reads one source, through the claim that cites it or, with none, by its
	 * id, or joins the read already under way. */
	read(claim: MdbrainWikiClaim | undefined, ref: SourceRef): Promise<SourceView>
	/** What has already been read, so a screen can paint it without a flash of
	 * loading. */
	peek(
		claim: MdbrainWikiClaim | undefined,
		ref: SourceRef,
	): SourceView | undefined
}

// A cite is keyed by the claim that cites and the event cited: the same event
// cited through two claims, or by id, is separate reads.
export const sourceKey = (
	claim: MdbrainWikiClaim | undefined,
	ref: SourceRef,
): string => `${claim ? (claim.marker ?? claim.id) : ""}\u0000${ref.marker}`

export function createSourceReader(upstream: DemoDataUpstream): SourceReader {
	const reading = new Map<string, Promise<SourceView>>()
	const settled = new Map<string, SourceView>()
	return {
		read(claim, ref) {
			const key = sourceKey(claim, ref)
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
			return settled.get(sourceKey(claim, ref))
		},
	}
}

/** How many cites a screen asks for at once. */
export const LANES = 4

export type SourceWanted = { claim: MdbrainWikiClaim; ref: SourceRef }

/** Reads the sources through the reader a few at a time, in order, so the
 * first land first. `onRead` hears each as it lands; once `live` says no, no
 * further source is asked for and none is heard. */
export async function readInLanes(
	reader: SourceReader,
	wanted: readonly SourceWanted[],
	onRead?: (item: SourceWanted, view: SourceView) => void,
	live: () => boolean = () => true,
): Promise<void> {
	let next = 0
	const lane = async () => {
		while (live() && next < wanted.length) {
			const item = wanted[next]
			next += 1
			if (item === undefined) {
				return
			}
			const view = await reader.read(item.claim, item.ref)
			if (live()) {
				onRead?.(item, view)
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(LANES, wanted.length) }, lane),
	)
}
