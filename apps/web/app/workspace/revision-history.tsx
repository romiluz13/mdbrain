"use client"

import type {
	MdbrainWikiRevisionListResponse,
	MdbrainWikiRevisionRecord,
} from "@mdbrain/client"
import { useEffect, useState } from "react"
import { Empty, Entry, ErrorNotice, RawJson } from "./ledger.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"
import { asRecord, asString, formatInstant, formatNumber } from "./values.js"

export function RevisionHistory({
	slug,
	currentRevision,
}: {
	slug: string
	currentRevision: number
}) {
	const { call, connection } = useWorkspace()
	const summaries = useLatest<MdbrainWikiRevisionListResponse>()
	const detail = useLatest<MdbrainWikiRevisionRecord>()
	const [selected, setSelected] = useState<number>()

	function loadSummaries() {
		return call((client, options) =>
			client.wikiRevisions(
				{
					slug,
					scope: connection.scope,
					scopeRef: connection.scopeRef,
					agentId: connection.agentId,
					limit: 50,
				},
				options,
			),
		)
	}

	function loadDetail(revision: number) {
		return call((client, options) =>
			client.wikiRevision(
				{
					slug,
					scope: connection.scope,
					scopeRef: connection.scopeRef,
					agentId: connection.agentId,
					revision,
				},
				options,
			),
		)
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch summaries when the page moves to a new revision.
	useEffect(() => {
		setSelected(undefined)
		detail.reset()
		void summaries.run(loadSummaries)
	}, [slug, currentRevision])

	function open(revision: number) {
		setSelected(revision)
		void detail.run(() => loadDetail(revision))
	}

	return (
		<section className={styles.section} aria-label="Revision history">
			<h4>History</h4>
			{summaries.state.status === "loading" ? (
				<p role="status">Loading revision summaries…</p>
			) : null}
			{summaries.state.status === "error" ? (
				<ErrorNotice error={summaries.state.error} title="History not loaded" />
			) : null}
			{summaries.state.status === "ok" &&
			summaries.state.data.revisions.length === 0 ? (
				<Empty title="No history visible to this key.">
					The API returned an empty revision list for this page.
				</Empty>
			) : null}
			{summaries.state.status === "ok" &&
			summaries.state.data.revisions.length > 0 ? (
				<>
					<p className={styles.hint}>
						These are summaries only: who wrote each revision and when. Open a
						revision to fetch its stored content.
					</p>
					<ul className={styles.list} aria-label="Revision summaries">
						{summaries.state.data.revisions.map((revision) => (
							<li key={revision.revision}>
								<button
									type="button"
									aria-current={revision.revision === selected}
									onClick={() => open(revision.revision)}
								>
									<span className={styles.title}>
										Revision {revision.revision}, {revision.editKind}
									</span>
									<span className={styles.meta}>
										{revision.editor?.name ?? "editor not reported"}
									</span>
									<span className={styles.meta}>
										{formatInstant(revision.createdAt) ?? "time not reported"}
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			) : null}
			{detail.state.status === "loading" ? (
				<p role="status">Fetching revision {selected}…</p>
			) : null}
			{detail.state.status === "error" ? (
				<ErrorNotice error={detail.state.error} title="Revision not loaded" />
			) : null}
			{detail.state.status === "ok" ? (
				<Snapshot record={detail.state.data} />
			) : null}
		</section>
	)
}

function Snapshot({ record }: { record: MdbrainWikiRevisionRecord }) {
	const snapshot = asRecord(record.snapshot) ?? {}
	return (
		<Entry
			marginLabel={`Revision ${record.revision} fields`}
			margin={[
				{
					label: "revision",
					value: formatNumber(record.revision),
					essential: true,
				},
				{ label: "edit", value: record.editKind, essential: true },
				{ label: "editor id", value: record.editor?.id },
				{ label: "editor name", value: record.editor?.name, essential: true },
				{ label: "editor run", value: record.editor?.runId },
				{
					label: "recorded",
					value: formatInstant(record.createdAt),
					essential: true,
				},
				{ label: "snapshot state", value: asString(snapshot.state) },
				{
					label: "snapshot updated",
					value: formatInstant(asString(snapshot.updatedAt)),
				},
			]}
		>
			<h4>Stored content of revision {record.revision}</h4>
			<p>{asString(snapshot.title) ?? "Title not stored in this snapshot."}</p>
			<p className={styles.body}>
				{asString(snapshot.body) ?? "Body not stored in this snapshot."}
			</p>
			<RawJson value={record} label="Raw revision record" />
		</Entry>
	)
}
