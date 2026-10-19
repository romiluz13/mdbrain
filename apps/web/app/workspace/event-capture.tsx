"use client"

import { type FormEvent, useRef, useState } from "react"
import { Entry, ErrorNotice, Notice } from "./ledger.js"
import {
	keyForWrite,
	type PendingWrite,
	writeFingerprint,
} from "./idempotency.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"

type Receipt = {
	eventId: string
	chunkCreated: boolean
	sessionId: string
	idempotencyKey: string
}

/** Stores one event through the SDK `add` call. The receipt is what the API
 *  returned: an event id and whether a chunk was created. The page makes no
 *  claim that facts were extracted from it. */
export function EventCapture({
	onRecall,
}: {
	onRecall: (sessionId: string) => void
}) {
	const { call, connection } = useWorkspace()
	const [sessionId, setSessionId] = useState("")
	const [content, setContent] = useState("")
	const [missing, setMissing] = useState<string[]>([])
	const [receipts, setReceipts] = useState<Receipt[]>([])
	const [retryKey, setRetryKey] = useState<string>()
	const pending = useRef<PendingWrite | null>(null)
	const { state, run } = useLatest<Receipt>()

	async function submit(event: FormEvent) {
		event.preventDefault()
		const absent = [
			!sessionId.trim() ? "Session ID" : "",
			!content.trim() ? "Event text" : "",
		].filter(Boolean)
		setMissing(absent)
		if (absent.length > 0) {
			return
		}
		const submittedText = content
		const write = keyForWrite(
			pending.current,
			writeFingerprint([
				connection.agentId,
				connection.scope,
				connection.scopeRef,
				sessionId.trim(),
				content,
			]),
		)
		pending.current = write
		setRetryKey(write.key)
		const receipt = await run(async () => {
			const out = await call((client, options) =>
				client.add(
					{
						content,
						sessionId: sessionId.trim(),
						agentId: connection.agentId,
						scope: connection.scope,
						scopeRef: connection.scopeRef,
						idempotencyKey: write.key,
					},
					// a keyless stack's first memory write can take about a minute
					{ ...options, timeoutMs: 120_000 },
				),
			)
			return {
				eventId: out.eventId,
				chunkCreated: out.chunkCreated,
				sessionId: sessionId.trim(),
				idempotencyKey: write.key,
			}
		})
		if (receipt) {
			pending.current = null
			setRetryKey(undefined)
			setReceipts((current) => [receipt, ...current])
			// clear only the text that was submitted, never newer text
			setContent((current) => (current === submittedText ? "" : current))
		}
	}

	return (
		<section className={styles.section} aria-labelledby="capture-heading">
			<h3 id="capture-heading">Capture an event</h3>
			<p className={styles.hint}>
				Stores one event in conversation memory for{" "}
				<span className={styles.mono}>
					{connection.scope}/{connection.scopeRef}
				</span>
				. Whether anything is extracted from it is not shown here. The first
				write to a fresh Memongo can take about a minute.
			</p>
			<form className={styles.form} onSubmit={submit} noValidate>
				{missing.length > 0 ? (
					<Notice tone="bad" title="Complete the required fields">
						Missing: {missing.join(", ")}.
					</Notice>
				) : null}
				<fieldset
					className={styles.fieldset}
					disabled={state.status === "loading"}
				>
					<label className={styles.field}>
						<span>Session ID</span>
						<input
							className={styles.mono}
							value={sessionId}
							onChange={(event) => setSessionId(event.target.value)}
						/>
						<small>Groups events so you can recall them together.</small>
					</label>
					<label className={styles.field}>
						<span>Event text</span>
						<textarea
							value={content}
							onChange={(event) => setContent(event.target.value)}
						/>
					</label>
				</fieldset>
				<div className={styles.row}>
					<button
						type="submit"
						className={styles.button}
						disabled={state.status === "loading"}
					>
						{state.status === "loading" ? "Storing…" : "Store event"}
					</button>
				</div>
				{state.status === "error" ? (
					<>
						<ErrorNotice error={state.error} title="Event not confirmed" />
						<p className={styles.hint}>
							Storing again without changing anything sends the same idempotency
							key <span className={styles.mono}>{retryKey}</span>, so the API
							treats it as the same write. Changing the text or session starts a
							new write with a new key.
						</p>
					</>
				) : null}
			</form>
			<div aria-live="polite">
				{receipts.map((receipt, index) => (
					<Entry
						key={receipt.eventId}
						fresh={index === 0}
						marginLabel="Event receipt fields"
						margin={[
							{ label: "event id", essential: true, value: receipt.eventId },
							{
								label: "chunk created",
								essential: true,
								value: receipt.chunkCreated ? "yes" : "no",
							},
							{
								label: "session id",
								essential: true,
								value: receipt.sessionId,
							},
							{ label: "agent id", value: connection.agentId },
							{
								label: "scope",
								value: `${connection.scope}/${connection.scopeRef}`,
							},
							{ label: "idempotency key", value: receipt.idempotencyKey },
						]}
					>
						<h4>Event stored</h4>
						<p>
							The API accepted this event and returned an event id. Receipts
							here are from this visit only.
						</p>
						<button
							type="button"
							className={`${styles.button} ${styles.secondary}`}
							onClick={() => onRecall(receipt.sessionId)}
						>
							Recall session {receipt.sessionId}
						</button>
					</Entry>
				))}
			</div>
		</section>
	)
}
