import { describe, expect, it } from "vitest"
import { chooseExcerpt } from "./excerpt.js"

describe("chooseExcerpt", () => {
	it("returns the sentence that contains the anchor, verbatim", () => {
		const body =
			"Northstar Track 9.3 shipped today. It adds shareable tracking links for consignees. The links are read-only."
		const note = chooseExcerpt(body, "shareable tracking links")
		expect(note).toBe("It adds shareable tracking links for consignees.")
	})

	it("matches the anchor case-insensitively", () => {
		const body =
			"Escalation runbook. First response is required Within 30 Minutes of the page."
		const note = chooseExcerpt(body, "within 30 minutes")
		expect(note).toContain("Within 30 Minutes")
	})

	it("trims table-cell fragments around a matched anchor", () => {
		const body = [
			"| Step | Owner | Deadline |",
			"| --- | --- | --- |",
			"| Page on-call | Support lead | Within 30 minutes |",
			"| Escalate | VP Support | 2 hours |",
		].join("\n")
		const note = chooseExcerpt(body, "within 30 minutes")
		expect(note).toContain("Within 30 minutes")
		expect(note.startsWith("|")).toBe(false)
		expect(note.endsWith("|")).toBe(false)
	})

	it("collapses whitespace runs but keeps the words verbatim", () => {
		const body = [
			"Pricing changed.",
			"",
			"Every product is priced per truck per month, list price.",
			"Discounts up to 25%.",
		].join("\n")
		const note = chooseExcerpt(body, "per truck per month")
		expect(note).toBe(
			"Every product is priced per truck per month, list price.",
		)
	})

	it("falls back to the opening of the body when the anchor is absent", () => {
		const body =
			"First sentence stands alone. Second sentence is here. Third one closes it out."
		const note = chooseExcerpt(body, "anchor that never appears")
		expect(note).toBe("First sentence stands alone. Second sentence is here.")
	})

	it("caps the excerpt length when the containing sentence is huge", () => {
		const long = `Prefix sentence. ${"filler words kept in the same very long sentence ".repeat(30)}the keystone anchor appears here ${"and even more filler words continue after it ".repeat(30)}. Trailing sentence.`
		const note = chooseExcerpt(long, "keystone anchor")
		expect(note).toContain("keystone anchor")
		expect(note.length).toBeLessThanOrEqual(600)
	})
})
