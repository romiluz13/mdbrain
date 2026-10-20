import { describe, expect, it } from "vitest"
import { corpusDigest } from "./digest.js"

const records = new Map([
	["src-a", { body: "body a" }],
	["src-b", { body: "body b" }],
])
const world = {
	sources: [{ id: "src-a" }, { id: "src-b" }],
	pages: [{ slug: "company/alpha" }],
	contradiction: { incoming: { slug: "risks/view" } },
}

describe("corpusDigest", () => {
	it("is stable across calls and independent of map order", () => {
		const first = corpusDigest({ ...world, records })
		const reordered = new Map([...records.entries()].reverse())
		const second = corpusDigest({ ...world, records: reordered })
		expect(second).toBe(first)
		expect(first).toMatch(/^[0-9a-f]{64}$/)
	})

	it("flips when a rendered body or the world model changes", () => {
		const base = corpusDigest({ ...world, records })
		const changedBody = corpusDigest({
			...world,
			records: new Map(records).set("src-a", { body: "body a2" }),
		})
		const changedWorld = corpusDigest({
			...world,
			records,
			pages: [{ slug: "company/alpha" }, { slug: "entity/extra" }],
		})
		expect(changedBody).not.toBe(base)
		expect(changedWorld).not.toBe(base)
	})
})
