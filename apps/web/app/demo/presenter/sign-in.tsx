"use client"

import { type FormEvent, useMemo, useState } from "react"
import { createPresenterClient } from "../../../lib/demo-presenter/client.js"
import shell from "../demo.module.css"
import styles from "../modes.module.css"

export function SignIn() {
	const client = useMemo(() => createPresenterClient(), [])
	const [token, setToken] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const submit = async (event: FormEvent) => {
		event.preventDefault()
		setBusy(true)
		setError(null)
		const result = await client.signIn(token)
		if (result.ok) {
			window.location.assign("/demo")
			return
		}
		setBusy(false)
		setError(result.message)
	}

	return (
		<div className={shell.root}>
			<main className={styles.signIn}>
				<h1>Presenter sign-in</h1>
				<p className={styles.modeText}>
					Presenting runs the agents on a leased slot. Visitors never see this
					page's controls.
				</p>
				<form className={styles.signIn} onSubmit={submit}>
					<label className={styles.presenterRow}>
						Presenter token
						<input
							type="password"
							className={styles.field}
							value={token}
							autoComplete="off"
							onChange={(event) => setToken(event.currentTarget.value)}
							data-testid="presenter-token"
						/>
					</label>
					<button
						type="submit"
						className={styles.control}
						data-variant="primary"
						disabled={busy || token === ""}
						data-testid="presenter-sign-in"
					>
						{busy ? "Signing in…" : "Sign in"}
					</button>
					{error ? (
						<p
							className={styles.message}
							data-tone="error"
							role="alert"
							data-testid="presenter-sign-in-error"
						>
							{error}
						</p>
					) : null}
				</form>
			</main>
		</div>
	)
}
