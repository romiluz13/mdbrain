"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
	ARRIVALS_PAGE,
	arrivalRows,
	outsideRecordNote,
	summarizeArrivals,
} from "../../../lib/demo-data/arrivals.js"
import {
	subjectKey,
	type EventConfirmation,
} from "../../../lib/demo-data/confirm-event.js"
import { countOf } from "../../../lib/demo-data/plural.js"
import type { RunRecord } from "../../../lib/demo-data/run-record.js"
import {
	sourceLabel,
	splitRoleLabel,
} from "../../../lib/demo-data/source-text.js"
import type { SourceIndexEntry } from "../../../lib/demo-data/views.js"
import chapter from "../chapters.module.css"
import { useDemo } from "../demo-context.js"
import { gsap, useGSAP } from "../motion/gsap-react.js"
import { DURATION, EASE, rowStagger } from "../motion/tokens.js"
import { useReducedMotion } from "../motion/use-reduced-motion.js"
import styles from "../run-chapters.module.css"
import { useEventReads } from "../use-event-reads.js"
import { TimeLine } from "./time-line.js"

type Status = EventConfirmation["status"] | "loading"

/** What a row leads with. A confirmed source leads with a label taken from the
 * stored source itself; the others say plainly why there is none. */
function rowTitle(status: Status, answer: EventConfirmation | undefined) {
	switch (status) {
		case "loading":
			return "Confirming this source…"
		case "confirmed": {
			const text = answer?.status === "confirmed" ? (answer.text ?? "") : ""
			return sourceLabel(splitRoleLabel(text).body) ?? "Stored without text"
		}
		case "unconfirmed":
			return "This source could not be confirmed"
		case "unavailable":
			return "This source could not be read right now"
	}
}

type RowProps = {
	row: ReturnType<typeof arrivalRows>[number]
	status: Status
	answer: EventConfirmation | undefined
	/** Where this row falls among those arriving with it, and how many arrive. */
	arrival: { at: number; of: number }
	onOpen: (opener: HTMLButtonElement) => void
}

/** One source file. It arrives in record order, and the label settles in at the
 * moment its confirmation lands. A row already confirmed when it shows, or any
 * row under reduced motion, is simply there. */
function ArrivalRow({ row, status, answer, arrival, onOpen }: RowProps) {
	const item = useRef<HTMLLIElement>(null)
	const label = useRef<HTMLSpanElement>(null)
	const reduced = useReducedMotion()
	const lastStatus = useRef(status)

	useGSAP(
		() => {
			if (reduced || !item.current) {
				return
			}
			gsap.from(item.current, {
				opacity: 0,
				y: 10,
				duration: DURATION.arrive,
				delay: 0.15 + arrival.at * rowStagger(arrival.of),
				ease: EASE.out,
				clearProps: "opacity,transform",
			})
		},
		{ scope: item, dependencies: [reduced], revertOnUpdate: true },
	)
	useGSAP(
		() => {
			const before = lastStatus.current
			lastStatus.current = status
			if (reduced || before !== "loading" || status !== "confirmed") {
				return
			}
			gsap.from(label.current, {
				opacity: 0.15,
				y: 4,
				duration: DURATION.arrive,
				ease: EASE.out,
				clearProps: "opacity,transform",
			})
		},
		{ scope: item, dependencies: [status, reduced], revertOnUpdate: true },
	)

	return (
		<li
			ref={item}
			tabIndex={-1}
			data-testid="source-row"
			data-status={status}
			data-position={row.position}
		>
			<span className={styles.position}>{row.position}</span>
			<div className={chapter.sourceWhat}>
				<span ref={label} className={styles.label} data-testid="source-label">
					{rowTitle(status, answer)}
				</span>
				<span className={chapter.sourceMeta}>
					<span>
						{row.citedBy
							? `Cited on ${row.citedBy.pageTitle}`
							: "No stored claim cites it"}
					</span>
					{status === "confirmed" && answer?.status === "confirmed" ? (
						<TimeLine kind="business" iso={answer.businessTime} />
					) : null}
				</span>
				<span className={styles.ids}>
					<span data-testid="source-id">{row.sourceId}</span>
					<span data-testid="source-event-id">{row.eventId}</span>
				</span>
			</div>
			{row.citedBy ? (
				<button
					type="button"
					className={styles.linkButton}
					aria-label={`Open source ${row.eventId}`}
					onClick={(event) => onOpen(event.currentTarget)}
				>
					Open source
				</button>
			) : null}
		</li>
	)
}

