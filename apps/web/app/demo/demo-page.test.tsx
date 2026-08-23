import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import DemoPage, { metadata } from "./page.js"

describe("retrieval autopsy demo page", () => {
	it("renders the complete sales story without JavaScript", () => {
		const html = renderToStaticMarkup(createElement(DemoPage))
		const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

		expect(text).toContain(
			"Your coding agent found the answer. It was six months out of date.",
		)
		expect(text).toContain("Guided synthetic simulation")
		expect(text).toContain("Identity Gateway v2")
		expect(text).toContain("Question loaded")
		expect(text).toContain("The confident answer")
		expect(text).toContain("Open the retrieval autopsy")
		expect(text).toContain("Run the same question through MDBrain")
		expect(text).toContain("The answer your agent can inspect")
		expect(text).toContain("The dangerous retrieval failure is not no answer.")
		expect(text).toContain("Open GitHub quickstart")
		expect(text).toContain("Read the field guide")
	})

	it("publishes demo-specific social metadata", () => {
		expect(metadata.openGraph).toMatchObject({
			title: "Retrieval Autopsy | MDBrain",
			url: "/demo",
		})
		expect(metadata.twitter).toMatchObject({
			title: "Retrieval Autopsy | MDBrain",
		})
	})
})
