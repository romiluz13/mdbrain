"use client"

import type { MdbrainWikiClaim } from "@mdbrain/client"
import { useEffect, useState } from "react"
import type {
	SourceRef,
	SourceView,
} from "../../lib/demo-data/loaders-chapters.js"
import { useDemo } from "./demo-context.js"

export type SourceWanted = { claim: MdbrainWikiClaim; ref: SourceRef }

// A cite is a governed recall that can take seconds: a list asks for a few at a
// time, in order, so the first rows land first and recall is not flooded.
const LANES = 4

/** The sources of a list, each as its own read lands, keyed by event id. A source
 * read before is there on the first render. */
export function useSourceReads(
	wanted: readonly SourceWanted[],
): Record<string, SourceView | undefined> {
	const { sources } = useDemo()
	const [arrived, setArrived] = useState<Record<string, SourceView>>({})

	useEffect(() => {
		let live = true
		let next = 0
		const lane = async () => {
			while (live && next < wanted.length) {
				const item = wanted[next]
				next += 1
				if (item === undefined) {
					return
				}
				const view = await sources.read(item.claim, item.ref)
				if (live) {
					setArrived((current) => ({ ...current, [item.ref.eventId]: view }))
				}
			}
		}
		for (let at = 0; at < Math.min(LANES, wanted.length); at += 1) {
			void lane()
		}
		return () => {
			live = false
		}
	}, [wanted, sources])

	return Object.fromEntries(
		wanted.map(({ claim, ref }) => [
			ref.eventId,
			arrived[ref.eventId] ?? sources.peek(claim, ref),
		]),
	)
}
