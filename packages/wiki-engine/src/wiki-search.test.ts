// wiki-search.ts unit tests (T5).
//
// Mocks the MongoDB collection.aggregate so the pipeline SHAPE is verified
// (vector stage, text compound, $rankFusion, pre-filters, recipe modes) without
// a live mongot. Verifies: empty query → empty result; vector-only (fast);
// text-only (no vector); hybrid ($rankFusion); pre-filters applied to both
// stages; aggregate failure throws WikiSearchUnavailableError (outage, NOT
// no-matches); minScore filters results below the floor; rerank reorders
// results by the reranker's own order with its own scores; probeWikiSearch
// exercises the text search index.

/* eslint-disable @typescript-eslint/unbound-method -- Vitest mock method assertions */
import type { Collection, Db, Document } from "mongodb"
import { describe, it, expect, vi } from "vitest"
import { probeWikiSearch } from "./wiki-search-probe.js"
import { searchWikiPages, WikiSearchUnavailableError } from "./wiki-search.js"
import { WIKI_PAGES_SEARCH_INDEX_TARGETS } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

function mockDb(capturedPipeline?: { push: (p: Document[]) => void }): {
	db: Db
	coll: Collection
} {
	const coll = {
		collectionName: "test_wiki_pages",
		aggregate: vi.fn((pipeline: Document[]) => {
			capturedPipeline?.push(pipeline)
			// Return a couple of fake docs with searchScore.
			const docs = [
				{
					_id: { toString: () => "id1" },
					kind: "concept",
					title: "Accounts",
					slug: "tables/accounts",
					aliases: [],
					summary: "s",
					body: "b",
					frontmatter: { type: "table" },
					claims: [],
					contradictions: [],
					questions: [],
					relationships: [],
					personCard: null,
					scope: "workspace",
					scopeRef: "ws-1",
					trustTier: "standard",
					permissions: {},
					state: "active",
					revision: 1,
					validFrom: new Date(),
					freshness: "fresh",
					backlinks: [],
					createdAt: new Date(),
					updatedAt: new Date(),
					searchScore: 1.5,
				},
			]
			return { toArray: async () => docs }
		}),
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { db, coll }
}

function handle(): WikiDbHandle {
	const { db } = mockDb()
	return { db, prefix: "test_" }
}

/** Fake wiki_pages doc with a searchScore, for scored-result assertions. */
function makeDoc(slug: string, searchScore: number, title = slug): Document {
	return {
		_id: { toString: () => `id-${slug}` },
		kind: "concept",
		title,
		slug,
		aliases: [],
		summary: `summary of ${slug}`,
		body: `body of ${slug}`,
		frontmatter: { type: "concept" },
		claims: [],
		contradictions: [],
		questions: [],
		relationships: [],
		personCard: null,
		scope: "workspace",
		scopeRef: "ws-1",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 1,
		validFrom: new Date(),
		freshness: "fresh",
		backlinks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		searchScore,
	}
}

function handleWithDocs(docs: Document[]): {
	h: WikiDbHandle
	aggregate: ReturnType<typeof vi.fn>
} {
	const aggregate = vi.fn(() => ({ toArray: async () => docs }))
	const coll = {
		collectionName: "test_wiki_pages",
		aggregate,
	} as unknown as Collection
	const db = { collection: vi.fn(() => coll) } as unknown as Db
	return { h: { db, prefix: "test_" }, aggregate }
}

describe("searchWikiPages", () => {
	it("returns empty for an empty query (not an error)", async () => {
		const res = await searchWikiPages(handle(), { query: "  " })
		expect(res.results).toEqual([])
		expect(res.total).toBe(0)
	})

	it("uses vector-only mode for the 'fast' recipe (auto-embed)", async () => {
		const captured: Document[][] = []
		const { db } = mockDb({ push: (p) => captured.push(p) })
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, {
			query: "accounts",
			recipe: "fast",
		})
		expect(captured.length).toBe(1)
		// First stage should be $vectorSearch (vector-only, auto-embed).
		expect(captured[0][0]).toHaveProperty("$vectorSearch")
		expect(captured[0][0].$vectorSearch.query).toEqual({ text: "accounts" })
		expect(captured[0][0].$vectorSearch.model).toBe("voyage-4-large")
		expect(captured[0][0].$vectorSearch.path).toBe("text")
		// No $rankFusion in vector-only mode.
		const hasRankFusion = captured[0].some((s) => "$rankFusion" in s)
		expect(hasRankFusion).toBe(false)
		// Score extraction must use vectorSearchScore (NOT searchScore — that's
		// for $search and returns null/0 after $vectorSearch). Regression guard.
		const addFields = captured[0].find((s) => "$addFields" in s) as
			| { $addFields: { searchScore?: { $meta: string } } }
			| undefined
		expect(addFields?.$addFields?.searchScore?.$meta).toBe("vectorSearchScore")
	})

	it("uses $rankFusion for hybrid mode (auto-embed vector + text)", async () => {
		const captured: Document[][] = []
		const { db } = mockDb({ push: (p) => captured.push(p) })
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, {
			query: "accounts",
			recipe: "hybrid",
		})
		expect(captured[0][0]).toHaveProperty("$rankFusion")
		const pipelines = captured[0][0].$rankFusion.input.pipelines
		expect(pipelines.vector[0]).toHaveProperty("$vectorSearch")
		expect(pipelines.vector[0].$vectorSearch.query).toEqual({
			text: "accounts",
		})
		expect(pipelines.text[0]).toHaveProperty("$search")
		// $rankFusion must enable scoreDetails and the pipeline must extract
		// the fused score from $meta:"scoreDetails" → .value (regression guard
		// for the C1 score-extraction bug — searchScore meta doesn't work post-
		// $rankFusion).
		expect(captured[0][0].$rankFusion.scoreDetails).toBe(true)
		const scoreDetailsAdd = captured[0].find(
			(s) =>
				"$addFields" in s &&
				(s as { $addFields: Record<string, unknown> }).$addFields.scoreDetails,
		) as { $addFields: { scoreDetails: { $meta: string } } } | undefined
		expect(scoreDetailsAdd?.$addFields.scoreDetails.$meta).toBe("scoreDetails")
	})

	it("applies pre-filters (scope, scopeRef, kind, trustTier, state, privacyTier) to the vector stage filter", async () => {
		const captured: Document[][] = []
		const { db } = mockDb({ push: (p) => captured.push(p) })
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, {
			query: "x",
			recipe: "fast",
			scope: "workspace",
			scopeRef: "ws-1",
			kind: "concept",
			trustTier: "standard",
			state: "active",
			privacyTier: "internal",
		})
		const vs = captured[0][0].$vectorSearch
		expect(vs.filter).toMatchObject({
			scope: "workspace",
			scopeRef: "ws-1",
			kind: "concept",
			trustTier: "standard",
			state: "active",
			"permissions.privacyTier": "internal",
		})
	})

	it("applies pre-filters to the text compound.filter in hybrid mode", async () => {
		const captured: Document[][] = []
		const { db } = mockDb({ push: (p) => captured.push(p) })
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, {
			query: "x",
			recipe: "hybrid",
			scope: "tenant",
			scopeRef: "t-1",
		})
		const textStage = captured[0][0].$rankFusion.input.pipelines.text[0].$search
		const filters = textStage.compound.filter as Document[]
		expect(
			filters.some(
				(f) => f.equals?.path === "scope" && f.equals?.value === "tenant",
			),
		).toBe(true)
		expect(
			filters.some(
				(f) => f.equals?.path === "scopeRef" && f.equals?.value === "t-1",
			),
		).toBe(true)
	})

	it("throws WikiSearchUnavailableError when aggregate throws (no mongot)", async () => {
		// An outage must be distinguishable from "no matches" — the HTTP API
		// maps this to 503 and the dreamer falls back to hash-slug promotion.
		const coll = {
			aggregate: vi.fn(() => ({
				toArray: async () =>
					Promise.reject(new Error("search index unavailable")),
			})),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(searchWikiPages(h, { query: "x" })).rejects.toBeInstanceOf(
			WikiSearchUnavailableError,
		)
	})

	it("throws WikiSearchUnavailableError when the $rerank retry also fails", async () => {
		// nativeRerank degrades to unranked results when ONLY the $rerank stage
		// is unsupported; if the retry without it also fails, that is a real
		// outage, not "no matches".
		const aggregate = vi.fn(() => ({
			toArray: async () => Promise.reject(new Error("mongot down")),
		}))
		const coll = {
			collectionName: "test_wiki_pages",
			aggregate,
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(
			searchWikiPages(h, { query: "x", nativeRerank: true }),
		).rejects.toBeInstanceOf(WikiSearchUnavailableError)
		// First call: pipeline with $rerank. Retry: pipeline without $rerank.
		expect(aggregate).toHaveBeenCalledTimes(2)
	})

	it("caps maxResults at 100", async () => {
		const captured: Document[][] = []
		const { db } = mockDb({ push: (p) => captured.push(p) })
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, {
			query: "x",
			maxResults: 500,
		})
		// The final $limit should be 100 (capped).
		const limitStage = captured[0].find((s) => "$limit" in s)
		expect(limitStage?.$limit).toBe(100)
	})

	it("over-fetches 4x before governance filtering and trims back to top-K", async () => {
		// Governance visibility filtering runs post-search (Atlas Search
		// compound can't express $exists/$or). Without over-fetch, the final
		// $limit landed BEFORE the filter, so ACL-blocked pages shrank the
		// result set below K even when more visible candidates existed.
		const captured: Document[][] = []
		const makeDoc = (slug: string, privacyTier?: string): Document => ({
			_id: { toString: () => `id-${slug}` },
			kind: "concept",
			title: slug,
			slug,
			aliases: [],
			summary: "s",
			body: "b",
			frontmatter: { type: "concept" },
			claims: [],
			contradictions: [],
			questions: [],
			relationships: [],
			personCard: null,
			scope: "workspace",
			scopeRef: "ws-1",
			trustTier: "standard",
			permissions: privacyTier ? { privacyTier } : {},
			state: "active",
			revision: 1,
			validFrom: new Date(),
			freshness: "fresh",
			backlinks: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			searchScore: 1,
		})
		// 6 ACL-blocked candidates outrank 2 visible ones: the blocked pages
		// would consume the entire top-2 without the 4x over-fetch.
		const docs = [
			...Array.from({ length: 6 }, (_, i) =>
				makeDoc(`confidential-${i}`, "confidential"),
			),
			makeDoc("open-1"),
			makeDoc("open-2"),
		]
		const coll = {
			collectionName: "test_wiki_pages",
			aggregate: vi.fn((pipeline: Document[]) => {
				captured.push(pipeline)
				return { toArray: async () => docs }
			}),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }

		const res = await searchWikiPages(h, {
			query: "x",
			maxResults: 2,
			governance: {
				scope: "workspace",
				scopeRef: "ws-1",
				trustTier: "standard",
			},
		})

		// The pipeline's final $limit must be the 4x over-fetch pool (2*4),
		// NOT top-K — the trim happens after governance filtering.
		const limitStage = captured[0].find((s) => "$limit" in s)
		expect(limitStage?.$limit).toBe(8)
		// The visible pages fill top-K despite 6 blocked candidates ranking
		// above them.
		expect(res.results).toHaveLength(2)
		expect(res.results.map((r) => r.page.slug)).toEqual(["open-1", "open-2"])
		expect(res.total).toBe(2)
	})

	it("keeps the plain top-K $limit when no governance context is present", async () => {
		const captured: Document[][] = []
		const { db } = mockDb({ push: (p) => captured.push(p) })
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, { query: "x", maxResults: 3 })
		const limitStage = captured[0].find((s) => "$limit" in s)
		expect(limitStage?.$limit).toBe(3)
	})

	it("filters results below minScore (score floor is a real filter)", async () => {
		// Dreamer-style gate: recipe "fast" (cosine similarity in [0,1]) with
		// minScore 0.65. Before WS-6, minScore was set but never read — the
		// low-score page was returned and adopted unconditionally.
		const { h } = handleWithDocs([
			makeDoc("accounts", 0.9),
			makeDoc("unrelated", 0.5),
		])
		const res = await searchWikiPages(h, {
			query: "accounts",
			recipe: "fast",
			minScore: 0.65,
		})
		expect(res.results).toHaveLength(1)
		expect(res.results[0].page.slug).toBe("accounts")
		expect(res.total).toBe(1)
	})

	it("returns empty when every result is below minScore (not an error)", async () => {
		const { h } = handleWithDocs([makeDoc("weak", 0.02)])
		const res = await searchWikiPages(h, {
			query: "x",
			recipe: "fast",
			minScore: 0.65,
		})
		expect(res.results).toEqual([])
		expect(res.total).toBe(0)
	})

	it("over-fetches 4x when minScore is set (floor must not shrink top-K)", async () => {
		// The floor removes candidates AFTER the pipeline's $limit — with a
		// plain top-K fetch, results could fall below K even though deeper
		// candidates clear the floor.
		const captured: Document[][] = []
		const coll = {
			collectionName: "test_wiki_pages",
			aggregate: vi.fn((pipeline: Document[]) => {
				captured.push(pipeline)
				return { toArray: async () => [] }
			}),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, { query: "x", maxResults: 3, minScore: 0.4 })
		const limitStage = captured[0].find((s) => "$limit" in s)
		expect(limitStage?.$limit).toBe(12)
	})
})

