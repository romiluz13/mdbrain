"use client"

import { useState } from "react"
import {
	loadWikiMap,
	type WikiMapView,
} from "../../../lib/demo-data/loaders.js"
import type { DataState } from "../../../lib/demo-data/states.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { StatePanel } from "../parts/state-panel.js"

type Row = {
	stat: string
	label: string
	how: string
	pick: (map: WikiMapView) => number
}

const ROWS: Row[] = [
	{
		stat: "pages",
		label: "Pages",
		how: "GET /api/demo/v1/wiki?limit=100&skip=0 — the total field",
		pick: (m) => m.pageTotal,
	},
	{
		stat: "claims",
		label: "Claims",
		how: "the same page list — the claims of every page, added up",
		pick: (m) => m.claimTotal,
	},
	{
		stat: "sources",
		label: "Source events cited",
		how: "the same page list — the distinct event sources in every claim's evidence",
		pick: (m) => m.sourceTotal,
	},
	{
		stat: "contradictions",
		label: "Open contradictions",
		how: "GET /api/demo/v1/wiki/lint?limit=100 — the unresolved records",
		pick: (m) => m.unresolvedContradictionCount,
	},
]

export function RunChapter() {
	const { data, upstream, reload } = useDemo()
	const [again, setAgain] = useState<DataState<WikiMapView> | null>(null)
	const shown = data.map.kind === "ready" ? data.map.data : null

	const recheck = async () => {
		setAgain({ kind: "loading" })
		setAgain(await loadWikiMap(upstream))
	}

	return (
		<>
			<section className={styles.panel} aria-labelledby="verify-heading">
				<h2 id="verify-heading">Verify the numbers yourself</h2>
				<p className={styles.note}>
					Each number below was read from the stored brain. The button reads it
					all again and compares.
				</p>
				<StatePanel
					state={data.map}
					what="the headline numbers"
					onRetry={reload}
				>
					{() => (
						<table className={styles.verify}>
							<thead>
								<tr>
									<th scope="col">Number</th>
									<th scope="col">On screen</th>
									<th scope="col">Read again</th>
									<th scope="col">Where it comes from</th>
								</tr>
							</thead>
							<tbody>
								{ROWS.map((row) => {
									const onScreen = shown ? row.pick(shown) : null
									const reread =
										again?.kind === "ready" ? row.pick(again.data) : null
									return (
										<tr key={row.stat} data-verify={row.stat}>
											<th scope="row">{row.label}</th>
											<td data-stat={`verify-${row.stat}`}>{onScreen}</td>
											<td data-reread={row.stat}>
												{again === null
													? "not read again yet"
													: again.kind === "loading"
														? "reading…"
														: reread === null
															? "could not be read"
															: `${reread} ${reread === onScreen ? "(matches)" : "(differs)"}`}
											</td>
											<td className={styles.how}>{row.how}</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					)}
				</StatePanel>
				<button
					type="button"
					className={styles.button}
					onClick={() => void recheck()}
					disabled={again?.kind === "loading"}
				>
					Read everything again
				</button>
			</section>
			<section className={styles.panel} aria-labelledby="run-id-heading">
				<h2 id="run-id-heading">Which run is this?</h2>
				<StatePanel
					state={data.sources}
					what="the run manifest"
					onRetry={reload}
				/>
				<p className={styles.note}>
					The proxy pins one seeded run on the server, so the run id and its
					scope never reach this page. The page can only show what it read,
					which is why each number above names the read behind it.
				</p>
			</section>
		</>
	)
}
