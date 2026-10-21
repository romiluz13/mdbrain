import styles from "../demo.module.css"

/** Said once for a section whose cards carry no business time of their own, so
 * the cards can stay quiet instead of repeating the statement on each one. */
export function BusinessTimeNote({ children }: { children: React.ReactNode }) {
	return (
		<p className={styles.timeNote} data-testid="business-time-note">
			{children}
		</p>
	)
}
