"use client"

import {
	useEffect,
	useId,
	useMemo,
	useRef,
	type FormEvent,
	type ReactNode,
} from "react"
import {
	ANSWER_MAX_INPUT_CHARS,
	VISITOR_QUESTIONS_PER_HOUR,
	type AnswerCitation,
	type AnswerOutcome,
	type AnswerRefusalReason,
} from "../../../lib/demo-data/answer-types.js"
import { loadWikiSearch } from "../../../lib/demo-data/loaders-chapters.js"
import { suggestQuestions } from "../../../lib/demo-data/views.js"
import { useDemo, type DemoContextValue } from "../demo-context.js"
import styles from "../chapters.module.css"
import { CitationTrigger } from "../parts/citation-trigger.js"
import { GraphStage } from "../parts/graph-stage.js"
import { StatePanel } from "../parts/state-panel.js"

const EXAMPLES_SHOWN = 3

/** What each refusal means to the person asking. */
const REFUSAL_NOTES: Record<AnswerRefusalReason, string> = {
	busy: "Someone else is getting an answer right now. Try again in a moment.",
	rate: "That is all the questions for this hour. Come back later.",
	input: "The question is empty or too long for the answer service.",
	limits:
		"The question cannot fit the answer service's limits. Try fewer words.",
	deadline: "The answer took too long. Try a simpler question.",
}

