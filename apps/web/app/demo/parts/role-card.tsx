"use client"

import type { EventConfirmation } from "../../../lib/demo-data/confirm-event.js"
import {
	type AgentRunChecks,
	type PageCheck,
	type RoleStory,
	reusedPageName,
} from "../../../lib/demo-data/agent-run.js"
import { countOf } from "../../../lib/demo-data/plural.js"
import type {
	AgentRoleId,
	AgentRunRecord,
} from "../../../lib/demo-data/run-record.js"
import { formatUtc } from "../../../lib/demo-data/views.js"
import styles from "../run-chapters.module.css"
import { TimeLine } from "./time-line.js"

type Check = { key: string; title: string; body: string }

const stamp = (iso: string) => formatUtc(iso)

function pageLine(page: PageCheck & { kind: "stored" }): string {
	return `${page.title}, revision ${page.revision}, ${page.state}, updated ${stamp(page.updatedAt)}`
}

function didOf(
	role: AgentRoleId,
	run: AgentRunRecord,
	checks: AgentRunChecks | null,
): string {
	const yet = run.state === "running" ? " yet" : ""
	const name = reusedPageName(run, checks)
	switch (role) {
		case "support":
			if (!run.reusedPage) {
				return `No page write is recorded for this role${yet}.`
			}
			return name === null
				? "Wrote a page to the wiki."
				: `Wrote the page “${name}”.`
		case "account":
			if (!run.reusedPage) {
				return `No page read is recorded for this role${yet}.`
			}
			return name === null
				? "Read the page Support wrote."
				: `Read Support's completed revision of “${name}”.`
		case "product":
			return run.pendingProposal
				? `Proposed “${run.pendingProposal.title}”. It is pending review.`
				: `No proposal is recorded for this role${yet}.`
	}
}

function checkOf(
	role: AgentRoleId,
	run: AgentRunRecord,
	checks: AgentRunChecks | null,
): Check | null {
	if (role === "product") {
		if (!run.pendingProposal) {
			return null
		}
		const found = checks?.proposal
		if (found === undefined) {
			return { key: "checking", title: "Checking the wiki…", body: "" }
		}
		if (found.kind === "absent") {
			return {
				key: "absent-pending",
				title: "Pending, as expected",
				body: "The wiki has no page for this proposal. A pending proposal is not a page until a person approves it, so its absence is the honest state.",
			}
		}
		if (found.kind === "stored") {
			return {
				key: "stored",
				title: "Approved since",
				body: `A page with this slug is now stored: ${pageLine(found)}.`,
			}
		}
		return { key: "unreadable", title: "Could not be read", body: found.code }
	}
	if (!run.reusedPage) {
		return null
	}
	const found = checks?.reusedPage
	if (found === undefined) {
		return { key: "checking", title: "Checking the wiki…", body: "" }
	}
	if (found.kind === "stored") {
		return {
			key: "stored",
			title: "Verified in the wiki",
			body:
				role === "support"
					? `${pageLine(found)}.`
					: `The page is stored at revision ${found.revision}. The run's record says Account read it.`,
		}
	}
	if (found.kind === "absent") {
		return {
			key: "absent",
			title: "Not found in the wiki",
			body: "The run's record names this page, but the wiki read found none.",
		}
	}
	return { key: "unreadable", title: "Could not be read", body: found.code }
}

function stepStatus(answer: EventConfirmation | undefined) {
	switch (answer?.status) {
		case undefined:
			return "Checking memory…"
		case "confirmed":
			return "Confirmed in memory"
		case "unconfirmed":
			return "Could not be confirmed in this run"
		case "unavailable":
			return "Could not be read right now"
	}
}

/** The hand-off arrow into this card, drawn by the chapter as the run reads
 * left to right. It points down between stacked cards and right between
 * columns. */
function HandoffArrow() {
	return (
		<svg
			className={styles.handoffArrow}
			data-testid="handoff-arrow"
			data-motion="handoff-arrow"
			viewBox="0 0 24 24"
			aria-hidden="true"
			focusable="false"
		>
			<path pathLength={1} d="M12 6.5V17M7.5 12.5L12 17L16.5 12.5" />
		</svg>
	)
}

type Props = {
	story: RoleStory
	order: number
	run: AgentRunRecord
	checks: AgentRunChecks | null
	reads: Record<string, EventConfirmation | undefined>
	onToggle: (open: boolean) => void
}

export function RoleCard({
	story,
	order,
	run,
	checks,
	reads,
	onToggle,
}: Props) {
	const check = checkOf(story.role, run, checks)
	return (
		<li className={styles.role} data-testid="agent-role" data-role={story.role}>
			{order > 1 ? <HandoffArrow /> : null}
			<div className={styles.roleHead}>
				<span className={styles.roleOrder} aria-hidden="true">
					{order}
				</span>
				<h3 className={styles.roleName}>{story.label}</h3>
			</div>
			<p className={styles.did}>{didOf(story.role, run, checks)}</p>
			{check ? (
				<div
					className={styles.check}
					data-check={check.key}
					data-testid="agent-check"
				>
					<span className={styles.checkTitle}>{check.title}</span>
					{check.body ? <span>{check.body}</span> : null}
				</div>
			) : null}
			{story.steps.length > 0 ? (
				<details
					className={styles.steps}
					onToggle={(event) => onToggle(event.currentTarget.open)}
				>
					<summary>{countOf(story.steps.length, "step")} recorded</summary>
					<ol className={styles.stepList}>
						{story.steps.map((step) => {
							const answer = reads[step.eventId]
							return (
								<li
									key={step.n}
									data-testid="agent-step"
									data-status={answer?.status ?? "loading"}
								>
									<span className={styles.stepNumber}>{step.n}</span>
									<div>
										<span className={styles.stepName}>
											{step.name}
											{step.detail ? ` · ${step.detail}` : ""}
										</span>
										<span className={styles.stepMeta}>
											<span className={styles.stepStatus}>
												{stepStatus(answer)}
											</span>
											{answer?.status === "confirmed" ? (
												<TimeLine kind="business" iso={answer.businessTime} />
											) : null}
										</span>
									</div>
								</li>
							)
						})}
					</ol>
				</details>
			) : null}
		</li>
	)
}
