"use client"

import { useState } from "react"
import type { DataState } from "../../../lib/demo-data/states.js"
import { useDemo } from "../demo-context.js"
import styles from "../chapters.module.css"
import { StatePanel } from "../parts/state-panel.js"

type Read = {
	id: string
	label: string
	path: string | null
	/** Why there is no path yet; shown in place of it. */
	blocked?: string
	sdk: string
	mcp: string
}

/** Why a read that points at stored data cannot be run, or null when that
 * data was read. */
function waitingFor(state: DataState<unknown>, what: string): string | null {
	switch (state.kind) {
		case "loading":
			return `waiting for ${what} to be read`
		case "empty":
			return `no ${what} are stored in this run`
		case "error":
			return `${what} could not be read (${state.code})`
		case "incomplete":
			return `${what} are incomplete in this run`
		case "ready":
			return null
	}
}

type Result =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "done"; status: number; ms: number; bytes: number; excerpt: string }
	| { kind: "failed"; message: string }

const EXCERPT = 1200

export function HoodChapter() {
	const { data, reload } = useDemo()
	const map = data.map.kind === "ready" ? data.map.data : null
	const noPages = waitingFor(data.map, "the pages")
	const noWindow = noPages ?? waitingFor(data.changes, "the first stored time")
	const firstPage = map?.pages[0]
	const withSource = map?.pages.find((page) =>
		page.claims.some(
			(claim) => claim.marker && claim.evidence.some((e) => e.kind === "event"),
		),
	)
	const claim = withSource?.claims.find(
		(c) => c.marker && c.evidence.some((e) => e.kind === "event"),
	)
	const evidence = claim?.evidence.find((e) => e.kind === "event")
	const since =
		data.changes.kind === "ready" ? data.changes.data.window.since : null
	const reads: Read[] = [
		{
			id: "wiki-list",
			label: "List pages",
			path: "/api/demo/v1/wiki?limit=2",
			sdk: "wikiList",
			mcp: "no MCP tool",
		},
		{
			id: "wiki-page",
			label: "Read one page",
			path: firstPage
				? `/api/demo/v1/wiki/${encodeURIComponent(firstPage.slug)}`
				: null,
			blocked: noPages ?? undefined,
			sdk: "wikiGet",
			mcp: "mdbrain_wiki_get",
		},
		{
			id: "wiki-overview",
			label: "Read a page with its neighbors",
			path: firstPage
				? `/api/demo/v1/wiki/overview/${encodeURIComponent(firstPage.slug)}`
				: null,
			blocked: noPages ?? undefined,
			sdk: "overview",
			mcp: "mdbrain_wiki_overview",
		},
		{
			id: "wiki-changes",
			label: "Read what changed",
			path: since
				? `/api/demo/v1/wiki/changes?since=${encodeURIComponent(since)}`
				: null,
			blocked: noWindow ?? undefined,
			sdk: "changes",
			mcp: "mdbrain_wiki_changes",
		},
		{
			id: "wiki-lint",
			label: "Find contradictions",
			path: "/api/demo/v1/wiki/lint?limit=5",
			sdk: "wikiLint",
			mcp: "mdbrain_wiki_lint",
		},
		{
			id: "cite",
			label: "Open a citation",
			path:
				claim?.marker && evidence?.marker
					? `/api/demo/v1/cite?marker=${encodeURIComponent(evidence.marker)}&citedBy=${encodeURIComponent(claim.marker)}`
					: null,
			blocked: noPages ?? "no stored claim cites a source event",
			sdk: "cite",
			mcp: "mdbrain_cite",
		},
		{
			id: "wiki-search",
			label: "Ask a question",
			path: firstPage
				? `/api/demo/v1/wiki/search?query=${encodeURIComponent(firstPage.title)}&maxResults=3`
				: null,
			blocked: noPages ?? undefined,
			sdk: "wikiSearch",
			mcp: "mdbrain_wiki_search",
		},
	]
	return (
		<>
			<p className={styles.note}>
				This page calls only the demo read proxy. The proxy adds a read key and
				pins the run on the server, so neither ever reaches the browser, and it
				forwards nothing outside this list.
			</p>
			<StatePanel
				state={data.map}
				what="the page list"
				emptyNote="No pages are stored in this run yet, so the reads that point at a page cannot run."
				onRetry={reload}
			>
				{() => null}
			</StatePanel>
			<ul className={styles.reads}>
				{reads.map((read) => (
					<ReadRow key={read.id} read={read} />
				))}
			</ul>
		</>
	)
}

function ReadRow({ read }: { read: Read }) {
	const [result, setResult] = useState<Result>({ kind: "idle" })
	const run = async () => {
		if (read.path === null) {
			return
		}
		setResult({ kind: "running" })
		const started = performance.now()
		try {
			const response = await fetch(read.path, {
				headers: { accept: "application/json" },
			})
			const text = await response.text()
			let pretty = text
			try {
				pretty = JSON.stringify(JSON.parse(text), null, 2)
			} catch {
				// A non-JSON body is shown as it came.
			}
			setResult({
				kind: "done",
				status: response.status,
				ms: Math.round(performance.now() - started),
				bytes: text.length,
				excerpt:
					pretty.length > EXCERPT ? `${pretty.slice(0, EXCERPT)}\n…` : pretty,
			})
		} catch (error) {
			setResult({
				kind: "failed",
				message: error instanceof Error ? error.message : "the request failed",
			})
		}
	}
	return (
		<li className={styles.read} data-read={read.id}>
			<div className={styles.readHead}>
				<div>
					<h2>{read.label}</h2>
					<p className={styles.mono}>
						{read.path
							? `GET ${read.path}`
							: (read.blocked ?? "waiting for the pages to be read")}
					</p>
					<p className={styles.claimMeta}>
						SDK <span className={styles.mono}>{read.sdk}</span> · MCP{" "}
						<span className={styles.mono}>{read.mcp}</span>
					</p>
				</div>
				<button
					type="button"
					className={styles.button}
					disabled={read.path === null || result.kind === "running"}
					onClick={() => void run()}
				>
					{result.kind === "running" ? "Reading…" : "Run this read"}
				</button>
			</div>
			<div aria-live="polite">
				{result.kind === "done" ? (
					<>
						<p className={styles.claimMeta} data-testid="read-status">
							HTTP {result.status} · {result.ms} ms · {result.bytes} bytes
						</p>
						<figure className={styles.codeFigure}>
							<figcaption className={styles.claimMeta}>
								Response excerpt, {read.label.toLowerCase()}
							</figcaption>
							<pre className={styles.code}>{result.excerpt}</pre>
						</figure>
					</>
				) : null}
				{result.kind === "failed" ? (
					<p role="alert" className={styles.note}>
						The read failed: {result.message}
					</p>
				) : null}
			</div>
		</li>
	)
}
