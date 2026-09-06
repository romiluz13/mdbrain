import {
	WikiStore,
	probeWikiSearch,
	resolveWikiStoreConfig,
	type WikiDbHandle,
	type WikiSearchCapabilities,
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
	search: WikiSearchCapabilities
}> {
	const handle = await getWikiStoreHandle()
	if (!wikiStore) throw new Error("WikiStore is not initialized")
	await handle.db.command({ ping: 1 })
	await wikiStore.transaction(async (session) => {
		await handle.db
			.collection(`${handle.prefix}wiki_pages`)
			.findOne({}, { projection: { _id: 1 }, session })
	})
	// Probe the search subsystem (mongot + Atlas Search indexes): ping and the
	// transactional findOne above succeed even while search is dead, which
	// left the node reporting /ready during search outages. The text lane is
	// fail-closed (probe throws → readiness fails). The vector/auto-embed
	// lanes degrade: probeWikiSearch resolves with a capability block
	// reporting "unavailable" + an actionable diagnostic when the Voyage model
	// key is missing or rejected — /ready stays 200 (text-ready) so a
	// keyless dev boot is not locked out (P6).
	const search = await probeWikiSearch(handle)
	return { transactional: true, search }
}

export async function closeWikiStore(): Promise<void> {
	if (!wikiStore) return
	const store = wikiStore
	wikiStore = undefined
	await store.close()
}
