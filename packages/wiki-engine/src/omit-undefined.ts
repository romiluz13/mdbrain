// @mdbrain/wiki-engine — undefined-safe MongoDB documents.
//
// MongoDB's Node driver serializes `undefined` property values as BSON null,
// which fails $jsonSchema validators that type a field as string/number/etc.
// whenever the field is optional-but-present (C2-15 / NB-1 defect class).
// Every document or $set object leaving the wiki engine passes through
// omitUndefined so an optional field is simply absent rather than null.
//
// Semantics:
//   - Plain-object properties whose value is `undefined` are dropped.
//   - Nested plain objects and arrays are recursed into.
//   - `undefined` array ELEMENTS are preserved as-is (dropping them would
//     silently reindex the array); no known write site produces them, and
//     the driver serializes them to null where a validator can catch it.
//   - null, 0, false, and "" are preserved — only `undefined` is dropped.

/** Returns a copy of `value` with every `undefined`-valued object property
 *  removed, recursively. The input is never mutated. Non-object inputs are
 *  returned unchanged. */
export function omitUndefined<T>(value: T): T {
	if (!Array.isArray(value) && typeof value !== "object") return value
	if (value === null) return value
	if (Array.isArray(value)) {
		return value.map((element) => omitUndefined(element)) as unknown as T
	}
	if (value instanceof Date) return value
	const out: Record<string, unknown> = {}
	for (const [key, propertyValue] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (propertyValue === undefined) continue
		out[key] = omitUndefined(propertyValue)
	}
	return out as unknown as T
}
