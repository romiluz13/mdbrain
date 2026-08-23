"use client"

import { useRef, useState } from "react"
import { demoScenario } from "../../../lib/marketing/demo-scenario.js"
import styles from "../demo.module.css"
import { ContextBundle } from "./context-bundle.js"
import { ResultStack } from "./result-stack.js"

const stages = [
	{ id: "idle", label: "Ask" },
	{ id: "baseline", label: "Fail" },
	{ id: "autopsy", label: "Autopsy" },
	{ id: "pipeline", label: "Retrieve" },
	{ id: "answer", label: "Trust" },
] as const

type DemoStage = (typeof stages)[number]["id"]

const stageHeadings: Record<DemoStage, string> = {
	idle: "A normal question. Five pieces of company truth.",
	baseline: "The confident answer",
	autopsy: "Open the retrieval autopsy",
	pipeline: "Run the same question through MDBrain",
	answer: "The answer your agent can inspect",
}

export function RetrievalAutopsy() {
	const [stage, setStage] = useState<DemoStage>("idle")
	const [runId, setRunId] = useState(0)
	const panelRef = useRef<HTMLElement>(null)
	const stageIndex = stages.findIndex((item) => item.id === stage)

	function goTo(nextStage: DemoStage) {
		setStage(nextStage)
		panelRef.current?.focus()
	}

	function goBack() {
		goTo(stages[Math.max(0, stageIndex - 1)].id)
	}

	function goForward() {
		goTo(stages[Math.min(stages.length - 1, stageIndex + 1)].id)
	}

	function restart() {
		setRunId((current) => current + 1)
		goTo("idle")
	}

	return (
		<section className={styles.autopsy} aria-label="Guided retrieval autopsy">
			<div className={styles.demoChrome}>
				<div className={styles.chromeIdentity}>
					<span className={styles.pulseDot} aria-hidden="true" />
					<div>
						<strong>Retrieval Autopsy</strong>
						<small>{demoScenario.company} / synthetic workspace</small>
					</div>
				</div>
				<div className={styles.demoUtilities}>
					<span>{demoScenario.mode}</span>
					<button onClick={() => goTo("answer")} type="button">
						Skip to answer
					</button>
					<button onClick={restart} type="button">
						Restart
					</button>
				</div>
			</div>

			<nav className={styles.progress} aria-label="Demo progress">
				{stages.map((item, index) => (
					<button
						aria-current={stage === item.id ? "step" : undefined}
						className={styles.progressStep}
						data-complete={index < stageIndex}
						key={item.id}
						onClick={() => goTo(item.id)}
						type="button"
					>
						<span>{String(index + 1).padStart(2, "0")}</span>
						<strong>{item.label}</strong>
					</button>
				))}
			</nav>

			<div className={styles.stageStatus} aria-live="polite" aria-atomic="true">
				Stage {stageIndex + 1} of {stages.length}: {stageHeadings[stage]}
			</div>

			<section
				className={styles.stagePanel}
				ref={panelRef}
				tabIndex={-1}
				aria-labelledby={`demo-stage-${stage}`}
			>
				<div className={styles.stage} hidden={stage !== "idle"}>
					<div className={styles.stageIntro}>
						<p className={styles.stageEyebrow}>01 / Ask</p>
						<h2 id="demo-stage-idle">{stageHeadings.idle}</h2>
						<p>
							A developer needs one implementation decision and one owner. The
							answer is scattered across five records with different lifecycle
							and access states.
						</p>
					</div>
					<blockquote className={styles.queryCard}>
						<span>Developer → coding agent</span>
						<p>“{demoScenario.question}”</p>
						<footer>
							<code>workspace:northstar-engineering</code>
							<code>role:developer</code>
						</footer>
					</blockquote>
					<div className={styles.corpusStrip}>
						{demoScenario.documents.map((document) => (
							<div key={document.id}>
								<span>{document.kind}</span>
								<strong>{document.title}</strong>
								<small>unknown to the agent</small>
							</div>
						))}
					</div>
				</div>

				<div className={styles.stage} hidden={stage !== "baseline"}>
					<div className={styles.stageIntro}>
						<p className={styles.stageEyebrow}>02 / Fail</p>
						<h2 id="demo-stage-baseline">{stageHeadings.baseline}</h2>
						<p>
							The highest similarity score wins. It sounds precise, includes a
							citation, and sends the developer toward retired infrastructure.
						</p>
					</div>
					<div className={styles.baselineGrid}>
						<article className={styles.wrongAnswer}>
							<header>
								<span>Agent response</span>
								<strong>Confidence: high</strong>
							</header>
							<p>{demoScenario.baseline.answer}</p>
							<footer>
								Cited:{" "}
								{
									demoScenario.documents.find(
										(document) =>
											document.id === demoScenario.baseline.citationId,
									)?.title
								}
							</footer>
						</article>
						<ResultStack documents={demoScenario.documents} mode="baseline" />
					</div>
					<p className={styles.dangerLine}>
						Your agent did not fail by returning nothing. It failed by returning
						the wrong thing with confidence.
					</p>
				</div>

				<div className={styles.stage} hidden={stage !== "autopsy"}>
					<div className={styles.stageIntro}>
						<p className={styles.stageEyebrow}>03 / Autopsy</p>
						<h2 id="demo-stage-autopsy">{stageHeadings.autopsy}</h2>
						<p>
							Similarity answered “does this sound related?” It never asked “is
							this current, permitted, connected, and safe to use?”
						</p>
					</div>
					<ResultStack documents={demoScenario.documents} mode="autopsy" />
					<div className={styles.autopsyFinding}>
						<span>Cause of failure</span>
						<div>
							<p>{demoScenario.baseline.diagnosis}</p>
							<p>
								A governed lifecycle operation recorded the v1 runbook as
								superseded before this retrieval began.
							</p>
							<a href={demoScenario.lifecycleSource.href}>
								{demoScenario.lifecycleSource.label} ↗
							</a>
						</div>
					</div>
				</div>

				<div className={styles.stage} hidden={stage !== "pipeline"}>
					<div className={styles.stageIntro}>
						<p className={styles.stageEyebrow}>04 / Retrieve</p>
						<h2 id="demo-stage-pipeline">{stageHeadings.pipeline}</h2>
						<p>
							One retrieval path changes which evidence is eligible before it
							changes how evidence is ranked.
						</p>
					</div>
					<ol className={styles.pipeline}>
						{demoScenario.pipeline.map((item) => (
							<li key={item.id}>
								<div className={styles.pipelineMarker}>
									<span />
								</div>
								<div className={styles.pipelineCopy}>
									<small>{item.label}</small>
									<h3>{item.operator}</h3>
									<p>{item.description}</p>
								</div>
								<div className={styles.pipelineResult}>
									<span>Result</span>
									<p>{item.result}</p>
									<a href={item.source.href}>{item.source.label} ↗</a>
								</div>
							</li>
						))}
					</ol>
					<p className={styles.engineBoundary}>
						<strong>Truth boundary:</strong> relationship expansion is
						implemented in the wiki engine. The current MCP search tool does not
						yet expose its graph-expansion option.
					</p>
				</div>

				<div className={styles.stage} hidden={stage !== "answer"}>
					<div className={styles.stageIntro}>
						<p className={styles.stageEyebrow}>05 / Trust</p>
						<h2 id="demo-stage-answer">{stageHeadings.answer}</h2>
						<p>
							The answer is only the top layer. The agent also receives the
							reasons to trust it and the warning that still needs a human.
						</p>
					</div>
					<ContextBundle key={runId} />
					<p className={styles.answerBoundary}>
						Representative rendering of the implemented context-bundle contract.
						No customer data is used.
					</p>
				</div>

				<footer className={styles.stageControls}>
					<button disabled={stageIndex === 0} onClick={goBack} type="button">
						← Back
					</button>
					<span>
						{String(stageIndex + 1).padStart(2, "0")} /{" "}
						{String(stages.length).padStart(2, "0")}
					</span>
					{stageIndex < stages.length - 1 ? (
						<button
							className={styles.nextButton}
							onClick={goForward}
							type="button"
						>
							{stage === "idle" && "Run retrieval"}
							{stage === "baseline" && "Open the autopsy"}
							{stage === "autopsy" && "Run through MDBrain"}
							{stage === "pipeline" && "Reveal the answer"}
							<span aria-hidden="true">→</span>
						</button>
					) : (
						<button
							className={styles.nextButton}
							onClick={restart}
							type="button"
						>
							Run it again ↻
						</button>
					)}
				</footer>
			</section>

			<p className={styles.disclosure}>{demoScenario.disclosure}</p>
		</section>
	)
}
