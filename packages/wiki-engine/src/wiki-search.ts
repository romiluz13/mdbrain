// @mdbrain/wiki-engine — hybrid search over wiki_pages.
//
// $vectorSearch (HNSW on embedding) + Atlas Search (full-text on
// title+summary+body+aliases+frontmatter.tags) + $rankFusion (RRF) merged,
// with pre-filters for kind, scope+scopeRef, trustTier, and
// permissions.privacyTier. Reuses the memory-engine retrieval recipe pattern
// (fast/hybrid/deep) adapted to wiki_pages.
//
// T5. The retrieval layer agents + web console use.

import type { Document } from "mongodb"
import {
	wikiPagesCollection,
	WIKI_PAGES_SEARCH_INDEX_TARGETS,
} from "./wiki-schema.js"
import { type WikiDbHandle, type WikiPageView } from "./wiki-bridge.js"
import { createSubsystemLogger } from "@mdbrain/lib"
import {
	filterPagesByGovernance,
	type GovernanceContext,
} from "./wiki-governance.js"

const log = createSubsystemLogger("wiki:search")

// ---------------------------------------------------------------------------
// Recipe profiles (fast/hybrid/deep) — mirrors memory-engine SearchRecipe.
// ---------------------------------------------------------------------------

export type WikiSearchRecipe = "fast" | "hybrid" | "deep"

/** Rerank function signature — receives the query and candidate docs, returns reranked docs with updated scores. */
export type WikiRerankFn = (
	query: string,
	docs: Array<{ text: string; score: number }>,
) => Promise<Array<{ text: string; score: number }>>

interface RecipeConfig {
	recipe: WikiSearchRecipe
	maxResults: number
	mode: "vector-only" | "text-only" | "hybrid"
	numCandidatesMultiplier: number
	minScore: number
}

function recipeDefaults(
	recipe: WikiSearchRecipe,
	maxResults: number,
): RecipeConfig {
	switch (recipe) {
		case "fast":
			return {
				recipe,
				maxResults,
				mode: "vector-only",
				numCandidatesMultiplier: 10,
				minScore: 0.0,
			}
		case "hybrid":
			return {
				recipe,
				maxResults,
				mode: "hybrid",
				numCandidatesMultiplier: 20,
				minScore: 0.0,
			}
		case "deep":
			return {
				recipe,
				maxResults,
				mode: "hybrid",
				numCandidatesMultiplier: 40,
				minScore: 0.0,
			}
	}
}

// ---------------------------------------------------------------------------
// Search input + result
// ---------------------------------------------------------------------------

export interface WikiSearchParams {
	query: string
	scope?: string
	scopeRef?: string
	kind?: string
	trustTier?: string
	state?: string
	privacyTier?: string // permissions.privacyTier filter
	recipe?: WikiSearchRecipe
	maxResults?: number
	minScore?: number
	agentId?: string // not used for filtering; reserved for future per-agent perms
	governance?: GovernanceContext
	/** When provided, re-ranks search results using a cross-encoder (e.g. Voyage rerank-2.5). */
	rerank?: WikiRerankFn
	/** When true, adds native MongoDB $rerank aggregation stage (requires MongoDB 8.3+). */
	nativeRerank?: boolean
	/** When provided, expands search results with related pages via relationship graph traversal. */
	graphExpansion?: { maxDepth?: number; crossScope?: boolean }
}

export interface WikiSearchResult {
	page: WikiPageView
	score: number
	source: "vector" | "text" | "hybrid" | "graph"
}

export interface WikiSearchResponse {
	results: WikiSearchResult[]
	total: number
	recipe: WikiSearchRecipe
	mode: string
}

// ---------------------------------------------------------------------------
// Filter builder — the pre-filter applied in BOTH vector + text stages so
// $rankFusion receives only in-scope candidates (scoped retrieval + governance).
// ---------------------------------------------------------------------------

function buildPrefilter(params: WikiSearchParams): Document {
	const filter: Document = {}
	const scope = params.governance?.scope ?? params.scope
	const scopeRef = params.governance?.scopeRef ?? params.scopeRef
	if (scope) filter.scope = scope
	if (scopeRef) filter.scopeRef = scopeRef
	if (params.kind) filter.kind = params.kind
	if (params.trustTier) filter.trustTier = params.trustTier
	// Default: exclude superseded pages unless the caller explicitly requests them.
	if (params.state) {
		filter.state = params.state
	} else {
		filter.state = { $ne: "superseded" }
	}
	if (params.privacyTier) filter["permissions.privacyTier"] = params.privacyTier
	return filter
}

