"use client"

import type { ReactNode } from "react"
import type { Graph } from "../../../lib/demo-data/views.js"
import type { DataState } from "../../../lib/demo-data/states.js"
import { useDemo } from "../demo-context.js"
import styles from "../graph.module.css"
import { GraphCanvas } from "./graph-canvas.js"
import { StatePanel } from "./state-panel.js"

type Props = {
	title: string
	/** Pages to ring on the map: the ones the chapter is about. */
	highlight?: ReadonlySet<string>
	caption?: ReactNode
	compact?: boolean
}

const NONE: ReadonlySet<string> = new Set()

/** The graph stage every map chapter shares. Ticket 13 swaps the body of this
 * component for the 3D renderer; the props are the seam. */
export function GraphStage({
	title,
	highlight = NONE,
	caption,
	compact,
}: Props) {
	const { data, graph, layout, pinned, pin, reload } = useDemo()
	const ready = graph !== null && layout !== null
	return (
		<section
			className={styles.stage}
			data-compact={compact || undefined}
			aria-label={title}
		>
			<header className={styles.stageHead}>
				<h2>{title}</h2>
				{graph ? (
					<p>
						{graph.edges.length} links between {graph.nodes.length} pages
					</p>
				) : null}
			</header>
			{ready ? (
				<GraphCanvas
					graph={graph}
					layout={layout}
					highlight={highlight}
					pinned={pinned}
					onPin={pin}
					label={`Map of ${graph.nodes.length} stored pages in ${graph.groups.length} groups, ${graph.edges.length} links. Use the page picker to read a page.`}
				/>
			) : (
				<StageState
					state={data.map}
					onRetry={reload}
					waitingForLayout={graph !== null}
				/>
			)}
			{graph ? <Legend graph={graph} /> : null}
			{caption ? <p className={styles.stageCaption}>{caption}</p> : null}
		</section>
	)
}

function StageState({
	state,
	onRetry,
	waitingForLayout,
}: {
	state: DataState<unknown>
	onRetry: () => void
	waitingForLayout: boolean
}) {
	return (
		<div className={styles.stageState}>
			{waitingForLayout ? (
				<StatePanel state={{ kind: "loading" }} what="the page layout" />
			) : (
				<StatePanel state={state} what="the page list" onRetry={onRetry} />
			)}
		</div>
	)
}

function Legend({ graph }: { graph: Graph }) {
	return (
		<ul className={styles.legend} aria-label="Page groups">
			{graph.groups.map((group) => (
				<li key={group.id}>
					<span
						className={styles.swatch}
						style={{ background: group.color }}
						aria-hidden="true"
					/>
					{group.label}
					<span className={styles.legendCount}>{group.count}</span>
				</li>
			))}
		</ul>
	)
}
