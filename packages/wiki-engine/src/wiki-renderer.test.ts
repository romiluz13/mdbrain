import { describe, expect, it } from "vitest"
import type { WikiPageView } from "./wiki-bridge.js"
import { renderWikiPageHtml, renderWikiPageMarkdown } from "./wiki-renderer.js"

function view(claims: unknown[]): WikiPageView {
	return {
		_id: "p1",
		kind: "entity",
		title: "Halvorsen",
		slug: "accounts/halvorsen",
		aliases: [],
		summary: "An account.",
		body: "",
		frontmatter: { type: "account" },
		claims,
		contradictions: [],
		questions: [],
		relationships: [],
		personCard: null,
		scope: "workspace",
		scopeRef: "ws-1",
		trustTier: "standard",
		state: "active",
		revision: 4,
		freshness: "fresh",
		backlinks: [],
	} as unknown as WikiPageView
}

describe("wiki page rendering with citation markers", () => {
	const marked = view([
		{
			id: "renewal",
			text: "The renewal is at risk.",
			status: "active",
			confidence: 0.8,
			marker: "[[wiki:accounts/halvorsen#renewal@r4]]",
		},
		{ id: "plain", text: "No marker here.", status: "active" },
	])

	it("prints a claim's marker after its text in markdown", () => {
		const lines = renderWikiPageMarkdown(marked).split("\n")

		expect(lines).toContain(
			"- The renewal is at risk. _[active]_ (conf: 0.8) [[wiki:accounts/halvorsen#renewal@r4]]",
		)
		expect(lines).toContain("- No marker here. _[active]_")
	})

	it("prints a claim's marker in HTML, escaped", () => {
		const html = renderWikiPageHtml(
			view([
				{
					id: "x",
					text: "Claim",
					status: "active",
					marker: "[[wiki:a&b#x@r1]]",
				},
			]),
		)

		expect(html).toContain("<code>[[wiki:a&amp;b#x@r1]]</code>")
		expect(renderWikiPageHtml(marked)).toContain(
			"<code>[[wiki:accounts/halvorsen#renewal@r4]]</code>",
		)
	})
})
