// @mdbrian/wiki-engine — wiki page rendering (markdown + HTML).
//
// Markdown render: agent-readable, dense, OKF-export-friendly structure.
// HTML render: human-browsable, minimal styling (no framework dependency).

import type { WikiPageView } from "./wiki-bridge.js"

/** Renders a wiki page view as markdown (agent-readable). */
export function renderWikiPageMarkdown(view: WikiPageView): string {
	const lines: string[] = []
	lines.push(`# ${view.title}`)
	lines.push("")
	if (view.aliases.length > 0) {
		lines.push(`**Aliases:** ${view.aliases.join(", ")}`)
		lines.push("")
	}
	lines.push(`> ${view.summary}`)
	lines.push("")
	if (view.body) {
		lines.push(view.body)
		lines.push("")
	}
	if (view.claims.length > 0) {
		lines.push("## Claims")
		lines.push("")
		for (const claim of view.claims as Array<Record<string, unknown>>) {
			const status = claim.status ? ` _[${claim.status}]_` : ""
			const conf =
				typeof claim.confidence === "number"
					? ` (conf: ${claim.confidence})`
					: ""
			lines.push(`- ${claim.text}${status}${conf}`)
		}
		lines.push("")
	}
	if (
		(view as unknown as { contradictions?: unknown[] }).contradictions?.length
	) {
		lines.push("## Contradictions")
		lines.push("")
		const contradictions = (
			view as unknown as { contradictions: Array<Record<string, unknown>> }
		).contradictions
		for (const c of contradictions) {
			const claimIds = Array.isArray(c.claimIds)
				? (c.claimIds as string[]).join(" ↔ ")
				: ""
			lines.push(`- [${c.resolution ?? "unresolved"}] ${claimIds}`)
		}
		lines.push("")
	}
	if (view.questions.length > 0) {
		lines.push("## Open Questions")
		lines.push("")
		for (const q of view.questions as Array<Record<string, unknown>>) {
			const marker = q.status === "answered" ? "✓" : "?"
			lines.push(`- ${marker} ${q.text}`)
		}
		lines.push("")
	}
	if (view.relationships.length > 0) {
		lines.push("## Relationships")
		lines.push("")
		for (const r of view.relationships as Array<Record<string, unknown>>) {
			lines.push(`- [${r.kind}] → [[${r.targetPageSlug}]] ${r.targetTitle}`)
		}
		lines.push("")
	}
	if (view.personCard) {
		const pc = view.personCard as Record<string, unknown>
		lines.push("## Person Card")
		lines.push("")
		if (pc.canonicalId) lines.push(`- **Canonical ID:** ${pc.canonicalId}`)
		if (Array.isArray(pc.handles) && pc.handles.length)
			lines.push(`- **Handles:** ${pc.handles.join(", ")}`)
		if (Array.isArray(pc.socials) && pc.socials.length)
			lines.push(`- **Socials:** ${pc.socials.join(", ")}`)
		if (Array.isArray(pc.emails) && pc.emails.length)
			lines.push(`- **Emails:** ${pc.emails.join(", ")}`)
		if (pc.timezone) lines.push(`- **Timezone:** ${pc.timezone}`)
		if (pc.bestUsedFor) lines.push(`- **Best used for:** ${pc.bestUsedFor}`)
		if (pc.notEnoughFor) lines.push(`- **Not enough for:** ${pc.notEnoughFor}`)
		lines.push("")
	}
	if (view.backlinks.length > 0) {
		lines.push("## Backlinks")
		lines.push("")
		for (const b of view.backlinks as Array<Record<string, unknown>>) {
			lines.push(`- ← [[${b.sourcePageSlug}]] ${b.sourceTitle}`)
		}
		lines.push("")
	}
	lines.push("---")
	lines.push(
		`_kind: ${view.kind} · scope: ${view.scope}:${view.scopeRef} · trust: ${view.trustTier} · state: ${view.state} · rev: ${view.revision} · freshness: ${view.freshness}_`,
	)
	return lines.join("\n")
}

