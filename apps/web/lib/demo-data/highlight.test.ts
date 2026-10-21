import { describe, expect, it } from "vitest"
import { highlightPhrase } from "./highlight.js"

const joined = (segments: ReturnType<typeof highlightPhrase>) =>
	segments.map((segment) => segment.text).join("")

describe("highlightPhrase", () => {
	it("marks the longest run of claim words found in the source, keeping the source text intact", () => {
		const source =
			"Spoke with Tobias. The Halvorsen renewal is healthy: budget confirmed."
		const segments = highlightPhrase(
			source,
			"The Halvorsen renewal is healthy.",
		)
		expect(joined(segments)).toBe(source)
		expect(segments.filter((s) => s.mark).map((s) => s.text)).toEqual([
			"The Halvorsen renewal is healthy",
		])
	})

	it("marks a shorter shared run when the wording differs", () => {
		const source =
			"Ticket 4411: trust has eroded, renewal at risk after the second outage."
		const segments = highlightPhrase(
			source,
			"The Halvorsen renewal is at risk.",
		)
		expect(segments.filter((s) => s.mark).map((s) => s.text)).toEqual([
			"at risk",
		])
		expect(joined(segments)).toBe(source)
	})

	it("matches case-insensitively but returns the source's own casing", () => {
		const segments = highlightPhrase(
			"BUDGET IS CONFIRMED today",
			"budget is confirmed",
		)
		expect(segments.find((s) => s.mark)?.text).toBe("BUDGET IS CONFIRMED")
	})

	it("returns the text unmarked when no two claim words appear together", () => {
		const segments = highlightPhrase(
			"Nothing related here.",
			"Renewal is healthy",
		)
		expect(segments).toEqual([
			{ text: "Nothing related here.", mark: false, start: 0 },
		])
	})

	it("returns an empty list for empty source text", () => {
		expect(highlightPhrase("", "anything")).toEqual([])
	})
})
