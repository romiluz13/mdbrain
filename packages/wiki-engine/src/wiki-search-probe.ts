// @mdbrain/wiki-engine — search readiness probe.
//
// Verifies the search subsystem can actually serve queries: mongot
// reachability + index existence + a live $search round-trip. Used by the
// API's /ready check so a search outage fails readiness instead of silently
// serving empty results (ping + transactional writes stay healthy while
// mongot is dead — verified live on atlas-local:preview during WS-6).
//
// The probe now reports per-lane capabilities (P6): the TEXT lane is the
// guaranteed lane and stays fail-closed (probe throws → /ready 503), while
// the VECTOR/auto-embed lanes degrade to "unavailable" with an actionable,
// non-secret diagnostic instead of failing readiness. Verified live on
// atlas-local:preview (WS-7 experiments):
//   - keyless boot: the autoEmbed vector index is never created (mongot has
//     no registered model) — hybrid search still answers via the text lane
//     inside $rankFusion, so /ready must stay 200 with vector "unavailable".
//   - invalid key: the vector index IS created (the model registers from any
//     key string) but the query-embedding call fails at search time — the
//     $vectorSearch round-trip below catches this; index existence alone
//     would falsely report "ready".

import {
	wikiPagesCollection,
	WIKI_AUTO_EMBED_MODEL,
	WIKI_PAGES_SEARCH_INDEX_TARGETS,
} from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"
import { WikiSearchUnavailableError } from "./wiki-search.js"

/** Per-lane capability reported by the readiness probe. */
export type WikiSearchLaneCapability = "ready" | "unavailable"

/** Search capability block embedded in /ready (P6). `text` is "ready"
 *  whenever the probe resolves — the text lane is fail-closed (a broken text
 *  lane throws instead of producing this object). `vector`/`autoEmbed` share
 *  one probe: the autoEmbed field IS the vector lane (Atlas generates the
 *  query embedding via the same model API key). */
export interface WikiSearchCapabilities {
	text: "ready"
	vector: WikiSearchLaneCapability
	autoEmbed: WikiSearchLaneCapability
	/** Actionable, non-secret diagnostic when a lane is unavailable. */
	detail?: string
}

/** Readiness probe: verifies the search subsystem can actually serve queries.
 *  A plain ping or transactional findOne succeeds even while mongot is dead,
 *  so outages were previously indistinguishable from no-matches.
 *
 *  Text lane (fail-closed, calibrated against a live atlas-local:preview
 *  stack during WS-6 verification):
 *  1. listSearchIndexes on the wiki_pages text index — fails FAST (gRPC
 *     error, ~2s) when mongot is unreachable, and returns [] when the index
 *     was never created (misconfigured deployment → not search-ready).
 *  2. A $search round-trip — proves queries actually answer. Verified to
 *     HANG (no server-side timeout observed within 15s) when mongot dies
 *     mid-connection, hence the client-side bound.
 *
 *  Vector/auto-embed lane (degrading, never throws):
 *  3. listSearchIndexes on the vector index — missing → "unavailable"
 *     (keyless boot: mongot cannot register the model without an Atlas
 *     Model API key, so the autoEmbed index is never created).
 *  4. A bounded $vectorSearch round-trip with an auto-embedded query — a
 *     present-but-broken lane (e.g. invalid key: embedding call rejected at
 *     query time) reports "unavailable"; a successful round-trip proves the
 *     full path (mongot → model API → HNSW) and reports "ready". Cost note:
 *     in a keyed deployment this probe performs one embedding API call per
 *     readiness refresh (the API caches readiness for ~1s), which is the
 *     accepted price of not reporting a dead lane as "ready".
 *
 *  Throws WikiSearchUnavailableError when the TEXT lane cannot serve (→
 *  /ready 503); resolves with the per-lane capability block otherwise. */
export async function probeWikiSearch(
	handle: WikiDbHandle,
): Promise<WikiSearchCapabilities> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const textIndex = WIKI_PAGES_SEARCH_INDEX_TARGETS.text.name
	const vectorIndex = WIKI_PAGES_SEARCH_INDEX_TARGETS.vector.name

	// --- Text lane: fail-closed -------------------------------------------
	let textIndexes: Array<{ name?: unknown }> = []
	try {
		textIndexes = (await coll
			.listSearchIndexes(textIndex, probeOptions())
			.toArray()) as Array<{ name?: unknown }>
	} catch (err) {
		throw wrapUnavailable("wiki search probe failed", err)
	}
	if (!textIndexes.some((i) => i?.name === textIndex)) {
		throw new WikiSearchUnavailableError(
			`wiki search index "${textIndex}" is missing`,
		)
	}
	try {
		await coll
			.aggregate(
				[
					{
						$search: {
							index: textIndex,
							compound: {
								must: [
									{
										text: { path: ["title"], query: "readiness probe" },
									},
								],
							},
						},
					},
					{ $limit: 1 },
					{ $project: { _id: 1 } },
				],
				probeOptions(),
			)
			.toArray()
	} catch (err) {
		throw wrapUnavailable("wiki search probe failed", err)
	}

	// --- Vector / auto-embed lane: degrading ------------------------------
	try {
		const vectorIndexes = (await coll
			.listSearchIndexes(vectorIndex, probeOptions())
			.toArray()) as Array<{ name?: unknown }>
		if (!vectorIndexes.some((i) => i?.name === vectorIndex)) {
			return unavailable(
				"wiki vector index is not provisioned — set VOYAGE_API_KEY (Atlas Model API key, al-... prefix) on the MongoDB container to enable the auto-embed vector lane; text search remains available",
			)
		}
		await coll
			.aggregate(
				[
					{
						$vectorSearch: {
							index: vectorIndex,
							query: { text: "readiness probe" },
							model: WIKI_AUTO_EMBED_MODEL,
							path: "text",
							numCandidates: 10,
							limit: 1,
						},
					},
					{ $project: { _id: 1 } },
				],
				probeOptions(),
			)
			.toArray()
		return { text: "ready", vector: "ready", autoEmbed: "ready" }
	} catch (err) {
		const cause = err instanceof Error ? err.message : String(err)
		return unavailable(
			`wiki vector lane did not answer a probe query — the autoEmbed index exists but the query embedding failed; verify VOYAGE_API_KEY validity (Atlas Model API key, al-... prefix); text search remains available (cause: ${truncate(cause)})`,
		)
	}
}

function unavailable(detail: string): WikiSearchCapabilities {
	return {
		text: "ready",
		vector: "unavailable",
		autoEmbed: "unavailable",
		detail,
	}
}

function wrapUnavailable(
	message: string,
	cause: unknown,
): WikiSearchUnavailableError {
	if (cause instanceof WikiSearchUnavailableError) return cause
	return new WikiSearchUnavailableError(message, { cause })
}

function truncate(text: string): string {
	return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/** Client-side bound for search ops. $search can hang indefinitely when
 *  mongot dies mid-connection (verified live); the server enforces no
 *  observed timeout, so the client must cut it off. Enforced via the
 *  driver's per-operation timeoutMS deadline, which CANCELS the operation
 *  (server-side maxTimeMS on 4.4+ plus a client-side abort) — a
 *  Promise.race would return while leaving the command running, and one
 *  hanging op per readiness refresh would eventually exhaust the
 *  connection pool. */
const PROBE_TIMEOUT_MS = 5000

function probeOptions(): { timeoutMS: number } {
	return { timeoutMS: PROBE_TIMEOUT_MS }
}
