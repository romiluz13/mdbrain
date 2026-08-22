import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import ComparePage, { metadata } from "./page.js"

describe("named comparison field guide", () => {
	it("renders all sourced alternatives and the comparison posture", () => {
		const html = renderToStaticMarkup(createElement(ComparePage))
		const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

		expect(text).toContain("A field guide, not a fight card.")
		expect(text).toContain("Where they are stronger")
		expect(text).toContain("Where MDBrain is different")
		expect(text).toContain("Verified 2026-08-22")

		for (const name of [
			"Modus",
			"Glean",
			"Guru",
			"Dust",
			"Mem0",
			"Zep / Graphiti",
			"Cognee",
			"OpenWiki",
			"Microsoft GraphRAG",
		]) {
			expect(text).toContain(name)
		}
	})

	it("publishes comparison-specific social metadata", () => {
		expect(metadata.openGraph).toMatchObject({
			title: "Comparison field guide | MDBrain",
			url: "/compare",
		})
		expect(metadata.twitter).toMatchObject({
			title: "Comparison field guide | MDBrain",
		})
	})
})
