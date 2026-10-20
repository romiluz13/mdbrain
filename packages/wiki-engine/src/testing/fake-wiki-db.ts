// An in-memory stand-in for the wiki collections, for tests that need the
// real query filters (governance, $in lookups, sort, limit) to be evaluated
// rather than mocked. It implements only the operators the engine's reads use;
// a method it does not implement throws, so a query that sneaks in a count or
// a scan fails loudly instead of passing.

import type { Db, Document } from "mongodb"

type Condition = Document | string | number | boolean | null

function valuesAt(value: unknown, path: string[]): unknown[] {
	if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, path))
	if (path.length === 0) return [value]
	if (value === null || typeof value !== "object") return []
	const [head, ...rest] = path as [string, ...string[]]
	const next = (value as Document)[head]
	return next === undefined ? [] : valuesAt(next, rest)
}

function leafValues(doc: Document, path: string): unknown[] {
	return valuesAt(doc, path.split("."))
}

// An empty array still exists, which valuesAt (flattening) cannot tell.
function existsAt(value: unknown, path: string[]): boolean {
	if (path.length === 0) return value !== undefined
	if (Array.isArray(value)) return value.some((item) => existsAt(item, path))
	if (value === null || typeof value !== "object") return false
	const [head, ...rest] = path as [string, ...string[]]
	return existsAt((value as Document)[head], rest)
}

function getPath(doc: Document, path: string[]): unknown {
	let current: unknown = doc
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined
		current = (current as Document)[key]
	}
	return current
}

// Inequality operators use type bracketing: a comparison matches only values of
// the operand's own type, so null, a missing field and any other type never
// match. Strings compare by UTF-16 code units here and by UTF-8 bytes in
// MongoDB; the two agree for the characters slugs use.
function rangeKind(value: unknown): "date" | "number" | "string" | undefined {
	if (value instanceof Date) return "date"
	if (typeof value === "number") return "number"
	if (typeof value === "string") return "string"
	return undefined
}

function rangeMatches(op: string, value: unknown, operand: unknown): boolean {
	const operandKind = rangeKind(operand)
	if (!operandKind) throw new Error(`unsupported operand for ${op}`)
	if (rangeKind(value) !== operandKind) return false
	const a = value instanceof Date ? value.getTime() : (value as number | string)
	const b =
		operand instanceof Date ? operand.getTime() : (operand as number | string)
	if (op === "$gt") return a > b
	if (op === "$gte") return a >= b
	if (op === "$lt") return a < b
	return a <= b
}

function same(a: unknown, b: unknown): boolean {
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
	return a === b
}

function isOperatorObject(value: unknown): value is Document {
	return (
		typeof value === "object" &&
		value !== null &&
		!(value instanceof Date) &&
		!Array.isArray(value) &&
		Object.keys(value).length > 0 &&
		Object.keys(value).every((key) => key.startsWith("$"))
	)
}

export function matches(doc: Document, filter: Document): boolean {
	for (const [key, condition] of Object.entries(filter) as Array<
		[string, Condition]
	>) {
		if (key === "$and") {
			if (!(condition as unknown as Document[]).every((f) => matches(doc, f)))
				return false
			continue
		}
		if (key === "$or") {
			if (!(condition as unknown as Document[]).some((f) => matches(doc, f)))
				return false
			continue
		}
		if (key.startsWith("$")) throw new Error(`unsupported operator ${key}`)
		const values = leafValues(doc, key)
		if (isOperatorObject(condition)) {
			for (const [op, arg] of Object.entries(condition)) {
				if (op === "$in") {
					if (!values.some((v) => (arg as unknown[]).some((a) => same(v, a))))
						return false
				} else if (op === "$ne") {
					if (values.some((v) => same(v, arg))) return false
				} else if (op === "$exists") {
					if (existsAt(doc, key.split(".")) !== Boolean(arg)) return false
				} else if (
					op === "$gt" ||
					op === "$gte" ||
					op === "$lt" ||
					op === "$lte"
				) {
					if (!values.some((v) => rangeMatches(op, v, arg))) return false
				} else {
					throw new Error(`unsupported operator ${op}`)
				}
			}
		} else if (!values.some((v) => same(v, condition))) {
			return false
		}
	}
	return true
}

function setPath(target: Document, path: string[], value: unknown): void {
	const [head, ...rest] = path as [string, ...string[]]
	if (rest.length === 0) {
		target[head] = value
		return
	}
	const child =
		typeof target[head] === "object" && target[head] !== null
			? (target[head] as Document)
			: {}
	target[head] = child
	setPath(child, rest, value)
}

function project(doc: Document, projection?: Document): Document {
	if (!projection) return doc
	const out: Document = {}
	if (projection._id !== 0 && doc._id !== undefined) out._id = doc._id
	for (const [path, include] of Object.entries(projection)) {
		if (path === "_id" || !include) continue
		const found = getPath(doc, path.split("."))
		if (found !== undefined) setPath(out, path.split("."), found)
	}
	return out
}

export type RecordedQuery = {
	collection: string
	filter: Document
	options: Document
	sort?: Document
	limit?: number
}

export function createFakeWikiDb(
	collections: Record<string, Document[]>,
	prefix = "t_",
): { db: Db; prefix: string; queries: RecordedQuery[] } {
	const queries: RecordedQuery[] = []
	const db = {
		collection(name: string) {
			const docs = collections[name.replace(prefix, "")]
			if (!docs) throw new Error(`unexpected collection ${name}`)
			return {
				collectionName: name,
				find(filter: Document, options: Document = {}) {
					const record: RecordedQuery = {
						collection: name,
						filter,
						options,
					}
					queries.push(record)
					let sortSpec: Document | undefined
					let cap: number | undefined
					const cursor = {
						sort(spec: Document) {
							sortSpec = spec
							record.sort = spec
							return cursor
						},
						limit(n: number) {
							cap = n
							record.limit = n
							return cursor
						},
						async toArray() {
							let found = docs.filter((doc) => matches(doc, filter))
							if (sortSpec) {
								const keys = Object.entries(sortSpec)
								found = [...found].sort((a, b) => {
									for (const [key, dir] of keys) {
										const av = leafValues(a, key)[0] as number | string | Date
										const bv = leafValues(b, key)[0] as number | string | Date
										if (av < bv) return -1 * Number(dir)
										if (av > bv) return 1 * Number(dir)
									}
									return 0
								})
							}
							if (cap !== undefined) found = found.slice(0, cap)
							return found.map((doc) => project(doc, options.projection))
						},
					}
					return cursor
				},
				async findOne(filter: Document, options: Document = {}) {
					queries.push({ collection: name, filter, options })
					const found = docs.find((doc) => matches(doc, filter))
					return found ? project(found, options.projection) : null
				},
			}
		},
	} as unknown as Db
	return { db, prefix, queries }
}
