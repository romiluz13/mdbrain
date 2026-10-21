"use client"

import { governanceMix } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
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
						<section
							className={styles.boundary}
							aria-labelledby="queue-heading"
							data-testid="review-queue-boundary"
						>
							<h2 id="queue-heading">The review queue is private by design</h2>
							<p>
								A proposed page waits for a reviewer. Until it is approved no
								wiki read returns it, so this public demo cannot list what is
								pending, and it does not pretend to. What it can show is what
								governance already let in: the tiers and states above.
							</p>
						</section>
					</>
				)
			}}
		</StatePanel>
	)
}
