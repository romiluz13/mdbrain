"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { createEventReader } from "../../lib/demo-data/event-reader.js"
import { claimSourceRefs } from "../../lib/demo-data/loaders-chapters.js"
import { graphAt } from "../../lib/demo-data/playback.js"
import { viewAt } from "../../lib/demo-data/playback-view.js"
import {
	createSourceReader,
	readInLanes,
} from "../../lib/demo-data/source-reader.js"
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
import { ModeLabel } from "./parts/mode-label.js"
import { PlaybackBar } from "./parts/playback-bar.js"
import { gsap, useGSAP } from "./motion/gsap-react.js"
import { DURATION, EASE, STAGGER } from "./motion/tokens.js"
import { useReducedMotion } from "./motion/use-reduced-motion.js"
import { DEMO_UPSTREAM, useDemoData } from "./use-demo-data.js"
import { useLayout } from "./use-layout.js"
import { usePlayback } from "./use-playback.js"
import { usePresenter } from "./use-presenter.js"

// Only a confirmed presenter's page asks for the controls' code.
const PresenterBar = dynamic(
	() => import("./parts/presenter-bar.js").then((m) => m.PresenterBar),
	{ ssr: false },
)

/** The chapters that follow the recording: sources arrive to what changed. The
 * cursor starts at the end, so each shows its final state until a visitor
 * scrubs back. */
const PLAYBACK_CHAPTERS: ReadonlySet<ChapterId> = new Set([
	"sources",
	"agents",
	"contradiction",
	"growth",
	"changes",
])

/** How often a live run's reads are taken again while its agents write. */
const LIVE_REFRESH_MS = 2_500

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