/** Renders a wiki page view as HTML (human-browsable). Minimal inline styling —
 *  no framework dependency. The web console can wrap this in its own layout. */
export function renderWikiPageHtml(view: WikiPageView): string {
	const esc = (s: unknown): string =>
		String(s ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
	const bodyHtml = markdownToHtml(esc(view.body))
	const parts: string[] = []
	parts.push(
		`<article class="mdbrian-wiki-page" data-slug="${esc(view.slug)}" data-kind="${esc(view.kind)}">`,
	)
	parts.push(`<h1>${esc(view.title)}</h1>`)
	if (view.aliases.length > 0) {
		parts.push(
			`<p class="aliases"><strong>Aliases:</strong> ${view.aliases.map(esc).join(", ")}</p>`,
		)
	}
	parts.push(`<blockquote>${esc(view.summary)}</blockquote>`)
	parts.push(`<div class="body">${bodyHtml}</div>`)
	if (view.claims.length > 0) {
		parts.push(`<h2>Claims</h2><ul>`)
		for (const claim of view.claims as Array<Record<string, unknown>>) {
			const status = claim.status ? ` <em>[${esc(claim.status)}]</em>` : ""
			parts.push(`<li>${esc(claim.text)}${status}</li>`)
		}
		parts.push(`</ul>`)
	}
	if (view.questions.length > 0) {
		parts.push(`<h2>Open Questions</h2><ul>`)
		for (const q of view.questions as Array<Record<string, unknown>>) {
			const marker = q.status === "answered" ? "✓" : "?"
			parts.push(`<li>${marker} ${esc(q.text)}</li>`)
		}
		parts.push(`</ul>`)
	}
	if (view.relationships.length > 0) {
		parts.push(`<h2>Relationships</h2><ul>`)
		for (const r of view.relationships as Array<Record<string, unknown>>) {
			parts.push(
				`<li>[${esc(r.kind)}] → <a href="/wiki/${esc(r.targetPageSlug)}">${esc(r.targetTitle)}</a></li>`,
			)
		}
		parts.push(`</ul>`)
	}
	if (view.backlinks.length > 0) {
		parts.push(`<h2>Backlinks</h2><ul>`)
		for (const b of view.backlinks as Array<Record<string, unknown>>) {
			parts.push(
				`<li>← <a href="/wiki/${esc(b.sourcePageSlug)}">${esc(b.sourceTitle)}</a></li>`,
			)
		}
		parts.push(`</ul>`)
	}
	parts.push(
		`<footer><small>kind: ${esc(view.kind)} · scope: ${esc(view.scope)}:${esc(view.scopeRef)} · trust: ${esc(view.trustTier)} · state: ${esc(view.state)} · rev: ${view.revision} · freshness: ${esc(view.freshness)}</small></footer>`,
	)
	parts.push(`</article>`)
	return parts.join("\n")
}

/** Minimal markdown → HTML (headings, bold, italic, code, paragraphs, links).
 *  No external dependency — keeps the wiki-engine self-contained. */
function markdownToHtml(md: string): string {
	if (!md) return ""
	const lines = md.split("\n")
	const out: string[] = []
	let inList = false
	const closeList = () => {
		if (inList) {
			out.push("</ul>")
			inList = false
		}
	}
	const inline = (s: string): string =>
		s
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/`(.+?)`/g, "<code>$1</code>")
			.replace(/\[\[(.+?)\]\]/g, '<a href="/wiki/$1">$1</a>')
	for (const raw of lines) {
		const line = raw
		if (/^###\s+/.test(line)) {
			closeList()
			out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`)
		} else if (/^##\s+/.test(line)) {
			closeList()
			out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`)
		} else if (/^#\s+/.test(line)) {
			closeList()
			out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`)
		} else if (/^[-*]\s+/.test(line)) {
			if (!inList) {
				out.push("<ul>")
				inList = true
			}
			out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`)
		} else if (line.trim() === "") {
			closeList()
		} else {
			closeList()
			out.push(`<p>${inline(line)}</p>`)
		}
	}
	closeList()
	return out.join("\n")
}
