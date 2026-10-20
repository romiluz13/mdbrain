"use client"

import { highlightPhrase } from "../../../lib/demo-data/highlight.js"
import type { SourceView } from "../../../lib/demo-data/loaders-chapters.js"
import styles from "../citation.module.css"
import { TimeLine } from "./time-line.js"

/** One stored source: its id, its business time (or the statement that the
 * source has none), and its full stored text with the part the claim rests on
 * marked. */
export function SourceSlip({
	source,
	claimText,
}: {
	source: SourceView
	claimText: string
}) {
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
				<p className={styles.slipText} data-testid="source-text">
					{highlightPhrase(source.text, claimText).map((segment) =>
						segment.mark ? (
							<mark key={segment.start}>{segment.text}</mark>
						) : (
							<span key={segment.start}>{segment.text}</span>
						),
					)}
				</p>
			)}
		</article>
	)
}
