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
import {
	getWikiDbHandle,
	type WikiDbHandle,
	type WikiPageView,
} from "./wiki-bridge.js"

// ---------------------------------------------------------------------------
// Recipe profiles (fast/hybrid/deep) — mirrors memory-engine SearchRecipe.
// ---------------------------------------------------------------------------

export type WikiSearchRecipe = "fast" | "hybrid" | "deep"

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
}

export interface WikiSearchResult {
	page: WikiPageView
	score: number
	source: "vector" | "text" | "hybrid"
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
	if (params.scope) filter.scope = params.scope
	if (params.scopeRef) filter.scopeRef = params.scopeRef
	if (params.kind) filter.kind = params.kind
	if (params.trustTier) filter.trustTier = params.trustTier
	if (params.state) filter.state = params.state
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
	const compoundFilters: Document[] = []
	for (const [field, value] of Object.entries(prefilter)) {
		compoundFilters.push({ equals: { path: field, value } })
	}
	const compound: Document = { must }
	if (compoundFilters.length > 0) {
		compound.filter = compoundFilters
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
	pipeline.push({ $limit: cfg.maxResults })

	try {
		const docs = await coll.aggregate(pipeline).toArray()
		return docs.map((doc) => ({
			page: toView(doc as Document),
			score: typeof doc.searchScore === "number" ? doc.searchScore : 0,
			source:
				cfg.mode === "vector-only"
					? "vector"
					: cfg.mode === "text-only"
						? "text"
						: "hybrid",
		}))
	} catch {
		// Search indexes unavailable (no mongot) or pipeline error → empty.
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

	const results = await hybridSearch(handle, params, cfg, prefilter)
	return {
		results,
		total: results.length,
		recipe,
		mode: cfg.mode,
	}
}

/** Convenience: search using a manager (obtains the db handle). */
export async function searchWikiPagesViaManager(
	manager: unknown,
	params: WikiSearchParams,
): Promise<WikiSearchResponse> {
	return searchWikiPages(getWikiDbHandle(manager), params)
}
