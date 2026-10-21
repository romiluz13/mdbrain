"use client"

import { useMemo, useState } from "react"
import { viewSource } from "../../../lib/demo-data/source-text.js"
import styles from "../citation.module.css"
import type { SourceSlot } from "../use-claim-sources.js"
import { MarkdownView } from "./markdown-view.js"
import { TimeLine } from "./time-line.js"

/** One stored source: its id and the role it was stored under, its business time
 * (or the statement that the source has none), the part the claim rests on, and
 * the full text behind a disclosure. The text is read as markdown, drawn as the
 * page's own elements; a short source is shown whole. */
export function SourceSlip({
	source,
	claimText,
}: {
	source: SourceSlot
	claimText: string
}) {
	if (source.status === "loading") {
		return (
			<article className={styles.slip} data-status="loading" aria-busy="true">
				<header>
					<span className={styles.eventId}>{source.eventId}</span>
				</header>
				<p className={styles.slipMarker}>{source.marker}</p>
				<p className={styles.reading} role="status">
					<span className={styles.readingBar} aria-hidden="true" />
					Reading this source through governed recall…
				</p>
			</article>
		)
	}
	return (
		<article className={styles.slip} data-status={source.status}>
			<header>
				<span className={styles.eventId}>{source.eventId}</span>
				<TimeLine kind="business" iso={source.businessTime} />
			</header>
			<p className={styles.slipMarker}>{source.marker}</p>
			{source.status === "unavailable" ? (
				<p className={styles.note}>This source could not be read right now.</p>
			) : source.text === undefined || source.text === "" ? (
				<p className={styles.note}>The source is stored without text.</p>
			) : (
				<SourceText stored={source.text} claimText={claimText} />
			)}
		</article>
	)
}

function SourceText({
	stored,
	claimText,
}: {
	stored: string
	claimText: string
}) {
	const view = useMemo(() => viewSource(stored, claimText), [stored, claimText])
	const [open, setOpen] = useState(false)
	const full = (
		<div data-testid="source-text">
			<MarkdownView blocks={view.blocks} mark={view.mark} />
		</div>
	)
	return (
		<>
			{view.role !== undefined ? (
				<p className={styles.role} data-testid="source-role">
					<span className={styles.roleLabel}>Stored as a message from</span>{" "}
					{view.role}
				</p>
			) : null}
			{view.excerpt === null ? (
				full
			) : (
				<>
					<div data-testid="source-excerpt">
						<MarkdownView blocks={view.excerpt} mark={view.mark} />
					</div>
					<details
						className={styles.full}
						onToggle={(event) => setOpen(event.currentTarget.open)}
					>
						<summary>{open ? "Hide full source" : "Show full source"}</summary>
						{full}
					</details>
				</>
			)}
		</>
	)
}
