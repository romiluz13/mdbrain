"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { countOf } from "../../../lib/demo-data/plural.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { gsap, useGSAP } from "../motion/gsap-react.js"
import { DURATION, EASE, STAGGER } from "../motion/tokens.js"
import { useReducedMotion } from "../motion/use-reduced-motion.js"
import { GraphStage } from "../parts/graph-stage.js"
import { BeatStepper } from "../parts/beat-stepper.js"
import { CitationTrigger } from "../parts/citation-trigger.js"
import { ClaimSources } from "../parts/claim-sources.js"
import { StatePanel } from "../parts/state-panel.js"
import { BusinessTimeNote } from "../parts/business-time-note.js"
import { TimeLine } from "../parts/time-line.js"

const ORDINAL = ["one", "two", "three", "four"]

/** One beat for each stored claim, then the recorded stamp. */
const beatLabels = (claims: number): string[] => [
	...Array.from(
		{ length: claims },
		(_, position) => `Claim ${ORDINAL[position] ?? position + 1}`,
	),
	"Recorded",
]

export function ContradictionChapter() {
	const { data, cite, pin, goTo, reload, proof } = useDemo()
	const [beat, setBeat] = useState(0)
	const beats = useRef<HTMLDivElement>(null)
	const heading = useRef<"forward" | "back">("forward")
	const reduced = useReducedMotion()
	const found =
		data.contradiction.kind === "ready" ? data.contradiction.data : null
	// On a phone each beat is one screen: a new beat opens at its top, not at
	// the middle of a card the person has just scrolled down through.
	const showBeat = (next: number) => {
		heading.current = next > beat ? "forward" : "back"
		setBeat(next)
		const top = beats.current
		if (top && top.getBoundingClientRect().top < 0) {
			const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
			top.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" })
		}
	}
	const labels = beatLabels(found?.claims.length ?? 0)
	const lastBeat = labels.length - 1
	// A "See it" from the story lands on the recorded stamp, not the first claim.
	useEffect(() => {
		if (proof?.target === "contradiction") {
			setBeat(lastBeat)
		}
	}, [proof, lastBeat])
	const highlight = useMemo(
		() => new Set(found?.claims.map((claim) => claim.pageSlug) ?? []),
		[found],
	)
	// A beat just reached arrives: its claim eases in and its sources slide in
	// from the side its claim sits on, and the recorded stamp lands. Stepping
	// back shows the earlier beat as it was, and reduced motion shows every beat
	// as it ends.
	useGSAP(
		() => {
			const root = beats.current
			if (reduced || !root || heading.current === "back") {
				return
			}
			const arrive = gsap.timeline({
				defaults: { clearProps: "opacity,transform" },
			})
			if (beat < lastBeat) {
				const step = root.querySelector('[data-current="true"]')
				if (!step) {
					return
				}
				const side = beat % 2 === 0 ? -1 : 1
				arrive
					.from(step, {
						opacity: 0,
						y: 8,
						duration: DURATION.arrive,
						ease: EASE.out,
					})
					.from(
						step.querySelectorAll('[data-motion="claim-slip"]'),
						{
							opacity: 0,
							x: side * 28,
							duration: DURATION.slip,
							ease: EASE.out,
							stagger: STAGGER.slips,
						},
						0.1,
					)
				return
			}
			const stamp = root.querySelector('[data-testid="contradiction-stamp"]')
			if (stamp) {
				arrive.from(stamp, {
					opacity: 0,
					scale: 1.35,
					rotation: -4,
					duration: DURATION.stamp,
					ease: EASE.stamp,
				})
			}
		},
		{
			scope: beats,
			dependencies: [beat, reduced, found === null],
			revertOnUpdate: true,
		},
	)
	// The camera frames the two pages from the beat the case is recorded on, and
	// goes back as the reader steps back.
	const framed = useMemo(() => {
		const [first, second] = [...highlight]
		return first !== undefined && second !== undefined && beat >= lastBeat
			? ([first, second] as const)
			: null
	}, [highlight, beat, lastBeat])
	return (
		<>
			<StatePanel
				state={data.contradiction}
				what="the recorded contradiction"
				emptyTitle="Not recorded in this run yet"
				emptyNote="None is recorded in this run yet. Agents write the contradiction live, as they read the sources, so this chapter fills in during an agent run. Nothing is shown here in its place."
				onRetry={reload}
			>
				{(record) => (
					<>
						<BusinessTimeNote>
							Business time is when a source says something happened. A claim
							carries none of its own; each source below shows its own, or says
							it has none.
						</BusinessTimeNote>
						<div className={styles.beats} ref={beats}>
							<BeatStepper labels={labels} beat={beat} onBeat={showBeat} />
							<ol className={styles.caseSteps}>
								{record.claims.map((entry, position) => (
									<li
										key={`${entry.pageSlug}:${entry.claim.id}`}
										className={styles.caseStep}
										hidden={position > beat}
										data-past={position < beat || undefined}
										data-current={position === beat || undefined}
									>
										<h2 className={styles.stepLabel}>{labels[position]}</h2>
										<p className={styles.where}>
											On the page{" "}
											<button
												type="button"
												className={styles.linkButton}
												onClick={() => {
													pin(entry.pageSlug)
													goTo("brain")
												}}
											>
												{entry.pageTitle}
											</button>
											, revision {entry.revision}
										</p>
										<blockquote
											className={styles.quote}
											data-testid="contradiction-claim"
										>
											{entry.claim.text}
										</blockquote>
										<p className={styles.claimMeta}>
											{entry.claim.status} · confidence{" "}
											{Math.round(entry.claim.confidence * 100)}%
										</p>
										<ClaimSources
											claim={entry.claim}
											listClassName={styles.slipList}
										/>
										<CitationTrigger
											claim={entry.claim}
											label={`Open citation for claim ${ORDINAL[position] ?? position + 1}`}
											onOpen={(opener) =>
												cite(
													{
														claim: entry.claim,
														pageSlug: entry.pageSlug,
														pageTitle: entry.pageTitle,
														revision: entry.revision,
													},
													opener,
												)
											}
										/>
									</li>
								))}
								<li
									className={styles.stamp}
									data-testid="contradiction-stamp"
									hidden={beat < lastBeat}
									data-past={beat > lastBeat || undefined}
								>
									<h2>Contradiction recorded</h2>
									<p className={styles.mono}>{record.id}</p>
									<TimeLine
										kind="ingestion"
										iso={record.detectedAt}
										note="detected"
									/>
									<p>Resolution: {record.resolution}</p>
									{record.note ? <p>{record.note}</p> : null}
									<p>
										{record.claims.length === 2
											? "Both claims were kept."
											: "Every claim was kept."}{" "}
										Nothing was overwritten.
									</p>
									<p className={styles.claimMeta}>
										{countOf(
											record.unresolvedCount,
											"unresolved contradiction",
										)}{" "}
										in this brain.
									</p>
								</li>
							</ol>
						</div>
					</>
				)}
			</StatePanel>
			<GraphStage
				view3d
				title={found ? "Where the two pages sit" : "The pages in this brain"}
				highlight={highlight}
				frame={framed}
				compact
			/>
		</>
	)
}
