"use client"

import type {
	MdbrainWikiPageUpdateInput,
	MdbrainWikiPageView,
} from "@mdbrain/client"
import { useId, useState } from "react"
import { ErrorNotice, Margin, Notice } from "./ledger.js"
import { pageMarginRows } from "./page-margin.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"

type Draft = { title: string; summary: string; body: string }

/** Edits an inspected revision. Saves with `expectedRevision` set to the
 *  revision this editor was last pointed at; the API refuses the save when the
 *  page has moved on. Only title, summary and body are sent, so frontmatter,
 *  trust tier, permissions and everything else on the page stay as stored. */
export function PageEditor({
	page,
	onSaved,
	onCancel,
}: {
	page: MdbrainWikiPageView
	onSaved: () => void
	onCancel: () => void
}) {
	const { call, connection } = useWorkspace()
	const [baseRevision, setBaseRevision] = useState(page.revision)
	const [base, setBase] = useState<Draft>({
		title: page.title,
		summary: page.summary,
		body: page.body,
	})
	const [draft, setDraft] = useState<Draft>(base)
	const save = useLatest<true>()
	const latest = useLatest<MdbrainWikiPageView>()
	const ids = useId()

	const changed = (Object.keys(draft) as Array<keyof Draft>).filter(
		(key) => draft[key] !== base[key],
	)
	const conflicted =
		save.state.status === "error" && save.state.error.kind === "conflict"

	async function submit() {
		const patch: Partial<Draft> = {}
		for (const key of changed) {
			patch[key] = draft[key]
		}
		const input: MdbrainWikiPageUpdateInput = {
			slug: page.slug,
			scope: connection.scope,
			scopeRef: connection.scopeRef,
			agentId: connection.agentId,
			expectedRevision: baseRevision,
			...patch,
		}
		const saved = await save.run(async () => {
			await call((client, options) => client.wikiUpdate(input, options))
			return true as const
		})
		// undefined means the request failed or this editor was discarded
		if (saved) {
			onSaved()
		}
	}

	function loadLatest() {
		void latest.run(() =>
			call((client, options) =>
				client.wikiGet(
					{
						slug: page.slug,
						scope: connection.scope,
						scopeRef: connection.scopeRef,
						agentId: connection.agentId,
					},
					options,
				),
			),
		)
	}

	/** Point the editor at the latest revision. Fields the person edited keep
	 *  their draft; untouched fields take the latest stored text, so saving
	 *  cannot silently revert someone else's change to a field they never edited. */
	function editOnLatest(latestPage: MdbrainWikiPageView) {
		const latestFields: Draft = {
			title: latestPage.title,
			summary: latestPage.summary,
			body: latestPage.body,
		}
		setDraft({
			title: draft.title !== base.title ? draft.title : latestFields.title,
			summary:
				draft.summary !== base.summary ? draft.summary : latestFields.summary,
			body: draft.body !== base.body ? draft.body : latestFields.body,
		})
		setBaseRevision(latestPage.revision)
		setBase(latestFields)
		save.reset()
		latest.reset()
	}

	return (
		<form
			className={styles.form}
			onSubmit={(event) => {
				event.preventDefault()
				void submit()
			}}
		>
			<h4 id={`${ids}-h`}>Edit revision {baseRevision}</h4>
			<p className={styles.hint}>
				Saving creates revision {baseRevision + 1} only if the page is still at
				revision {baseRevision}.
			</p>
			<fieldset
				className={styles.fieldset}
				disabled={save.state.status === "loading"}
			>
				<label className={styles.field}>
					<span>Title</span>
					<input
						value={draft.title}
						onChange={(event) =>
							setDraft({ ...draft, title: event.target.value })
						}
					/>
				</label>
				<label className={styles.field}>
					<span>Summary</span>
					<input
						value={draft.summary}
						onChange={(event) =>
							setDraft({ ...draft, summary: event.target.value })
						}
					/>
				</label>
				<label className={styles.field}>
					<span>Body</span>
					<textarea
						value={draft.body}
						onChange={(event) =>
							setDraft({ ...draft, body: event.target.value })
						}
					/>
				</label>
			</fieldset>
			<div className={styles.row}>
				<button
					type="submit"
					className={styles.button}
					disabled={changed.length === 0 || save.state.status === "loading"}
				>
					{save.state.status === "loading" ? "Saving…" : "Save revision"}
				</button>
				<button
					type="button"
					className={`${styles.button} ${styles.secondary}`}
					onClick={onCancel}
				>
					Discard draft
				</button>
			</div>
			{save.state.status === "error" && !conflicted ? (
				<ErrorNotice error={save.state.error} title="Not saved" />
			) : null}
			{conflicted ? (
				<div>
					<Notice
						tone="bad"
						title="Not saved: the page changed after you opened it."
					>
						Your draft is kept exactly as written. Nothing was overwritten.
					</Notice>
					<div className={styles.row}>
						<button
							type="button"
							className={`${styles.button} ${styles.secondary}`}
							onClick={loadLatest}
							disabled={latest.state.status === "loading"}
						>
							Show the latest revision
						</button>
					</div>
				</div>
			) : null}
			{latest.state.status === "error" ? (
				<ErrorNotice error={latest.state.error} title="Could not load latest" />
			) : null}
			{latest.state.status === "ok" ? (
				<LatestPreview latest={latest.state.data} onAdopt={editOnLatest} />
			) : null}
		</form>
	)
}

function LatestPreview({
	latest,
	onAdopt,
}: {
	latest: MdbrainWikiPageView
	onAdopt: (latest: MdbrainWikiPageView) => void
}) {
	return (
		<div className={styles.entry}>
			<div className={styles.entryMain}>
				<h4>Latest stored text, revision {latest.revision}</h4>
				<p className={styles.body}>{latest.body}</p>
				<div className={styles.row}>
					<button
						type="button"
						className={styles.button}
						onClick={() => onAdopt(latest)}
					>
						Keep my edits and save against revision {latest.revision}
					</button>
				</div>
			</div>
			<Margin rows={pageMarginRows(latest)} label="Latest revision fields" />
		</div>
	)
}
