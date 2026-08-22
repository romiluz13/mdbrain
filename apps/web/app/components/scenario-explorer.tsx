"use client"

import { useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import type { ProofScenario } from "../../lib/marketing/architecture.js"
import styles from "../landing.module.css"

type ScenarioExplorerProps = {
	scenarios: ProofScenario[]
}

export function ScenarioExplorer({ scenarios }: ScenarioExplorerProps) {
	const [activeId, setActiveId] = useState<ProofScenario["id"]>("supersession")
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
	const activeScenario =
		scenarios.find((scenario) => scenario.id === activeId) ?? scenarios[0]

	function selectTab(index: number) {
		const nextIndex = (index + scenarios.length) % scenarios.length
		const nextScenario = scenarios[nextIndex]

		setActiveId(nextScenario.id)
		tabRefs.current[nextIndex]?.focus()
	}

	function handleTabKeyDown(
		event: KeyboardEvent<HTMLButtonElement>,
		index: number,
	) {
		const keyOffsets: Partial<Record<KeyboardEvent["key"], number>> = {
			ArrowLeft: -1,
			ArrowUp: -1,
			ArrowRight: 1,
			ArrowDown: 1,
		}
		const offset = keyOffsets[event.key]

		if (offset !== undefined) {
			event.preventDefault()
			selectTab(index + offset)
			return
		}
		if (event.key === "Home" || event.key === "End") {
			event.preventDefault()
			selectTab(event.key === "Home" ? 0 : scenarios.length - 1)
		}
	}

	return (
		<div className={styles.scenarioExplorer}>
			<div
				className={styles.scenarioTabs}
				role="tablist"
				aria-label="Proof scenarios"
			>
				{scenarios.map((scenario, index) => (
					<button
						aria-controls={`scenario-${scenario.id}`}
						aria-selected={activeScenario.id === scenario.id}
						className={styles.scenarioTab}
						id={`scenario-tab-${scenario.id}`}
						key={scenario.id}
						onClick={() => setActiveId(scenario.id)}
						onKeyDown={(event) => handleTabKeyDown(event, index)}
						ref={(element) => {
							tabRefs.current[index] = element
						}}
						role="tab"
						tabIndex={activeScenario.id === scenario.id ? 0 : -1}
						type="button"
					>
						<span>{scenario.label}</span>
						<strong>{scenario.title}</strong>
					</button>
				))}
			</div>

			<article
				aria-labelledby={`scenario-tab-${activeScenario.id}`}
				className={styles.scenarioPanel}
				id={`scenario-${activeScenario.id}`}
				role="tabpanel"
			>
				<div>
					<p className={styles.microLabel}>Observe the behavior</p>
					<h3>{activeScenario.title}</h3>
					<p>{activeScenario.summary}</p>
				</div>
				<ol className={styles.scenarioSteps}>
					{activeScenario.steps.map((step, index) => (
						<li key={step}>
							<span>{String(index + 1).padStart(2, "0")}</span>
							<p>{step}</p>
						</li>
					))}
				</ol>
				<footer className={styles.scenarioFooter}>
					<span>{activeScenario.mongodb}</span>
					<a href={activeScenario.source.href}>
						Inspect the test
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M5 3h8v8M13 3 3 13" />
						</svg>
					</a>
				</footer>
			</article>
		</div>
	)
}
