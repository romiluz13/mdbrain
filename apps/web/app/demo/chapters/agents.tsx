"use client"

import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { StatePanel } from "../parts/state-panel.js"

export function AgentsChapter() {
	const { data } = useDemo()
	return (
		<section className={styles.panel} aria-labelledby="agents-heading">
			<h2 id="agents-heading">Agent activity</h2>
			<StatePanel state={data.agents} what="agent activity" />
			<p className={styles.note}>
				When agent activity is stored, this screen lists each agent, the pages
				it wrote, and the proposals it made. Until then it shows nothing rather
				than a guess.
			</p>
		</section>
	)
}
