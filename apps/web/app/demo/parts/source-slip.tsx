"use client"

import { highlightPhrase } from "../../../lib/demo-data/highlight.js"
import type { SourceSlot } from "../use-claim-sources.js"
import styles from "../citation.module.css"
import { TimeLine } from "./time-line.js"

/** One stored source: its id, its business time (or the statement that the
 * source has none), and its full stored text with the part the claim rests on
 * marked. A source still being read shows its id and marker and says so. */
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
