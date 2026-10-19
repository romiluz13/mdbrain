"use client"

import type {
	MdbrainContextBundleResponse,
	MdbrainSearchDetailedResponse,
} from "@mdbrain/client"
import { type FormEvent, useState } from "react"
import { BundleView } from "./bundle-view.js"
import { ErrorNotice } from "./ledger.js"
import { RetrievalView } from "./retrieval-view.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"

/** Two independent requests over the same question: the detailed retrieval
 *  report and the context bundle an agent would be handed. A failure in one
 *  does not blank the other. */
export function RetrievalPanel() {
	const { call, connection } = useWorkspace()
	const [query, setQuery] = useState("")
	const [session, setSession] = useState("")
	const [blank, setBlank] = useState(false)
	const [asked, setAsked] = useState<{
		search?: string
		bundle?: string
		searchSession?: string
	}>({})
	const search = useLatest<MdbrainSearchDetailedResponse>()
	const bundle = useLatest<MdbrainContextBundleResponse>()

	function ready(): string | undefined {
		const text = query.trim()
		setBlank(!text)
		return text || undefined
	}

	function runSearch(event: FormEvent) {
		event.preventDefault()
		const text = ready()
		if (!text) {
			return
		}
		const sessionKey = session.trim()
		setAsked((current) => ({
			...current,
			search: text,
			searchSession: sessionKey || undefined,
		}))
		void search.run(() =>
			call((client, options) =>
				client.searchDetailed(
					{
						query: text,
						limit: 8,
						agentId: connection.agentId,
						scope: connection.scope,
						scopeRef: connection.scopeRef,
						// Only sent when set: a blank field searches the whole scope.
						...(sessionKey ? { conversationScope: { sessionKey } } : {}),
					},
					options,
				),
			),
		)
	}

	function runBundle() {
		const text = ready()
		if (!text) {
			return
		}
		setAsked((current) => ({ ...current, bundle: text }))
		void bundle.run(() =>
			call((client, options) =>
				client.buildContextBundle(
					{
						query: text,
						agentId: connection.agentId,
						scope: connection.scope,
						scopeRef: connection.scopeRef,
					},
					options,
				),
			),
		)
	}

	return (
		<section className={styles.section} aria-labelledby="retrieve-heading">
			<h3 id="retrieve-heading">Retrieve evidence from conversation memory</h3>
			<p className={styles.hint}>
				Shows what Memongo returned for a query: each result with its reported
				trust and provenance fields, and the context an agent would receive. It
				does not search knowledge pages.
			</p>
			<form className={styles.form} onSubmit={runSearch} noValidate>
				<label className={styles.field}>
					<span>Query</span>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					{blank ? (
						<span className={styles.fieldError}>Enter a query.</span>
					) : null}
				</label>
				<label className={styles.field}>
					<span>Search session ID</span>
					<input
						value={session}
						onChange={(event) => setSession(event.target.value)}
					/>
					<span className={styles.hint}>
						Optional. Filters evidence search to one session's events; leave
						blank to search across the connected scope. The context bundle is
						built over the connected scope and is not limited by this filter.
					</span>
				</label>
				<div className={styles.row}>
					<button
						type="submit"
						className={styles.button}
						disabled={search.state.status === "loading"}
					>
						{search.state.status === "loading"
							? "Retrieving…"
							: "Retrieve evidence"}
					</button>
					<button
						type="button"
						className={`${styles.button} ${styles.secondary}`}
						disabled={bundle.state.status === "loading"}
						onClick={runBundle}
					>
						{bundle.state.status === "loading"
							? "Building…"
							: "Build context bundle"}
					</button>
				</div>
			</form>
			{search.state.status === "error" ? (
				<ErrorNotice
					error={search.state.error}
					title={
						search.state.error.kind === "unavailable"
							? "Retrieval unavailable (this is not a zero-result answer)"
							: "Retrieval failed"
					}
				/>
			) : null}
			{search.state.status === "ok" ? (
				<>
					{/* Request summary frozen at request time: editing the session
					 *  field afterwards cannot relabel the results shown below. */}
					<p className={styles.hint}>
						Evidence search for “{asked.search ?? ""}”
						{asked.searchSession
							? ` filtered to session ${asked.searchSession}`
							: " across the connected scope"}
						.
					</p>
					<RetrievalView
						response={search.state.data}
						query={asked.search ?? ""}
					/>
				</>
			) : null}
			{bundle.state.status === "error" ? (
				<ErrorNotice error={bundle.state.error} title="Context bundle failed" />
			) : null}
			{bundle.state.status === "ok" ? (
				<BundleView bundle={bundle.state.data} query={asked.bundle ?? ""} />
			) : null}
		</section>
	)
}
