"use client"

import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { GraphStage } from "../parts/graph-stage.js"
import { PageInspector } from "../parts/page-inspector.js"
import { StatTile } from "../parts/stat-tile.js"

export function BrainChapter() {
	const { data } = useDemo()
	const map = data.map.kind === "ready" ? data.map.data : null
	return (
		<>
			<div className={styles.tiles}>
				<StatTile label="Pages" stat="pages" value={map?.pageTotal ?? null} />
				<StatTile
					label="Claims"
					stat="claims"
					value={map?.claimTotal ?? null}
				/>
				<StatTile
					label="Source events cited"
					stat="sources"
					value={map?.sourceTotal ?? null}
				/>
				<StatTile
					label="Open contradictions"
					stat="contradictions"
					value={map?.unresolvedContradictionCount ?? null}
					tone="signal"
				/>
			</div>
			<div className={styles.workspace}>
				<GraphStage
					title="Wiki graph"
					caption="Each dot is a stored page, colored by its group. Rings mark pages that hold a contradicted claim."
				/>
				<PageInspector />
			</div>
		</>
	)
}
