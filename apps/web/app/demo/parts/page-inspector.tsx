"use client"

import { useId } from "react"
import type { MdbrainWikiClaim } from "@mdbrain/client"
import { useDemo } from "../demo-context.js"
import { countOf } from "../../../lib/demo-data/plural.js"
import styles from "../graph.module.css"
import { CitationTrigger } from "./citation-trigger.js"
import { TimeLine } from "./time-line.js"

const CLAIMS_SHOWN = 5
const LINKS_SHOWN = 6
const STARTERS = 6

function claimLabel(claim: MdbrainWikiClaim): string {
	return claim.text.length > 48 ? `${claim.text.slice(0, 47)}…` : claim.text
}

/** Reads one stored page off the map. The picker is the keyboard and screen
 * reader path to every page; clicking a node on the map is the pointer path. */
export function PageInspector() {
	const { data, graph, pinned, pin, cite } = useDemo()
	const pickerId = useId()
	const map = data.map.kind === "ready" ? data.map.data : null
	const page = map?.pages.find((candidate) => candidate.slug === pinned)
	const group =
		graph && page
			? graph.groups.find(
					(g) => g.id === graph.nodes[graph.index.get(page.slug) ?? 0]?.group,
				)
			: undefined
	const starters = graph
		? [...graph.nodes]
				.sort((a, b) => b.degree - a.degree || a.slug.localeCompare(b.slug))
				.slice(0, STARTERS)
		: []

	return (
		<aside className={styles.inspector} aria-label="Page inspector">
			<h2>Inspect a page</h2>
			{graph ? (
				<div className={styles.picker}>
					<label htmlFor={pickerId}>Pick a page</label>
					<select
						id={pickerId}
						value={pinned ?? ""}
						onChange={(event) =>
							pin(event.target.value === "" ? null : event.target.value)
						}
					>
						<option value="">Choose a page…</option>
						{graph.groups.map((g) => (
							<optgroup key={g.id} label={g.label}>
								{graph.nodes
									.filter((node) => node.group === g.id)
									.map((node) => (
										<option key={node.slug} value={node.slug}>
											{node.title}
										</option>
									))}
							</optgroup>
						))}
					</select>
				</div>
			) : (
				<p className={styles.inspectorHint}>
					The page picker appears once the pages are read.
				</p>
			)}
			<div aria-live="polite" className={styles.inspectorBody}>
				{page ? (
					<article>
						<h3 className={styles.pageTitle}>{page.title}</h3>
						<p className={styles.pageMeta}>
							{group ? (
								<span>
									<span
										className={styles.swatch}
										style={{ background: group.color }}
										aria-hidden="true"
									/>
									{group.label}
								</span>
							) : null}
							<span>trust tier: {page.trustTier}</span>
							<span>state: {page.state}</span>
							<span>revision {page.revision}</span>
						</p>
						<p className={styles.pageMeta}>
							<span>{countOf(page.claimCount, "claim")}</span>
							<span>{countOf(page.links.length, "link")}</span>
						</p>
						<TimeLine
							kind="ingestion"
							iso={page.createdAt}
							note="first stored"
						/>
						<TimeLine
							kind="ingestion"
							iso={page.updatedAt}
							note="last updated"
						/>
						<TimeLine
							kind="business"
							iso={undefined}
							missingNote="missing on a page; each source carries its own"
						/>
						{page.links.length > 0 ? (
							<>
								<h4>Linked pages</h4>
								<ul className={styles.linkList}>
									{page.links.slice(0, LINKS_SHOWN).map((link) => {
										const target = map?.pages.find(
											(candidate) => candidate.slug === link.slug,
										)
										return target ? (
											<li key={`${link.slug}:${link.kind}`}>
												<button type="button" onClick={() => pin(target.slug)}>
													{target.title}
													<span className={styles.linkKind}>{link.kind}</span>
												</button>
											</li>
										) : null
									})}
								</ul>
							</>
						) : null}
						<h4>Claims</h4>
						{page.claims.length === 0 ? (
							<p className={styles.inspectorHint}>
								This page stores no claims.
							</p>
						) : (
							<ul className={styles.claimList}>
								{page.claims.slice(0, CLAIMS_SHOWN).map((claim) => (
									<li key={claim.id}>
										<p>{claim.text}</p>
										<p className={styles.claimMeta}>
											{claim.status} · confidence{" "}
											{Math.round(claim.confidence * 100)}%
										</p>
										<CitationTrigger
											claim={claim}
											label={`Open citation for: ${claimLabel(claim)}`}
											onOpen={(opener) =>
												cite(
													{
														claim,
														pageSlug: page.slug,
														pageTitle: page.title,
														revision: page.revision,
													},
													opener,
												)
											}
										/>
									</li>
								))}
							</ul>
						)}
					</article>
				) : (
					<>
						<p className={styles.inspectorHint}>
							Pick a page above, or click a dot on the map. Or start with the
							most connected pages.
						</p>
						<ul className={styles.linkList}>
							{starters.map((node) => (
								<li key={node.slug}>
									<button type="button" onClick={() => pin(node.slug)}>
										{node.title}
										<span className={styles.linkKind}>
											{countOf(node.degree, "link")}
										</span>
									</button>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
		</aside>
	)
}
