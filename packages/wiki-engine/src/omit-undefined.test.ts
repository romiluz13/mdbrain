// Unit tests for omitUndefined — the undefined-safe document gate for every
// MongoDB write in the wiki engine (C2-15 / NB-1 defect class: the driver
// serializes undefined to BSON null, which fails $jsonSchema validators).

import { describe, expect, it } from "vitest"
import { omitUndefined } from "./omit-undefined.js"

describe("omitUndefined", () => {
	it("drops undefined-valued properties", () => {
		expect(omitUndefined({ a: 1, b: undefined, c: "x" })).toEqual({
			a: 1,
			c: "x",
		})
	})

	it("preserves null, 0, false, and empty string", () => {
		expect(omitUndefined({ a: null, b: 0, c: false, d: "" })).toEqual({
			a: null,
			b: 0,
			c: false,
			d: "",
		})
	})

	it("recurses into nested objects", () => {
		expect(
			omitUndefined({
				outer: "keep",
				nested: { keep: 1, drop: undefined, deeper: { drop: undefined } },
			}),
		).toEqual({
			outer: "keep",
			nested: { keep: 1, deeper: {} },
		})
	})

	it("recurses into objects inside arrays", () => {
		expect(
			omitUndefined({
				claims: [
					{ id: "c1", writerAgent: undefined },
					{ id: "c2", supersedesClaimId: "c1" },
				],
			}),
		).toEqual({
			claims: [{ id: "c1" }, { id: "c2", supersedesClaimId: "c1" }],
		})
	})

	it("preserves undefined array elements (documented behavior)", () => {
		expect(omitUndefined({ arr: [1, undefined, 3] })).toEqual({
			arr: [1, undefined, 3],
		})
	})

	it("does not mutate the input", () => {
		const input = { a: 1, nested: { drop: undefined } }
		const frozen = JSON.stringify(input)
		omitUndefined(input)
		expect(JSON.stringify(input)).toBe(frozen)
	})

	it("passes primitives and Dates through unchanged", () => {
		const date = new Date()
		expect(omitUndefined(5)).toBe(5)
		expect(omitUndefined("x")).toBe("x")
		expect(omitUndefined(null)).toBe(null)
		expect(omitUndefined(date)).toBe(date)
	})

	it("empties an all-undefined object", () => {
		expect(omitUndefined({ a: undefined, b: undefined })).toEqual({})
	})
})
