"use client"

import Link from "next/link"
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"
import { claimSourceRefs } from "../../lib/demo-data/loaders-chapters.js"
import { createSourceReader } from "../../lib/demo-data/source-reader.js"
import { buildGraph, flagPages } from "../../lib/demo-data/views.js"
import { AgentsChapter } from "./chapters/agents.js"
import { AskChapter } from "./chapters/ask.js"
import { BrainChapter } from "./chapters/brain.js"
import { ChangesChapter } from "./chapters/changes.js"
import { ContradictionChapter } from "./chapters/contradiction.js"
import { GrowthChapter } from "./chapters/growth.js"
import { HoodChapter } from "./chapters/hood.js"
import { RunChapter } from "./chapters/run.js"
import { SourcesChapter } from "./chapters/sources.js"
import { CHAPTERS, chapterIndex, type ChapterId } from "./chapters.js"
import {
	DemoContext,
	type AskState,
	type CitationTarget,
	type DemoContextValue,
} from "./demo-context.js"
import styles from "./demo.module.css"
import { CitationDialog } from "./parts/citation-dialog.js"
import { DEMO_UPSTREAM, useDemoData } from "./use-demo-data.js"
import { useLayout } from "./use-layout.js"

const BODY: Record<ChapterId, () => React.JSX.Element> = {
	brain: BrainChapter,
	ask: AskChapter,
	sources: SourcesChapter,
	agents: AgentsChapter,
	contradiction: ContradictionChapter,
	growth: GrowthChapter,
	changes: ChangesChapter,
	hood: HoodChapter,
	run: RunChapter,
}

const REDUCED = "(prefers-reduced-motion: reduce)"

function subscribeMotion(notify: () => void): () => void {
	const query = window.matchMedia(REDUCED)
	query.addEventListener("change", notify)
	return () => query.removeEventListener("change", notify)
}

/** The OS setting, read before the first data read starts, so a visitor who
 * asked for reduced motion never sees a moving frame. */
function useReducedMotion(): boolean {
	return useSyncExternalStore(
		subscribeMotion,
		() => window.matchMedia(REDUCED).matches,
		() => false,
	)
}

