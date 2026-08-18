import type { ClientSession, Collection, Db } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import { recordWikiMutationIntent } from "./wiki-mutation-intents.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

describe("recordWikiMutationIntent", () => {
	it("records a canonical fingerprint and principal in the caller transaction", async () => {
		const insertOne = vi.fn(async () => ({
			acknowledged: true,
			insertedId: "intent-1",
		}))
		const db = {
			collection: vi.fn(() => ({ insertOne }) as unknown as Collection),
		} as unknown as Db
		const handle: WikiDbHandle = { db, prefix: "test_" }
		const session = {} as ClientSession

		const intent = await recordWikiMutationIntent(
			handle,
			{
				operationId: "op-1",
				kind: "update",
				pageSlug: "tables/accounts",
				scope: "workspace",
				scopeRef: "ws-1",
				principalSubjectId: "user:alice",
				payload: { z: 1, a: 2 },
			},
			session,
		)

		expect(intent).toMatchObject({
			operationId: "op-1",
			state: "recorded",
			principalSubjectId: "user:alice",
			payloadFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
		})
		expect(insertOne).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "op-1",
				payloadFingerprint: intent.payloadFingerprint,
			}),
			{ session },
		)
	})

	it("produces the same fingerprint for equivalent object key order", async () => {
		const inserts: Array<Record<string, unknown>> = []
		const handle = {
			db: {
				collection: () => ({
					insertOne: async (doc: Record<string, unknown>) => {
						inserts.push(doc)
						return { acknowledged: true, insertedId: "x" }
					},
				}),
			} as unknown as Db,
			prefix: "test_",
		}
		const base = {
			kind: "update" as const,
			pageSlug: "x",
			scope: "workspace",
			scopeRef: "ws-1",
			principalSubjectId: "user:alice",
		}

		await recordWikiMutationIntent(handle, {
			...base,
			operationId: "op-1",
			payload: { a: 1, b: 2 },
		})
		await recordWikiMutationIntent(handle, {
			...base,
			operationId: "op-2",
			payload: { b: 2, a: 1 },
		})

		expect(inserts[0]?.payloadFingerprint).toBe(inserts[1]?.payloadFingerprint)
	})
})
