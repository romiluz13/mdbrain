"use client"

import type { MdbrainWikiPageListResponse } from "@mdbrain/client"
import { useEffect } from "react"
import { Empty, ErrorNotice } from "./ledger.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"

const PAGE_LIMIT = 50

export function PageList({
	version,
	selectedSlug,
	onSelect,
	onNew,
}: {
	version: number
	selectedSlug?: string
	onSelect: (slug: string) => void
	onNew: () => void
}) {
	const { call, connection } = useWorkspace()
	const { state, run } = useLatest<MdbrainWikiPageListResponse>()

	function listPages() {
		return call((client, options) =>
			client.wikiList(
				{
					scope: connection.scope,
					scopeRef: connection.scopeRef,
					agentId: connection.agentId,
					limit: PAGE_LIMIT,
				},
				options,
			),
		)
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the parent bumps `version`; the connection never changes inside this instance.
	useEffect(() => {
		void run(listPages)
	}, [version])

	return (
		<section className={styles.section} aria-labelledby="pages-heading">
			<div className={styles.row}>
				<h3 id="pages-heading">Pages in this scope</h3>
				<button type="button" className={styles.button} onClick={onNew}>
					New page
				</button>
				<button
					type="button"
					className={`${styles.button} ${styles.secondary}`}
					onClick={() => void run(listPages)}
				>
					Reload list
				</button>
			</div>
			{state.status === "loading" ? <p role="status">Loading pages…</p> : null}
			{state.status === "error" ? <ErrorNotice error={state.error} /> : null}
			{state.status === "ok" && state.data.pages.length === 0 ? (
				<Empty title="No pages in this scope yet">
					Create one with “New page”. This list shows what the API returned for{" "}
					<span className={styles.mono}>
						{connection.scope}/{connection.scopeRef}
					</span>
					.
				</Empty>
			) : null}
			{state.status === "ok" && state.data.pages.length > 0 ? (
				<>
					<p className={styles.hint} role="status">
						Showing {state.data.pages.length} of {state.data.total}.
					</p>
					<ul className={styles.list}>
						{state.data.pages.map((page) => (
							<li key={page.slug}>
								<button
									type="button"
									aria-current={page.slug === selectedSlug}
									onClick={() => onSelect(page.slug)}
								>
									<span className={styles.title}>{page.title}</span>
									<span className={styles.meta}>{page.slug}</span>
									<span className={styles.meta}>
										revision {page.revision}, {page.state}
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			) : null}
		</section>
	)
}
