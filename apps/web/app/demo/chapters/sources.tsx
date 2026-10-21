"use client"

import { useMemo } from "react"
import { eventRef } from "../../../lib/demo-data/loaders-chapters.js"
import type { SourceView } from "../../../lib/demo-data/loaders-chapters.js"
import type { RunRecord } from "../../../lib/demo-data/run-record.js"
import {
	sourceLabel,
	splitRoleLabel,
} from "../../../lib/demo-data/source-text.js"
import { countOf } from "../../../lib/demo-data/plural.js"
import { buildSourceIndex } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { ArrivalList } from "../parts/arrival-list.js"
import { StatePanel } from "../parts/state-panel.js"
import { StatTile } from "../parts/stat-tile.js"
import { TimeLine } from "../parts/time-line.js"
import { useSourceReads } from "../use-source-reads.js"

// Without the run's record the list is the sources stored claims cite. Each row
// is a read through governed recall, so that list stays short.
const SHOWN = 8

/** What a row leads with: a label taken from the stored source itself. */
function sourceTitle(read: SourceView | undefined): string {
	if (read === undefined) {
		return "Reading this source…"
	}
	if (read.status === "unavailable") {
		return read.reason === "unconfirmed"
			? "Recall could not confirm this source"
			: "This source could not be read right now"
	}
	return (
		sourceLabel(splitRoleLabel(read.text ?? "").body) ?? "Stored without text"
	)
}

export function SourcesChapter() {
	const { data, cite, reload } = useDemo()
	const map = data.map.kind === "ready" ? data.map.data : null
	const record: RunRecord | null =
		data.run.kind === "ready"
			? data.run.data
			: data.run.kind === "incomplete"
				? (data.run.data ?? null)
				: null
	// The stored-claims list stands in only once the run's record has settled
	// without one, so a loading record does not start reads it will not show.
	const withoutRecord = record === null && data.run.kind !== "loading"
	const everyCitedSource = useMemo(
		() => (map ? buildSourceIndex(map, Number.POSITIVE_INFINITY) : []),
		[map],
	)
	const index = useMemo(
		() => (withoutRecord ? everyCitedSource.slice(0, SHOWN) : []),
		[withoutRecord, everyCitedSource],
	)
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
					label="Source files arrived (the run's record)"
					singular="Source file arrived (the run's record)"
					stat="arrived"
					value={record?.arrivals.length ?? null}
				/>
				<StatTile
					label="Planned (the run's record)"
					stat="planned"
					value={record?.eventsPlanned ?? null}
				/>
				<StatTile
					label="Source events cited by stored claims"
					singular="Source event cited by stored claims"
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
				<h2 id="run-sources">Source files in arrival order</h2>
				<StatePanel
					state={data.run}
					what="the run's record"
					onRetry={reload}
					emptyNote="The run's record lists no source files yet."
				>
					{(run) =>
						data.map.kind === "ready" || data.map.kind === "empty" ? (
							<ArrivalList record={run} index={everyCitedSource} />
						) : (
							<StatePanel
								state={data.map}
								what="the cited sources"
								onRetry={reload}
							/>
						)
					}
				</StatePanel>
			</section>
			{withoutRecord ? (
				<section className={styles.panel} aria-labelledby="stored-sources">
					<h2 id="stored-sources">Source events the stored claims cite</h2>
					<StatePanel
						state={data.map}
						what="the cited sources"
						onRetry={reload}
					>
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
														<span
															className={styles.mono}
															data-testid="source-id"
														>
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
			) : null}
		</>
	)
}
