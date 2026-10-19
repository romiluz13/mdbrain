"use client"

import { type FormEvent, useState } from "react"
import { Empty, ErrorNotice, Notice, RawJson } from "./ledger.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"
import { parseWikiSearch, type WikiSearchView } from "./wiki-search-view.js"

type Outcome = { view: WikiSearchView | null; raw: unknown; query: string }

export function WikiQuery({ onSelect }: { onSelect: (slug: string) => void }) {
	const { call, connection } = useWorkspace()
	const [query, setQuery] = useState("")
	const [blank, setBlank] = useState(false)
	const { state, run } = useLatest<Outcome>()

	async function submit(event: FormEvent) {
		event.preventDefault()
		const asked = query.trim()
		setBlank(!asked)
		if (!asked) {
			return
		}
		await run(async () => {
			const raw = await call((client, options) =>
				client.wikiSearch(
					{
						query: asked,
						scope: connection.scope,
						scopeRef: connection.scopeRef,
						agentId: connection.agentId,
						maxResults: 8,
					},
					options,
				),
			)
			return { view: parseWikiSearch(raw), raw, query: asked }
		})
	}

	return (
		<section className={styles.section} aria-labelledby="wiki-query-heading">
			<h3 id="wiki-query-heading">Search knowledge pages</h3>
			<p className={styles.hint}>
				Searches wiki pages only. It does not search conversation memory.
			</p>
			<form className={styles.form} onSubmit={submit} noValidate>
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
				<div className={styles.row}>
					<button
						type="submit"
						className={styles.button}
						disabled={state.status === "loading"}
					>
						{state.status === "loading" ? "Searching…" : "Search pages"}
					</button>
				</div>
			</form>
			{state.status === "error" ? (
				<ErrorNotice
					error={state.error}
					title={
						state.error.kind === "unavailable"
							? "Search unavailable (this is not a zero-result answer)"
							: "Search failed"
					}
				/>
			) : null}
			{state.status === "ok" ? (
				<Results outcome={state.data} onSelect={onSelect} />
			) : null}
		</section>
	)
}

function Results({
	outcome,
	onSelect,
}: {
	outcome: Outcome
	onSelect: (slug: string) => void
}) {
	if (!outcome.view) {
		return (
			<>
				<Notice
					tone="warn"
					title="The response was not a recognizable search result."
				>
					Showing it unchanged below.
				</Notice>
				<RawJson value={outcome.raw} label="Raw response" />
			</>
		)
	}
	const { hits, total, recipe, mode } = outcome.view
	return (
		<div role="status" aria-label="Wiki search results">
			{hits.length === 0 ? (
				<Empty title={`No pages matched “${outcome.query}”`}>
					The search ran and returned zero results for this scope.
				</Empty>
			) : (
				<>
					<p className={styles.hint}>
						{hits.length} returned
						{total !== undefined ? ` of ${total} matched` : ""}
						{recipe ? `, recipe ${recipe}` : ""}
						{mode ? `, mode ${mode}` : ""}. Scores and sources are as the API
						reported them.
					</p>
					<ul className={styles.list}>
						{hits.map((hit) => (
							<li key={hit.slug}>
								<button type="button" onClick={() => onSelect(hit.slug)}>
									<span className={styles.title}>{hit.title}</span>
									<span className={styles.meta}>{hit.slug}</span>
									<span className={styles.meta}>
										score {hit.score ?? "not reported"}, source{" "}
										{hit.source ?? "not reported"}
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			)}
			<RawJson value={outcome.raw} label="Raw search response" />
		</div>
	)
}
