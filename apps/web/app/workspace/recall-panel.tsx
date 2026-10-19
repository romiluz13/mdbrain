"use client"

import type { MdbrainConversationRecallResponse } from "@mdbrain/client"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Empty, Entry, ErrorNotice, Notice, RawJson } from "./ledger.js"
import { useLatest } from "./use-latest.js"
import { formatInstant, formatNumber } from "./values.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"

export function RecallPanel({
	request,
}: {
	request: { sessionId: string; nonce: number }
}) {
	const { call, connection } = useWorkspace()
	const [sessionId, setSessionId] = useState("")
	const [query, setQuery] = useState("")
	const { state, run } = useLatest<MdbrainConversationRecallResponse>()
	const lastNonce = useRef(0)

	function recall(session: string, text: string) {
		return run(() =>
			call((client, options) =>
				client.recallConversation(
					{
						sessionId: session.trim() || undefined,
						query: text.trim() || undefined,
						limit: 10,
						agentId: connection.agentId,
						scope: connection.scope,
						scopeRef: connection.scopeRef,
					},
					options,
				),
			),
		)
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new request from the capture panel should trigger this.
	useEffect(() => {
		if (request.nonce > lastNonce.current) {
			lastNonce.current = request.nonce
			setSessionId(request.sessionId)
			setQuery("")
			void recall(request.sessionId, "")
		}
	}, [request])

	function submit(event: FormEvent) {
		event.preventDefault()
		void recall(sessionId, query)
	}

	const data = state.status === "ok" ? state.data : undefined

	return (
		<section className={styles.section} aria-labelledby="recall-heading">
			<h3 id="recall-heading">Recall stored events</h3>
			<p className={styles.hint}>
				Lists cited events from conversation memory. Leave both fields empty to
				list recent events in this scope.
			</p>
			<form className={styles.form} onSubmit={submit}>
				<label className={styles.field}>
					<span>Session ID</span>
					<input
						className={styles.mono}
						value={sessionId}
						onChange={(event) => setSessionId(event.target.value)}
					/>
				</label>
				<label className={styles.field}>
					<span>Text to match</span>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<div className={styles.row}>
					<button
						type="submit"
						className={styles.button}
						disabled={state.status === "loading"}
					>
						{state.status === "loading" ? "Recalling…" : "Recall events"}
					</button>
				</div>
			</form>
			{state.status === "error" ? (
				<ErrorNotice error={state.error} title="Recall failed" />
			) : null}
			{data && data.results.length === 0 ? (
				<Empty title="Recall returned no events">
					Conversation memory fills when you capture an event on this page, or
					when an agent writes with the SDK <code>add</code> call or the MCP
					tools using this agent ID and scope. Saving a knowledge page does not
					add events.
				</Empty>
			) : null}
			{data?.metadata.throttled ? (
				<Notice tone="warn" title="Recall was throttled">
					The API asked to retry after {data.metadata.throttled.retryAfterMs}{" "}
					ms; results may be incomplete.
				</Notice>
			) : null}
			{data?.results.map((result) => (
				<Entry
					key={result.citation.eventId}
					marginLabel="Cited event fields"
					margin={[
						{
							label: "event id",
							essential: true,
							value: result.citation.eventId,
						},
						{
							label: "session id",
							essential: true,
							value: result.citation.sessionId,
						},
						{ label: "role", essential: true, value: result.citation.role },
						{
							label: "timestamp",
							essential: true,
							value: formatInstant(result.citation.timestamp),
						},
						{ label: "match type", value: result.matchType },
						{ label: "score", value: formatNumber(result.score) },
						{ label: "source ref", value: result.citation.sourceRef },
					]}
				>
					<p className={styles.body}>{result.citation.preview}</p>
				</Entry>
			))}
			{data ? (
				<>
					<p className={styles.hint} role="status">
						{data.metadata.totalMatched} matched, search method{" "}
						{data.metadata.searchMethod}, {data.metadata.durationMs} ms. Filters
						applied:{" "}
						{data.metadata.filtersApplied.join(", ") || "none reported"}.
					</p>
					<RawJson value={data} label="Raw recall response" />
				</>
			) : null}
		</section>
	)
}
