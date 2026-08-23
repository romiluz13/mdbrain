"use client"

import { useState } from "react"
import { demoScenario } from "../../../lib/marketing/demo-scenario.js"
import styles from "../demo.module.css"

export function ContextBundle() {
	const [view, setView] = useState<"readable" | "json">("readable")
	const { answer } = demoScenario

	return (
		<section className={styles.bundle} aria-labelledby="bundle-heading">
			<header className={styles.bundleHeader}>
				<div>
					<p>Agent delivery</p>
					<h3 id="bundle-heading">Inspectable context bundle</h3>
				</div>
				<fieldset className={styles.viewToggle}>
					<legend className={styles.visuallyHidden}>Context bundle view</legend>
					<button
						aria-pressed={view === "readable"}
						onClick={() => setView("readable")}
						type="button"
					>
						Human view
					</button>
					<button
						aria-pressed={view === "json"}
						onClick={() => setView("json")}
						type="button"
					>
						JSON
					</button>
				</fieldset>
			</header>

			{view === "readable" ? (
				<div className={styles.bundleReadable}>
					<div className={styles.answerText}>
						<span>Answer</span>
						<p>{answer.text}</p>
					</div>
					<div className={styles.signalGrid}>
						{answer.signals.map((signal) => (
							<div data-tone={signal.tone} key={signal.label}>
								<span>{signal.label}</span>
								<strong>{signal.value}</strong>
								<small>{signal.detail}</small>
							</div>
						))}
					</div>
					<div className={styles.citationList}>
						<span>Citations</span>
						{answer.citations.map((citation) => {
							const document = demoScenario.documents.find(
								(item) => item.id === citation,
							)
							return document ? (
								<code key={citation}>{document.title}</code>
							) : null
						})}
					</div>
				</div>
			) : (
				<section
					className={styles.bundleJson}
					aria-labelledby="bundle-json-heading"
					// A scrollable code region must be keyboard focusable.
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Enables keyboard scrolling.
					tabIndex={0}
				>
					<h4 className={styles.visuallyHidden} id="bundle-json-heading">
						Representative context bundle JSON
					</h4>
					<pre>
						<code>{JSON.stringify(answer.contextBundle, null, 2)}</code>
					</pre>
				</section>
			)}
		</section>
	)
}
