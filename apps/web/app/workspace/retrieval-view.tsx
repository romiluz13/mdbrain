import type { MdbrainSearchDetailedResponse } from "@mdbrain/client"
import {
	Empty,
	Entry,
	Margin,
	type MarginRow,
	Notice,
	RawJson,
} from "./ledger.js"
import {
	flag,
	formatInstant,
	formatNumber,
	isEmptyValue,
	joinList,
} from "./values.js"
import styles from "./workspace.module.css"

type Result = MdbrainSearchDetailedResponse["results"][number]

function resultMargin(result: Result): MarginRow[] {
	const trust = result.trust
	const rows: MarginRow[] = [
		{ label: "score", essential: true, value: formatNumber(result.score) },
		{ label: "source", essential: true, value: result.source },
		{ label: "canonical id", essential: true, value: result.canonicalId },
		{
			label: "scope",
			essential: true,
			value: result.scope
				? `${result.scope}/${result.scopeRef ?? "?"}`
				: undefined,
		},
		{ label: "state", value: result.state },
		{ label: "valid from", value: formatInstant(result.validFrom) },
		{ label: "valid to", value: formatInstant(result.validTo) },
		{ label: "last confirmed", value: formatInstant(result.lastConfirmedAt) },
		{ label: "review at", value: formatInstant(result.reviewAt) },
		{ label: "timestamp", value: formatInstant(result.timestamp) },
		{ label: "session id", value: result.sessionId },
		{ label: "source events", value: joinList(result.sourceEventIds) },
		{
			label: "source reliability",
			value: formatNumber(result.sourceReliability),
		},
		{ label: "reinforcements", value: formatNumber(result.reinforcementCount) },
		{
			label: "provenance",
			value: isEmptyValue(result.provenance)
				? undefined
				: JSON.stringify(result.provenance),
		},
	]
	if (!trust) {
		rows.push({ label: "trust", essential: true, value: undefined })
		return rows
	}
	rows.push(
		{ label: "trust score", value: formatNumber(trust.score) },
		{ label: "trust confidence", essential: true, value: trust.confidence },
		{ label: "exactness", value: trust.exactness },
		{ label: "freshness", value: trust.freshness },
		{ label: "contradiction", value: trust.contradiction },
		{ label: "scope match", value: trust.scopeMatch },
		{ label: "provenance density", value: trust.provenance },
		{ label: "source diversity", value: trust.sourceDiversity },
		{ label: "trust factors", value: joinList(trust.factors) },
	)
	return rows
}

export function RetrievalView({
	response,
	query,
}: {
	response: MdbrainSearchDetailedResponse
	query: string
}) {
	const results = response.results ?? []
	const metadata: Partial<MdbrainSearchDetailedResponse["metadata"]> =
		response.metadata ?? {}
	return (
		<div role="status" aria-label="Retrieval results">
			{metadata.throttled ? (
				<Notice tone="warn" title="Retrieval was throttled">
					The API asked to retry after {metadata.throttled.retryAfterMs} ms.
					These results may be incomplete.
				</Notice>
			) : null}
			{results.length === 0 ? (
				<Empty title={`No evidence returned for “${query}”`}>
					The retrieval ran and returned zero results.
					{metadata.noDirectEvidenceReason
						? ` Reason reported by the API: ${metadata.noDirectEvidenceReason}`
						: " The API gave no reason."}
				</Empty>
			) : (
				results.map((result, index) => (
					<Entry
						// biome-ignore lint/suspicious/noArrayIndexKey: results may lack ids; the list is replaced wholesale on each request.
						key={`${result.canonicalId ?? result.path}-${index}`}
						marginLabel={`Evidence ${index + 1} fields`}
						margin={resultMargin(result)}
					>
						<p className={styles.body}>{result.snippet}</p>
						<p className={styles.hint}>
							<span className={styles.mono}>
								{result.path}:{result.startLine}-{result.endLine}
							</span>
						</p>
					</Entry>
				))
			)}
			<Report metadata={metadata} />
			<RawJson value={response} label="Raw retrieval response" />
		</div>
	)
}

function Report({
	metadata,
}: {
	metadata: Partial<MdbrainSearchDetailedResponse["metadata"]>
}) {
	const summary = metadata.trustSummary
	const rows: MarginRow[] = [
		{ label: "mode", essential: true, value: metadata.mode },
		{ label: "classification", value: metadata.classification },
		{
			label: "evidence coverage",
			essential: true,
			value: metadata.evidenceCoverage,
		},
		{
			label: "paths executed",
			essential: true,
			value: joinList(metadata.pathsExecuted),
		},
		{ label: "query rewritten", value: flag(metadata.queryRewritten) },
		{ label: "reranked", value: flag(metadata.reranked) },
		{
			label: "constraints applied",
			value: joinList(metadata.constraintsApplied),
		},
		{
			label: "results rejected",
			value: Array.isArray(metadata.resultsRejected)
				? String(metadata.resultsRejected.length)
				: undefined,
		},
		{
			label: "trust summary",
			value: summary
				? `confidence ${summary.topConfidence ?? "none"}, contradictions ${summary.contradictionCount}, stale ${summary.staleCount}, exact ${summary.exactCount}`
				: undefined,
		},
	]
	return (
		<section className={styles.section} aria-label="Retrieval report">
			<h4>Retrieval report as returned</h4>
			<Margin rows={rows} label="Retrieval report fields" />
			{metadata.passes?.length ? (
				<ol className={styles.passes}>
					{metadata.passes.map((pass) => (
						<li key={pass.pass}>
							Pass {pass.pass}: {pass.resultCount} results from{" "}
							{joinList(pass.pathsExecuted) ?? "no reported path"}. Reason
							given: {pass.reason || "none"}
						</li>
					))}
				</ol>
			) : null}
			{metadata.resultsRejected?.length ? (
				<ul className={styles.passes}>
					{metadata.resultsRejected.map((rejected, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: rejected entries may lack ids; the list is static per response.
							key={`${rejected.canonicalId ?? rejected.path ?? "r"}-${index}`}
						>
							Rejected {rejected.canonicalId ?? rejected.path ?? "a result"}:{" "}
							{rejected.reason}
						</li>
					))}
				</ul>
			) : null}
		</section>
	)
}
