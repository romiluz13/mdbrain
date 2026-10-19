import type { ReactNode } from "react"
import type { DescribedError } from "./describe-error.js"
import styles from "./workspace.module.css"
import { isEmptyValue } from "./values.js"

export type MarginRow = {
	label: string
	value?: ReactNode
	/** Always shown beside the record (as "not reported" when absent). Every
	 *  other row stays behind the "All fields" disclosure. */
	essential?: boolean
}

/** Provenance margin. Essential rows stay visible; every other row, reported
 *  or not, is behind the "All fields" disclosure. Fields the API did not return
 *  read "not reported". Nothing here is computed or inferred by the page. */
export function Margin({ rows, label }: { rows: MarginRow[]; label: string }) {
	const essential = rows.filter((row) => row.essential)
	const rest = rows.filter((row) => !row.essential)
	const reported = rest.filter((row) => !isEmptyValue(row.value))
	const unreported = rest.filter((row) => isEmptyValue(row.value))
	return (
		<div className={styles.margin}>
			<dl className={styles.marginEssential} aria-label={label}>
				{essential.map((row) => (
					<div key={row.label}>
						<dt>{row.label}</dt>
						<dd>
							{isEmptyValue(row.value) ? (
								<span className={styles.unreported}>not reported</span>
							) : (
								row.value
							)}
						</dd>
					</div>
				))}
			</dl>
			{rest.length > 0 ? (
				<details className={styles.marginAll}>
					<summary>
						All fields ({reported.length} reported, {unreported.length} not
						reported)
					</summary>
					<dl>
						{reported.map((row) => (
							<div key={row.label}>
								<dt>{row.label}</dt>
								<dd>{row.value}</dd>
							</div>
						))}
						{unreported.length > 0 ? (
							<div>
								<dt>not reported</dt>
								<dd className={styles.unreported}>
									{unreported.map((row) => row.label).join(", ")}
								</dd>
							</div>
						) : null}
					</dl>
				</details>
			) : null}
		</div>
	)
}

export function Entry({
	children,
	margin,
	marginLabel,
	fresh,
}: {
	children: ReactNode
	margin: MarginRow[]
	marginLabel: string
	fresh?: boolean
}) {
	return (
		<article className={`${styles.entry} ${fresh ? styles.fresh : ""}`}>
			<div className={styles.entryMain}>{children}</div>
			<Margin rows={margin} label={marginLabel} />
		</article>
	)
}

export function Tag({
	tone,
	children,
}: {
	tone: "ok" | "warn" | "bad"
	children: ReactNode
}) {
	const toneClass =
		tone === "ok"
			? styles.tagOk
			: tone === "warn"
				? styles.tagWarn
				: styles.tagBad
	return <span className={`${styles.tag} ${toneClass}`}>{children}</span>
}

export function Notice({
	tone = "info",
	title,
	children,
	live = tone === "bad" ? "alert" : "status",
}: {
	tone?: "info" | "ok" | "warn" | "bad"
	title: string
	children?: ReactNode
	live?: "alert" | "status"
}) {
	const toneClass =
		tone === "bad"
			? styles.noticeBad
			: tone === "warn"
				? styles.noticeWarn
				: tone === "ok"
					? styles.noticeOk
					: ""
	return (
		<div className={`${styles.notice} ${toneClass}`} role={live}>
			<strong>{title}</strong>
			{children ? <p>{children}</p> : null}
		</div>
	)
}

export function RawJson({ value, label }: { value: unknown; label: string }) {
	return (
		<details className={styles.raw}>
			<summary>{label}</summary>
			<pre>{JSON.stringify(value, null, 2)}</pre>
		</details>
	)
}

export function Empty({
	title,
	children,
}: {
	title: string
	children?: ReactNode
}) {
	return (
		<div className={styles.empty}>
			<strong>{title}</strong>
			{children ? <div>{children}</div> : null}
		</div>
	)
}

export function ErrorNotice({
	error,
	title,
	children,
}: {
	error: DescribedError
	title?: string
	children?: ReactNode
}) {
	const facts = [
		error.status ? `HTTP ${error.status}` : undefined,
		error.code,
	].filter(Boolean)
	return (
		<Notice
			live="alert"
			tone={
				error.kind === "unavailable" || error.kind === "throttled"
					? "warn"
					: "bad"
			}
			title={title ? `${title}: ${error.headline}` : error.headline}
		>
			{[error.detail, facts.length ? `(${facts.join(", ")})` : undefined]
				.filter(Boolean)
				.join(" ")}
			{children}
		</Notice>
	)
}
