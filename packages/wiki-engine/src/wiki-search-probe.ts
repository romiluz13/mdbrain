// @mdbrain/wiki-engine — search readiness probe.
//
// Verifies the search subsystem can actually serve queries: mongot
// reachability + index existence + a live $search round-trip. Used by the
// API's /ready check so a search outage fails readiness instead of silently
// serving empty results (ping + transactional writes stay healthy while
// mongot is dead — verified live on atlas-local:preview during WS-6).

import {
	wikiPagesCollection,
	WIKI_PAGES_SEARCH_INDEX_TARGETS,
} from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import { WikiSearchUnavailableError } from "./wiki-search.js"

/** Readiness probe: verifies the search subsystem can actually serve queries.
 *  A plain ping or transactional findOne succeeds even while mongot is dead,
 *  so outages were previously indistinguishable from no-matches.
 *
 *  Two checks, both calibrated against a live atlas-local:preview stack
 *  (WS-6 verification):
 *  1. listSearchIndexes on the wiki_pages text index — fails FAST (gRPC
 *     error, ~2s) when mongot is unreachable, and returns [] when the index
 *     was never created (misconfigured deployment → not search-ready).
 *  2. A $search round-trip — proves queries actually answer. Verified to
 *     HANG (no server-side timeout observed within 15s) when mongot dies
 *     mid-connection, hence the client-side bound.
 *
 *  Throws WikiSearchUnavailableError on any check failure or timeout;
 *  resolves to the number of docs matched by the probe query otherwise. */
export async function probeWikiSearch(handle: WikiDbHandle): Promise<number> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const textIndex = WIKI_PAGES_SEARCH_INDEX_TARGETS.text.name
	try {
		const indexes = (await withTimeout(
			coll.listSearchIndexes(textIndex).toArray(),
			"wiki search index management timed out",
		)) as Array<{ name?: unknown }>
		if (!indexes.some((i) => i?.name === textIndex)) {
			throw new WikiSearchUnavailableError(
				`wiki search index "${textIndex}" is missing`,
			)
		}
		const docs = await withTimeout(
			coll
				.aggregate([
					{
						$search: {
							index: textIndex,
							compound: {
								must: [{ text: { path: ["title"], query: "readiness probe" } }],
							},
						},
					},
					{ $limit: 1 },
				])
				.toArray(),
			"wiki search probe query timed out",
		)
		return docs.length
	} catch (err) {
		if (err instanceof WikiSearchUnavailableError) throw err
		throw new WikiSearchUnavailableError("wiki search probe failed", {
			cause: err,
		})
	}
}

/** Client-side bound for search ops. $search can hang indefinitely when
 *  mongot dies mid-connection (verified live); the server enforces no
 *  observed timeout, so the client must cut it off. */
const PROBE_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(message)), PROBE_TIMEOUT_MS),
		),
	])
}
