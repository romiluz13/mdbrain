import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import WorkspacePage, { metadata } from "./page.js"

describe("workspace page", () => {
	it("starts disconnected with an empty identity and no records", () => {
		const html = renderToStaticMarkup(createElement(WorkspacePage))
		const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

		expect(text).toContain("API base URL")
		expect(text).toContain("API key")
		expect(text).toContain("Agent ID")
		expect(text).toContain("Scope reference")
		expect(text).toContain("never written to browser storage")
		expect(text).not.toContain("Pages in this scope")
		expect(text).not.toContain("Northstar")
		expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/)
		expect(html).not.toMatch(/name="(agentId|scopeRef)"[^>]*value="[^"]+"/)
	})

	it("is titled as the workspace, not the synthetic demo", () => {
		expect(metadata.title).toBe("Workspace | MDBrain")
	})
})
