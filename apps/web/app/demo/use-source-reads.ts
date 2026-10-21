"use client"

import { useEffect, useState } from "react"
import type { SourceView } from "../../lib/demo-data/loaders-chapters.js"
import {
	readInLanes,
	type SourceWanted,
} from "../../lib/demo-data/source-reader.js"
import { useDemo } from "./demo-context.js"

/** The sources of a list, each as its own read lands, keyed by event id. A source
 * read before is there on the first render. */
export function useSourceReads(
	wanted: readonly SourceWanted[],
): Record<string, SourceView | undefined> {
	const { sources } = useDemo()
	const [arrived, setArrived] = useState<Record<string, SourceView>>({})

	useEffect(() => {
		let live = true
		void readInLanes(
			sources,
			wanted,
			({ ref }, view) =>
				setArrived((current) => ({ ...current, [ref.eventId]: view })),
			() => live,
		)
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
