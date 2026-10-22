"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
	TOKEN_CEILING,
	agentRunState,
	agentStage,
	formatWallTime,
	loadAgentRunChecks,
	roleStories,
	totalTokens,
	wallTimeMs,
	type AgentRunChecks,
} from "../../../lib/demo-data/agent-run.js"
import type {
	AgentRoleId,
	AgentRunRecord,
	RunRecord,
} from "../../../lib/demo-data/run-record.js"
import { formatUtc } from "../../../lib/demo-data/views.js"
import chapter from "../chapters.module.css"
import { useDemo } from "../demo-context.js"
import { gsap, useGSAP } from "../motion/gsap-react.js"
import { DURATION, EASE } from "../motion/tokens.js"
import { useCountUp } from "../motion/use-count-up.js"
import { useReducedMotion } from "../motion/use-reduced-motion.js"
import { RoleCard } from "../parts/role-card.js"
import { StatePanel } from "../parts/state-panel.js"
import styles from "../run-chapters.module.css"
import { useEventReads } from "../use-event-reads.js"

const number = new Intl.NumberFormat("en-US")

const RUN_TAG = {
	complete: { text: "Finished", tone: "ok" },
	running: { text: "Running", tone: undefined },
	incomplete: { text: "Stopped early", tone: "signal" },
} as const