export function DemoApp() {
	const { data, reload } = useDemoData()
	const reduced = useReducedMotion()
	const [index, setIndex] = useState(0)
	const [pinned, setPinned] = useState<string | null>(null)
	const [citation, setCitation] = useState<CitationTarget | null>(null)
	const [ask, setAsk] = useState<AskState>({ query: "", result: null })
	const headingRef = useRef<HTMLHeadingElement>(null)
	const navRef = useRef<HTMLElement>(null)
	const focusHeading = useRef(false)

	const baseGraph = useMemo(
		() => (data.map.kind === "ready" ? buildGraph(data.map.data) : null),
		[data.map],
	)
	const flagged = useMemo(
		() =>
			new Set(
				data.contradiction.kind === "ready"
					? data.contradiction.data.claims.map((claim) => claim.pageSlug)
					: [],
			),
		[data.contradiction],
	)
	const graph = useMemo(
		() => (baseGraph ? flagPages(baseGraph, flagged) : null),
		[baseGraph, flagged],
	)
	const layout = useLayout(baseGraph)
	const sources = useMemo(() => createSourceReader(DEMO_UPSTREAM), [])

	// A cite is a governed recall that takes seconds, so the recorded
	// contradiction's own sources are read as soon as it is known, and chapter 5
	// finds them waiting.
	useEffect(() => {
		if (data.contradiction.kind !== "ready") {
			return
		}
		for (const { claim } of data.contradiction.data.claims) {
			const named = claimSourceRefs(claim)
			if (named.kind === "ready") {
				for (const ref of named.data.refs) {
					void sources.read(claim, ref)
				}
			}
		}
	}, [data.contradiction, sources])

	useEffect(() => {
		const fromHash = chapterIndex(window.location.hash.slice(1))
		if (fromHash > 0) {
			setIndex(fromHash)
		}
	}, [])

	// After a chapter change, not on first paint, move focus to the new heading.
	useEffect(() => {
		if (focusHeading.current) {
			focusHeading.current = false
			headingRef.current?.focus()
		}
	})

	// The phone rail scrolls sideways: keep the current chapter in view.
	useEffect(() => {
		navRef.current
			?.querySelector(`[data-chapter="${index}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" })
	}, [index])

	const goToIndex = useCallback((next: number) => {
		const clamped = Math.min(Math.max(next, 0), CHAPTERS.length - 1)
		focusHeading.current = true
		setIndex(clamped)
		const chapter = CHAPTERS[clamped]
		if (chapter) {
			window.history.replaceState(null, "", `#${chapter.id}`)
		}
	}, [])

	// Arrow keys step the chapters from the pager, and walk the rail's buttons
	// without selecting one (Enter selects), so a keyboard visitor can move
	// through the story without tabbing past every control.
	const stepFromPager = (event: KeyboardEvent<HTMLElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
			return
		}
		const step =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
		if (step !== 0 && CHAPTERS[index + step]) {
			event.preventDefault()
			goToIndex(index + step)
		}
	}
	const walkRail = (event: KeyboardEvent<HTMLElement>) => {
		const buttons = [
			...(navRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
		]
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
		if (at === -1 || event.altKey || event.ctrlKey || event.metaKey) {
			return
		}
		const target =
			event.key === "ArrowDown" || event.key === "ArrowRight"
				? buttons[at + 1]
				: event.key === "ArrowUp" || event.key === "ArrowLeft"
					? buttons[at - 1]
					: event.key === "Home"
						? buttons[0]
						: event.key === "End"
							? buttons[buttons.length - 1]
							: undefined
		if (target) {
			event.preventDefault()
			target.focus()
		}
	}

	const value = useMemo<DemoContextValue>(
		() => ({
			upstream: DEMO_UPSTREAM,
			sources,
			data,
			reload,
			graph,
			layout,
			pinned,
			pin: setPinned,
			cite: (target, opener) => setCitation({ ...target, opener }),
			ask,
			setAsk,
			goTo: (id) => goToIndex(chapterIndex(id)),
		}),
		[data, sources, reload, graph, layout, pinned, ask, goToIndex],
	)

	const citationRef = useRef(citation)
	citationRef.current = citation
	const closeCitation = useCallback(() => {
		const opener = citationRef.current?.opener
		setCitation(null)
		opener?.focus()
	}, [])

	const chapter = CHAPTERS[index] ?? CHAPTERS[0]
	if (!chapter) {
		return null
	}
	const Body = BODY[chapter.id]
	const previous = CHAPTERS[index - 1]
	const next = CHAPTERS[index + 1]

	return (
		<DemoContext.Provider value={value}>
			<div className={styles.root} data-motion={reduced ? "reduced" : "full"}>
				<a className={styles.skip} href="#chapter">
					Skip to the chapter
				</a>
				<aside className={styles.rail}>
					<div className={styles.brand}>
						<Link href="/" className={styles.brandName}>
							mdbrain
						</Link>
						<span className={styles.brandSub}>Control room</span>
					</div>
					<nav
						ref={navRef}
						aria-label="Chapters"
						className={styles.chapterNav}
						onKeyDown={walkRail}
					>
						<ol>
							{CHAPTERS.map((entry, position) => (
								<li key={entry.id} data-chapter={position}>
									<button
										type="button"
										className={styles.chapterButton}
										aria-current={position === index ? "step" : undefined}
										onClick={() => goToIndex(position)}
									>
										<span className={styles.chapterNumber} aria-hidden="true">
											{position + 1}
										</span>
										<span>{entry.title}</span>
									</button>
								</li>
							))}
						</ol>
					</nav>
				</aside>
				<p className={styles.syntheticBar} data-testid="synthetic-label">
					<span className={styles.syntheticTag}>Synthetic company</span>
					<span>
						Northstar Systems (fictional)
						<span className={styles.syntheticMore}>
							: its people, accounts and sources are invented. The reads are
							real.
						</span>
					</span>
				</p>
				<main id="chapter" className={styles.main} key={chapter.id}>
					<header className={styles.chapterHead}>
						<p className={styles.kicker}>
							Chapter {index + 1} of {CHAPTERS.length}
						</p>
						<h1 ref={headingRef} tabIndex={-1}>
							{chapter.title}
						</h1>
						<p className={styles.lede}>{chapter.lede}</p>
					</header>
					<div className={styles.screen} data-testid="screen">
						<Body />
					</div>
					<footer className={styles.pager}>
						{previous ? (
							<button
								type="button"
								className={styles.button}
								data-variant="quiet"
								onClick={() => goToIndex(index - 1)}
								onKeyDown={stepFromPager}
							>
								← {previous.title}
							</button>
						) : (
							<span />
						)}
						{next ? (
							<button
								type="button"
								className={styles.button}
								onClick={() => goToIndex(index + 1)}
								onKeyDown={stepFromPager}
							>
								{next.title} →
							</button>
						) : null}
					</footer>
				</main>
				<CitationDialog target={citation} onClose={closeCitation} />
			</div>
		</DemoContext.Provider>
	)
}
