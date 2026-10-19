"use client"

import { type FormEvent, useId, useState } from "react"
import { ErrorNotice, Notice } from "./ledger.js"
import { slugify } from "./slug.js"
import { useLatest } from "./use-latest.js"
import styles from "./workspace.module.css"
import { useWorkspace } from "./workspace-context.js"

const KINDS = [
	"entity",
	"concept",
	"synthesis",
	"source",
	"report",
	"procedure",
] as const

const TRUST_TIERS = ["standard", "restricted"] as const

type Draft = {
	title: string
	slug: string
	kind: string
	frontmatterType: string
	trustTier: string
	summary: string
	body: string
}

const EMPTY: Draft = {
	title: "",
	slug: "",
	kind: "",
	frontmatterType: "",
	trustTier: "standard",
	summary: "",
	body: "",
}

export function PageCreate({
	onCreated,
}: {
	onCreated: (slug: string) => void
}) {
	const { call, connection } = useWorkspace()
	const [draft, setDraft] = useState<Draft>(EMPTY)
	const [slugTouched, setSlugTouched] = useState(false)
	const [missing, setMissing] = useState<string[]>([])
	const { state, run } = useLatest<string>()
	const ids = useId()

	function set<K extends keyof Draft>(key: K, value: Draft[K]) {
		setDraft((current) => ({ ...current, [key]: value }))
	}

	async function submit(event: FormEvent) {
		event.preventDefault()
		const required: Array<[keyof Draft, string]> = [
			["title", "Title"],
			["slug", "Slug"],
			["kind", "Kind"],
			["frontmatterType", "Frontmatter type"],
			["summary", "Summary"],
			["body", "Body"],
		]
		const absent = required
			.filter(([key]) => !draft[key].trim())
			.map(([, label]) => label)
		setMissing(absent)
		if (absent.length > 0) {
			return
		}
		const created = await run(async () => {
			const page = await call((client, options) =>
				client.wikiCreate(
					{
						kind: draft.kind,
						title: draft.title.trim(),
						slug: draft.slug.trim(),
						summary: draft.summary.trim(),
						body: draft.body,
						frontmatter: { type: draft.frontmatterType.trim() },
						scope: connection.scope,
						scopeRef: connection.scopeRef,
						trustTier: draft.trustTier,
						agentId: connection.agentId,
					},
					options,
				),
			)
			return page.slug
		})
		if (created) {
			onCreated(created)
		}
	}

	return (
		<section className={styles.section} aria-labelledby={`${ids}-h`}>
			<h3 id={`${ids}-h`}>New knowledge page</h3>
			<p className={styles.hint}>
				Saved to the wiki in{" "}
				<span className={styles.mono}>
					{connection.scope}/{connection.scopeRef}
				</span>{" "}
				as revision 1. This does not write to conversation memory.
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
						<span>Title</span>
						<input
							value={draft.title}
							onChange={(event) => {
								set("title", event.target.value)
								if (!slugTouched) {
									set("slug", slugify(event.target.value))
								}
							}}
						/>
					</label>
					<label className={styles.field}>
						<span>Slug</span>
						<input
							className={styles.mono}
							value={draft.slug}
							onChange={(event) => {
								setSlugTouched(true)
								set("slug", event.target.value)
							}}
						/>
						<small>
							The page's address in this scope. It cannot change later.
						</small>
					</label>
					<div className={styles.field}>
						<label htmlFor={`${ids}-kind`}>Kind</label>
						<select
							id={`${ids}-kind`}
							value={draft.kind}
							onChange={(event) => set("kind", event.target.value)}
						>
							<option value="">Choose a kind</option>
							{KINDS.map((kind) => (
								<option key={kind} value={kind}>
									{kind}
								</option>
							))}
						</select>
					</div>
					<label className={styles.field}>
						<span>Frontmatter type</span>
						<input
							value={draft.frontmatterType}
							onChange={(event) => set("frontmatterType", event.target.value)}
						/>
						<small>
							Required by the API, for example “decision” or “note”.
						</small>
					</label>
					<div className={styles.field}>
						<label htmlFor={`${ids}-tier`}>Trust tier</label>
						<select
							id={`${ids}-tier`}
							value={draft.trustTier}
							onChange={(event) => set("trustTier", event.target.value)}
							aria-describedby={`${ids}-tier-help`}
						>
							{TRUST_TIERS.map((tier) => (
								<option key={tier} value={tier}>
									{tier}
								</option>
							))}
						</select>
						<small id={`${ids}-tier-help`}>
							The API only accepts the tier your key already has, unless the key
							can change permissions.
						</small>
					</div>
					<label className={styles.field}>
						<span>Summary</span>
						<input
							value={draft.summary}
							onChange={(event) => set("summary", event.target.value)}
						/>
					</label>
					<label className={styles.field}>
						<span>Body</span>
						<textarea
							value={draft.body}
							onChange={(event) => set("body", event.target.value)}
						/>
					</label>
				</fieldset>
				<div className={styles.row}>
					<button
						type="submit"
						className={styles.button}
						disabled={state.status === "loading"}
					>
						{state.status === "loading" ? "Creating…" : "Create page"}
					</button>
				</div>
				{state.status === "error" ? (
					<ErrorNotice error={state.error} title="Page not created" />
				) : null}
			</form>
		</section>
	)
}
