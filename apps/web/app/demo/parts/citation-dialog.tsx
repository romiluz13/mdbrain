"use client"

import { useEffect, useRef } from "react"
import { revisionStoredAt } from "../../../lib/demo-data/views.js"
import { useDemo, type CitationTarget } from "../demo-context.js"
import styles from "../citation.module.css"
import { ClaimSources } from "./claim-sources.js"
import { TimeLine } from "./time-line.js"

type Props = {
	target: CitationTarget | null
	onClose: () => void
}

/** A claim's citation, opened as a modal dialog: the claim, then every source
 * event it rests on read through `cite`, each shown as its own read lands. The
 * browser makes the page behind it inert and Escape closes it; focus returns
 * to the element that opened it. */
export function CitationDialog({ target, onClose }: Props) {
	const ref = useRef<HTMLDialogElement>(null)

	useEffect(() => {
		const dialog = ref.current
		if (!dialog) {
			return
		}
		if (target !== null && !dialog.open) {
			dialog.showModal()
		} else if (target === null && dialog.open) {
			dialog.close()
		}
	}, [target])

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click is a pointer shortcut; Escape and the close button are the keyboard paths
		<dialog
			ref={ref}
			className={styles.dialog}
			aria-labelledby="citation-title"
			onClose={onClose}
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					event.currentTarget.close()
				}
			}}
		>
			{target ? <CitationBody target={target} /> : null}
		</dialog>
	)
}

function CitationBody({ target }: { target: CitationTarget }) {
	const { data } = useDemo()
	const { claim } = target

	const storedAt =
		target.revision === undefined
			? undefined
			: revisionStoredAt(
					data.map.kind === "ready" ? data.map.data : null,
					data.changes.kind === "ready" ? data.changes.data : null,
					target.pageSlug,
					target.revision,
				)
	return (
		<div className={styles.sheet}>
			<header className={styles.head}>
				<div>
					<p className={styles.kicker}>Citation</p>
					<h2 id="citation-title">{target.pageTitle}</h2>
				</div>
				<form method="dialog">
					<button
						type="submit"
						className={styles.close}
						aria-label="Close citation"
					>
						<span aria-hidden="true">×</span>
					</button>
				</form>
			</header>
			<blockquote className={styles.claim} data-testid="citation-claim">
				{claim.text}
			</blockquote>
			<dl className={styles.facts}>
				<div>
					<dt>Status</dt>
					<dd>{claim.status}</dd>
				</div>
				<div>
					<dt>Confidence</dt>
					<dd>{Math.round(claim.confidence * 100)}%</dd>
				</div>
				{target.revision !== undefined ? (
					<div>
						<dt>Page revision</dt>
						<dd>{target.revision}</dd>
					</div>
				) : null}
			</dl>
			<div className={styles.clocks}>
				<TimeLine kind="ingestion" iso={storedAt} note="revision stored" />
				<TimeLine
					kind="business"
					iso={undefined}
					missingNote="missing on the claim; each source below carries its own"
				/>
			</div>
			{claim.marker ? (
				<p className={styles.marker} data-testid="citation-marker">
					{claim.marker}
				</p>
			) : null}
			<h3>Evidence</h3>
			<ClaimSources claim={claim} listClassName={styles.slips} />
		</div>
	)
}
