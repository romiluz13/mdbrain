"use client"

import type { ReactNode } from "react"
import type {
	DataState,
	IncompleteReason,
} from "../../../lib/demo-data/states.js"
import styles from "../demo.module.css"

const INCOMPLETE: Record<IncompleteReason, { title: string; body: string }> = {
	RUN_MANIFEST_NOT_EXPOSED: {
		title: "Not yet in this run",
		body: "The read API has no run manifest route yet, so this screen cannot list the run's source files. It shows what is stored instead.",
	},
	RUN_NOT_READY: {
		title: "This run is not finished",
		body: "The run is still being filled. What is stored so far is shown.",
	},
	AGENT_ACTIVITY_NOT_EXPOSED: {
		title: "Not yet in this run",
		body: "No agent activity is stored in this run, and the read API has no route for it yet. Nothing is invented here.",
	},
}

type Props<T> = {
	state: DataState<T>
	/** What is being read, in a few words: "the page list". */
	what: string
	onRetry?: () => void
	emptyNote?: string
	children?: (data: T) => ReactNode
}

export function StatePanel<T>({
	state,
	what,
	onRetry,
	emptyNote,
	children,
}: Props<T>) {
	switch (state.kind) {
		case "loading":
			return (
				<div className={styles.state} role="status" data-state="loading">
					<span className={styles.pulse} aria-hidden="true" />
					<p>Reading {what} from the stored brain…</p>
				</div>
			)
		case "empty":
			return (
				<div className={styles.state} data-state="empty">
					<p className={styles.stateTitle}>Nothing stored yet</p>
					<p>{emptyNote ?? `No ${what} are stored in this run yet.`}</p>
				</div>
			)
		case "error":
			return (
				<div className={styles.state} role="alert" data-state="error">
					<p className={styles.stateTitle}>Could not read {what}</p>
					<p className={styles.mono}>
						{state.code}
						{state.status !== undefined ? ` · ${state.status}` : ""}
					</p>
					<p>{state.message}</p>
					{onRetry ? (
						<button type="button" className={styles.button} onClick={onRetry}>
							Try again
						</button>
					) : null}
				</div>
			)
		case "incomplete": {
			const copy = INCOMPLETE[state.reason]
			return (
				<>
					<div
						className={styles.state}
						data-state="incomplete"
						data-reason={state.reason}
					>
						<p className={styles.stateTitle}>{copy.title}</p>
						<p>
							{copy.body}
							{state.state ? ` Run state: ${state.state}.` : ""}
						</p>
					</div>
					{state.data !== undefined && children ? children(state.data) : null}
				</>
			)
		}
		case "ready":
			return <>{children ? children(state.data) : null}</>
	}
}