// ---------------------------------------------------------------------------
// Pipeline builders
// ---------------------------------------------------------------------------

function buildVectorStage(
	params: WikiSearchParams,
	cfg: RecipeConfig,
	prefilter: Document,
): Document | null {
	// Auto-embed mode: MongoDB Atlas generates the query embedding via
	// Voyage AI from the query text. No pre-computed queryVector needed.
	// Mirrors memory-engine buildVectorSearchStage (mongodb-search.ts:496-503).
	if (!params.query || !params.query.trim()) return null
	const numCandidates = Math.max(
		cfg.maxResults * cfg.numCandidatesMultiplier,
		100,
	)
	return {
		index: WIKI_PAGES_SEARCH_INDEX_TARGETS.vector.name,
		query: { text: params.query },
		model: "voyage-4-large",
		path: "text",
		numCandidates,
		limit: cfg.maxResults * 4,
		filter: prefilter,
	}
}

function buildTextCompound(query: string, prefilter: Document): Document {
	const must: Document[] = [
		{
			text: {
				path: ["title", "summary", "body", "aliases", "frontmatter.tags"],
				query,
			},
		},
	]
	// Atlas Search compound.filter (no scoring) for the scalar pre-filter axes.
	// $ne values are routed to compound.mustNot (Atlas Search doesn't support
	// $ne in filter — mustNot with equals is the correct equivalent).
	const compoundFilters: Document[] = []
	const mustNot: Document[] = []
	for (const [field, value] of Object.entries(prefilter)) {
		if (value && typeof value === "object" && "$ne" in value) {
			mustNot.push({
				equals: { path: field, value: (value as { $ne: unknown }).$ne },
			})
		} else {
			compoundFilters.push({ equals: { path: field, value } })
		}
	}
	const compound: Document = { must }
	if (compoundFilters.length > 0) {
		compound.filter = compoundFilters
	}
	if (mustNot.length > 0) {
		compound.mustNot = mustNot
	}
	return compound
}

function toView(doc: Document): WikiPageView {
	const { _id, embedding, text, ...rest } = doc as Record<string, unknown> & {
		_id: { toString(): string }
	}
	void embedding
	void text
	const out: Record<string, unknown> = { _id: _id.toString(), ...rest }
	for (const dateField of [
		"validFrom",
		"validTo",
		"lastMaintainedAt",
		"createdAt",
		"updatedAt",
	]) {
		if (out[dateField] instanceof Date) {
			out[dateField] = (out[dateField] as Date).toISOString()
		}
	}
	return out as unknown as WikiPageView
}

// ---------------------------------------------------------------------------
// Hybrid search (vector + text + $rankFusion)
// ---------------------------------------------------------------------------

