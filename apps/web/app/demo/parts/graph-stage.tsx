"use client"

import type { ReactNode } from "react"
import type { Graph } from "../../../lib/demo-data/views.js"
import type { DataState } from "../../../lib/demo-data/states.js"
import { useDemo } from "../demo-context.js"
import { countOf } from "../../../lib/demo-data/plural.js"
import styles from "../graph.module.css"
import { GraphCanvas } from "./graph-canvas.js"
import { GraphView } from "./graph-view.js"
import { StatePanel } from "./state-panel.js"

type Props = {
	title: string
	/** Pages to ring on the map: the ones the chapter is about. */
	highlight?: ReadonlySet<string>
	caption?: ReactNode
	compact?: boolean
	/** Stays in view beside a long list when the page has two columns. */
	sticky?: boolean
	/** Offers the 3D map where the device can carry it. The flat map is always
	 * there first, and stays as the fallback. */
	view3d?: boolean
	/** The pair of pages the 3D camera frames; null keeps the whole brain in view. */
	frame?: readonly [string, string] | null
}

const NONE: ReadonlySet<string> = new Set()

/** The graph stage every map chapter shares. Chapters that ask for `view3d`
 * get the 3D map over the flat one; the rest keep the flat map as it was. */
export function GraphStage({
	title,
	highlight = NONE,
	caption,
	compact,
	sticky,
	view3d,
	frame,
}: Props) {
	const { data, graph, layout, pinned, pin, reload } = useDemo()
	const ready = graph !== null && layout !== null
	return (
		<section
			className={styles.stage}
			data-compact={compact || undefined}
			data-sticky={sticky || undefined}
			aria-label={title}
		>
			<header className={styles.stageHead}>
				<h2>{title}</h2>
				{graph ? (
					<p>
						{countOf(graph.edges.length, "link")} between{" "}
						{countOf(graph.nodes.length, "page")}
					</p>
				) : null}
			</header>
			{ready ? (
				view3d ? (
					<GraphView
						graph={graph}
						layout={layout}
						highlight={highlight}
						pinned={pinned}
						onPin={pin}
						label={mapLabel(graph)}
						frame={frame}
					/>
				) : (
					<GraphCanvas
						graph={graph}
						layout={layout}
						highlight={highlight}
						pinned={pinned}
						onPin={pin}
						label={mapLabel(graph)}
					/>
				)
			) : (
				<StageState
					state={data.map}
					onRetry={reload}
					waitingForLayout={graph !== null}
					view3d={view3d}
				/>
			)}
			<div className={styles.legendSlot}>
				{graph ? <Legend graph={graph} /> : null}
			</div>
			{caption ? <p className={styles.stageCaption}>{caption}</p> : null}
		</section>
	)
}

const mapLabel = (graph: Graph) =>
	`Map of ${countOf(graph.nodes.length, "stored page")} in ${countOf(graph.groups.length, "group")}, ${countOf(graph.edges.length, "link")}. Use the page picker to read a page.`

function StageState({
	state,
	onRetry,
	waitingForLayout,
	view3d,
}: {
	state: DataState<unknown>
	onRetry: () => void
	waitingForLayout: boolean
	view3d?: boolean
}) {
	return (
		<div className={styles.stageState} data-view3d={view3d || undefined}>
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
