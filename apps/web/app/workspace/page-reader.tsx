"use client"

import type { MdbrainWikiPageView } from "@mdbrain/client"
import { useCallback, useEffect, useState } from "react"
import { ErrorNotice, Empty, Entry, RawJson } from "./ledger.js"
import { PageEditor } from "./page-editor.js"
import { pageMarginRows } from "./page-margin.js"
import { RevisionHistory } from "./revision-history.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"
import { asRecord, asString, formatInstant, formatNumber } from "./values.js"

/** Reads the persisted page from the API every time it is opened or reloaded.
 *  Nothing shown here comes from the list row or from a cache. */
export function PageReader({
	slug,
	onChanged,
}: {
	slug: string
	onChanged: () => void
}) {
	const { call, connection } = useWorkspace()
	const { state, run } = useLatest<MdbrainWikiPageView>()
	const [editing, setEditing] = useState(false)

	function readPage() {
		return call((client, options) =>
			client.wikiGet(
				{
					slug,
					scope: connection.scope,
					scopeRef: connection.scopeRef,
					agentId: connection.agentId,
				},
				options,
			),
		)
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: the reader is keyed by slug and the connection is fixed per instance.
	const reload = useCallback(() => void run(readPage), [run, slug])

	useEffect(() => {
		reload()
	}, [reload])

	return (
		<section className={styles.section} aria-label={`Page ${slug}`}>
			{state.status === "loading" ? <p role="status">Loading page…</p> : null}
			{state.status === "error" ? (
				<>
					<ErrorNotice error={state.error} title="Page not loaded" />
					<button
						type="button"
						className={`${styles.button} ${styles.secondary}`}
						onClick={reload}
					>
						Try again
					</button>
				</>
			) : null}
			{state.status === "ok" ? (
				<>
					<Entry
						margin={pageMarginRows(state.data)}
						marginLabel="Page record fields"
					>
						{editing ? (
							<PageEditor
								page={state.data}
								onCancel={() => setEditing(false)}
								onSaved={() => {
									setEditing(false)
									reload()
									onChanged()
								}}
							/>
						) : (
							<>
								<h3>{state.data.title}</h3>
								<p>{state.data.summary}</p>
								<p className={styles.body}>{state.data.body}</p>
								<div className={styles.row}>
									<button
										type="button"
										className={styles.button}
										onClick={() => setEditing(true)}
									>
										Edit this revision
									</button>
									<button
										type="button"
										className={`${styles.button} ${styles.secondary}`}
										onClick={reload}
									>
										Reload from API
									</button>
								</div>
							</>
						)}
					</Entry>
					<Claims claims={state.data.claims} />
					<RawJson value={state.data} label="Raw page record" />
					<RevisionHistory slug={slug} currentRevision={state.data.revision} />
				</>
			) : null}
		</section>
	)
}

function Claims({ claims }: { claims: unknown[] }) {
	if (!Array.isArray(claims) || claims.length === 0) {
		return (
			<Empty title="No claims recorded on this page">
				The API returned an empty claims list.
			</Empty>
		)
	}
	return (
		<div>
			<h4>Claims</h4>
			{claims.map((entry, index) => {
				const claim = asRecord(entry) ?? {}
				const evidence = Array.isArray(claim.evidence) ? claim.evidence : []
				return (
					<Entry
						key={asString(claim.id) ?? index}
						marginLabel={`Claim ${index + 1} fields`}
						margin={[
							{ label: "claim id", value: asString(claim.id) },
							{
								label: "status",
								essential: true,
								value: asString(claim.status),
							},
							{
								label: "confidence",
								essential: true,
								value: formatNumber(
									typeof claim.confidence === "number"
										? claim.confidence
										: undefined,
								),
							},
							{ label: "evidence items", value: String(evidence.length) },
							{
								label: "derived from",
								value: Array.isArray(claim.derivedFrom)
									? claim.derivedFrom.join(", ")
									: undefined,
							},
							{
								label: "valid from",
								value: formatInstant(asString(claim.validFrom)),
							},
							{
								label: "valid to",
								value: formatInstant(asString(claim.validTo)),
							},
						]}
					>
						<p className={styles.body}>
							{asString(claim.text) ?? "Claim text not reported."}
						</p>
						{evidence.length > 0 ? (
							<RawJson value={evidence} label="Evidence as returned" />
						) : null}
					</Entry>
				)
			})}
		</div>
	)
}