async function hybridSearch(
	handle: WikiDbHandle,
	params: WikiSearchParams,
	cfg: RecipeConfig,
	prefilter: Document,
	fetchLimit: number,
): Promise<WikiSearchResult[]> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const vsStage = buildVectorStage(params, cfg, prefilter)
	const pipeline: Document[] = []

	if (cfg.mode === "vector-only" && vsStage) {
		pipeline.push({ $vectorSearch: vsStage })
		// $vectorSearch exposes the vectorSearchScore metadata keyword (NOT
		// searchScore — that's for $search). Mirrors memory-engine mongodb-search.ts:570.
		pipeline.push({
			$addFields: { searchScore: { $meta: "vectorSearchScore" } },
		})
	} else if (cfg.mode === "text-only" || !vsStage) {
		pipeline.push({
			$search: {
				index: WIKI_PAGES_SEARCH_INDEX_TARGETS.text.name,
				compound: buildTextCompound(params.query, prefilter),
			},
		})
		pipeline.push({ $limit: cfg.maxResults * 4 })
		pipeline.push({ $addFields: { searchScore: { $meta: "searchScore" } } })
	} else {
		// hybrid: $rankFusion of vector + text pipelines (RRF). scoreDetails:true
		// exposes the fused score via $meta:"scoreDetails" → .value. Mirrors
		// memory-engine mongodb-search.ts:861-893.
		pipeline.push({
			$rankFusion: {
				input: {
					pipelines: {
						vector: [{ $vectorSearch: vsStage }],
						text: [
							{
								$search: {
									index: WIKI_PAGES_SEARCH_INDEX_TARGETS.text.name,
									compound: buildTextCompound(params.query, prefilter),
								},
							},
							{ $limit: cfg.maxResults * 4 },
						],
					},
				},
				combination: { weights: { vector: 1, text: 1 } },
				scoreDetails: true,
			},
		})
		pipeline.push({ $addFields: { scoreDetails: { $meta: "scoreDetails" } } })
		pipeline.push({ $addFields: { searchScore: "$scoreDetails.value" } })
	}
	// Native $rerank stage (MongoDB 8.3+, Public Preview June 2026).
	// Runs server-side in the aggregation pipeline — no app-side HTTP round trip.
	// Per MongoDB docs: { $rerank: { query: "text", model: "rerank-2.5", top_k: N } }
	//
	// The $rerank stage is tracked by index so that on an unsupported server
	// (pre-8.3 or no Preview) we can retry the aggregation WITHOUT it, returning
	// unranked results instead of blanking the entire search. See the catch
	// block below — do NOT let a rerank-only failure collapse all results.
	let rerankStageIndex = -1
	if (params.nativeRerank) {
		rerankStageIndex = pipeline.length
		pipeline.push({
			$rerank: {
				query: params.query,
				model: "rerank-2.5",
				top_k: fetchLimit,
			},
		})
	}
	pipeline.push({ $limit: fetchLimit })

	const mapResults = (docs: Document[]): WikiSearchResult[] =>
		docs.map((doc) => ({
			page: toView(doc as Document),
			score: typeof doc.searchScore === "number" ? doc.searchScore : 0,
			source:
				cfg.mode === "vector-only"
					? "vector"
					: cfg.mode === "text-only"
						? "text"
						: "hybrid",
		}))

	try {
		const docs = await coll.aggregate(pipeline).toArray()
		return mapResults(docs)
	} catch (err) {
		// If $rerank was requested but the server doesn't support it (MongoDB
		// 8.3+ Public Preview), the whole aggregation throws. Retry without the
		// $rerank stage so callers still get unranked results instead of an
		// empty set. Do NOT blank the entire search for a rerank-only failure.
		if (rerankStageIndex >= 0) {
			const msg = err instanceof Error ? err.message : String(err)
			log.warn(
				`$rerank stage failed (${msg}); retrying wiki search without rerank`,
			)
			const withoutRerank = pipeline.filter((_, i) => i !== rerankStageIndex)
			try {
				const docs = await coll.aggregate(withoutRerank).toArray()
				return mapResults(docs)
			} catch {
				// Search indexes genuinely unavailable (no mongot) → empty.
				return []
			}
		}
		// No rerank was requested → this is a genuine search-index failure.
		return []
	}
}

// ---------------------------------------------------------------------------
// Graph expansion: traverse relationships[] to find related pages
// ---------------------------------------------------------------------------

/** Graph expansion via native MongoDB $graphLookup. Traverses
 *  relationships[].targetPageSlug → slug on the same wiki_pages collection.
 *  Mirrors memory-engine $graphLookup pattern (mongodb-graph.ts:1007-1020).
 *  Returns related pages not already in the search result set. */
