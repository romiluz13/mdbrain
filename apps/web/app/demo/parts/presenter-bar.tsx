"use client"

import { useState } from "react"
import { leaseLabel } from "../../../lib/demo-presenter/client.js"
import { runProgress } from "../../../lib/demo-presenter/progress.js"
import { useDemo } from "../demo-context.js"
import styles from "../modes.module.css"

const NAME_MAX = 40
const BLOCKED = new Set(["queued", "running", "complete", "incomplete"])

/** The presenter's controls. Loaded only for a confirmed presenter, so a
 * visitor's page never contains them. */
export function PresenterBar() {
	const { presenter, data } = useDemo()
	const [name, setName] = useState("")
	const [rename, setRename] = useState("")
	const [confirmingPin, setConfirmingPin] = useState(false)
	const { lease, request, busy, message, actions } = presenter
	const record =
		data.run.kind === "ready"
			? data.run.data
			: data.run.kind === "incomplete"
				? data.run.data
				: undefined
	const progress = runProgress({
		request,
		agentRun: lease ? record?.agentRun : undefined,
		now: new Date(),
	})
	const working = busy !== null
	return (
		<section
			className={styles.presenter}
			aria-label="Presenter controls"
			data-testid="presenter-bar"
		>
			<div className={styles.presenterRow}>
				<span className={styles.modeTag} data-mode="live">
					Presenter
				</span>
				{lease ? (
					<span data-testid="lease-slot">{leaseLabel(lease)}</span>
				) : (
					<span className={styles.modeText}>
						No slot leased. Visitors see the recording.
					</span>
				)}
				<button
					type="button"
					className={styles.control}
					onClick={() => void actions.signOut()}
					disabled={working}
					data-testid="presenter-sign-out"
				>
					Sign out
				</button>
			</div>

			{lease ? (
				<>
					<div className={styles.presenterRow}>
						<label>
							Slot name
							<input
								className={styles.field}
								value={rename}
								maxLength={NAME_MAX}
								placeholder={lease.name || "Name this slot"}
								onChange={(event) => setRename(event.currentTarget.value)}
								data-testid="slot-rename-input"
							/>
						</label>
						<button
							type="button"
							className={styles.control}
							disabled={working || rename.trim() === ""}
							onClick={() => {
								void actions.rename(rename.trim())
								setRename("")
							}}
							data-testid="slot-rename"
						>
							Rename
						</button>
						<button
							type="button"
							className={styles.control}
							disabled={working}
							onClick={() => void actions.release()}
							data-testid="slot-release"
						>
							Release slot
						</button>
					</div>
					<div className={styles.presenterRow}>
						<button
							type="button"
							className={styles.control}
							data-variant="primary"
							disabled={working || BLOCKED.has(progress.stage)}
							onClick={() => void actions.run()}
							data-testid="run-agents"
						>
							{busy === "run" ? "Starting…" : "Run the agents"}
						</button>
						<span
							role="status"
							data-testid="run-progress"
							data-stage={progress.stage}
						>
							{progress.label}
						</span>
						{progress.stage === "complete" ? (
							confirmingPin ? (
								<>
									<span className={styles.modeText}>
										Public mode will play this run back.
									</span>
									<button
										type="button"
										className={styles.control}
										data-variant="primary"
										disabled={working}
										onClick={() => {
											setConfirmingPin(false)
											void actions.pin()
										}}
										data-testid="pin-confirm"
									>
										Pin it
									</button>
									<button
										type="button"
										className={styles.control}
										onClick={() => setConfirmingPin(false)}
									>
										Cancel
									</button>
								</>
							) : (
								<button
									type="button"
									className={styles.control}
									disabled={working}
									onClick={() => setConfirmingPin(true)}
									data-testid="pin-run"
								>
									Pin for public mode
								</button>
							)
						) : null}
					</div>
				</>
			) : (
				<div className={styles.presenterRow}>
					<label>
						Slot name (optional)
						<input
							className={styles.field}
							value={name}
							maxLength={NAME_MAX}
							onChange={(event) => setName(event.currentTarget.value)}
							data-testid="lease-name-input"
						/>
					</label>
					<button
						type="button"
						className={styles.control}
						data-variant="primary"
						disabled={working}
						onClick={() => void actions.lease(name.trim() || undefined)}
						data-testid="lease-slot-button"
					>
						{busy === "lease" ? "Leasing…" : "Lease a free slot"}
					</button>
				</div>
			)}

			{message ? (
				<p
					className={styles.message}
					data-tone={message.tone}
					role={message.tone === "error" ? "alert" : "status"}
					data-testid="presenter-message"
				>
					{message.text}{" "}
					<button
						type="button"
						className={styles.control}
						onClick={actions.dismiss}
					>
						Dismiss
					</button>
				</p>
			) : null}
		</section>
	)
}
