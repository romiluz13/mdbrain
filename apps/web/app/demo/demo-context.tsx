"use client"

import { createContext, useContext } from "react"
import type { MdbrainWikiClaim } from "@mdbrain/client"
import type { Layout } from "../../lib/demo-data/graph-layout.js"
import type { DemoDataUpstream } from "../../lib/demo-data/loaders.js"
import type { SearchView } from "../../lib/demo-data/loaders-chapters.js"
import type { EventReader } from "../../lib/demo-data/event-reader.js"
import type { SourceReader } from "../../lib/demo-data/source-reader.js"
import type { DataState } from "../../lib/demo-data/states.js"
import type { Graph } from "../../lib/demo-data/views.js"
import type { DemoData } from "./use-demo-data.js"
import type { Playback } from "./use-playback.js"
import type { Presenter } from "./use-presenter.js"

/** A claim opened as a citation, with where it lives and what to focus when
 * the citation closes. */
export type CitationTarget = {
	claim: MdbrainWikiClaim
	pageSlug: string
	pageTitle: string
	revision?: number
	opener: HTMLElement | null
}

export type AskState = {
	query: string
	result: DataState<SearchView> | null
}

export type DemoContextValue = {
	upstream: DemoDataUpstream
	/** Reads a claim's sources one at a time and remembers them. */
	sources: SourceReader
	/** Confirms the run's arrivals and steps, one at a time, and remembers. */
	events: EventReader
	data: DemoData
	reload: () => void
	/** Reads again without clearing the screen, for a live run still writing. */
	refresh: () => void
	graph: Graph | null
	layout: Layout | null
	pinned: string | null
	pin: (slug: string | null) => void
	cite: (
		target: Omit<CitationTarget, "opener">,
		opener: HTMLElement | null,
	) => void
	ask: AskState
	setAsk: (next: AskState) => void
	goTo: (id: string) => void
	presenter: Presenter
	/** The page is showing a presenter's leased slot, live, not the recording. */
	live: boolean
	playback: Playback
}

export const DemoContext = createContext<DemoContextValue | null>(null)

export function useDemo(): DemoContextValue {
	const value = useContext(DemoContext)
	if (value === null) {
		throw new Error("useDemo is used outside the demo shell")
	}
	return value
}
