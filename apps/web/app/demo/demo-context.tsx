"use client"

import {
	createContext,
	useContext,
	type Dispatch,
	type SetStateAction,
} from "react"
import type { MdbrainWikiClaim } from "@mdbrain/client"
import type { AnswerOutcome } from "../../lib/demo-data/answer-types.js"
import type { Layout } from "../../lib/demo-data/graph-layout.js"
import type { DemoDataUpstream } from "../../lib/demo-data/loaders.js"
import type { SearchView } from "../../lib/demo-data/loaders-chapters.js"
import type { EventReader } from "../../lib/demo-data/event-reader.js"
import type { SourceReader } from "../../lib/demo-data/source-reader.js"
import type { DataState } from "../../lib/demo-data/states.js"
import type { Graph } from "../../lib/demo-data/views.js"
import type { DemoData } from "./use-demo-data.js"

/** A claim opened as a citation, with where it lives and what to focus when
 * the citation closes. */
export type CitationTarget = {
	claim: MdbrainWikiClaim
	pageSlug: string
	pageTitle: string
	revision?: number
	opener: HTMLElement | null
}

/** The model answer lane, one step at a time: idle until a question is
 * sent, answering while its request is live, then the outcome the server
 * returned. It lives here, not in the chapter, because chapters unmount on
 * switch and the lane must survive the trip and remember a canceled answer. */
export type AnswerLane =
	| { status: "idle" }
	| { status: "answering"; question: string }
	| { status: "done"; question: string; outcome: AnswerOutcome }

export type AskState = {
	query: string
	result: DataState<SearchView> | null
	answer: AnswerLane
}

export type DemoContextValue = {
	upstream: DemoDataUpstream
	/** Reads a claim's sources one at a time and remembers them. */
	sources: SourceReader
	/** Confirms the run's arrivals and steps, one at a time, and remembers. */
	events: EventReader
	data: DemoData
	reload: () => void
	graph: Graph | null
	layout: Layout | null
	pinned: string | null
	pin: (slug: string | null) => void
	cite: (
		target: Omit<CitationTarget, "opener">,
		opener: HTMLElement | null,
	) => void
	ask: AskState
	setAsk: Dispatch<SetStateAction<AskState>>
	goTo: (id: string) => void
}

export const DemoContext = createContext<DemoContextValue | null>(null)

export function useDemo(): DemoContextValue {
	const value = useContext(DemoContext)
	if (value === null) {
		throw new Error("useDemo is used outside the demo shell")
	}
	return value
}
