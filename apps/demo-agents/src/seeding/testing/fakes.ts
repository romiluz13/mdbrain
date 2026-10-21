import { MdbrainClientError } from "@mdbrain/client"
import type {
	SeedClient,
	SeedRequestOptions,
	SeedWriteEventInput,
} from "../seed.js"

/** In-memory stand-ins for the MongoDB control collections and the API
 * client, used by the seeding unit tests. The fake collection mimics the
 * driver's findOneAndUpdate semantics closely enough for the guarded
 * one-way-state transitions: flat-equality and $or filters, $set /
 * $setOnInsert / $inc / $currentDate updates, sort, upsert, and the
 * returnDocument "before"/"after" behavior. */
export class FakeCollection<T extends { _id: string }> {
	readonly docs = new Map<string, T>()
	/** Hook fired inside findOneAndUpdate before the match is applied —
	 * used by tests to simulate a concurrent writer winning a race. */
	beforeUpdate: ((filter: Record<string, unknown>) => void) | undefined

	constructor(seed: T[] = []) {
		for (const doc of seed) this.docs.set(doc._id, doc)
	}

	async findOne(filter: Record<string, unknown>): Promise<T | null> {
		return this.query(filter)[0] ?? null
	}

	async findOneAndUpdate(
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options: {
			upsert?: boolean
			sort?: Record<string, 1 | -1>
			returnDocument?: "before" | "after"
		} = {},
	): Promise<T | null> {
		this.beforeUpdate?.(filter)
		const matched = this.query(filter, options.sort)[0]
		if (!matched) {
			if (!options.upsert) return null
			if (typeof filter._id !== "string") {
				throw new Error("FakeCollection upsert requires an _id equality filter")
			}
			const inserted = applyUpdate({ _id: filter._id } as T, update, {
				isInsert: true,
			})
			this.docs.set(filter._id, inserted)
			// Driver semantics: with returnDocument "before" an upsert
			// insert reports the (nonexistent) pre-update doc as null.
			if (options.returnDocument === "before") return null
			return clone(inserted)
		}
		const before = clone(matched)
		const after = applyUpdate(matched, update, { isInsert: false })
		this.docs.set(matched._id, after)
		return options.returnDocument === "before" ? before : clone(after)
	}

	private query(
		filter: Record<string, unknown>,
		sort?: Record<string, 1 | -1>,
	): T[] {
		const list = [...this.docs.values()].filter((doc) => matches(doc, filter))
		if (sort) {
			list.sort((a, b) => {
				for (const [field, direction] of Object.entries(sort)) {
					const left = (a as Record<string, unknown>)[field]
					const right = (b as Record<string, unknown>)[field]
					if (left === right) continue
					return compareValues(left, right) * direction
				}
				return 0
			})
		}
		return list
	}
}

/** Total order over unknown field values: numeric when both sides are
 * numbers (slot indexes), string otherwise. */
function compareValues(left: unknown, right: unknown): number {
	if (typeof left === "number" && typeof right === "number")
		return left < right ? -1 : 1
	return String(left) < String(right) ? -1 : 1
}

function matches(
	doc: Record<string, unknown>,
	filter: Record<string, unknown>,
): boolean {
	for (const [key, value] of Object.entries(filter)) {
		if (key === "$or") {
			const alternatives = value as Record<string, unknown>[]
			if (!alternatives.some((alt) => matches(doc, alt))) return false
			continue
		}
		if (isExistsOperator(value)) {
			if ((doc[key] !== undefined) !== value.$exists) return false
			continue
		}
		if (doc[key] !== value) return false
	}
	return true
}

function isExistsOperator(value: unknown): value is { $exists: boolean } {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { $exists?: unknown }).$exists === "boolean"
	)
}

