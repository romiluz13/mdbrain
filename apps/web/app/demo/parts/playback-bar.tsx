"use client"

import { countOf } from "../../../lib/demo-data/plural.js"
import { noRecordingReason } from "../../../lib/demo-data/playback-view.js"
import { formatUtc } from "../../../lib/demo-data/views.js"
import { useDemo } from "../demo-context.js"
import styles from "../modes.module.css"
import type { Playback } from "../use-playback.js"

type Ready = Extract<Playback, { status: "ready" }>

const FEED_SHOWN = 30

function phaseOf(playback: Ready): string | null {
	const marks = playback.boundaries
	if (!marks) return null
	const cursor = playback.state.cursor
	if (cursor <= marks.sourcesEnd) return "Sources arriving"
	if (cursor <= marks.agentsEnd) return "Agents at work"
	if (marks.approval !== null && cursor >= marks.approval) {
		return "Proposal approved"
	}
	if (marks.contradiction !== null && cursor >= marks.contradiction) {
		return "Contradiction recorded"
	}
	return "After the agents"
}

function ReadyBar({ playback }: { playback: Ready }) {
	const { state, boundaries: marks } = playback
	const latest = state.recent[0]
	const phase = phaseOf(playback)
	const summary = `Revision ${state.cursor} of ${state.total}, ${countOf(state.pageCount, "page")}, ${countOf(state.claimCount, "claim")}`
	return (
		<section
			className={styles.playback}
			aria-labelledby="playback-heading"
			data-testid="playback-bar"
		>
			<div className={styles.playbackHead}>
				<h2 id="playback-heading">Watch how it was built</h2>
				<span className={styles.playbackNote}>
					Pages, claims, revisions, the graph and the change feed follow the
					recording. Source counts and the run's own record show their stored
					final values.
				</span>
			</div>
			<input
				type="range"
				className={styles.slider}
				min={1}
				max={state.total}
				step={1}
				value={state.cursor}
				aria-label="Position in the recording"
				aria-valuetext={summary}
				data-testid="playback-slider"
				onChange={(event) =>
					playback.setCursor(Number(event.currentTarget.value))
				}
			/>
			<div className={styles.playbackControls}>
				<button
					type="button"
					className={styles.control}
					disabled={state.cursor <= 1}
					onClick={() => playback.step(-1)}
					data-testid="playback-back"
				>
					← Back
				</button>
				<button
					type="button"
					className={styles.control}
					data-variant="primary"
					aria-pressed={playback.playing}
					onClick={playback.toggle}
					data-testid="playback-play"
				>
					{playback.playing ? "Pause" : "Play"}
				</button>
				<button
					type="button"
					className={styles.control}
					disabled={state.cursor >= state.total}
					onClick={() => playback.step(1)}
					data-testid="playback-forward"
				>
					Forward →
				</button>
				{marks ? (
					<>
						<button
							type="button"
							className={styles.control}
							onClick={() => playback.jump("sources")}
							data-testid="playback-jump-sources"
						>
							Sources in
						</button>
						<button
							type="button"
							className={styles.control}
							onClick={() => playback.jump("agents")}
							data-testid="playback-jump-agents"
						>
							Agents done
						</button>
						{marks.contradiction !== null ? (
							<button
								type="button"
								className={styles.control}
								onClick={() => playback.jump("contradiction")}
								data-testid="playback-jump-contradiction"
							>
								Contradiction caught
							</button>
						) : null}
						{marks.approval !== null ? (
							<button
								type="button"
								className={styles.control}
								onClick={() => playback.jump("approval")}
								data-testid="playback-jump-approval"
							>
								Approved
							</button>
						) : null}
					</>
				) : null}
			</div>
			<p className={styles.readout} data-testid="playback-readout">
				<span>
					<strong>Revision {state.cursor}</strong> of {state.total}
				</span>
				<span data-readout="pages">{countOf(state.pageCount, "page")}</span>
				<span data-readout="claims">{countOf(state.claimCount, "claim")}</span>
				{state.at ? <span>stored {formatUtc(state.at)}</span> : null}
				{phase ? <span data-testid="playback-phase">{phase}</span> : null}
				{latest ? (
					<span>
						Latest: {latest.title ?? latest.pageSlug} revision {latest.revision}
						{latest.created ? " (new page)" : ""}
					</span>
				) : null}
			</p>
		</section>
	)
}

function Fallback({ reason }: { reason: string }) {
	const { data } = useDemo()
	const rows =
		data.changes.kind === "ready"
			? [...data.changes.data.changes].sort(
					(a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
				)
			: []
	return (
		<section
			className={styles.playback}
			aria-labelledby="playback-heading"
			data-testid="playback-fallback"
		>
			<div className={styles.playbackHead}>
				<h2 id="playback-heading">Watch how it was built</h2>
				<span className={styles.modeText}>Recorded, final state only.</span>
			</div>
			<p className={styles.modeText}>
				This recording cannot be stepped through. {reason} The chapter shows the
				final state
				{rows.length > 0
					? ", and the stored revisions follow in the order they were stored."
					: "."}
			</p>
			{rows.length > 0 ? (
				<section
					aria-label="Stored revisions in order"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
					tabIndex={0}
				>
					<ol className={styles.fallbackList}>
						{rows.slice(0, FEED_SHOWN).map((change) => (
							<li key={`${change.pageSlug}:${change.revision}`}>
								<span>
									{change.title ?? change.pageSlug} revision {change.revision}
								</span>
								<span>stored {formatUtc(change.createdAt)}</span>
							</li>
						))}
					</ol>
				</section>
			) : null}
			{rows.length > FEED_SHOWN ? (
				<p className={styles.modeText}>
					{rows.length - FEED_SHOWN} later revisions are on the What changed
					chapter.
				</p>
			) : null}
		</section>
	)
}

/** The recording's controls for chapters 3 to 7. A page with no recording to
 * play says so and shows the feed it has. */
export function PlaybackBar() {
	const { playback, data } = useDemo()
	if (playback.status === "ready") return <ReadyBar playback={playback} />
	if (playback.status === "fallback") {
		return <Fallback reason={playback.reason} />
	}
	const waiting = data.map.kind === "loading" || data.changes.kind === "loading"
	return waiting ? (
		<div
			className={styles.playback}
			role="status"
			data-testid="playback-loading"
		>
			<p className={styles.modeText}>Reading the recording…</p>
		</div>
	) : (
		<Fallback reason={noRecordingReason(data)} />
	)
}
