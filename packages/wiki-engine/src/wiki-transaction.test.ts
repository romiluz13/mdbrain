import type { ClientSession, Db, MongoClient } from "mongodb"
import { describe, expect, it, vi } from "vitest"
import type { WikiDbHandle } from "./wiki-bridge.js"
import { withWikiTransaction } from "./wiki-transaction.js"

function recordingSession(active: boolean): {
	session: ClientSession
	withTransaction: ReturnType<typeof vi.fn>
	endSession: ReturnType<typeof vi.fn>
} {
	const session = {} as ClientSession
	const withTransaction = vi.fn(async (callback: () => Promise<unknown>) =>
		callback(),
	)
	const endSession = vi.fn(async () => undefined)
	Object.assign(session, {
		inTransaction: vi.fn(() => active),
		withTransaction,
		endSession,
	})
	return { session, withTransaction, endSession }
}

describe("withWikiTransaction", () => {
	it("joins an active caller transaction without wrapping or ending it", async () => {
		const { session, withTransaction, endSession } = recordingSession(true)
		const operation = vi.fn(async () => "joined")
		const handle = { db: {} as Db, prefix: "test_" } satisfies WikiDbHandle

		await expect(withWikiTransaction(handle, session, operation)).resolves.toBe(
			"joined",
		)
		expect(operation).toHaveBeenCalledWith(session)
		expect(withTransaction).not.toHaveBeenCalled()
		expect(endSession).not.toHaveBeenCalled()
	})

	it("wraps an inactive caller session without ending it", async () => {
		const { session, withTransaction, endSession } = recordingSession(false)
		const operation = vi.fn(async () => "wrapped")
		const handle = { db: {} as Db, prefix: "test_" } satisfies WikiDbHandle

		await expect(withWikiTransaction(handle, session, operation)).resolves.toBe(
			"wrapped",
		)
		expect(operation).toHaveBeenCalledWith(session)
		expect(withTransaction).toHaveBeenCalledTimes(1)
		expect(endSession).not.toHaveBeenCalled()
	})

	it("owns and ends a session when the caller supplies none", async () => {
		const { session, withTransaction, endSession } = recordingSession(false)
		const client = {
			startSession: vi.fn(() => session),
		} as unknown as MongoClient
		const handle = {
			db: {} as Db,
			prefix: "test_",
			client,
		} satisfies WikiDbHandle
		const operation = vi.fn(async () => "owned")

		await expect(
			withWikiTransaction(handle, undefined, operation),
		).resolves.toBe("owned")
		expect(client.startSession).toHaveBeenCalledTimes(1)
		expect(operation).toHaveBeenCalledWith(session)
		expect(withTransaction).toHaveBeenCalledTimes(1)
		expect(endSession).toHaveBeenCalledTimes(1)
	})
})
