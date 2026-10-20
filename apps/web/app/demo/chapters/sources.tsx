"use client"

import { buildSourceIndex } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { StatePanel } from "../parts/state-panel.js"
import { StatTile } from "../parts/stat-tile.js"
import { TimeLine } from "../parts/time-line.js"

const SHOWN = 12

export function SourcesChapter() {
	const { data, cite, reload } = useDemo()
	const map = data.map.kind === "ready" ? data.map.data : null
	const index = map ? buildSourceIndex(map, SHOWN) : []
	return (
		<>
			<div className={styles.tiles}>
				<StatTile
					label="Source events cited"
					stat="sources"
					value={map?.sourceTotal ?? null}
				/>
				<StatTile label="Pages" stat="pages" value={map?.pageTotal ?? null} />
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
									Showing {index.length} of {map?.sourceTotal} source events.
									Open one to read the claim that cites it and the full stored
									source.
								</p>
								<ul className={styles.sourceList}>
									{index.map((entry) => (
										<li key={entry.eventId}>
											<span className={styles.mono}>{entry.eventId}</span>
											<span>cited on {entry.pageTitle}</span>
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
									))}
								</ul>
							</>
						)
					}
				</StatePanel>
			</section>
		</>
	)
}
