"use client"

import type { KeyboardEvent } from "react"
import styles from "../chapters.module.css"

/** Steps a walk-through one beat at a time. The ends say they are ends instead
 * of dropping out of the tab order, so focus is never lost on the last press. */
export function BeatStepper({
	labels,
	beat,
	onBeat,
}: {
	labels: readonly string[]
	beat: number
	onBeat: (beat: number) => void
}) {
	const last = labels.length - 1
	const step = (by: number) => {
		const next = Math.min(last, Math.max(0, beat + by))
		if (next !== beat) {
			onBeat(next)
		}
	}
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const by =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
		if (by !== 0) {
			event.preventDefault()
			step(by)
		}
	}
	return (
		<fieldset
			className={styles.stepper}
			aria-label="Walk through the contradiction"
			data-testid="beat-stepper"
			data-beat={beat}
		>
			<button
				type="button"
				className={styles.stepButton}
				aria-disabled={beat === 0}
				onClick={() => step(-1)}
				onKeyDown={onKeyDown}
			>
				← Previous beat
			</button>
			<p className={styles.beatStatus} role="status" data-testid="beat-status">
				Beat {beat + 1} of {labels.length} · {labels[beat]}
			</p>
			<button
				type="button"
				className={styles.stepButton}
				aria-disabled={beat === last}
				onClick={() => step(1)}
				onKeyDown={onKeyDown}
			>
				Next beat →
			</button>
		</fieldset>
	)
}
