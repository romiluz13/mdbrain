// An in-memory stand-in for a control collection, close enough to the
// driver's single-document semantics for the guarded transitions the
// presenter services rely on: equality, comparison, $in, $ne, $exists and $or
// filters; $set / $unset updates; a unique `_id` plus optional unique fields;
// returnDocument before / after. It proves the services' logic. Atomicity
// itself is the database's, and the live run exercises it for real.

import {
	DuplicateKeyError,
	type ControlCollection,
	type FindOneAndUpdateOptions,
} from "../collections.js"

type Doc = Record<string, unknown>

const clone = <T>(value: T): T => structuredClone(value)

const comparable = (value: unknown): unknown =>
	value instanceof Date ? value.getTime() : value

function matchesOperator(actual: unknown, operator: Doc): boolean {
	const value = comparable(actual)
	for (const [name, expected] of Object.entries(operator)) {
		const wanted = comparable(expected)
		switch (name) {
			case "$lte":
				if (!(value !== undefined && (value as number) <= (wanted as number)))
					return false
				break
			case "$lt":
				if (!(value !== undefined && (value as number) < (wanted as number)))
					return false
				break
			case "$gte":
				if (!(value !== undefined && (value as number) >= (wanted as number)))
					return false
				break
			case "$gt":
				if (!(value !== undefined && (value as number) > (wanted as number)))
					return false
				break
			case "$ne":
				if (value === wanted) return false
				break
			case "$in":
				if (!(expected as unknown[]).map(comparable).includes(value))
					return false
				break
			case "$exists":
				if ((actual !== undefined) !== expected) return false
				break
			default:
				throw new Error(`MemoryCollection does not support ${name}`)
		}
	}
	return true
}

function matches(doc: Doc, filter: Doc): boolean {
	for (const [key, expected] of Object.entries(filter)) {
		if (key === "$or") {
			if (!(expected as Doc[]).some((alternative) => matches(doc, alternative)))
				return false
			continue
		}
		const actual = doc[key]
		const isOperator =
			typeof expected === "object" &&
			expected !== null &&
			!(expected instanceof Date) &&
			!Array.isArray(expected) &&
			Object.keys(expected).some((name) => name.startsWith("$"))
		if (isOperator) {
			if (!matchesOperator(actual, expected as Doc)) return false
			continue
		}
		if (comparable(actual) !== comparable(expected)) return false
	}
	return true
}

export class MemoryCollection<T extends { _id: string }>
	implements ControlCollection<T>
{
	readonly docs = new Map<string, T>()
	/** Runs inside findOneAndUpdate before the match, so a test can let a
	 * rival write win the race. */
	beforeUpdate: ((filter: Doc) => void) | undefined

	constructor(
		private readonly unique: string[] = [],
		seed: T[] = [],
	) {
		for (const doc of seed) this.docs.set(doc._id, clone(doc))
	}

	private matching(filter: Doc, sort?: Record<string, 1 | -1>): T[] {
		const list = [...this.docs.values()].filter((doc) =>
			matches(doc as Doc, filter),
		)
		if (sort) {
			list.sort((a, b) => {
				for (const [field, direction] of Object.entries(sort)) {
					const left = comparable((a as Doc)[field]) as number
					const right = comparable((b as Doc)[field]) as number
					if (left !== right) return (left < right ? -1 : 1) * direction
				}
				return 0
			})
		}
		return list
	}

	async findOne(filter: Doc): Promise<T | null> {
		const found = this.matching(filter)[0]
		return found ? clone(found) : null
	}

	async find(filter: Doc): Promise<T[]> {
		return this.matching(filter).map(clone)
	}

	private assertUnique(doc: T, ignoreId?: string): void {
		if (doc._id !== ignoreId && this.docs.has(doc._id)) {
			throw new DuplicateKeyError(`_id ${doc._id}`)
		}
		for (const field of this.unique) {
			const value = (doc as Doc)[field]
			if (value === undefined) continue
			for (const other of this.docs.values()) {
				if (other._id !== ignoreId && (other as Doc)[field] === value) {
					throw new DuplicateKeyError(`${field} ${String(value)}`)
				}
			}
		}
	}

	async insertOne(doc: T): Promise<void> {
		this.assertUnique(doc)
		this.docs.set(doc._id, clone(doc))
	}

	async findOneAndUpdate(
		filter: Doc,
		update: Doc,
		options: FindOneAndUpdateOptions = {},
	): Promise<T | null> {
		this.beforeUpdate?.(filter)
		const matched = this.matching(filter, options.sort)[0]
		if (!matched) return null
		const before = clone(matched)
		const after = clone(matched) as Doc
		for (const [operator, fields] of Object.entries(update)) {
			if (operator === "$set") Object.assign(after, clone(fields as Doc))
			else if (operator === "$unset") {
				for (const field of Object.keys(fields as Doc)) delete after[field]
			} else throw new Error(`MemoryCollection does not support ${operator}`)
		}
		this.assertUnique(after as T, matched._id)
		this.docs.set(matched._id, after as T)
		return options.returnDocument === "before" ? before : clone(after as T)
	}

	async deleteOne(filter: Doc): Promise<number> {
		const found = this.matching(filter)[0]
		if (!found) return 0
		this.docs.delete(found._id)
		return 1
	}

	async deleteMany(filter: Doc): Promise<number> {
		const found = this.matching(filter)
		for (const doc of found) this.docs.delete(doc._id)
		return found.length
	}
}
