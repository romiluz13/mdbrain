"use client"

import { useRef } from "react"
import styles from "../demo.module.css"
import { useCountUp } from "../motion/use-count-up.js"

type Props = {
	label: string
	/** The label when the value is exactly one. */
	singular?: string
	/** null reads as unavailable: the value could not be read. */
	value: number | string | null
	/** Which headline number this tile shows, for tests and the verify table. */
	stat: string
	tone?: "signal" | "ok"
}

export function StatTile({ label, singular, value, stat, tone }: Props) {
	const figure = useRef<HTMLParagraphElement>(null)
	useCountUp(figure, value)
	return (
		<div className={styles.tile} data-tone={tone}>
			<p ref={figure} className={styles.tileValue} data-stat={stat}>
				{value === null ? "—" : value}
			</p>
			<p className={styles.tileLabel}>
				{value === 1 && singular ? singular : label}
			</p>
		</div>
	)
}
