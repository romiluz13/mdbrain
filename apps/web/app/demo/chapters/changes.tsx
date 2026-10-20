"use client"

import { useMemo } from "react"
import { formatUtc, summarizeChanges } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { GraphStage } from "../parts/graph-stage.js"
import { StatePanel } from "../parts/state-panel.js"
import { StatTile } from "../parts/stat-tile.js"
import { TimeLine } from "../parts/time-line.js"

const SHOWN = 12

export function ChangesChapter() {
	const { data, cite, reload } = useDemo()
	const map = data.map.kind === "ready" ? data.map.data : null
	const shown = useMemo(
		() =>
			data.changes.kind === "ready"
				? [...data.changes.data.changes]
						.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
						.slice(0, SHOWN)
				: [],
		[data.changes],
	)
	const highlight = useMemo(
		() => new Set(shown.map((change) => change.pageSlug)),
		[shown],
	)
	return (
		<StatePanel
			state={data.changes}
			what="the stored revisions"
			onRetry={reload}
		>
			{(view) => {
				const totals = summarizeChanges(view)
				return (
					<>
						<div className={styles.tiles}>
							<StatTile
								label="Revisions"
								stat="revisions"
								value={totals.revisions}
							/>
							<StatTile
								label="Pages touched"
								stat="pages-touched"
								value={totals.pages}
							/>
							<StatTile
								label="Claims added"
								stat="claims-added"
								value={totals.added}
								tone="ok"
							/>
							<StatTile
								label="Claims changed or removed"
								stat="claims-moved"
								value={totals.changed + totals.removed}
							/>
						</div>
						<p className={styles.note}>
							Window: since {formatUtc(view.window.since)} (the first stored
							page) until {formatUtc(view.window.until)}. These are ingestion
							times: when mdbrain stored each revision, not when the sources say
							things happened.
							{view.complete ? "" : " More revisions exist than were read."}
						</p>
						<div className={styles.split}>
							<ol className={styles.changeList} aria-label="Recent revisions">
								{shown.map((change) => {
									const title =
										change.title ??
										map?.pages.find((p) => p.slug === change.pageSlug)?.title ??
										change.pageSlug
									const added = change.claims?.added[0]
									const counts = change.claims?.counts
									return (
										<li
											key={`${change.pageSlug}:${change.revision}`}
											data-testid="change-row"
										>
											<p className={styles.changeTitle}>
												{title}{" "}
												<span className={styles.mono}>
													revision {change.revision}
												</span>
											</p>
											<p className={styles.claimMeta}>
												{change.editKind} ·{" "}
												{counts
													? `${counts.added} added, ${counts.changed} changed, ${counts.removed} removed`
													: "baseline unavailable"}
											</p>
											<TimeLine
												kind="ingestion"
												iso={change.createdAt}
												note="stored"
											/>
											<TimeLine
												kind="business"
												iso={undefined}
												missingNote="missing on a revision; its sources carry their own"
											/>
											{added ? (
												<>
													<p className={styles.record}>{added.text}</p>
													<button
														type="button"
														className={styles.linkButton}
														aria-label={`Open citation for: ${added.text.slice(0, 48)}`}
														onClick={(event) =>
															cite(
																{
																	claim: added,
																	pageSlug: change.pageSlug,
																	pageTitle: title,
																	revision: change.revision,
																},
																event.currentTarget,
															)
														}
													>
														Open citation
													</button>
												</>
											) : null}
										</li>
									)
								})}
							</ol>
							<GraphStage
								title="Where it changed"
								highlight={highlight}
								compact
							/>
						</div>
					</>
				)
			}}
		</StatePanel>
	)
}