function applyUpdate<T>(
	doc: T,
	update: Record<string, unknown>,
	{ isInsert }: { isInsert: boolean },
): T {
	const target = doc as Record<string, unknown>
	for (const [key, value] of Object.entries(update)) {
		const fields = value as Record<string, unknown>
		if (key === "$set") {
			Object.assign(target, fields)
		} else if (key === "$setOnInsert" && isInsert) {
			Object.assign(target, fields)
		} else if (key === "$inc") {
			for (const [field, amount] of Object.entries(fields)) {
				target[field] = (Number(target[field]) || 0) + (amount as number)
			}
		} else if (key === "$addToSet") {
			for (const [field, value] of Object.entries(fields)) {
				const list = (target[field] as unknown[] | undefined) ?? []
				if (
					!list.some((item) => JSON.stringify(item) === JSON.stringify(value))
				) {
					list.push(value)
				}
				target[field] = list
			}
		} else if (key === "$currentDate") {
			for (const field of Object.keys(fields)) {
				target[field] = new Date().toISOString()
			}
		}
	}
	return doc
}

function clone<T>(doc: T): T {
	return structuredClone(doc)
}
/** In-memory stand-in for the API client surface the seeder uses
 * (write-event + wiki create/get). Models the server behaviors the seeder
 * depends on: idempotency-key replay returns the original eventId, a
 * repeated create fails 409 DUPLICATE_SLUG, and wikiGet 404s on a missing
 * page. `script` queues one-shot errors for retry and fail-closed tests. */
export class FakeSeedClient implements SeedClient {
	calls: Array<{
		op: "writeEvent" | "wikiCreate" | "wikiGet"
		input: Record<string, unknown>
	}> = []
	/** idempotencyKey -> the event the server already stored. */
	readonly writeEvents = new Map<
		string,
		{ eventId: string; sourceId: string }
	>()
	readonly pages = new Map<string, { slug: string; revision: number }>()
	script: Array<{
		op: "writeEvent" | "wikiCreate" | "wikiGet"
		error: Error
	}> = []
	private eventIdSeq = 0

	async writeEvent(
		input: SeedWriteEventInput,
		_requestOptions?: SeedRequestOptions,
	): Promise<{ ok: true; eventId: string; chunkCreated: boolean }> {
		this.calls.push({ op: "writeEvent", input: { ...input } })
		const failure = this.takeScriptedFailure("writeEvent")
		if (failure) throw failure
		const existing = this.writeEvents.get(input.idempotencyKey)
		if (existing) {
			return { ok: true, eventId: existing.eventId, chunkCreated: false }
		}
		const eventId = `evt-${String(++this.eventIdSeq).padStart(3, "0")}`
		this.writeEvents.set(input.idempotencyKey, {
			eventId,
			sourceId: String(input.metadata?.seedSourceId ?? ""),
		})
		return { ok: true, eventId, chunkCreated: true }
	}

	async wikiCreate(input: {
		slug: string
	}): Promise<{ slug: string; revision: number }> {
		this.calls.push({ op: "wikiCreate", input: { ...input } })
		const failure = this.takeScriptedFailure("wikiCreate")
		if (failure) throw failure
		if (this.pages.has(input.slug)) {
			throw new MdbrainClientError(
				409,
				JSON.stringify({
					error: { code: "DUPLICATE_SLUG", message: "slug already exists" },
				}),
			)
		}
		const page = { slug: input.slug, revision: 1 }
		this.pages.set(input.slug, page)
		return page
	}

	async wikiGet(input: {
		slug: string
	}): Promise<{ slug: string; revision: number }> {
		this.calls.push({ op: "wikiGet", input: { ...input } })
		const failure = this.takeScriptedFailure("wikiGet")
		if (failure) throw failure
		const page = this.pages.get(input.slug)
		if (!page) {
			throw new MdbrainClientError(
				404,
				JSON.stringify({
					error: { code: "NOT_FOUND", message: "no such page" },
				}),
			)
		}
		return page
	}

	private takeScriptedFailure(op: "writeEvent" | "wikiCreate" | "wikiGet") {
		const index = this.script.findIndex((entry) => entry.op === op)
		if (index === -1) return undefined
		return this.script.splice(index, 1)[0].error
	}
}
