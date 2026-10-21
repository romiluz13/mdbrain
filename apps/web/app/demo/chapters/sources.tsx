"use client"

import { useMemo } from "react"
import { eventRef } from "../../../lib/demo-data/loaders-chapters.js"
import type { SourceView } from "../../../lib/demo-data/loaders-chapters.js"
import {
	sourceLabel,
	splitRoleLabel,
} from "../../../lib/demo-data/source-text.js"
import { countOf } from "../../../lib/demo-data/plural.js"
import { buildSourceIndex } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { StatePanel } from "../parts/state-panel.js"
import { StatTile } from "../parts/stat-tile.js"
import { TimeLine } from "../parts/time-line.js"
import { useSourceReads } from "../use-source-reads.js"

// Each row is a read through governed recall, so the list stays short.
const SHOWN = 8

/** What a row leads with: a label taken from the stored source itself. */
function sourceTitle(read: SourceView | undefined): string {
	if (read === undefined) {
		return "Reading this source…"
	}
	if (read.status === "unavailable") {
		return "This source could not be read right now"
	}
	return (
		sourceLabel(splitRoleLabel(read.text ?? "").body) ?? "Stored without text"
	)
}

export function SourcesChapter() {
	const { data, cite, reload } = useDemo()
	const map = data.map.kind === "ready" ? data.map.data : null
	const index = useMemo(() => (map ? buildSourceIndex(map, SHOWN) : []), [map])
	const reads = useSourceReads(
		useMemo(
			() =>
				index.flatMap((entry) => {
					const ref = eventRef(entry.claim, entry.eventId)
					return ref ? [{ claim: entry.claim, ref }] : []
				}),
			[index],
		),
	)
	return (
		<>
			<div className={styles.tiles}>
				<StatTile
					label="Source events cited"
					singular="Source event cited"
					stat="sources"
					value={map?.sourceTotal ?? null}
				/>
				<StatTile
					label="Pages"
					singular="Page"
					stat="pages"
					value={map?.pageTotal ?? null}
				/>
			</div>
			<section className={styles.panel} aria-labelledby="run-sources">
				<h2 id="run-sources">Source files in this run</h2>
				<StatePanel
					state={data.sources}
					what="the run's source list"
					onRetry={reload}
				>
					{(view) => (
						<ol className={styles.eventList}>
							{view.events.map((event) => (
								<li key={event.id}>
									<span className={styles.mono}>{event.id}</span>
									<TimeLine kind="business" iso={event.timestamp} />
									{event.text ? (
										<p className={styles.record}>{event.text}</p>
									) : null}
								</li>
							))}
						</ol>
					)}
				</StatePanel>
			</section>
			<section className={styles.panel} aria-labelledby="stored-sources">
				<h2 id="stored-sources">Source events the stored claims cite</h2>
				<StatePanel state={data.map} what="the cited sources" onRetry={reload}>
					{() =>
						index.length === 0 ? (
							<p className={styles.note}>
								No stored claim cites a source event.
							</p>
						) : (
							<>
								<p className={styles.note}>
									Showing {index.length} of{" "}
									{countOf(map?.sourceTotal ?? index.length, "source event")}.
									Open one to read the claim that cites it and the full stored
									source.
								</p>
								<ul className={styles.sourceList}>
									{index.map((entry) => {
										const read = reads[entry.eventId]
										return (
											<li
												key={entry.eventId}
												data-testid="source-row"
												data-status={read?.status ?? "loading"}
											>
												<div className={styles.sourceWhat}>
													<span
														className={styles.sourceLabel}
														data-testid="source-label"
													>
														{sourceTitle(read)}
													</span>
													<span className={styles.sourceMeta}>
														<span>cited on {entry.pageTitle}</span>
														{read?.status === "resolved" ? (
															<TimeLine
																kind="business"
																iso={read.businessTime}
															/>
														) : null}
													</span>
													<span className={styles.mono} data-testid="source-id">
														{entry.eventId}
													</span>
												</div>
												<button
													type="button"
													className={styles.linkButton}
													aria-label={`Open source ${entry.eventId}`}
													onClick={(event) =>
														cite(
															{
																claim: entry.claim,
																pageSlug: entry.pageSlug,
																pageTitle: entry.pageTitle,
																revision: entry.revision,
															},
															event.currentTarget,
														)
													}
												>
													Open source
												</button>
											</li>
										)
									})}
								</ul>
							</>
						)
					}
				</StatePanel>
			</section>
		</>
	)
}
