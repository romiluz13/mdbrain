import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import Home from "./page.js"

describe("Living System Atlas landing page", () => {
	it("renders the complete product story for visitors without JavaScript", () => {
		const html = renderToStaticMarkup(createElement(Home))
		const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

		expect(text).toContain(
			"Your AI can retrieve a fact. Can it tell when that fact stopped being true?",
		)
		expect(text).toContain("One living system, not a pipeline of loose parts.")
		expect(text).toContain("Five ways to prove it")
		expect(text).toContain("Why MongoDB changes the architecture")
		expect(text).toContain("Compare architectures, not slogans")
		expect(text).toContain("Inspect every claim")
		expect(text).toContain("Install the entire system")
	})
})
