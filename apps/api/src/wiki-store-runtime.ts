import {
	WikiStore,
	resolveWikiStoreConfig,
	type WikiDbHandle,
	type WikiTransactionSession,
} from "@mdbrain/wiki-engine"

let wikiStore: WikiStore | undefined

export async function getWikiStoreHandle(): Promise<WikiDbHandle> {
	if (!wikiStore) {
		wikiStore = new WikiStore(resolveWikiStoreConfig())
	}
	await wikiStore.initialize()
	return wikiStore.handle()
}

export async function withWikiTransaction<T>(
	operation: (
		handle: WikiDbHandle,
		session: WikiTransactionSession,
	) => Promise<T>,
): Promise<T> {
	const handle = await getWikiStoreHandle()
	if (!wikiStore) throw new Error("WikiStore is not initialized")
	return wikiStore.transaction((session) => operation(handle, session))
}

export async function checkWikiStoreReadiness(): Promise<{
	transactional: true
}> {
	const handle = await getWikiStoreHandle()
	if (!wikiStore) throw new Error("WikiStore is not initialized")
	await handle.db.command({ ping: 1 })
	await wikiStore.transaction(async (session) => {
		await handle.db
			.collection(`${handle.prefix}wiki_pages`)
			.findOne({}, { projection: { _id: 1 }, session })
	})
	return { transactional: true }
}

export async function closeWikiStore(): Promise<void> {
	if (!wikiStore) return
	const store = wikiStore
	wikiStore = undefined
	await store.close()
}
