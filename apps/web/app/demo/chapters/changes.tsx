"use client"

import type { MdbrainWikiChange, MdbrainWikiClaim } from "@mdbrain/client"
import { useMemo } from "react"
import { formatUtc, summarizeChanges } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { GraphStage } from "../parts/graph-stage.js"
import { StatePanel } from "../parts/state-panel.js"
import { StatTile } from "../parts/stat-tile.js"
import { CitationTrigger } from "../parts/citation-trigger.js"
import { BusinessTimeNote } from "../parts/business-time-note.js"
import { TimeLine } from "../parts/time-line.js"

const SHOWN = 12

/** The first claim a revision moved, with how it moved: an added claim, the
 * new side of a changed one, or a removed one. */
function firstMovement(
	change: MdbrainWikiChange,
): { verb: string; claim: MdbrainWikiClaim } | undefined {
	const claims = change.claims
	if (claims?.added[0]) {
		return { verb: "Added", claim: claims.added[0] }
	}
	if (claims?.changed[0]) {
		return { verb: "Changed", claim: claims.changed[0].after }
	}
	if (claims?.removed[0]) {
		return { verb: "Removed", claim: claims.removed[0] }
	}
	return undefined
}

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
								singular="Revision"
								stat="revisions"
								value={totals.revisions}
							/>
							<StatTile
								label="Pages touched"
								singular="Page touched"
								stat="pages-touched"
								value={totals.pages}
							/>
							<StatTile
								label="Claims added"
								singular="Claim added"
								stat="claims-added"
								value={totals.added}
								tone="ok"
							/>
							<StatTile
								label="Claims changed or removed"
								singular="Claim changed or removed"
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
						<BusinessTimeNote>
							Business time is when a source says something happened. A revision
							carries none of its own, so each row says so briefly; the sources
							behind a revision's claims carry theirs.
						</BusinessTimeNote>
						<div className={styles.split}>
							<ol className={styles.changeList} aria-label="Recent revisions">
								{shown.map((change) => {
									const title =
										change.title ??
										map?.pages.find((p) => p.slug === change.pageSlug)?.title ??
										change.pageSlug
									const moved = firstMovement(change)
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
												missingNote="none on a revision"
											/>
											{moved ? (
												<>
													<p className={styles.claimMeta}>{moved.verb}</p>
													<p className={styles.record}>{moved.claim.text}</p>
													<CitationTrigger
														claim={moved.claim}
														label={`Open citation for: ${moved.claim.text.slice(0, 48)}`}
														onOpen={(opener) =>
															cite(
																{
																	claim: moved.claim,
																	pageSlug: change.pageSlug,
																	pageTitle: title,
																	revision: change.revision,
																},
																opener,
															)
														}
													/>
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
								sticky
							/>
						</div>
					</>
				)
			}}
		</StatePanel>
	)
}
