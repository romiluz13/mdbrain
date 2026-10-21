import { describe, expect, it } from "vitest"
import { countOf, nonEventEvidence } from "./plural.js"

describe("countOf", () => {
	it("uses the singular for exactly one", () => {
		expect(countOf(1, "claim")).toBe("1 claim")
		expect(countOf(1, "source event")).toBe("1 source event")
	})

	it("uses the plural for zero and for every other count", () => {
		expect(countOf(0, "link")).toBe("0 links")
		expect(countOf(2, "page")).toBe("2 pages")
		expect(countOf(182, "source event")).toBe("182 source events")
	})
})

describe("nonEventEvidence", () => {
	it("agrees the verb and the noun with the count", () => {
		expect(nonEventEvidence(1)).toBe(
			"1 evidence item that is not a source event",
		)
		expect(nonEventEvidence(2)).toBe(
			"2 evidence items that are not source events",
		)
	})
})