export function AskChapter() {
	const { upstream, ask, setAsk, cite, pin, data, graph } = useDemo()
	const inputId = useId()
	const latest = useRef(0)
	const latestAnswer = useRef(0)
	const abortAnswer = useRef<AbortController | null>(null)

	// Leaving the chapter is a disconnect: the request aborts, the server
	// cancels the answer and releases its lease, and the lane keeps the
	// outcome for when the visitor comes back.
	useEffect(() => () => abortAnswer.current?.abort(), [])

	const run = async (question: string) => {
		const trimmed = question.trim()
		const ticket = ++latest.current
		if (trimmed === "") {
			setAsk((current) => ({ ...current, result: { kind: "empty" } }))
			return
		}
		setAsk((current) => ({
			...current,
			query: question,
			result: { kind: "loading" },
		}))
		const result = await loadWikiSearch(upstream, trimmed)
		if (ticket === latest.current) {
			setAsk((current) => ({ ...current, result }))
		}
	}

	const askTheModel = async (question: string) => {
		const trimmed = question.trim()
		if (trimmed === "") {
			return
		}
		abortAnswer.current?.abort()
		const controller = new AbortController()
		abortAnswer.current = controller
		const ticket = ++latestAnswer.current
		setAsk((current) => ({
			...current,
			answer: { status: "answering", question: trimmed },
		}))
		try {
			const response = await fetch("/api/demo/answers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ question: trimmed }),
				signal: controller.signal,
			})
			if (!response.ok) {
				throw new Error(`answers route responded ${response.status}`)
			}
			const outcome = (await response.json()) as AnswerOutcome
			if (ticket === latestAnswer.current) {
				setAsk((current) => ({
					...current,
					answer: { status: "done", question: trimmed, outcome },
				}))
			}
		} catch {
			if (ticket !== latestAnswer.current) {
				return
			}
			const outcome: AnswerOutcome = controller.signal.aborted
				? { state: "canceled" }
				: { state: "unavailable" }
			setAsk((current) => ({
				...current,
				answer: { status: "done", question: trimmed, outcome },
			}))
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
	const answer = ask.answer

	return (
		<div className={styles.split}>
			<div className={styles.column}>
				<form className={styles.askForm} onSubmit={onSubmit}>
					<label htmlFor={inputId}>Your question</label>
					<div className={styles.askRow}>
						<input
							id={inputId}
							type="search"
							maxLength={ANSWER_MAX_INPUT_CHARS}
							value={ask.query}
							placeholder="Ask about an account, a policy, an incident…"
							onChange={(event) =>
								setAsk((current) => ({
									...current,
									query: event.target.value,
								}))
							}
						/>
						<button type="submit" className={styles.button}>
							Ask
						</button>
					</div>
				</form>
				<button
					type="button"
					className={styles.linkButton}
					data-testid="answer-submit"
					onClick={() => void askTheModel(ask.query)}
				>
					Answer with a model
				</button>
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
					Two lanes: the stored text search returns stored claims, not a written
					answer. The answer service has a small model read this brain's own
					pages and write a cited answer, from the run's sources only.
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
				<section
					className={styles.answerLane}
					data-testid="answer-lane"
					aria-label="Model answer"
					aria-live="polite"
				>
					{answer.status === "idle" ? (
						<p className={styles.answerMeta} data-testid="answer-idle">
							Answer with a model and it reads the brain's own pages and writes
							a cited answer. One visitor at a time,{" "}
							{VISITOR_QUESTIONS_PER_HOUR} questions an hour.
						</p>
					) : answer.status === "answering" ? (
						<p className={styles.answerMeta} data-testid="answer-answering">
							Writing an answer from the brain's own pages…
						</p>
					) : (
						<AnswerOutcomeView
							outcome={answer.outcome}
							cite={cite}
							pin={pin}
							onRetry={() => void askTheModel(answer.question)}
							onSearch={() => void run(answer.question)}
						/>
					)}
				</section>
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

/** One finished answer, by how it ended. */
function AnswerOutcomeView({
	outcome,
	cite,
	pin,
	onRetry,
	onSearch,
}: {
	outcome: AnswerOutcome
	cite: DemoContextValue["cite"]
	pin: DemoContextValue["pin"]
	onRetry: () => void
	onSearch: () => void
}) {
	if (outcome.state === "answered") {
		return (
			<>
				<p className={styles.answerText} data-testid="answer-text">
					{renderCited(outcome.text, outcome.citations, cite)}
				</p>
				<EventCitations citations={outcome.citations} />
			</>
		)
	}
	if (outcome.state === "refused") {
		return (
			<div className={styles.answerStatus} data-testid="answer-refused">
				<p>{REFUSAL_NOTES[outcome.reason]}</p>
				{outcome.reason === "busy" || outcome.reason === "deadline" ? (
					<button type="button" className={styles.linkButton} onClick={onRetry}>
						Try again
					</button>
				) : null}
			</div>
		)
	}
	if (outcome.state === "spent") {
		return (
			<div className={styles.answerStatus} data-testid="answer-spent">
				<p>{outcome.message}</p>
				<p className={styles.answerMeta}>
					These are the pages it found; the stored search can still read them.
				</p>
				<ol className={styles.hits} aria-label="Pages the spent answer found">
					{outcome.hits.map((hit) => (
						<li key={hit.slug} data-testid="answer-hit">
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
							<ul className={styles.claimList}>
								{hit.claims.map((claim) => (
									<li key={claim.id}>
										<p className={styles.record}>{claim.text}</p>
									</li>
								))}
							</ul>
						</li>
					))}
				</ol>
				<button type="button" className={styles.linkButton} onClick={onSearch}>
					Search the stored pages
				</button>
			</div>
		)
	}
	if (outcome.state === "canceled") {
		return (
			<div className={styles.answerStatus} data-testid="answer-canceled">
				<p>The answer was canceled.</p>
				<button type="button" className={styles.linkButton} onClick={onRetry}>
					Try again
				</button>
			</div>
		)
	}
	if (outcome.state === "off") {
		return (
			<p className={styles.answerStatus} data-testid="answer-off">
				The answer service is switched off today. The stored search still works.
			</p>
		)
	}
	return (
		<div className={styles.answerStatus} data-testid="answer-unavailable">
			<p>The answer service cannot be reached right now.</p>
			<button type="button" className={styles.linkButton} onClick={onRetry}>
				Try again
			</button>
		</div>
	)
}

/** The answer text with its citation markers turned into the same citation
 * controls the stored claims use; an event citation stays as its marker. */
function renderCited(
	text: string,
	citations: AnswerCitation[],
	cite: DemoContextValue["cite"],
): ReactNode[] {
	const parts: ReactNode[] = []
	let cursor = 0
	for (const citation of citations) {
		const at = text.indexOf(citation.marker, cursor)
		if (at === -1) {
			continue
		}
		parts.push(text.slice(cursor, at))
		const response = citation.response
		if (response.status === "resolved" && response.kind === "claim") {
			parts.push(
				<CitationTrigger
					key={`${citation.marker}-at-${at}`}
					claim={response.claim}
					label={`Open citation for: ${response.claim.text.slice(0, 48)}`}
					onOpen={(opener) =>
						cite(
							{
								claim: response.claim,
								pageSlug: response.page.slug,
								pageTitle: response.page.title ?? response.page.slug,
								revision: response.page.revision,
							},
							opener,
						)
					}
				/>,
			)
		} else {
			parts.push(
				<span key={`event-at-${at}`} className={styles.answerEvent}>
					{citation.marker}
				</span>,
			)
		}
		cursor = at + citation.marker.length
	}
	parts.push(text.slice(cursor))
	return parts
}

/** Event citations have no claim to open, so their text is listed instead. */
function EventCitations({ citations }: { citations: AnswerCitation[] }) {
	const events = citations.flatMap((citation) => {
		const response = citation.response
		if (response.status === "resolved" && response.kind === "event") {
			return [
				{
					marker: citation.marker,
					text: response.event.text ?? response.event.eventId,
				},
			]
		}
		return []
	})
	if (events.length === 0) {
		return null
	}
	return (
		<ul className={styles.answerEvents} aria-label="Event citations">
			{events.map((event) => (
				<li key={event.marker}>
					<span className={styles.mono}>{event.marker}</span> — {event.text}
				</li>
			))}
		</ul>
	)
}
