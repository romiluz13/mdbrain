"use client"

import styles from "../modes.module.css"

/** Says which of the two views this is. The recorded view is the default for
 * every visitor; the live one exists only for the presenter who holds a slot. */
export function ModeLabel({
	live,
	slotIndex,
	name,
}: {
	live: boolean
	slotIndex?: number
	name?: string
}) {
	return live ? (
		<p className={styles.modeBar} data-testid="live-label">
			<span className={styles.modeTag} data-mode="live">
				Live
			</span>
			<span className={styles.modeText}>
				Slot {slotIndex}
				{name ? `, ${name}` : ""}. Every number here is read from this slot as
				its agents write.
			</span>
		</p>
	) : (
		<p className={styles.modeBar} data-testid="recorded-label">
			<span className={styles.modeTag} data-mode="recorded">
				Recorded
			</span>
			<span className={styles.modeText}>
				Playback of a completed run, read from what it stored. Visitors watch;
				they cannot change it.
			</span>
		</p>
	)
}
