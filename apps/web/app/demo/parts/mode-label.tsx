"use client"

import {
	type LeaseView,
	leaseLabel,
} from "../../../lib/demo-presenter/client.js"
import styles from "../modes.module.css"

/** Says which of the two views this is. The recorded view is the default for
 * every visitor; the live one exists only for the presenter who holds a slot. */
export function ModeLabel({
	lease,
}: {
	/** The presenter's lease: set when this page is live. */
	lease: LeaseView | null
}) {
	return lease ? (
		<p className={styles.modeBar} data-testid="live-label">
			<span className={styles.modeTag} data-mode="live">
				Live
			</span>
			<span className={styles.modeText}>
				{leaseLabel(lease)}. Every number here is read from this slot as its
				agents write.
			</span>
		</p>
	) : (
		<p className={styles.modeBar} data-testid="recorded-label">
			<span className={styles.modeTag} data-mode="recorded">
				Recorded
			</span>
			<span className={styles.modeText}>
				A completed run, played back.
				<span className={styles.modeWide}>
					{" "}
					Read from what it stored; visitors cannot change it.
				</span>
			</span>
		</p>
	)
}
