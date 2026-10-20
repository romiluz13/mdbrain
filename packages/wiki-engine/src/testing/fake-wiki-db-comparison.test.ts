// The changes feed reads revisions with $gt/$gte/$lt/$lte on dates, strings and
// numbers. MongoDB applies type bracketing to those operators (a comparison on a
// type matches only values of that type, so null, a missing field and a value of
// another type never match) and, for an array field, matches when one element of
// the right type satisfies it. The fake must do the same or the feed's paging
// tests pass against a stricter or looser server than the real one. Source:
// mongodb.com/docs/manual/reference/mql/query-predicates/type-bracketing/ (read
// 2026-10-20); null and missing values are the rule's consequence, which the page
// does not spell out, and were not run against a real server.

import { describe, expect, it } from "vitest"
import { matches } from "./fake-wiki-db.js"

const t = (iso: string) => new Date(iso)
const noon = t("2026-10-01T12:00:00.000Z")

describe("range operators on dates", () => {
	it("include the boundary for $gte and $lte and exclude it for $gt and $lt", () => {
		const doc = { createdAt: noon }

		expect(matches(doc, { createdAt: { $gte: noon } })).toBe(true)
		expect(matches(doc, { createdAt: { $lte: noon } })).toBe(true)
		expect(matches(doc, { createdAt: { $gt: noon } })).toBe(false)
		expect(matches(doc, { createdAt: { $lt: noon } })).toBe(false)
	})

	it("compare instants, not object identity", () => {
		const doc = { createdAt: t("2026-10-01T12:00:00.000Z") }

		expect(
			matches(doc, { createdAt: { $gte: t("2026-10-01T12:00:00.000Z") } }),
		).toBe(true)
		expect(
			matches(doc, { createdAt: { $lt: t("2026-10-01T12:00:00.001Z") } }),
		).toBe(true)
	})

	it("combine into a half-open window", () => {
		const window = {
			createdAt: { $gte: noon, $lt: t("2026-10-01T13:00:00.000Z") },
		}

		expect(matches({ createdAt: noon }, window)).toBe(true)
		expect(matches({ createdAt: t("2026-10-01T12:59:59.999Z") }, window)).toBe(
			true,
		)
		expect(matches({ createdAt: t("2026-10-01T13:00:00.000Z") }, window)).toBe(
			false,
		)
		expect(matches({ createdAt: t("2026-10-01T11:59:59.999Z") }, window)).toBe(
			false,
		)
	})
})

describe("range operators on strings and numbers", () => {
	it("order strings by simple binary comparison", () => {
		expect(matches({ pageSlug: "b" }, { pageSlug: { $gt: "a" } })).toBe(true)
		expect(matches({ pageSlug: "B" }, { pageSlug: { $gt: "a" } })).toBe(false)
		expect(matches({ pageSlug: "a/b" }, { pageSlug: { $gt: "a" } })).toBe(true)
		expect(matches({ pageSlug: "a" }, { pageSlug: { $gt: "a" } })).toBe(false)
	})

	it("order numbers numerically, not as text", () => {
		expect(matches({ revision: 10 }, { revision: { $gt: 9 } })).toBe(true)
		expect(matches({ revision: 2 }, { revision: { $lt: 10 } })).toBe(true)
		expect(matches({ revision: 3 }, { revision: { $gte: 3, $lte: 3 } })).toBe(
			true,
		)
	})
})

describe("type bracketing", () => {
	const unmatched: Array<[string, Record<string, unknown>]> = [
		["a null value", { createdAt: null }],
		["a missing field", {}],
		["a string", { createdAt: "2026-10-01T12:00:00.000Z" }],
		["a number", { createdAt: noon.getTime() }],
	]

	it.each(unmatched)("never matches a date comparison on %s", (_name, doc) => {
		for (const op of ["$gt", "$gte", "$lt", "$lte"]) {
			expect(matches(doc, { createdAt: { [op]: noon } }), op).toBe(false)
		}
	})

	it.each([
		["a null value", { revision: null }],
		["a missing field", {}],
		["a numeric string", { revision: "5" }],
		["a date", { revision: noon }],
	])("never matches a number comparison on %s", (_name, doc) => {
		for (const op of ["$gt", "$gte", "$lt", "$lte"]) {
			expect(matches(doc, { revision: { [op]: 3 } }), op).toBe(false)
		}
	})

	it("never matches a string comparison on a number", () => {
		expect(matches({ pageSlug: 7 }, { pageSlug: { $gt: "a" } })).toBe(false)
	})
})

describe("range operators on an array field", () => {
	it("match when one element of the operand's type satisfies the comparison", () => {
		expect(matches({ revisions: [1, 2, 5] }, { revisions: { $gt: 4 } })).toBe(
			true,
		)
		expect(matches({ revisions: [1, 2, 3] }, { revisions: { $gt: 4 } })).toBe(
			false,
		)
		expect(matches({ revisions: ["x", 5] }, { revisions: { $gt: 4 } })).toBe(
			true,
		)
		expect(matches({ revisions: ["x", "y"] }, { revisions: { $gt: 4 } })).toBe(
			false,
		)
	})
})
