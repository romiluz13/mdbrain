"use client"

import type { MdbrainWikiClaim } from "@mdbrain/client"
import styles from "../citation.module.css"
import { useClaimSources } from "../use-claim-sources.js"
import { SourceSlip } from "./source-slip.js"
import { StatePanel } from "./state-panel.js"

/** The events a claim rests on, each shown the moment its own cite returns. */
export function ClaimSources({
	claim,
	listClassName,
	emptyNote,
}: {
	claim: MdbrainWikiClaim
	listClassName: string
	emptyNote: string
}) {
	const state = useClaimSources(claim)
	return (
		<StatePanel state={state} what="the cited sources" emptyNote={emptyNote}>
			{(view) => (
				<>
					{view.eventCount > view.refs.length ? (
						<p className={styles.note}>
							Showing {view.refs.length} of {view.eventCount} source events.
						</p>
					) : null}
					<ol className={listClassName}>
						{view.slots.map((slot) => (
							<li key={slot.eventId}>
								<SourceSlip source={slot} claimText={claim.text} />
							</li>
						))}
					</ol>
					{view.otherEvidence > 0 ? (
						<p className={styles.note}>
							Also rests on {view.otherEvidence} evidence item
							{view.otherEvidence === 1 ? "" : "s"} that are not source events.
						</p>
					) : null}
				</>
			)}
		</StatePanel>
	)
}
