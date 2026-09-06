// json-schema.ts tests — the local validation floor for every LLM response.

import { describe, expect, it } from "vitest"
import { validateJsonSchema, type JsonSchema } from "./json-schema.js"

const SCHEMA: JsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["name", "count", "tags", "note"],
	properties: {
		name: { type: "string" },
		count: { type: "integer", minimum: 0, maximum: 10 },
		tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
		note: { type: ["string", "null"] },
	},
}

describe("validateJsonSchema", () => {
	it("accepts a valid document", () => {
		const violations = validateJsonSchema(SCHEMA, {
			name: "x",
			count: 3,
			tags: ["a"],
			note: null,
		})
		expect(violations).toEqual([])
	})

	it("flags missing keys", () => {
		const violations = validateJsonSchema(SCHEMA, { name: "x" })
		expect(
			violations.some((v) => v.includes('missing required property "count"')),
		).toBe(true)
	})

	it("flags wrong types (including integer vs number)", () => {
		expect(
			validateJsonSchema(SCHEMA, {
				name: "x",
				count: 1.5,
				tags: [],
				note: null,
			}),
		).toEqual([expect.stringContaining("$.count: expected type integer")])
		expect(
			validateJsonSchema(SCHEMA, { name: 7, count: 1, tags: [], note: null }),
		).toEqual([expect.stringContaining("$.name: expected type string")])
	})

	it("flags enum mismatches inside array items", () => {
		const violations = validateJsonSchema(SCHEMA, {
			name: "x",
			count: 1,
			tags: ["c"],
			note: null,
		})
		expect(violations).toEqual([
			expect.stringContaining('$.tags[0]: expected one of ["a","b"]'),
		])
	})

	it("flags out-of-range numbers", () => {
		expect(
			validateJsonSchema(SCHEMA, {
				name: "x",
				count: 11,
				tags: [],
				note: null,
			}),
		).toEqual([expect.stringContaining("above maximum 10")])
		expect(
			validateJsonSchema(SCHEMA, {
				name: "x",
				count: -1,
				tags: [],
				note: null,
			}),
		).toEqual([expect.stringContaining("below minimum 0")])
	})

	it("flags unexpected properties when additionalProperties is false", () => {
		const violations = validateJsonSchema(SCHEMA, {
			name: "x",
			count: 1,
			tags: [],
			note: null,
			extra: "no",
		})
		expect(violations).toEqual([
			expect.stringContaining('unexpected property "extra"'),
		])
	})

	it("accepts null through a nullable union type", () => {
		const violations = validateJsonSchema({ type: ["string", "null"] }, null)
		expect(violations).toEqual([])
	})

	it("accumulates multiple violations instead of failing fast", () => {
		const violations = validateJsonSchema(SCHEMA, { name: 1, count: "many" })
		expect(violations.length).toBeGreaterThanOrEqual(2)
	})
})
