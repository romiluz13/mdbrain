import { describe, expect, it } from "vitest"
import { corpusDigest } from "./digest.js"

const records = new Map([
	["src-a", { body: "body a" }],
	["src-b", { body: "body b" }],
])
const world = {
	sources: [
		{ id: "src-a", date: "2026-07-01T09:00:00.000Z", kind: "crm_note" },
		{
			id: "src-b",
			date: "2026-07-02T09:00:00.000Z",
			kind: "slack_thread",
			storyline: "renewal",
		},
	],
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

	it.each([
		["business date", { date: "2026-07-09T09:00:00.000Z" }],
		["source kind", { kind: "support_ticket" }],
		["storyline", { storyline: "drift" }],
	])("flips when a source's %s changes, since it becomes event data", (_field, change) => {
		const base = corpusDigest({ ...world, records })
		const [a, b] = world.sources
		const changed = corpusDigest({
			...world,
			records,
			sources: [a, { ...b, ...change }],
		})
		expect(changed).not.toBe(base)
	})
})
