"use client"

import { governanceMix } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { ProposalReview } from "../parts/proposal-review.js"
import { StatePanel } from "../parts/state-panel.js"
import { StatTile } from "../parts/stat-tile.js"

function Bars({
	title,
	rows,
	total,
}: {
	title: string
	rows: Array<[string, number]>
	total: number
}) {
	return (
		<section className={styles.panel}>
			<h2>{title}</h2>
			<ul className={styles.bars}>
				{rows.map(([label, count]) => (
					<li key={label} data-bar={label}>
						<span>{label}</span>
						<span className={styles.barTrack} aria-hidden="true">
							<span
								className={styles.barFill}
								style={{ width: `${(count / total) * 100}%` }}
							/>
						</span>
						<span className={styles.mono}>{count}</span>
					</li>
				))}
			</ul>
		</section>
	)
}

export function GrowthChapter() {
	const { data, reload } = useDemo()
	return (
		<StatePanel state={data.map} what="the page list" onRetry={reload}>
			{(map) => {
				const mix = governanceMix(map)
				return (
					<>
						<div className={styles.tiles}>
							<StatTile
								label="Pages"
								singular="Page"
								stat="pages"
								value={map.pageTotal}
							/>
							<StatTile
								label="Trust tiers in use"
								singular="Trust tier in use"
								stat="tiers"
								value={mix.tiers.length}
							/>
							<StatTile
								label="Lifecycle states in use"
								singular="Lifecycle state in use"
								stat="states"
								value={mix.states.length}
							/>
							<StatTile
								label="Open contradictions"
								singular="Open contradiction"
								stat="contradictions"
								value={map.unresolvedContradictionCount}
								tone="signal"
							/>
						</div>
						<div className={styles.twoUp}>
							<Bars
								title="Pages by trust tier"
								rows={mix.tiers}
								total={map.pageTotal}
							/>
							<Bars
								title="Pages by lifecycle state"
								rows={mix.states}
								total={map.pageTotal}
							/>
						</div>
						<ProposalReview />
					</>
				)
			}}
		</StatePanel>
	)
}
