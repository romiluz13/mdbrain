"use client"

import type { ReactNode } from "react"
import type {
	DataState,
	IncompleteReason,
} from "../../../lib/demo-data/states.js"
import styles from "../demo.module.css"

const INCOMPLETE: Record<IncompleteReason, { title: string; body: string }> = {
	RUN_NOT_CONFIGURED: {
		title: "Run not configured",
		body: "This server has no pinned run's record, so the run's own account is not shown: which source files arrived, in what order, and what its agents did. What is stored is still shown.",
	},
	RUN_NOT_READY: {
		title: "This run is not finished",
		body: "The run is still being filled. What is stored so far is shown.",
	},
	CONTRADICTION_NOT_READABLE: {
		title: "Recorded, but not readable here",
		body: "The detector recorded a contradiction, but this read-only key cannot read both of its claims, so the case is not shown. It is counted, not hidden.",
	},
	AGENT_RUN_NOT_STARTED: {
		title: "Not yet in this run",
		body: "This run's record has no agent run yet, so there is nothing to show about what its agents did. Nothing is invented here.",
	},
	AGENT_RUN_RUNNING: {
		title: "The agents are at work",
		body: "The agent run has started and has not finished. What it has recorded so far is shown.",
	},
	AGENT_RUN_INCOMPLETE: {
		title: "The agent run stopped early",
		body: "Only what the run recorded before it stopped is shown here, and nothing is filled in.",
	},
	RUN_FAILED: {
		title: "This run stopped while it was being filled",
		body: "The run's record says seeding stopped before the run was ready. What arrived before it stopped is shown.",
	},
}

type Props<T> = {
	state: DataState<T>
	/** What is being read, in a few words: "the page list". */
	what: string
	onRetry?: () => void
	emptyNote?: string
	/** Replaces "Nothing stored yet" where an empty read is a timing fact, not
	 * an absence: a record that is written later. */
	emptyTitle?: string
	children?: (data: T) => ReactNode
}

export function StatePanel<T>({
	state,
	what,
	onRetry,
	emptyNote,
	emptyTitle,
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
					<p className={styles.stateTitle}>
						{emptyTitle ?? "Nothing stored yet"}
					</p>
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