export function ArrivalList({
	record,
	index,
}: {
	record: RunRecord
	index: readonly SourceIndexEntry[]
}) {
	const { cite } = useDemo()
	const rows = useMemo(() => arrivalRows(record, index), [record, index])
	const summary = useMemo(
		() => summarizeArrivals(record, index),
		[record, index],
	)
	const [shown, setShown] = useState(ARRIVALS_PAGE)
	const visible = useMemo(() => rows.slice(0, shown), [rows, shown])
	const subjects = useMemo(
		() => visible.map(({ eventId }) => ({ eventId })),
		[visible],
	)
	const reads = useEventReads(subjects)
	const listRef = useRef<HTMLOListElement>(null)
	const focusAt = useRef<number | null>(null)
	// How many rows were showing before this render: only the rest arrive.
	const arrived = useRef(0)

	// After "Show ten more", focus moves to the first row that arrived.
	useEffect(() => {
		if (focusAt.current !== null) {
			listRef.current
				?.querySelector<HTMLElement>(`[data-position="${focusAt.current}"]`)
				?.focus()
			focusAt.current = null
		}
	})

	useEffect(() => {
		arrived.current = visible.length
	}, [visible.length])

	const answers = subjects.map((subject) => reads[subjectKey(subject)])
	const statuses = answers.map((answer): Status => answer?.status ?? "loading")
	const tally: Partial<Record<Status, number>> = {}
	for (const status of statuses) {
		tally[status] = (tally[status] ?? 0) + 1
	}

	if (rows.length === 0) {
		return (
			<p className={chapter.note}>
				The run's record lists no source files yet.
			</p>
		)
	}

	return (
		<>
			<div className={styles.arrivalSummary} data-testid="arrivals-summary">
				<p className={chapter.note}>
					The run's record lists {summary.arrived} of {summary.planned} planned
					source files, in the order they arrived. Each one shown is checked by
					its id through the API; stored claims cite {summary.cited} of them.
					{summary.citedOutsideRecord > 0
						? ` ${outsideRecordNote(summary)}`
						: ""}
				</p>
				<p className={chapter.note} data-testid="arrivals-tally">
					Showing {visible.length} of {summary.arrived}. {tally.confirmed ?? 0}{" "}
					confirmed
					{(tally.unconfirmed ?? 0) > 0
						? `, ${tally.unconfirmed} not confirmed`
						: ""}
					{(tally.unavailable ?? 0) > 0
						? `, ${tally.unavailable} could not be read`
						: ""}
					{(tally.loading ?? 0) > 0
						? `, ${tally.loading} still being checked`
						: ""}
					.
				</p>
			</div>
			<ol
				ref={listRef}
				className={styles.arrivalList}
				aria-label="Source files in arrival order"
			>
				{visible.map((row, at) => (
					<ArrivalRow
						key={row.eventId}
						row={row}
						status={statuses[at] ?? "loading"}
						answer={answers[at]}
						arrival={{
							at: Math.max(0, at - arrived.current),
							of: visible.length - arrived.current,
						}}
						onOpen={(opener) => {
							const entry = row.citedBy
							if (entry) {
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
						}}
					/>
				))}
			</ol>
			{shown < rows.length ? (
				<div className={styles.more}>
					<button
						type="button"
						className={styles.button}
						data-variant="quiet"
						onClick={() => {
							focusAt.current = shown + 1
							setShown(Math.min(shown + ARRIVALS_PAGE, rows.length))
						}}
					>
						Show ten more
					</button>
					<span className={chapter.note}>
						{countOf(rows.length - shown, "more source file")} in the record.
					</span>
				</div>
			) : null}
		</>
	)
}