function AgentStory({
	run,
	unindexed,
}: {
	run: AgentRunRecord
	unindexed: boolean
}) {
	const { upstream, data, goTo } = useDemo()
	const [checks, setChecks] = useState<AgentRunChecks | null>(null)
	const [open, setOpen] = useState<ReadonlySet<AgentRoleId>>(new Set())
	const stories = useMemo(() => roleStories(run), [run])

	useEffect(() => {
		let live = true
		setChecks(null)
		void loadAgentRunChecks(upstream, run).then((found) => {
			if (live) {
				setChecks(found)
			}
		})
		return () => {
			live = false
		}
	}, [upstream, run])

	// A role's steps are confirmed when its disclosure opens: nobody has asked
	// to see them before.
	const wanted = useMemo(
		() =>
			stories
				.filter((story) => open.has(story.role))
				.flatMap((story) => story.steps.map(({ eventId }) => ({ eventId }))),
		[stories, open],
	)
	const reads = useEventReads(wanted)

	const tag = RUN_TAG[run.state]
	const wall = wallTimeMs(run)
	const tokens = run.usage ? totalTokens(run.usage) : null

	// The token count climbs with the meter, then the hand-off arrows are drawn
	// Support to Account to Product. Both end where the record says they are.
	const reduced = useReducedMotion()
	const figure = useRef<HTMLSpanElement>(null)
	const meter = useRef<HTMLMeterElement>(null)
	const handoff = useRef<HTMLOListElement>(null)
	useCountUp(figure, tokens, number.format, (shown) => {
		if (meter.current) {
			meter.current.value = Math.min(shown, TOKEN_CEILING)
		}
	})
	useGSAP(
		() => {
			const arrows = handoff.current?.querySelectorAll(
				'[data-motion="handoff-arrow"]',
			)
			if (reduced || !arrows?.length) {
				return
			}
			const draw = gsap.timeline({
				delay: 0.3,
				defaults: { clearProps: "opacity,strokeDashoffset" },
			})
			arrows.forEach((arrow, at) => {
				const start = at * DURATION.arrow
				draw.from(arrow, { opacity: 0, duration: 0.15, ease: EASE.out }, start)
				draw.from(
					arrow.querySelector("path"),
					{ strokeDashoffset: 1, duration: DURATION.arrow, ease: EASE.inOut },
					start,
				)
			})
		},
		{ scope: handoff, dependencies: [reduced], revertOnUpdate: true },
	)
	const meetsContradiction =
		run.reusedPage !== undefined &&
		data.contradiction.kind === "ready" &&
		data.contradiction.data.claims.some(
			(claim) => claim.pageSlug === run.reusedPage?.slug,
		)

	return (
		<>
			<section
				className={`${chapter.panel} ${styles.strip}`}
				aria-labelledby="agent-run-heading"
				data-testid="agent-run"
				data-run-state={run.state}
			>
				<div className={styles.stripHead}>
					<h2 id="agent-run-heading">Three agents, one shared brain</h2>
					<span className={styles.tag} data-tone={tag.tone}>
						{tag.text}
					</span>
					<span className={chapter.note}>
						From the run's record. Started {formatUtc(run.startedAt)}.
					</span>
				</div>
				{run.incompleteLabel ? (
					<p className={chapter.note} data-testid="agent-run-label">
						{run.incompleteLabel}
					</p>
				) : null}
				<div className={styles.stripFacts}>
					<div className={styles.fact}>
						<span className={styles.factLabel}>Wall time</span>
						<span className={styles.factValue} data-stat="agent-wall-time">
							{wall === undefined ? "—" : formatWallTime(wall)}
						</span>
					</div>
					<div className={styles.fact}>
						<span className={styles.factLabel}>Tokens used</span>
						{tokens === null ? (
							<span className={styles.factValue}>—</span>
						) : (
							<>
								<span
									ref={figure}
									className={styles.factValue}
									data-stat="agent-tokens"
								>
									{number.format(tokens)}
									<span className={styles.factOf}>
										{" "}
										of {number.format(TOKEN_CEILING)}
									</span>
								</span>
								<meter
									ref={meter}
									className={styles.meter}
									aria-label="Tokens used against the ceiling"
									min={0}
									max={TOKEN_CEILING}
									value={Math.min(tokens, TOKEN_CEILING)}
								/>
								{run.usage ? (
									<dl className={styles.breakdown}>
										<div>
											<dt>Input</dt>
											<dd>{number.format(run.usage.uncachedInput)}</dd>
										</div>
										<div>
											<dt>Cache read</dt>
											<dd>{number.format(run.usage.cacheRead)}</dd>
										</div>
										<div>
											<dt>Cache write</dt>
											<dd>{number.format(run.usage.cacheWrite)}</dd>
										</div>
										<div>
											<dt>Output</dt>
											<dd>{number.format(run.usage.output)}</dd>
										</div>
									</dl>
								) : null}
							</>
						)}
					</div>
				</div>
			</section>
			<section aria-labelledby="handoff-heading" className={chapter.column}>
				<h2 id="handoff-heading" className={styles.sectionHeading}>
					The hand-off
				</h2>
				<ol
					ref={handoff}
					className={styles.handoff}
					aria-label="The hand-off, in order"
				>
					{stories.map((story, at) => (
						<RoleCard
							key={story.role}
							story={story}
							order={at + 1}
							run={run}
							checks={checks}
							reads={reads}
							onToggle={(isOpen) =>
								setOpen((current) => {
									const next = new Set(current)
									if (isOpen) {
										next.add(story.role)
									} else {
										next.delete(story.role)
									}
									return next
								})
							}
						/>
					))}
				</ol>
				{unindexed ? (
					<p className={chapter.note} data-testid="agent-steps-unindexed">
						This run's steps were not indexed, so the step-by-step is not shown.
						What each agent did above is from the run's record, and the wiki
						checks are live.
					</p>
				) : null}
			</section>
			{meetsContradiction ? (
				<aside className={styles.bridge} data-testid="agent-bridge">
					<p>
						The next chapter's recorded contradiction involves a claim on the
						page Support wrote here.
					</p>
					<button
						type="button"
						className={styles.button}
						onClick={() => goTo("contradiction")}
					>
						See the contradiction
					</button>
				</aside>
			) : null}
		</>
	)
}

function AgentRun({ record }: { record: RunRecord }) {
	return (
		<StatePanel state={agentRunState(record)} what="the agent run">
			{(run) => (
				<AgentStory
					run={run}
					unindexed={agentStage(record) === "complete-unindexed"}
				/>
			)}
		</StatePanel>
	)
}

export function AgentsChapter() {
	const { data, reload } = useDemo()
	return (
		<StatePanel state={data.run} what="the run's record" onRetry={reload}>
			{(record) => <AgentRun record={record} />}
		</StatePanel>
	)
}
