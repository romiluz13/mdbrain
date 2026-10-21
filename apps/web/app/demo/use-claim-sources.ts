"use client"

import type { MdbrainWikiClaim } from "@mdbrain/client"
import { useEffect, useMemo, useState } from "react"
import {
	claimSourceRefs,
	type ClaimSourceRefs,
	type SourceRef,
	type SourceView,
} from "../../lib/demo-data/loaders-chapters.js"
import { readInLanes, sourceKey } from "../../lib/demo-data/source-reader.js"
import type { DataState } from "../../lib/demo-data/states.js"
import { useDemo } from "./demo-context.js"

/** A source of a claim: read, or still being read. */
export type SourceSlot = SourceView | (SourceRef & { status: "loading" })
export type ClaimSourcesProgress = ClaimSourceRefs & { slots: SourceSlot[] }

/** A claim's sources, each as its own read lands. The claim's events are known
 * at once, so every source has a slot from the first render and fills in when
 * its cite returns; a source read before (or warmed) is there without a wait. */
export function useClaimSources(
	claim: MdbrainWikiClaim,
): DataState<ClaimSourcesProgress> {
	const { sources } = useDemo()
	const named = useMemo(() => claimSourceRefs(claim), [claim])
	const [arrived, setArrived] = useState<Record<string, SourceView>>({})

	useEffect(() => {
		if (named.kind !== "ready") {
			return
		}
		let live = true
		void readInLanes(
			sources,
			named.data.refs.map((ref) => ({ claim, ref })),
			({ ref }, view) =>
				setArrived((current) => ({
					...current,
					[sourceKey(claim, ref)]: view,
				})),
			() => live,
		)
		return () => {
			live = false
		}
	}, [claim, named, sources])

	if (named.kind !== "ready") {
		return named
	}
	return {
		kind: "ready",
		data: {
			...named.data,
			slots: named.data.refs.map(
				(ref): SourceSlot =>
					arrived[sourceKey(claim, ref)] ??
					sources.peek(claim, ref) ?? { ...ref, status: "loading" },
			),
		},
	}
}
