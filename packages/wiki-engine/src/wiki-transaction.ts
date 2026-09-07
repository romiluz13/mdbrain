import type { ClientSession } from "mongodb"
import type { WikiDbHandle } from "./wiki-bridge.js"

/** Runs wiki mutations in one transaction without taking ownership of caller sessions. */
export async function withWikiTransaction<T>(
	handle: WikiDbHandle,
	session: ClientSession | undefined,
	operation: (session: ClientSession) => Promise<T>,
): Promise<T> {
	if (session?.inTransaction()) {
		return operation(session)
	}
	if (session) {
		return session.withTransaction(() => operation(session))
	}

	const ownedSession = (handle.client ?? handle.db.client).startSession()
	try {
		return await ownedSession.withTransaction(() => operation(ownedSession))
	} finally {
		await ownedSession.endSession()
	}
}