describe("searchWikiPages with reranking", () => {
	it("reorders results AND adopts the reranker's scores (no index mapping)", async () => {
		// Regression guard: the reranker returns docs in ITS OWN order. The
		// old code mapped scores by array position without reordering —
		// every score landed on the wrong page.
		const { h } = handleWithDocs([
			makeDoc("tables/accounts", 1.5, "Accounts"),
			makeDoc("tables/orders", 0.8, "Orders"),
		])
		const rerankFn = vi.fn(
			async (_query: string, docs: Array<{ text: string; score: number }>) => {
				// Reranker prefers Orders and assigns its own scores.
				return [
					{ text: docs[1].text, score: 0.95 },
					{ text: docs[0].text, score: 0.42 },
				]
			},
		)
		const res = await searchWikiPages(h, {
			query: "accounts",
			rerank: rerankFn,
		})
		expect(rerankFn).toHaveBeenCalledTimes(1)
		expect(rerankFn.mock.calls[0][0]).toBe("accounts")
		expect(res.results).toHaveLength(2)
		// Order follows the reranker; each score belongs to its own page.
		expect(res.results[0].page.slug).toBe("tables/orders")
		expect(res.results[0].score).toBe(0.95)
		expect(res.results[1].page.slug).toBe("tables/accounts")
		expect(res.results[1].score).toBe(0.42)
	})

	it("keeps reranker-dropped candidates after the reranked ones (no silent loss)", async () => {
		const { h } = handleWithDocs([
			makeDoc("a", 1.0),
			makeDoc("b", 0.9),
			makeDoc("c", 0.8),
		])
		const rerankFn = vi.fn(
			async (_query: string, docs: Array<{ text: string; score: number }>) => {
				// Reranker returns only its top pick.
				return [{ text: docs[2].text, score: 0.99 }]
			},
		)
		const res = await searchWikiPages(h, {
			query: "x",
			rerank: rerankFn,
		})
		expect(res.results).toHaveLength(3)
		expect(res.results[0].page.slug).toBe("c")
		expect(res.results[0].score).toBe(0.99)
		// Dropped candidates keep their original order and search scores.
		expect(res.results.slice(1).map((r) => r.page.slug)).toEqual(["a", "b"])
		expect(res.results[1].score).toBe(1.0)
	})

	it("keeps original order and scores when the reranker throws", async () => {
		const { h } = handleWithDocs([makeDoc("a", 1.0), makeDoc("b", 0.9)])
		const rerankFn = vi.fn(async () => {
			throw new Error("reranker outage")
		})
		const res = await searchWikiPages(h, {
			query: "x",
			rerank: rerankFn,
		})
		expect(res.results.map((r) => r.page.slug)).toEqual(["a", "b"])
		expect(res.results[0].score).toBe(1.0)
		expect(res.results[1].score).toBe(0.9)
	})

	it("does not call rerankFn when results are empty", async () => {
		const coll = {
			aggregate: vi.fn(() => ({
				toArray: async () => [],
			})),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		const rerankFn = vi.fn(async () => [])
		const res = await searchWikiPages(h, {
			query: "x",
			rerank: rerankFn,
		})
		expect(rerankFn).not.toHaveBeenCalled()
		expect(res.results).toEqual([])
	})
})

describe("searchWikiPages with graph expansion", () => {
	it("uses $graphLookup in aggregation pipeline when graphExpansion is enabled", async () => {
		const capturedPipelines: Document[][] = []
		const coll = {
			collectionName: "test_wiki_pages",
			aggregate: vi.fn((pipeline: Document[]) => {
				capturedPipelines.push(pipeline)
				// First call: hybrid search → returns page with relationship
				// Second call: $graphLookup expansion → returns related page
				if (capturedPipelines.length === 1) {
					return {
						toArray: async () => [
							{
								_id: { toString: () => "id1" },
								kind: "concept",
								title: "Accounts",
								slug: "tables/accounts",
								aliases: [],
								summary: "s",
								body: "b",
								frontmatter: { type: "table" },
								claims: [],
								contradictions: [],
								questions: [],
								relationships: [{ targetPageSlug: "tables/orders" }],
								personCard: null,
								scope: "workspace",
								scopeRef: "ws-1",
								trustTier: "standard",
								permissions: {},
								state: "active",
								revision: 1,
								validFrom: new Date(),
								freshness: "fresh",
								backlinks: [],
								createdAt: new Date(),
								updatedAt: new Date(),
								searchScore: 1.5,
							},
						],
					}
				}
				// Second call: $graphLookup pipeline → returns expanded page
				return {
					toArray: async () => [
						{
							_id: { toString: () => "id-orders" },
							slug: "tables/orders",
							kind: "concept",
							title: "Orders",
							aliases: [],
							summary: "Order data",
							body: "# Orders",
							frontmatter: { type: "table" },
							claims: [],
							contradictions: [],
							questions: [],
							relationships: [],
							personCard: null,
							scope: "workspace",
							scopeRef: "ws-1",
							trustTier: "standard",
							permissions: {},
							state: "active",
							revision: 1,
							validFrom: new Date(),
							freshness: "fresh",
							backlinks: [],
							createdAt: new Date(),
							updatedAt: new Date(),
						},
					],
				}
			}),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		const res = await searchWikiPages(h, {
			query: "accounts",
			graphExpansion: { maxDepth: 1 },
		})
		// Should have the original result + the expanded related page
		expect(res.results.length).toBe(2)
		expect(res.results.some((r) => r.page.slug === "tables/orders")).toBe(true)
		expect(res.results.some((r) => r.source === "graph")).toBe(true)
		// The second aggregate call should contain $graphLookup
		expect(capturedPipelines.length).toBe(2)
		const graphPipeline = capturedPipelines[1]
		const graphStage = graphPipeline.find((s) => "$graphLookup" in s)
		expect(graphStage).toBeDefined()
		expect(graphStage?.$graphLookup).toBeDefined()
		expect(graphStage?.$graphLookup.connectFromField).toBe(
			"relationships.targetPageSlug",
		)
		expect(graphStage?.$graphLookup.connectToField).toBe("slug")
		expect(graphStage?.$graphLookup.depthField).toBe("depth")
	})

	it("throws WikiSearchUnavailableError when graph expansion aggregation fails", async () => {
		// Graph expansion runs on the same store — a failure must not be
		// silently swallowed into partial results.
		let call = 0
		const coll = {
			collectionName: "test_wiki_pages",
			aggregate: vi.fn(() => {
				call++
				if (call === 1) {
					return { toArray: async () => [makeDoc("tables/accounts", 1.5)] }
				}
				return {
					toArray: async () => Promise.reject(new Error("graph lookup failed")),
				}
			}),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(
			searchWikiPages(h, {
				query: "accounts",
				graphExpansion: { maxDepth: 1 },
			}),
		).rejects.toBeInstanceOf(WikiSearchUnavailableError)
	})
})

describe("searchWikiPages with native rerank", () => {
	it("adds $rerank stage to pipeline when nativeRerank is true", async () => {
		const capturedPipelines: Document[][] = []
		const coll = {
			collectionName: "test_wiki_pages",
			aggregate: vi.fn((pipeline: Document[]) => {
				capturedPipelines.push(pipeline)
				return {
					toArray: async () => [
						{
							_id: { toString: () => "id1" },
							kind: "concept",
							title: "Accounts",
							slug: "tables/accounts",
							aliases: [],
							summary: "s",
							body: "b",
							frontmatter: { type: "table" },
							claims: [],
							contradictions: [],
							questions: [],
							relationships: [],
							personCard: null,
							scope: "workspace",
							scopeRef: "ws-1",
							trustTier: "standard",
							permissions: {},
							state: "active",
							revision: 1,
							validFrom: new Date(),
							freshness: "fresh",
							backlinks: [],
							createdAt: new Date(),
							updatedAt: new Date(),
							searchScore: 1.5,
						},
					],
				}
			}),
		} as unknown as Collection
		const db = { collection: vi.fn(() => coll) } as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await searchWikiPages(h, {
			query: "accounts",
			nativeRerank: true,
		})
		// The search pipeline should contain $rerank stage
		expect(capturedPipelines.length).toBe(1)
		const rerankStage = capturedPipelines[0].find((s) => "$rerank" in s)
		expect(rerankStage).toBeDefined()
		expect(rerankStage?.$rerank.model).toBe("rerank-2.5")
		expect(rerankStage?.$rerank.query).toBe("accounts")
	})
})

describe("probeWikiSearch", () => {
	const TEXT_INDEX = WIKI_PAGES_SEARCH_INDEX_TARGETS.text.name

	function probeColl(opts: {
		indexes?: Array<{ name?: unknown }>
		indexError?: Error
		aggregate?: ReturnType<typeof vi.fn>
	}): Collection {
		return {
			collectionName: "test_wiki_pages",
			listSearchIndexes: opts.indexError
				? vi.fn(() => ({
						toArray: async () => Promise.reject(opts.indexError),
					}))
				: vi.fn(() => ({
						toArray: async () => opts.indexes ?? [{ name: TEXT_INDEX }],
					})),
			aggregate:
				opts.aggregate ??
				vi.fn(() => ({ toArray: async () => [makeDoc("any", 1)] })),
		} as unknown as Collection
	}

	it("verifies the text index exists and answers a $search round-trip", async () => {
		const aggregate = vi.fn(() => ({
			toArray: async () => [makeDoc("any", 1)],
		}))
		const db = {
			collection: vi.fn(() => probeColl({ aggregate })),
		} as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		const matched = await probeWikiSearch(h)
		expect(matched).toBe(1)
		// Round-trip pipeline: $search on the text index, $limit 1.
		const call = aggregate.mock.calls[0][0] as Document[]
		expect(call[0].$search.index).toBe(TEXT_INDEX)
		expect(call.find((s) => "$limit" in s)?.$limit).toBe(1)
	})

	it("throws when the search index was never created (misconfiguration)", async () => {
		const db = {
			collection: vi.fn(() => probeColl({ indexes: [] })),
		} as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(probeWikiSearch(h)).rejects.toBeInstanceOf(
			WikiSearchUnavailableError,
		)
	})

	it("throws when search index management is unreachable (mongot down)", async () => {
		// Verified live: listSearchIndexes fails fast with a gRPC error when
		// mongot is dead, while ping + transactional findOne still succeed —
		// this is what flips /ready to 503 during search outages.
		const db = {
			collection: vi.fn(() =>
				probeColl({
					indexError: new Error("gRPC stream establishment was cancelled"),
				}),
			),
		} as unknown as Db
		const h: WikiDbHandle = { db, prefix: "test_" }
		await expect(probeWikiSearch(h)).rejects.toBeInstanceOf(
			WikiSearchUnavailableError,
		)
	})

	it("throws when the probe $search hangs (client-side bound)", async () => {
		// Verified live: $search can hang indefinitely when mongot dies
		// mid-connection — the probe must cut it off, not block /ready.
		vi.useFakeTimers()
		try {
			const aggregate = vi.fn(() =>
				// Never resolves — simulates the hung $search.
				({ toArray: () => new Promise<never>(() => {}) }),
			)
			const db = {
				collection: vi.fn(() => probeColl({ aggregate })),
			} as unknown as Db
			const h: WikiDbHandle = { db, prefix: "test_" }
			const probe = probeWikiSearch(h)
			const expectation = expect(probe).rejects.toBeInstanceOf(
				WikiSearchUnavailableError,
			)
			await vi.advanceTimersByTimeAsync(5000)
			await expectation
		} finally {
			vi.useRealTimers()
		}
	})
})
