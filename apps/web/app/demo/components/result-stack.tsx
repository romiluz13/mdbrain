import type { DemoDocument } from "../../../lib/marketing/demo-scenario.js"
import styles from "../demo.module.css"

type ResultStackProps = {
	documents: readonly DemoDocument[]
	mode: "baseline" | "autopsy"
}

function dispositionLabel(document: DemoDocument) {
	if (document.disposition === "accepted") return "Keep"
	if (document.disposition === "expanded") return "Connected"
	if (document.disposition === "flagged") return "Review"
	return "Discard"
}

export function ResultStack({ documents, mode }: ResultStackProps) {
	const rankedDocuments = documents
		.filter((document) => document.score !== undefined)
		.sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
	const connectedDocuments = documents.filter(
		(document) => document.disposition === "expanded",
	)
	const visibleDocuments =
		mode === "baseline"
			? rankedDocuments.slice(0, 3)
			: [...rankedDocuments, ...connectedDocuments]

	return (
		<ol className={styles.resultStack} aria-label="Retrieved evidence">
			{visibleDocuments.map((document, index) => (
				<li
					className={styles.resultCard}
					data-disposition={
						mode === "baseline" ? "unexamined" : document.disposition
					}
					key={document.id}
				>
					<div className={styles.resultRank}>
						<span>{String(index + 1).padStart(2, "0")}</span>
						{document.score !== undefined && (
							<small>{document.score.toFixed(2)} similarity</small>
						)}
					</div>
					<div className={styles.resultBody}>
						<div className={styles.resultMeta}>
							<span>{document.kind}</span>
							<span>{document.state}</span>
							<span>{document.freshness}</span>
							<span>{document.access}</span>
						</div>
						<h3>{document.title}</h3>
						<p>{document.excerpt}</p>
						{mode === "autopsy" && <small>{document.reason}</small>}
					</div>
					{mode === "autopsy" && (
						<strong className={styles.disposition}>
							{dispositionLabel(document)}
						</strong>
					)}
				</li>
			))}
		</ol>
	)
}
