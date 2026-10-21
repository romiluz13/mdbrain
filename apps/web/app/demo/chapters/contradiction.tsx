"use client"

import { useMemo } from "react"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { GraphStage } from "../parts/graph-stage.js"
import { CitationTrigger } from "../parts/citation-trigger.js"
import { ClaimSources } from "../parts/claim-sources.js"
import { StatePanel } from "../parts/state-panel.js"
import { BusinessTimeNote } from "../parts/business-time-note.js"
import { TimeLine } from "../parts/time-line.js"

const ORDINAL = ["one", "two", "three", "four"]

export function ContradictionChapter() {
	const { data, cite, pin, goTo, reload } = useDemo()
	const found =
		data.contradiction.kind === "ready" ? data.contradiction.data : null
	const highlight = useMemo(
		() => new Set(found?.claims.map((claim) => claim.pageSlug) ?? []),
		[found],
	)
	return (
		<>
			<StatePanel
				state={data.contradiction}
				what="the recorded contradiction"
				emptyTitle="Not recorded in this run yet"
				emptyNote="None is recorded in this run yet. Agents write the contradiction live, as they read the sources, so this chapter fills in during an agent run. Nothing is shown here in its place."
				onRetry={reload}
			>
				{(record) => (
					<>
						<BusinessTimeNote>
							Business time is when a source says something happened. A claim
							carries none of its own; each source below shows its own, or says
							it has none.
						</BusinessTimeNote>
						<ol className={styles.caseSteps}>
							{record.claims.map((entry, position) => (
								<li
									key={`${entry.pageSlug}:${entry.claim.id}`}
									className={styles.caseStep}
								>
									<h2 className={styles.stepLabel}>
										Claim {ORDINAL[position] ?? position + 1}
									</h2>
									<p className={styles.where}>
										On the page{" "}
										<button
											type="button"
											className={styles.linkButton}
											onClick={() => {
												pin(entry.pageSlug)
												goTo("brain")
											}}
										>
											{entry.pageTitle}
										</button>
										, revision {entry.revision}
									</p>
									<blockquote
										className={styles.quote}
										data-testid="contradiction-claim"
									>
										{entry.claim.text}
									</blockquote>
									<p className={styles.claimMeta}>
										{entry.claim.status} · confidence{" "}
										{Math.round(entry.claim.confidence * 100)}%
									</p>
									<ClaimSources
										claim={entry.claim}
										listClassName={styles.slipList}
									/>
									<CitationTrigger
										claim={entry.claim}
										label={`Open citation for claim ${ORDINAL[position] ?? position + 1}`}
										onOpen={(opener) =>
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
									/>
								</li>
							))}
							<li className={styles.stamp} data-testid="contradiction-stamp">
								<h2>Contradiction recorded</h2>
								<p className={styles.mono}>{record.id}</p>
								<TimeLine
									kind="ingestion"
									iso={record.detectedAt}
									note="detected"
								/>
								<p>Resolution: {record.resolution}</p>
								{record.note ? <p>{record.note}</p> : null}
								<p>Both claims were kept. Nothing was overwritten.</p>
								<p className={styles.claimMeta}>
									{record.unresolvedCount} unresolved contradiction
									{record.unresolvedCount === 1 ? "" : "s"} in this brain.
								</p>
							</li>
						</ol>
					</>
				)}
			</StatePanel>
			<GraphStage
				title="Where the two pages sit"
				highlight={highlight}
				compact
			/>
		</>
	)
}
