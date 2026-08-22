"use client"

import { useState } from "react"
import type { CSSProperties } from "react"
import type { ArchitectureStage } from "../../lib/marketing/architecture.js"
import styles from "../landing.module.css"

type SystemAtlasProps = {
	stages: ArchitectureStage[]
}

const positions: Record<
	ArchitectureStage["id"],
	{ x: number; y: number; short: string }
> = {
	sources: { x: 16, y: 20, short: "Sources" },
	api: { x: 50, y: 8, short: "Identity" },
	wiki: { x: 84, y: 24, short: "Wiki" },
	memory: { x: 86, y: 74, short: "Memory" },
	mongodb: { x: 50, y: 91, short: "MongoDB" },
	context: { x: 14, y: 72, short: "Context" },
}

export function SystemAtlas({ stages }: SystemAtlasProps) {
	const [activeId, setActiveId] = useState<ArchitectureStage["id"]>("mongodb")
	const activeStage = stages.find((stage) => stage.id === activeId) ?? stages[0]

	return (
		<div className={styles.atlas}>
			<section
				className={styles.atlasMap}
				aria-label="Interactive map of the MDBrain architecture"
			>
				<svg
					className={styles.atlasLines}
					viewBox="0 0 100 100"
					aria-hidden="true"
				>
					<title>Knowledge moves through six connected system stages</title>
					<circle cx="50" cy="50" r="31" />
					<circle cx="50" cy="50" r="18" />
					<path d="M16 20 L50 8 L84 24 L86 74 L50 91 L14 72 Z" />
					<path d="M16 20 L50 50 L50 8 M84 24 L50 50 L86 74 M50 91 L50 50 L14 72" />
				</svg>

				<div className={styles.atlasCore} aria-hidden="true">
					<span>living</span>
					<strong>context</strong>
					<small>with receipts</small>
				</div>

				{stages.map((stage) => {
					const position = positions[stage.id]
					const customProperties = {
						"--atlas-x": `${position.x}%`,
						"--atlas-y": `${position.y}%`,
					} as CSSProperties

					return (
						<button
							className={styles.atlasNode}
							data-active={stage.id === activeId}
							key={stage.id}
							onClick={() => setActiveId(stage.id)}
							onFocus={() => setActiveId(stage.id)}
							style={customProperties}
							type="button"
							aria-pressed={stage.id === activeId}
						>
							<span>{stage.label.slice(0, 2)}</span>
							<strong>{position.short}</strong>
						</button>
					)
				})}
			</section>

			<div className={styles.atlasDetail} aria-live="polite">
				<p className={styles.microLabel}>{activeStage.label}</p>
				<h2>{activeStage.title}</h2>
				<p>{activeStage.description}</p>
				<div className={styles.atlasEvidence}>
					<span>{activeStage.capability}</span>
					<a href={activeStage.source.href}>
						{activeStage.source.label}
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M5 3h8v8M13 3 3 13" />
						</svg>
					</a>
				</div>
			</div>
		</div>
	)
}
