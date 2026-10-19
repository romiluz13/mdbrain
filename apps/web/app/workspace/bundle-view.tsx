import type { MdbrainContextBundleResponse } from "@mdbrain/client"
import { Empty, Entry, Margin, type MarginRow, RawJson, Tag } from "./ledger.js"
import { flag, formatInstant, formatNumber, joinList } from "./values.js"
import styles from "./workspace.module.css"

export function BundleView({
	bundle,
	query,
}: {
	bundle: MdbrainContextBundleResponse
	query: string
}) {
	const metadata: Partial<MdbrainContextBundleResponse["metadata"]> =
		bundle.metadata ?? {}
	const rendered = bundle.rendered ?? ""
	const sections = bundle.sections ?? []
	const rows: MarginRow[] = [
		{
			label: "token budget",
			essential: true,
			value: formatNumber(metadata.tokenBudget),
		},
		{
			label: "estimated tokens used",
			essential: true,
			value: formatNumber(metadata.estimatedTokensUsed),
		},
		{ label: "paths executed", value: joinList(metadata.pathsExecuted) },
		{ label: "sections included", value: joinList(metadata.sectionsIncluded) },
		{ label: "built at", value: formatInstant(bundle.builtAt) },
		{
			label: "scope",
			value: bundle.scope
				? `${bundle.scope}/${bundle.scopeRef ?? "?"}`
				: undefined,
		},
	]
	return (
		<section className={styles.section} aria-label="Context bundle">
			<h4>Context bundle for “{query}”</h4>
			<p className={styles.hint}>
				The text below is the rendered context exactly as the API returned it.
			</p>
			<div className={styles.row}>
				{metadata.partial ? <Tag tone="warn">partial result</Tag> : null}
				{metadata.truncated ? <Tag tone="warn">truncated to budget</Tag> : null}
			</div>
			{rendered.trim() ? (
				<pre className={styles.rendered}>{rendered}</pre>
			) : (
				<Empty title="The rendered context is empty">
					The API built a bundle with no text for this query and scope.
				</Empty>
			)}
			<Margin rows={rows} label="Context bundle fields" />
			{sections.map((section) => (
				<Entry
					key={`${section.kind}-${section.title}`}
					marginLabel={`${section.title} fields`}
					margin={[
						{ label: "kind", essential: true, value: section.kind },
						{
							label: "estimated tokens",
							essential: true,
							value: formatNumber(section.estimatedTokens),
						},
						{
							label: "items",
							value: Array.isArray(section.items)
								? String(section.items.length)
								: undefined,
						},
						{ label: "partial", value: flag(section.partial) },
						{ label: "truncated", value: flag(section.truncated) },
					]}
				>
					<h4>{section.title}</h4>
					<p>{section.summary ?? "No section summary reported."}</p>
				</Entry>
			))}
			<RawJson value={bundle} label="Raw context bundle" />
		</section>
	)
}
