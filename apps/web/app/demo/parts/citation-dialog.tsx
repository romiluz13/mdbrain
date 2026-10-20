"use client"

import { useEffect, useRef, useState } from "react"
import {
	loadClaimSources,
	type ClaimSourcesView,
} from "../../../lib/demo-data/loaders-chapters.js"
import type { DataState } from "../../../lib/demo-data/states.js"
import { useDemo, type CitationTarget } from "../demo-context.js"
import styles from "../citation.module.css"
import { StatePanel } from "./state-panel.js"
import { SourceSlip } from "./source-slip.js"

type Props = {
	target: CitationTarget | null
	onClose: () => void
}

/** A claim's citation, opened as a modal dialog: the claim, then every source
 * event it rests on read through `cite`, each with its full stored text. The
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
	const { upstream } = useDemo()
	const [sources, setSources] = useState<DataState<ClaimSourcesView>>({
		kind: "loading",
	})
	const { claim } = target

	useEffect(() => {
		let live = true
		setSources({ kind: "loading" })
		void loadClaimSources(upstream, claim).then((state) => {
			if (live) {
				setSources(state)
			}
		})
		return () => {
			live = false
		}
	}, [upstream, claim])

	const eventCount = claim.evidence.filter(
		(evidence) => evidence.kind === "event",
	).length

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
			{claim.marker ? <p className={styles.marker}>{claim.marker}</p> : null}
			<h3>Evidence</h3>
			<StatePanel
				state={sources}
				what="the cited sources"
				emptyNote="This claim cites no source event. It may rest on other evidence."
			>
				{(view) => (
					<>
						{eventCount > view.sources.length ? (
							<p className={styles.note}>
								Showing {view.sources.length} of {eventCount} source events.
							</p>
						) : null}
						<ol className={styles.slips}>
							{view.sources.map((source) => (
								<li key={source.eventId}>
									<SourceSlip source={source} claimText={claim.text} />
								</li>
							))}
						</ol>
						{view.otherEvidence > 0 ? (
							<p className={styles.note}>
								Also rests on {view.otherEvidence} evidence item
								{view.otherEvidence === 1 ? "" : "s"} that are not source
								events.
							</p>
						) : null}
					</>
				)}
			</StatePanel>
		</div>
	)
}
