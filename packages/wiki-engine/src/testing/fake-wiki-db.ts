// An in-memory stand-in for the wiki collections, for tests that need the
// real query filters (governance, $in lookups, sort, limit) to be evaluated
// rather than mocked. It implements only the operators the engine's reads use;
// a method it does not implement throws, so a query that sneaks in a count or
// a scan fails loudly instead of passing. Writes are limited to single-document
// updates ($set, $unset, $inc, $addToSet, $push); aggregate runs only $match
// and $project; a dotted projection reaches through arrays, as MongoDB does.

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

// Reads hand out copies, as a server does: a later write must not change a
// document a caller already holds.
// A dotted path reaches through arrays, as in MongoDB: "claims.id" keeps the id
// of each claim and nothing else.
type ProjectionTree = { [key: string]: ProjectionTree | true }

function include(value: unknown, tree: ProjectionTree | true): unknown {
	if (tree === true) return structuredClone(value)
	if (Array.isArray(value)) {
		return value
			.map((item) => include(item, tree))
			.filter((item) => item !== undefined)
	}
	if (value === null || typeof value !== "object") return undefined
	const out: Document = {}
	for (const [key, sub] of Object.entries(tree)) {
		const picked = include((value as Document)[key], sub)
		if (picked !== undefined) out[key] = picked
	}
	return out
}

function project(doc: Document, projection?: Document): Document {
	if (!projection) return structuredClone(doc)
	const tree: ProjectionTree = {}
	for (const [path, keep] of Object.entries(projection)) {
		if (path === "_id" || !keep) continue
		let node = tree
		const keys = path.split(".")
		for (const key of keys.slice(0, -1)) {
			const next = node[key]
			if (typeof next === "object") {
				node = next
				continue
			}
			const child: ProjectionTree = {}
			node[key] = child
			node = child
		}
		node[keys[keys.length - 1] as string] = true
	}
	const out = include(doc, tree) as Document
	if (projection._id !== 0 && doc._id !== undefined) out._id = doc._id
	return out
}

function applyUpdate(doc: Document, update: Document): void {
	for (const [op, spec] of Object.entries(update) as Array<
		[string, Document]
	>) {
		if (op === "$set") {
			for (const [path, value] of Object.entries(spec)) {
				setPath(doc, path.split("."), value)
			}
		} else if (op === "$unset") {
			for (const path of Object.keys(spec)) delete doc[path]
		} else if (op === "$inc") {
			for (const [path, by] of Object.entries(spec)) {
				doc[path] = ((doc[path] as number | undefined) ?? 0) + (by as number)
			}
		} else if (op === "$push") {
			for (const [path, item] of Object.entries(spec)) {
				doc[path] = [
					...((doc[path] as unknown[] | undefined) ?? []),
					structuredClone(item),
				]
			}
		} else if (op === "$addToSet") {
			for (const [path, add] of Object.entries(spec)) {
				const current = (doc[path] as unknown[] | undefined) ?? []
				const items = (add as { $each?: unknown[] }).$each ?? [add]
				doc[path] = [
					...current,
					...items.filter((item) => !current.some((c) => same(c, item))),
				]
			}
		} else {
			throw new Error(`unsupported update operator ${op}`)
		}
	}
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
					let offset = 0
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
						skip(n: number) {
							offset = n
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
							found = found.slice(offset)
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
				async countDocuments(filter: Document) {
					queries.push({ collection: name, filter, options: {} })
					return docs.filter((doc) => matches(doc, filter)).length
				},
				async insertOne(doc: Document) {
					docs.push(structuredClone(doc))
					return { acknowledged: true }
				},
				async updateOne(filter: Document, update: Document) {
					const found = docs.find((doc) => matches(doc, filter))
					if (found) applyUpdate(found, update)
					return { matchedCount: found ? 1 : 0 }
				},
				// Only the $match and $project stages the engine's reads use.
				aggregate(pipeline: Document[]) {
					queries.push({
						collection: name,
						filter: pipeline[0]?.$match ?? {},
						options: { pipeline },
					})
					return {
						async toArray() {
							let found = docs
							for (const stage of pipeline) {
								if (stage.$match) {
									found = found.filter((doc) => matches(doc, stage.$match))
								} else if (stage.$project) {
									found = found.map((doc) => project(doc, stage.$project))
								} else {
									throw new Error(`unsupported stage ${Object.keys(stage)[0]}`)
								}
							}
							return found.map((doc) => structuredClone(doc))
						},
					}
				},
				// The filter is evaluated and the write applied in one synchronous
				// step, as a server does for a single document, so two callers
				// racing on one predicate cannot both match.
				async findOneAndUpdate(filter: Document, update: Document) {
					const found = docs.find((doc) => matches(doc, filter))
					if (!found) return null
					applyUpdate(found, update)
					return structuredClone(found)
				},
			}
		},
	} as unknown as Db
	return { db, prefix, queries }
}
