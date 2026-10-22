"use client"

import type { MdbrainWikiClaim } from "@mdbrain/client"
import { countOf, nonEventEvidence } from "../../../lib/demo-data/plural.js"
import styles from "../citation.module.css"
import { useClaimSources } from "../use-claim-sources.js"
import { SourceSlip } from "./source-slip.js"
import { StatePanel } from "./state-panel.js"

/** What to say of a claim that names no source event: that it stores none, as a
 * plain fact about the claim, not as something still to come. */
function noSource(claim: MdbrainWikiClaim): { title: string; note: string } {
	const other = claim.evidence.length
	if (other === 0) {
		return {
			title: "No stored source",
			note: "This claim is stored with no evidence, so there is no source to read behind it. Nothing is shown here in its place.",
		}
	}
	return {
		title: "No source event",
		note: `This claim rests on ${nonEventEvidence(other)}, so there is no source event to read for it. Nothing is shown here in its place.`,
	}
}

/** The events a claim rests on, each shown the moment its own cite returns. */
export function ClaimSources({
	claim,
	listClassName,
}: {
	claim: MdbrainWikiClaim
	listClassName: string
}) {
	const state = useClaimSources(claim)
	const none = noSource(claim)
	return (
		<StatePanel
			state={state}
			what="the cited sources"
			emptyTitle={none.title}
			emptyNote={none.note}
		>
			{(view) => (
				<>
					{view.eventCount > view.refs.length ? (
						<p className={styles.note}>
							Showing {view.refs.length} of{" "}
							{countOf(view.eventCount, "source event")}.
						</p>
					) : null}
					<ol className={listClassName}>
						{view.slots.map((slot) => (
							<li
								key={slot.eventId}
								data-testid="claim-slip"
								data-motion="claim-slip"
							>
								<SourceSlip source={slot} claimText={claim.text} />
							</li>
						))}
					</ol>
					{view.otherEvidence > 0 ? (
						<p className={styles.note}>
							Also rests on {nonEventEvidence(view.otherEvidence)}.
						</p>
					) : null}
				</>
			)}
		</StatePanel>
	)
}
