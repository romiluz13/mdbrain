"use client"

import { useCallback, useEffect, useState } from "react"
import { recordedApproval } from "../../../lib/demo-data/recorded-approval.js"
import { dataOf } from "../../../lib/demo-data/states.js"
import { formatUtc } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import chapter from "../chapters.module.css"
import styles from "../modes.module.css"
import type { ProposalRow } from "../use-presenter.js"

const REASON_MAX = 200

function RecordedApproval() {
	const { data, playback } = useDemo()
	const run = dataOf(data.run) ?? null
	const map = data.map.kind === "ready" ? data.map.data : null
	const found = recordedApproval(
		run,
		map,
		playback.status === "ready" ? playback.timeline : null,
		playback.status === "ready" ? playback.boundaries : null,
	)
	if (found === null || found.kind === "none") return null
	return (
		<p data-testid="recorded-approval" data-approval={found.kind}>
			{found.kind === "approved"
				? `Recorded: a reviewer approved the proposed page "${found.title}"${found.at ? ` (stored ${formatUtc(found.at)})` : ""}. This page cannot approve or reject anything.`
				: `Recorded: the proposed page "${found.title}" was still waiting for a reviewer when this run was recorded.`}
		</p>
	)
}

/** Chapter 6's review panel. A visitor sees the recorded approval as a fact;
 * only the presenter holding a slot sees the pending proposals and the two
 * buttons. */
export function ProposalReview() {
	const { presenter, live, refresh, data } = useDemo()
	const [rows, setRows] = useState<ProposalRow[] | null>(null)
	const [reason, setReason] = useState("")
	const { proposals, decide } = presenter.actions
	const agentRunState =
		data.run.kind === "ready" ? data.run.data.agentRun?.state : undefined
	const pendingSlug =
		data.run.kind === "ready"
			? data.run.data.agentRun?.pendingProposal?.slug
			: undefined

	const load = useCallback(async () => {
		setRows(await proposals())
	}, [proposals])

	// biome-ignore lint/correctness/useExhaustiveDependencies: a finished run or a new proposal means the queue changed
	useEffect(() => {
		if (live) void load()
	}, [live, load, agentRunState, pendingSlug])

	if (!live) {
		return (
			<section
				className={chapter.boundary}
				aria-labelledby="queue-heading"
				data-testid="review-queue-boundary"
			>
				<h2 id="queue-heading">The review queue is private by design</h2>
				<p>
					A proposed page waits for a reviewer. Until it is approved no wiki
					read returns it, so this public demo cannot list what is pending, and
					it does not pretend to. What it can show is what governance already
					let in: the tiers and states above.
				</p>
				<RecordedApproval />
			</section>
		)
	}

	const decideOn = async (
		operationId: string,
		decision: "approve" | "reject",
	) => {
		const done = await decide(
			operationId,
			decision,
			decision === "reject" && reason.trim() ? reason.trim() : undefined,
		)
		if (done) {
			setReason("")
			refresh()
			await load()
		}
	}

	return (
		<section
			className={chapter.boundary}
			aria-labelledby="queue-heading"
			data-testid="proposal-review"
		>
			<h2 id="queue-heading">Review the proposed page</h2>
			{rows === null ? (
				<p role="status">Reading the review queue…</p>
			) : rows.length === 0 ? (
				<p data-testid="proposal-empty">
					Nothing is waiting for a reviewer on this slot.
				</p>
			) : (
				<>
					<label className={styles.presenterRow}>
						Reason for a rejection (optional)
						<input
							className={styles.field}
							value={reason}
							maxLength={REASON_MAX}
							onChange={(event) => setReason(event.currentTarget.value)}
							data-testid="reject-reason"
						/>
					</label>
					<ul>
						{rows.map((row) => (
							<li
								key={row.operationId}
								className={styles.proposal}
								data-testid="proposal-row"
							>
								<h3>{row.title}</h3>
								<p>{row.summary}</p>
								<p className={chapter.note}>
									{row.claimCount} claims, proposed {formatUtc(row.proposedAt)}
								</p>
								<div className={styles.presenterRow}>
									<button
										type="button"
										className={styles.control}
										data-variant="primary"
										disabled={presenter.busy !== null}
										onClick={() => void decideOn(row.operationId, "approve")}
										data-testid="proposal-approve"
									>
										Approve
									</button>
									<button
										type="button"
										className={styles.control}
										disabled={presenter.busy !== null}
										onClick={() => void decideOn(row.operationId, "reject")}
										data-testid="proposal-reject"
									>
										Reject
									</button>
								</div>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	)
}
