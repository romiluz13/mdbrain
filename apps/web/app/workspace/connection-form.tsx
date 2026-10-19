"use client"

import { type FormEvent, useId, useState } from "react"
import {
	type ConnectionDraft,
	type DraftErrors,
	SCOPES,
	validateDraft,
	type Connection,
} from "./identity.js"
import { Notice } from "./ledger.js"
import styles from "./workspace.module.css"

export function ConnectionForm({
	draft,
	onDraft,
	onConnect,
	nextId,
}: {
	draft: ConnectionDraft
	onDraft: (draft: ConnectionDraft) => void
	onConnect: (connection: Connection) => void
	nextId: number
}) {
	const [errors, setErrors] = useState<DraftErrors>({})
	const ids = useId()

	function set(key: keyof ConnectionDraft, value: string) {
		onDraft({ ...draft, [key]: value })
	}

	function submit(event: FormEvent) {
		event.preventDefault()
		const result = validateDraft(draft, nextId)
		if (!result.ok) {
			setErrors(result.errors)
			return
		}
		setErrors({})
		onConnect(result.connection)
	}

	const failed = Object.keys(errors).length > 0

	function field(key: keyof ConnectionDraft) {
		const error = errors[key]
		return {
			"aria-invalid": error ? true : undefined,
			"aria-describedby": error ? `${ids}-${key}-error` : undefined,
		}
	}

	function error(key: keyof ConnectionDraft) {
		return errors[key] ? (
			<span id={`${ids}-${key}-error`} className={styles.fieldError}>
				{errors[key]}
			</span>
		) : null
	}

	return (
		<form className={styles.form} onSubmit={submit} noValidate>
			<p className={styles.lede}>
				Connect to an MDBrain API with a key that is scoped to the agent and
				scope you want to work in. The key stays in this tab's memory. It is
				never written to browser storage, and reloading the page clears it.
			</p>
			{failed ? (
				<Notice tone="bad" title="Fix the highlighted fields to connect." />
			) : null}
			<label className={styles.field}>
				<span>API base URL</span>
				<input
					className={styles.mono}
					value={draft.baseUrl}
					onChange={(event) => set("baseUrl", event.target.value)}
					autoComplete="off"
					spellCheck={false}
					{...field("baseUrl")}
				/>
				{error("baseUrl")}
			</label>
			<label className={styles.field}>
				<span>API key</span>
				<input
					className={styles.mono}
					type="password"
					value={draft.apiKey}
					onChange={(event) => set("apiKey", event.target.value)}
					autoComplete="off"
					spellCheck={false}
					{...field("apiKey")}
				/>
				<small>
					Leave empty only for a local API that runs without keys. Use a scoped
					key, never an admin key.
				</small>
			</label>
			<label className={styles.field}>
				<span>Agent ID</span>
				<input
					className={styles.mono}
					value={draft.agentId}
					onChange={(event) => set("agentId", event.target.value)}
					autoComplete="off"
					spellCheck={false}
					{...field("agentId")}
				/>
				{error("agentId")}
			</label>
			<div className={styles.field}>
				<label htmlFor={`${ids}-scope`}>Scope</label>
				<select
					id={`${ids}-scope`}
					value={draft.scope}
					onChange={(event) => set("scope", event.target.value)}
					{...field("scope")}
				>
					<option value="">Choose a scope</option>
					{SCOPES.map((scope) => (
						<option key={scope} value={scope}>
							{scope}
						</option>
					))}
				</select>
				{error("scope")}
			</div>
			<label className={styles.field}>
				<span>Scope reference</span>
				<input
					className={styles.mono}
					value={draft.scopeRef}
					onChange={(event) => set("scopeRef", event.target.value)}
					autoComplete="off"
					spellCheck={false}
					{...field("scopeRef")}
				/>
				{error("scopeRef")}
			</label>
			<div className={styles.row}>
				<button type="submit" className={styles.button}>
					Connect
				</button>
			</div>
		</form>
	)
}
