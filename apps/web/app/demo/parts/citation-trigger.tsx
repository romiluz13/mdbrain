"use client"

import type { MdbrainWikiClaim } from "@mdbrain/client"
import styles from "../citation.module.css"

/** Opens a claim's citation. The claim's own marker is the control, so the page
 * shows what is being cited instead of one more labeled button under every
 * claim. The accessible name says what the control does and for which claim. */
export function CitationTrigger({
	claim,
	label,
	onOpen,
}: {
	claim: MdbrainWikiClaim
	label: string
	onOpen: (opener: HTMLButtonElement) => void
}) {
	return (
		<button
			type="button"
			className={styles.trigger}
			aria-label={label}
			onClick={(event) => onOpen(event.currentTarget)}
		>
			{claim.marker ?? "Open citation"}
		</button>
	)
}
