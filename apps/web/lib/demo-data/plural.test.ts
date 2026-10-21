import { describe, expect, it } from "vitest"
import { countOf } from "./plural.js"

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

	it("takes an irregular plural", () => {
		expect(countOf(1, "match", "matches")).toBe("1 match")
		expect(countOf(3, "match", "matches")).toBe("3 matches")
	})
})