async function expandGraph(
	handle: WikiDbHandle,
	searchResults: WikiSearchResult[],
	params: WikiSearchParams,
	prefilter: Document,
): Promise<WikiPageView[]> {
	const coll = wikiPagesCollection(handle.db, handle.prefix)
	const maxDepth = params.graphExpansion?.maxDepth ?? 1
	const maxExpansion = 20 // cap to avoid unbounded expansion
	const startSlugs = searchResults.map((r) => r.page.slug)

	// Build $graphLookup pipeline: match seed pages → traverse relationships
	// Self-referential: from = same collection, connectFromField = relationships.targetPageSlug, connectToField = slug
	const pipeline: Document[] = [
		{ $match: { slug: { $in: startSlugs } } },
		{
			$graphLookup: {
				from: coll.collectionName,
				startWith: "$relationships.targetPageSlug",
				connectFromField: "relationships.targetPageSlug",
				connectToField: "slug",
				as: "relatedPages",
				maxDepth: maxDepth,
				depthField: "depth",
				restrictSearchWithMatch: prefilter,
			},
		},
		{ $unwind: "$relatedPages" },
		{ $replaceRoot: "$relatedPages" },
		{ $limit: maxExpansion },
	]

	try {
		const docs = await coll.aggregate(pipeline).toArray()
		const existingSlugs = new Set(startSlugs)
		const result: WikiPageView[] = []
		for (const doc of docs) {
			const view = toView(doc as Document)
			if (!existingSlugs.has(view.slug)) {
				result.push(view)
				existingSlugs.add(view.slug)
			}
		}
		return result
	} catch {
		return []
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Hybrid search over wiki_pages. Returns ranked results, or empty (never
 *  throws) when no results or search indexes are unavailable. */
export async function searchWikiPages(
	handle: WikiDbHandle,
	params: WikiSearchParams,
): Promise<WikiSearchResponse> {
	const recipe = params.recipe ?? "hybrid"
	const maxResults = Math.min(params.maxResults ?? 10, 100)
	const cfg = recipeDefaults(recipe, maxResults)
	if (params.minScore !== undefined) cfg.minScore = params.minScore
	const prefilter = buildPrefilter(params)

	if (!params.query.trim()) {
		return { results: [], total: 0, recipe, mode: cfg.mode }
	}

	// Governance ACL filtering (roles/departments/privacyTier visibility)
	// cannot be expressed in Atlas Search compound filters ($exists and $or
	// are unsupported there), so it runs post-search via
	// filterPagesByGovernance. Applying the final top-K limit BEFORE that
	// filter let ACL-blocked pages shrink the result set below K even when
	// more visible candidates existed past rank K. Fix: over-fetch 4x when a
	// governance context is present (matching the per-stage limits of
	// maxResults*4 the vector/text stages already use), filter the larger
	// pool, then trim back to K. Residual risk, documented deliberately:
	// if more than 3/4 of the top candidates are ACL-blocked, results can
	// still fall below K — full MQL pre-filtering would need a dedicated
	// governed index or post-$rankFusion $match stage (future work).
	const fetchLimit = params.governance ? cfg.maxResults * 4 : cfg.maxResults
	let results = await hybridSearch(handle, params, cfg, prefilter, fetchLimit)

	// Post-filter the over-fetched pool through governance (roles/departments/
	// privacyTier visibility checks that can't be expressed in Atlas Search
	// compound). Scope + the exact privacyTier param are already pre-filtered
	// at the index level via buildPrefilter; the visibility filter runs here
	// on the 4x pool so blocked pages cannot shrink results below top-K.
	if (params.governance) {
		const govDocs = filterPagesByGovernance(
			results.map((r) => r.page as unknown as Document),
			params.governance,
		)
		const allowedSlugs = new Set(
			govDocs.map((d) => (d as Record<string, unknown>).slug as string),
		)
		results = results.filter((r) => allowedSlugs.has(r.page.slug))
	}

	// Reranking: cross-encoder re-ranks search results (e.g. Voyage rerank-2.5).
	// Mirrors memory-engine's rerankResults pattern (mongodb-manager.ts:2644).
	if (params.rerank && results.length > 1) {
		try {
			const docs = results.map((r) => ({
				text: `${r.page.title} ${r.page.summary} ${r.page.body}`,
				score: r.score,
			}))
			const reranked = await params.rerank(params.query, docs)
			// Reorder results to match reranked order, update scores.
			results = results.map((r, i) => ({
				...r,
				score: reranked[i]?.score ?? r.score,
			}))
		} catch {
			// Reranking failure → keep original results (never crash search)
		}
	}

	// Trim the filtered + reranked pool back to the requested top-K. Without
	// a governance context the pipeline already limited to K; with one, the
	// 4x over-fetched pool is trimmed here.
	if (results.length > maxResults) {
		results = results.slice(0, maxResults)
	}

	// Graph expansion: traverse relationships[] to find related pages.
	// Uses BFS over wiki relationships (same graph as $graphLookup would traverse).
	if (params.graphExpansion && results.length > 0) {
		try {
			const expanded = await expandGraph(handle, results, params, prefilter)
			const governedExpanded = params.governance
				? filterPagesByGovernance(
						expanded as unknown as Document[],
						params.governance,
					).map((page) => page as unknown as WikiPageView)
				: expanded
			// Merge expanded pages, avoiding duplicates from search results.
			const existingSlugs = new Set(results.map((r) => r.page.slug))
			for (const page of governedExpanded) {
				if (!existingSlugs.has(page.slug)) {
					results.push({
						page,
						score: 0, // graph-expanded pages have no search score
						source: "graph",
					})
					existingSlugs.add(page.slug)
				}
			}
		} catch {
			// Graph expansion failure → keep search results only
		}
	}

	return {
		results,
		total: results.length,
		recipe,
		mode: cfg.mode,
	}
}
