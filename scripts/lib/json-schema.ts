// Local JSON Schema subset validator for LLM structured output.
//
// Rationale (agreed plan W3): providers vary — Structured Outputs
// (`response_format: json_schema`) is model-gated, and unstructured models
// wrap output in prose or code fences. Local validation of every LLM
// response is mandatory regardless of provider support. This validator
// covers the subset we author: type (incl. type arrays and "integer"),
// properties, required, additionalProperties, enum, items, minimum,
// maximum. Schemas we define follow the strict-profile rules (every
// property listed in `required`, objects closed with
// `additionalProperties: false`, optional fields expressed as
// `["T", "null"]` unions rather than absent keys).

export interface JsonSchema {
	type?: string | string[]
	properties?: Record<string, JsonSchema>
	required?: string[]
	additionalProperties?: boolean
	enum?: Array<string | number | boolean | null>
	items?: JsonSchema
	minimum?: number
	maximum?: number
	description?: string
}

/** Validates `value` against the JSON Schema subset. Returns a list of
 *  violation messages (empty = valid). Unknown keywords are ignored. */
export function validateJsonSchema(
	schema: JsonSchema,
	value: unknown,
	path = "$",
): string[] {
	const violations: string[] = []
	validateNode(schema, value, path, violations)
	return violations
}

function validateNode(
	schema: JsonSchema,
	value: unknown,
	path: string,
	violations: string[],
): void {
	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type]
		if (!types.some((t) => matchesType(t, value))) {
			violations.push(
				`${path}: expected type ${types.join("|")}, got ${describeType(value)}`,
			)
			// Type mismatch invalidates deeper checks for this node.
			return
		}
	}
	if (schema.enum !== undefined) {
		const hit = schema.enum.some(
			(candidate) => typeof candidate === typeof value && candidate === value,
		)
		if (!hit) {
			violations.push(
				`${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
			)
		}
	}
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		!Number.isNaN(value)
	) {
		if (schema.minimum !== undefined && value < schema.minimum) {
			violations.push(`${path}: ${value} is below minimum ${schema.minimum}`)
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			violations.push(`${path}: ${value} is above maximum ${schema.maximum}`)
		}
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const record = value as Record<string, unknown>
		for (const key of schema.required ?? []) {
			if (record[key] === undefined) {
				violations.push(`${path}: missing required property "${key}"`)
			}
		}
		if (schema.properties) {
			for (const [key, childSchema] of Object.entries(schema.properties)) {
				if (record[key] !== undefined) {
					validateNode(childSchema, record[key], `${path}.${key}`, violations)
				}
			}
			if (schema.additionalProperties === false) {
				for (const key of Object.keys(record)) {
					if (!(key in schema.properties)) {
						violations.push(
							`${path}: unexpected property "${key}" (additionalProperties: false)`,
						)
					}
				}
			}
		}
	}
	if (Array.isArray(value)) {
		if (schema.items) {
			for (let i = 0; i < value.length; i++) {
				validateNode(
					schema.items as JsonSchema,
					value[i],
					`${path}[${i}]`,
					violations,
				)
			}
		}
	}
}

function matchesType(type: string, value: unknown): boolean {
	switch (type) {
		case "object":
			return (
				typeof value === "object" && value !== null && !Array.isArray(value)
			)
		case "array":
			return Array.isArray(value)
		case "string":
			return typeof value === "string"
		case "number":
			return typeof value === "number" && Number.isFinite(value)
		case "integer":
			return (
				typeof value === "number" &&
				Number.isInteger(value) &&
				Number.isFinite(value)
			)
		case "boolean":
			return typeof value === "boolean"
		case "null":
			return value === null
		default:
			// Unknown type keyword: cannot fail on it; ignore.
			return true
	}
}

function describeType(value: unknown): string {
	if (value === null) return "null"
	if (Array.isArray(value)) return "array"
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "number"
	}
	return typeof value
}
