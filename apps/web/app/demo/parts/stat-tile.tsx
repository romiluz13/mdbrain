import styles from "../demo.module.css"

type Props = {
	label: string
	/** null reads as unavailable: the value could not be read. */
	value: number | string | null
	/** Which headline number this tile shows, for tests and the verify table. */
	stat: string
	tone?: "signal" | "ok"
}

export function StatTile({ label, value, stat, tone }: Props) {
	return (
		<div className={styles.tile} data-tone={tone}>
			<p className={styles.tileValue} data-stat={stat}>
				{value === null ? "—" : value}
			</p>
			<p className={styles.tileLabel}>{label}</p>
		</div>
	)
}
