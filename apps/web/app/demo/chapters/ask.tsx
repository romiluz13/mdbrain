"use client"

import { useId, useMemo, useRef, type FormEvent } from "react"
import { loadWikiSearch } from "../../../lib/demo-data/loaders-chapters.js"
import { suggestQuestions } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { CitationTrigger } from "../parts/citation-trigger.js"
import { GraphStage } from "../parts/graph-stage.js"
import { StatePanel } from "../parts/state-panel.js"

const EXAMPLES_SHOWN = 3

export function AskChapter() {
	const { upstream, ask, setAsk, cite, pin, data, graph } = useDemo()
	const inputId = useId()
	const latest = useRef(0)

	const run = async (question: string) => {
		const trimmed = question.trim()
		const ticket = ++latest.current
		if (trimmed === "") {
			setAsk({ query: question, result: { kind: "empty" } })
			return
		}
		setAsk({ query: question, result: { kind: "loading" } })
		const result = await loadWikiSearch(upstream, trimmed)
		if (ticket === latest.current) {
			setAsk({ query: question, result })
		}
	}

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		void run(ask.query)
	}

	const highlight = useMemo(
		() =>
			new Set(
				ask.result?.kind === "ready"
					? ask.result.data.hits.map((hit) => hit.slug)
					: [],
			),
		[ask.result],
	)
	const map = data.map.kind === "ready" ? data.map.data : null
	const examples = graph ? suggestQuestions(graph, EXAMPLES_SHOWN) : []

	return (
		<div className={styles.split}>
			<div className={styles.column}>
				<form className={styles.askForm} onSubmit={onSubmit}>
					<label htmlFor={inputId}>Your question</label>
					<div className={styles.askRow}>
						<input
							id={inputId}
							type="search"
							maxLength={200}
							value={ask.query}
							placeholder="Ask about an account, a policy, an incident…"
							onChange={(event) =>
								setAsk({ query: event.target.value, result: ask.result })
							}
						/>
						<button type="submit" className={styles.button}>
							Ask
						</button>
					</div>
				</form>
				{examples.length > 0 ? (
					<ul className={styles.chips} aria-label="Example questions">
						{examples.map((example) => (
							<li key={example.slug}>
								<button
									type="button"
									onClick={() => void run(example.question)}
								>
									{example.question}
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className={styles.note}>
						Example questions appear once the pages are read.
					</p>
				)}
				<p className={styles.note} data-testid="ask-note">
					Read-only: this is the stored text search lane. It returns stored
					claims, not a written answer. Written answers from a model arrive in a
					later release.
				</p>
				{ask.result === null ? (
					<p className={styles.idle}>
						Pick an example or type a question to read the brain.
					</p>
				) : (
					<StatePanel
						state={ask.result}
						what="the search results"
						emptyNote="Nothing stored matches that question. Try fewer or different words."
						onRetry={() => void run(ask.query)}
					>
						{(view) => (
							<ol className={styles.hits} aria-label="Search results">
								{view.hits.map((hit) => (
									<li key={hit.slug} data-testid="ask-hit">
										<div className={styles.hitHead}>
											<h3>{hit.title}</h3>
											<button
												type="button"
												className={styles.linkButton}
												onClick={() => pin(hit.slug)}
											>
												Show on the map
											</button>
										</div>
										<p className={styles.hitMeta}>
											score {hit.score.toFixed(2)} · {hit.lane} lane
										</p>
										{hit.summary ? <p>{hit.summary}</p> : null}
										<ul className={styles.claimList}>
											{hit.claims.map((claim) => (
												<li key={claim.id}>
													<p className={styles.record}>{claim.text}</p>
													<CitationTrigger
														claim={claim}
														label={`Open citation for: ${claim.text.slice(0, 48)}`}
														onOpen={(opener) =>
															cite(
																{
																	claim,
																	pageSlug: hit.slug,
																	pageTitle: hit.title,
																	...(map
																		? {
																				revision: map.pages.find(
																					(p) => p.slug === hit.slug,
																				)?.revision,
																			}
																		: {}),
																},
																opener,
															)
														}
													/>
												</li>
											))}
										</ul>
									</li>
								))}
							</ol>
						)}
					</StatePanel>
				)}
			</div>
			<GraphStage
				title="Where the answers live"
				highlight={highlight}
				compact
				sticky
			/>
		</div>
	)
}