export function DemoApp() {
	const { data: stored, reload, refresh } = useDemoData()
	const presenter = usePresenter()
	const reduced = useReducedMotion()
	const [index, setIndex] = useState(0)
	const [pinned, setPinned] = useState<string | null>(null)
	const [citation, setCitation] = useState<CitationTarget | null>(null)
	const [ask, setAsk] = useState<AskState>({ query: "", result: null })
	const headingRef = useRef<HTMLHeadingElement>(null)
	const mainRef = useRef<HTMLElement>(null)
	const headRef = useRef<HTMLElement>(null)
	const screenRef = useRef<HTMLDivElement>(null)
	const navRef = useRef<HTMLElement>(null)
	const focusHeading = useRef(false)

	const baseGraph = useMemo(
		() => (stored.map.kind === "ready" ? buildGraph(stored.map.data) : null),
		[stored.map],
	)
	const flagged = useMemo(
		() =>
			new Set(
				stored.contradiction.kind === "ready"
					? stored.contradiction.data.claims.map((claim) => claim.pageSlug)
					: [],
			),
		[stored.contradiction],
	)
	const storedGraph = useMemo(
		() => (baseGraph ? flagPages(baseGraph, flagged) : null),
		[baseGraph, flagged],
	)
	const storedLayout = useLayout(baseGraph)

	// The recording is the default view. A presenter holding a slot sees that
	// slot live instead, and a page that has not heard from the server yet
	// shows neither.
	const live = presenter.mode === "presenter" && presenter.lease !== null
	const recorded = presenter.mode !== "loading" && !live
	const playback = usePlayback({
		enabled: recorded,
		map: stored.map.kind === "ready" ? stored.map.data : null,
		changes: stored.changes.kind === "ready" ? stored.changes.data : null,
		run:
			stored.run.kind === "ready"
				? stored.run.data
				: stored.run.kind === "incomplete"
					? (stored.run.data ?? null)
					: null,
		detectedAt:
			stored.contradiction.kind === "ready"
				? stored.contradiction.data.detectedAt
				: undefined,
	})
	const chapterId = CHAPTERS[index]?.id
	const following =
		recorded && chapterId !== undefined && PLAYBACK_CHAPTERS.has(chapterId)
	const cursorView = following && playback.status === "ready" ? playback : null
	const data = useMemo(
		() =>
			cursorView
				? viewAt(stored, cursorView.state, cursorView.timeline)
				: stored,
		[stored, cursorView],
	)
	const cut = useMemo(
		() =>
			cursorView && storedGraph && storedLayout
				? graphAt(storedGraph, storedLayout, cursorView.state.visible)
				: null,
		[cursorView, storedGraph, storedLayout],
	)
	const graph = cursorView ? (cut?.graph ?? null) : storedGraph
	const layout = cursorView ? (cut?.layout ?? null) : storedLayout
	const sources = useMemo(() => createSourceReader(DEMO_UPSTREAM), [])
	const events = useMemo(() => createEventReader({ sources }), [sources])

	// The recorded contradiction's own sources are read as soon as it is
	// known, a few at a time, and chapter 5 finds them waiting.
	useEffect(() => {
		if (stored.contradiction.kind !== "ready") {
			return
		}
		void readInLanes(
			sources,
			stored.contradiction.data.claims.flatMap(({ claim }) => {
				const named = claimSourceRefs(claim)
				return named.kind === "ready"
					? named.data.refs.map((ref) => ({ claim, ref }))
					: []
			}),
		)
	}, [stored.contradiction, sources])

	useEffect(() => {
		const fromHash = chapterIndex(window.location.hash.slice(1))
		if (fromHash > 0) {
			setIndex(fromHash)
		}
	}, [])

	// The leased slot is another brain: reading it again, from a clear screen,
	// when the lease starts, ends or changes hands.
	const slot =
		presenter.mode === "loading" ? undefined : (presenter.lease?.slotIndex ?? 0)
	const lastSlot = useRef<number | undefined>(undefined)
	useEffect(() => {
		if (slot === undefined) {
			return
		}
		if (lastSlot.current !== undefined && lastSlot.current !== slot) {
			reload()
		}
		lastSlot.current = slot
	}, [slot, reload])

	// While the agents write, chapters 3 and 4 read the slot again as it moves.
	const requestState = presenter.request?.state
	const agentRunState =
		stored.run.kind === "ready" ? stored.run.data.agentRun?.state : undefined
	const runActive =
		live &&
		(requestState === "queued" ||
			requestState === "claimed" ||
			agentRunState === "running")
	useEffect(() => {
		if (!runActive) {
			return
		}
		const timer = setInterval(refresh, LIVE_REFRESH_MS)
		return () => clearInterval(timer)
	}, [runActive, refresh])

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

	// A chapter settles in: its kicker, title and lede, then its screen. Starting
	// another chapter, or asking for reduced motion, ends the move where it was
	// going.
	useGSAP(
		() => {
			const head = headRef.current
			const screen = screenRef.current
			if (reduced || !head || !screen) {
				return
			}
			gsap
				.timeline({
					defaults: { ease: EASE.out, clearProps: "opacity,transform" },
				})
				.from(head.children, {
					opacity: 0,
					y: 8,
					duration: DURATION.settle,
					stagger: STAGGER.head,
				})
				.from(screen, { opacity: 0, y: 6, duration: DURATION.arrive }, 0.12)
		},
		{ scope: mainRef, dependencies: [index, reduced], revertOnUpdate: true },
	)

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
			events,
			data,
			reload,
			refresh,
			graph,
			layout,
			pinned,
			pin: setPinned,
			cite: (target, opener) => setCitation({ ...target, opener }),
			ask,
			setAsk,
			goTo: (id) => goToIndex(chapterIndex(id)),
			presenter,
			live,
			playback,
		}),
		[
			data,
			sources,
			events,
			reload,
			refresh,
			graph,
			layout,
			pinned,
			ask,
			goToIndex,
			presenter,
			live,
			playback,
		],
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
				<aside className={styles.rail} data-testid="rail">
					<div className={styles.railInner}>
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
					</div>
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
				<main
					id="chapter"
					ref={mainRef}
					className={styles.main}
					key={chapter.id}
				>
					<header ref={headRef} className={styles.chapterHead}>
						<p className={styles.kicker}>
							Chapter {index + 1} of {CHAPTERS.length}
						</p>
						<h1 ref={headingRef} tabIndex={-1}>
							{chapter.title}
						</h1>
						<p className={styles.lede}>{chapter.lede}</p>
					</header>
					<div ref={screenRef} className={styles.screen} data-testid="screen">
						{presenter.mode === "presenter" ? <PresenterBar /> : null}
						{presenter.mode === "loading" ? null : (
							<ModeLabel lease={live ? presenter.lease : null} />
						)}
						{following ? <PlaybackBar /> : null}
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
