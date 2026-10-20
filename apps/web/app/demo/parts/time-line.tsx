import { formatUtc } from "../../../lib/demo-data/views.js"
import styles from "../demo.module.css"

type Props = {
	kind: "ingestion" | "business"
	iso: string | undefined
	/** What the instant is, after the clock's name: "first stored". */
	note?: string
}

const LABEL = {
	ingestion: "Ingestion time",
	business: "Business time",
} as const

/** One of the two clocks, always named. Ingestion time is when mdbrain stored
 * something; business time is when the source says it happened. A missing
 * business time is stated, not hidden or invented. */
export function TimeLine({ kind, iso, note }: Props) {
	const missing = iso === undefined || formatUtc(iso) === "unknown"
	return (
		<span
			className={styles.time}
			data-time-kind={kind}
			data-missing={missing || undefined}
		>
			<span className={styles.timeKind}>
				{note ? `${LABEL[kind]} · ${note}` : LABEL[kind]}
			</span>
			{missing ? (
				<span>
					{kind === "business" ? "missing in this source" : "unknown"}
				</span>
			) : (
				<time dateTime={iso}>{formatUtc(iso)}</time>
			)}
		</span>
	)
}
