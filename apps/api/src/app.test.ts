import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDeliveryPayloadTooLargeError } from "@mdbrain/wiki-engine"
import contractFixtures from "./__fixtures__/contract-fixtures.js"

const bridgeMocks = vi.hoisted(() => ({
	mdbrainBridgeCheckReadiness: vi.fn(),
	mdbrainBridgeAdd: vi.fn(),
	mdbrainBridgeAccessSummaries: vi.fn(),
	mdbrainBridgeAccessTrends: vi.fn(),
	mdbrainBridgeBenchmarkIngest: vi.fn(),
	mdbrainBridgeImportConversations: vi.fn(),
	mdbrainBridgeBuildContextBundle: vi.fn(),
	mdbrainBridgeBuildDiscoveryProjection: vi.fn(),
	mdbrainBridgeDeleteLifecycleItem: vi.fn(),
	mdbrainBridgeApplyMemoryFeedback: vi.fn(),
	mdbrainBridgeGetState: vi.fn(),
	mdbrainBridgeGetDetailedStatus: vi.fn(),
	mdbrainBridgeExtractEvent: vi.fn(),
	mdbrainBridgeGetLifecycleHistory: vi.fn(),
	mdbrainBridgeGetLifecycleItem: vi.fn(),
	mdbrainBridgeGetMemoryJob: vi.fn(),
	mdbrainBridgeGetRecallTrace: vi.fn(),
	mdbrainBridgeHydrateActiveSlate: vi.fn(),
	mdbrainBridgeListMemoryJobs: vi.fn(),
	mdbrainBridgeListRecallTraces: vi.fn(),
	mdbrainBridgeProbeEmbedding: vi.fn(),
	mdbrainBridgeProbeVector: vi.fn(),
	mdbrainBridgeProfile: vi.fn(),
	mdbrainBridgeRecallConversation: vi.fn(),
	mdbrainBridgeReadFile: vi.fn(),
	mdbrainBridgeRelevanceBenchmark: vi.fn(),
	mdbrainBridgeRelevanceExplain: vi.fn(),
	mdbrainBridgeRelevanceReport: vi.fn(),
	mdbrainBridgeRelevanceSampleRate: vi.fn(),
	mdbrainBridgeSearch: vi.fn(),
	mdbrainBridgeSearchDetailed: vi.fn(),
	mdbrainBridgeSearchKB: vi.fn(),
	mdbrainBridgeStats: vi.fn(),
	mdbrainBridgeStatus: vi.fn(),
	mdbrainBridgeSync: vi.fn(),
	mdbrainBridgeUpdateLifecycleItem: vi.fn(),
	mdbrainBridgeReportProcedureOutcome: vi.fn(),
	mdbrainBridgeWriteConversationEvent: vi.fn(),
	mdbrainBridgeWriteProcedure: vi.fn(),
	mdbrainBridgeWriteStructuredMemory: vi.fn(),
	mdbrainBridgeTraceChain: vi.fn(),
	mdbrainBridgeScanNovelty: vi.fn(),
	mdbrainBridgeConsolidate: vi.fn(),
	mdbrainBridgeSelfEdit: vi.fn(),
}))

vi.mock("@mdbrain/memory-bridge", () => bridgeMocks)

const deliveryMocks = vi.hoisted(() => ({
	deliverMemoryWrite: vi.fn(),
	approvePendingWikiPromotion: vi.fn(),
	redriveDeadLetteredMemoryDelivery: vi.fn(),
	MemoryDeliveryDispatchError: class MemoryDeliveryDispatchError extends Error {
		constructor(
			readonly operationId: string,
			readonly state: string,
			readonly code: string,
		) {
			super(`memory delivery ${operationId} entered ${state}`)
		}
	},
}))

vi.mock("./memory-delivery-runtime.js", () => ({
	deliverMemoryWrite: deliveryMocks.deliverMemoryWrite,
	approvePendingWikiPromotion: deliveryMocks.approvePendingWikiPromotion,
	redriveDeadLetteredMemoryDelivery:
		deliveryMocks.redriveDeadLetteredMemoryDelivery,
	wikiPromotionApprovalRequired: () => false,
	buildMemoryDeliveryOperationId: (params: { operation: string }) =>
		`${params.operation}:${"a".repeat(64)}`,
	buildMemoryWikiPromotion: (params: {
		body: {
			promotionPolicy?: string
			wikiPromotion?: { page?: { slug?: string } }
		}
		operationId: string
	}) =>
		params.body.promotionPolicy === "wiki"
			? {
					promotion: {
						key: `${params.operationId}:wiki:${params.body.wikiPromotion?.page?.slug}:v1`,
						mutateWiki: vi.fn(),
					},
				}
			: {},
	MemoryDeliveryDispatchError: deliveryMocks.MemoryDeliveryDispatchError,
}))

const wikiStoreMocks = vi.hoisted(() => ({
	checkWikiStoreReadiness: vi.fn(),
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
	closeWikiStore: vi.fn(),
}))

vi.mock("./wiki-store-runtime.js", () => wikiStoreMocks)

import { createApp } from "./app.js"

describe("createApp", () => {
	const prevEnv = { ...process.env }

	beforeEach(() => {
		process.env = { ...prevEnv }
		bridgeMocks.mdbrainBridgeSearch.mockReset()
		bridgeMocks.mdbrainBridgeSearchKB.mockReset()
		deliveryMocks.deliverMemoryWrite.mockReset()
		deliveryMocks.approvePendingWikiPromotion.mockReset()
		deliveryMocks.redriveDeadLetteredMemoryDelivery.mockReset()
		deliveryMocks.deliverMemoryWrite.mockImplementation(
			async (params: { dispatch: () => Promise<unknown> }) => params.dispatch(),
		)
		bridgeMocks.mdbrainBridgeCheckReadiness.mockReset()
		bridgeMocks.mdbrainBridgeCheckReadiness.mockResolvedValue({
			contractVersion: "2.0.1",
			contractSha256: "abc",
			lanes: { retrieval: "ready" },
		})
		wikiStoreMocks.checkWikiStoreReadiness.mockReset()
		wikiStoreMocks.checkWikiStoreReadiness.mockResolvedValue({
			transactional: true,
		})
		bridgeMocks.mdbrainBridgeSearchDetailed.mockReset()
		bridgeMocks.mdbrainBridgeAdd.mockReset()
		bridgeMocks.mdbrainBridgeAccessSummaries.mockReset()
		bridgeMocks.mdbrainBridgeAccessTrends.mockReset()
		bridgeMocks.mdbrainBridgeBenchmarkIngest.mockReset()
		bridgeMocks.mdbrainBridgeImportConversations.mockReset()
		bridgeMocks.mdbrainBridgeBuildContextBundle.mockReset()
		bridgeMocks.mdbrainBridgeBuildDiscoveryProjection.mockReset()
		bridgeMocks.mdbrainBridgeDeleteLifecycleItem.mockReset()
		bridgeMocks.mdbrainBridgeApplyMemoryFeedback.mockReset()
		bridgeMocks.mdbrainBridgeExtractEvent.mockReset()
		bridgeMocks.mdbrainBridgeGetLifecycleHistory.mockReset()
		bridgeMocks.mdbrainBridgeGetLifecycleItem.mockReset()
		bridgeMocks.mdbrainBridgeGetState.mockReset()
		bridgeMocks.mdbrainBridgeGetMemoryJob.mockReset()
		bridgeMocks.mdbrainBridgeGetRecallTrace.mockReset()
		bridgeMocks.mdbrainBridgeProfile.mockReset()
		bridgeMocks.mdbrainBridgeRecallConversation.mockReset()
		bridgeMocks.mdbrainBridgeListMemoryJobs.mockReset()
		bridgeMocks.mdbrainBridgeListRecallTraces.mockReset()
		bridgeMocks.mdbrainBridgeProbeEmbedding.mockReset()
		bridgeMocks.mdbrainBridgeProbeVector.mockReset()
		bridgeMocks.mdbrainBridgeRelevanceBenchmark.mockReset()
		bridgeMocks.mdbrainBridgeStatus.mockReset()
		bridgeMocks.mdbrainBridgeTraceChain.mockReset()
		bridgeMocks.mdbrainBridgeScanNovelty.mockReset()
		bridgeMocks.mdbrainBridgeConsolidate.mockReset()
		bridgeMocks.mdbrainBridgeSelfEdit.mockReset()
		bridgeMocks.mdbrainBridgeUpdateLifecycleItem.mockReset()
		bridgeMocks.mdbrainBridgeReportProcedureOutcome.mockReset()
		bridgeMocks.mdbrainBridgeWriteConversationEvent.mockReset()
		bridgeMocks.mdbrainBridgeSearch.mockResolvedValue([])
		bridgeMocks.mdbrainBridgeSearchDetailed.mockResolvedValue({
			results: [],
			metadata: {
				mode: "auto",
				classification: "factoid",
				sourceOrder: ["conversation"],
				passes: [],
				queriesTried: [],
				constraintsApplied: [],
				resultsRejected: [],
				evidenceCoverage: {
					totalResults: 0,
					sourceCounts: {},
					exactEvidenceCount: 0,
					coverageRatio: 0,
				},
				pathsExecuted: [],
				resultsByPath: {},
				queryRewritten: false,
				reranked: false,
			},
		})
		bridgeMocks.mdbrainBridgeAdd.mockResolvedValue({
			eventId: "evt-1",
			chunkCreated: true,
		})
		bridgeMocks.mdbrainBridgeWriteConversationEvent.mockResolvedValue({
			eventId: "evt-2",
			chunkCreated: true,
		})
		bridgeMocks.mdbrainBridgeProfile.mockResolvedValue({ profile: [] })
		bridgeMocks.mdbrainBridgeHydrateActiveSlate.mockResolvedValue({
			agentId: "main",
			scope: "agent",
			scopeRef: "agent:main",
			items: [],
			metadata: {
				maxItems: 5,
				truncated: false,
				partial: false,
				countsByKind: {},
				sourceCounts: {},
			},
			hydratedAt: "2026-04-05T12:00:00.000Z",
		})
		bridgeMocks.mdbrainBridgeBuildDiscoveryProjection.mockResolvedValue({
			kind: "entity-brief",
			query: "Phoenix",
			title: "Phoenix entity brief",
			summary: "Phoenix has one active owner and one linked decision.",
			scope: "agent",
			scopeRef: "agent:main",
			sections: [],
			metadata: {
				partial: false,
				evidenceCount: 0,
				sourceCounts: {},
			},
			builtAt: "2026-04-05T12:00:00.000Z",
		})
		bridgeMocks.mdbrainBridgeBuildContextBundle.mockResolvedValue({
			agentId: "main",
			query: "Phoenix",
			scope: "agent",
			scopeRef: "agent:main",
			sessionId: "session-main",
			rendered:
				"## Active Slate\nHighest-salience durable state assembled from structured memory, procedures, and recent anchors.",
			sections: [],
			metadata: {
				tokenBudget: 320,
				estimatedTokensUsed: 48,
				partial: false,
				truncated: false,
				pathsExecuted: ["active-slate"],
				sectionsIncluded: [],
			},
			builtAt: "2026-04-05T12:00:00.000Z",
		})
		bridgeMocks.mdbrainBridgeRecallConversation.mockResolvedValue({
			results: [],
			metadata: {
				totalMatched: 0,
				filtersApplied: ["excludeToolMessages"],
				searchMethod: "standard",
				durationMs: 2,
			},
		})
		bridgeMocks.mdbrainBridgeGetLifecycleItem.mockResolvedValue({
			family: "structured",
			handle: {
				family: "structured",
				id: "structured:agent-42:agent:agent-42:decision:db",
				agentId: "agent-42",
				scope: "agent",
				scopeRef: "agent-42",
				revision: 2,
				state: "active",
				structured: { type: "decision", key: "db" },
				updatedAt: "2026-04-10T12:00:00.000Z",
			},
			data: {
				type: "decision",
				key: "db",
				value: "Use MongoDB Atlas Local",
				sourceAgent: { id: "dreamer", name: "Dreamer" },
			},
			createdAt: "2026-04-09T12:00:00.000Z",
			updatedAt: "2026-04-10T12:00:00.000Z",
		})
		bridgeMocks.mdbrainBridgeUpdateLifecycleItem.mockImplementation(
			async ({ handle, patch }) => ({
				family: handle.family,
				handle: {
					...handle,
					revision: handle.revision + 1,
					updatedAt: "2026-04-10T12:05:00.000Z",
				},
				data:
					handle.family === "structured"
						? {
								type: handle.structured.type,
								key: handle.structured.key,
								value:
									typeof patch?.value === "string"
										? patch.value
										: "Use MongoDB Atlas Local",
							}
						: {
								procedureId: handle.procedure.procedureId,
								name: typeof patch?.name === "string" ? patch.name : "Deploy",
								steps: Array.isArray(patch?.steps) ? patch.steps : ["Build"],
							},
				createdAt: "2026-04-09T12:00:00.000Z",
				updatedAt: "2026-04-10T12:05:00.000Z",
			}),
		)
		bridgeMocks.mdbrainBridgeDeleteLifecycleItem.mockImplementation(
			async ({ handle }) => ({
				family: handle.family,
				handle: {
					...handle,
					revision: handle.revision + 1,
					state: "invalidated",
					validTo: "2026-04-10T12:10:00.000Z",
					updatedAt: "2026-04-10T12:10:00.000Z",
				},
				data:
					handle.family === "structured"
						? {
								type: handle.structured.type,
								key: handle.structured.key,
								value: "Use MongoDB Atlas Local",
							}
						: {
								procedureId: handle.procedure.procedureId,
								name: "Deploy",
								steps: ["Build"],
							},
				createdAt: "2026-04-09T12:00:00.000Z",
				updatedAt: "2026-04-10T12:10:00.000Z",
			}),
		)
		bridgeMocks.mdbrainBridgeGetLifecycleHistory.mockResolvedValue([
			{
				family: "structured",
				handle: {
					family: "structured",
					id: "structured:agent-42:agent:agent-42:decision:db",
					agentId: "agent-42",
					scope: "agent",
					scopeRef: "agent-42",
					revision: 1,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				data: {
					type: "decision",
					key: "db",
					value: "Use local files",
				},
				historyKind: "revision",
				supersededAt: "2026-04-10T12:00:00.000Z",
			},
			{
				family: "structured",
				handle: {
					family: "structured",
					id: "structured:agent-42:agent:agent-42:decision:db",
					agentId: "agent-42",
					scope: "agent",
					scopeRef: "agent-42",
					revision: 2,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				data: {
					type: "decision",
					key: "db",
					value: "Use MongoDB Atlas Local",
				},
				historyKind: "current",
			},
		])
		bridgeMocks.mdbrainBridgeGetState.mockResolvedValue({
			profile: { profile: [] },
			blocks: {
				blocks: [],
				totalTokenBudget: 0,
				totalActualTokens: 0,
			},
			bundle: {
				agentId: "main",
				scope: "agent",
				scopeRef: "agent:main",
				rendered: "",
				sections: [],
				metadata: {
					tokenBudget: 320,
					estimatedTokensUsed: 0,
					partial: false,
					truncated: false,
					pathsExecuted: [],
					sectionsIncluded: [],
				},
				builtAt: "2026-04-05T12:00:00.000Z",
			},
		})
		bridgeMocks.mdbrainBridgeStatus.mockResolvedValue({
			backend: "mongodb",
			provider: "voyage",
		})
		bridgeMocks.mdbrainBridgeExtractEvent.mockResolvedValue({
			jobId: "extraction-evt-1",
			scheduled: true,
		})
		bridgeMocks.mdbrainBridgeAccessTrends.mockResolvedValue([])
		bridgeMocks.mdbrainBridgeBenchmarkIngest.mockResolvedValue({
			datasetPath: "/tmp/benchmark.json",
			datasetName: "benchmark.json",
			conversationsIngested: 1,
			turnsIngested: 2,
			skippedConversations: 0,
			startedAt: "2026-04-09T12:00:00.000Z",
			completedAt: "2026-04-09T12:00:01.000Z",
		})
		bridgeMocks.mdbrainBridgeImportConversations.mockResolvedValue({
			datasetPath: "/tmp/history.json",
			datasetName: "history.json",
			datasetKind: "generic",
			conversationsImported: 1,
			turnsImported: 2,
			skippedConversations: 0,
			failedLines: 0,
			failedTurns: 0,
			startedAt: "2026-04-11T09:00:00.000Z",
			completedAt: "2026-04-11T09:00:02.000Z",
		})
		bridgeMocks.mdbrainBridgeRelevanceBenchmark.mockResolvedValue({
			datasetVersion: "bench-v1",
			datasetName: "longmemeval.json",
			datasetKind: "longmemeval",
			scenarios: 2,
			cases: 4,
			scoredCases: 4,
			skippedCases: 0,
			hitRate: 0.75,
			emptyRate: 0.25,
			avgTopScore: 0.82,
			p95LatencyMs: 44,
			rAt5: 0.88,
			rAt10: 0.91,
			ndcgAt10: 0.86,
			questionTypeBreakdown: [],
			officialMetrics: {
				longMemEval: {
					retrievalCases: 4,
					abstentionCases: 0,
					session: {
						recallAnyAt1: 0.75,
						recallAllAt1: 0.5,
						ndcgAnyAt1: 0.75,
						recallAnyAt3: 0.88,
						recallAllAt3: 0.75,
						ndcgAnyAt3: 0.82,
						recallAnyAt5: 0.9,
						recallAllAt5: 0.88,
						ndcgAnyAt5: 0.86,
						recallAnyAt10: 0.95,
						recallAllAt10: 0.91,
						ndcgAnyAt10: 0.9,
						recallAnyAt30: 0.95,
						recallAllAt30: 0.91,
						ndcgAnyAt30: 0.9,
						recallAnyAt50: 0.95,
						recallAllAt50: 0.91,
						ndcgAnyAt50: 0.9,
					},
				},
			},
			regressions: [],
			benchmarkReport: {
				generatedAt: new Date("2026-04-10T12:00:00.000Z"),
				build: {
					source: "env",
					commitSha: "abc123",
				},
				corpus: {
					datasetVersion: "bench-v1",
					datasetName: "longmemeval.json",
					datasetKind: "longmemeval",
					scenarios: 2,
					cases: 4,
					scoredCases: 4,
					skippedCases: 0,
				},
				metrics: {
					internal: {
						hitRate: 0.75,
						emptyRate: 0.25,
						avgTopScore: 0.82,
						p95LatencyMs: 44,
						rAt5: 0.88,
						rAt10: 0.91,
						ndcgAt10: 0.86,
					},
				},
				releaseGates: [
					{
						gate: "official-retrieval",
						status: "passed",
						evidence: "officialMetrics present in benchmark response",
					},
					{
						gate: "query-governance",
						status: "advisory-only",
						evidence: "queryGovernance candidates are advisory-only",
					},
				],
				warnings: [],
				degradations: [],
			},
		})
		bridgeMocks.mdbrainBridgeListRecallTraces.mockResolvedValue([])
		bridgeMocks.mdbrainBridgeListMemoryJobs.mockResolvedValue([])
	})

	afterEach(() => {
		process.env = { ...prevEnv }
	})

	it("returns the public health payload", async () => {
		const res = await createApp().request("/health")

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			ok: true,
			service: "mdbrain-api",
		})
	})

	it("reports ready only after Memongo compatibility succeeds", async () => {
		const res = await createApp().request("/ready")

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			ok: true,
			service: "mdbrain-api",
			memongo: {
				contractVersion: "2.0.1",
				contractSha256: "abc",
				lanes: { retrieval: "ready" },
			},
			wiki: { transactional: true },
		})
	})

	it("coalesces and briefly caches readiness probes to protect dependencies", async () => {
		const app = createApp()
		const [first, second] = await Promise.all([
			app.request("/ready"),
			app.request("/ready"),
		])
		const third = await app.request("/ready")

		expect(first.status).toBe(200)
		expect(second.status).toBe(200)
		expect(third.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeCheckReadiness).toHaveBeenCalledTimes(1)
		expect(wikiStoreMocks.checkWikiStoreReadiness).toHaveBeenCalledTimes(1)
	})

	it("fails readiness when the Memongo contract is unavailable or incompatible", async () => {
		bridgeMocks.mdbrainBridgeCheckReadiness.mockRejectedValueOnce(
			new Error("incompatible"),
		)
		const res = await createApp().request("/ready")

		expect(res.status).toBe(503)
		await expect(res.json()).resolves.toEqual({
			ok: false,
			service: "mdbrain-api",
			error: {
				code: "DEPENDENCY_NOT_READY",
				message: "Memongo or the wiki store is not ready",
				dependencies: ["memongo"],
			},
		})
	})

	it("identifies the unavailable Memongo lane without exposing probe routes", async () => {
		bridgeMocks.mdbrainBridgeCheckReadiness.mockRejectedValueOnce(
			Object.assign(new Error("not ready"), { dependency: "vector" }),
		)
		const res = await createApp().request("/ready")

		expect(res.status).toBe(503)
		await expect(res.json()).resolves.toEqual({
			ok: false,
			service: "mdbrain-api",
			error: {
				code: "DEPENDENCY_NOT_READY",
				message: "Memongo or the wiki store is not ready",
				dependencies: ["memongo.vector"],
			},
		})
	})

	it("fails readiness when the wiki store cannot run transactions", async () => {
		wikiStoreMocks.checkWikiStoreReadiness.mockRejectedValueOnce(
			new Error("transactions unavailable"),
		)
		const res = await createApp().request("/ready")

		expect(res.status).toBe(503)
		expect(bridgeMocks.mdbrainBridgeCheckReadiness).toHaveBeenCalled()
		await expect(res.json()).resolves.toEqual({
			ok: false,
			service: "mdbrain-api",
			error: {
				code: "DEPENDENCY_NOT_READY",
				message: "Memongo or the wiki store is not ready",
				dependencies: ["wiki"],
			},
		})
	})

	it("fails readiness when the wiki search probe fails (mongot outage)", async () => {
		// Ping + transactions can succeed while mongot is dead — readiness
		// must probe search or the node reports ready during search outages.
		wikiStoreMocks.checkWikiStoreReadiness.mockRejectedValueOnce(
			new Error("wiki search probe failed"),
		)
		const res = await createApp().request("/ready")

		expect(res.status).toBe(503)
		await expect(res.json()).resolves.toEqual({
			ok: false,
			service: "mdbrain-api",
			error: {
				code: "DEPENDENCY_NOT_READY",
				message: "Memongo or the wiki store is not ready",
				dependencies: ["wiki"],
			},
		})
	})

	it("serves the OpenAPI document without auth", async () => {
		const res = await createApp().request("/openapi.json")
		const json = (await res.json()) as { paths?: Record<string, unknown> }

		expect(res.status).toBe(200)
		for (const path of contractFixtures.corePaths) {
			expect(json.paths).toHaveProperty(path)
		}
		for (const path of [
			"/ready",
			"/v1/admin/deliveries",
			"/v1/wiki/revisions",
			"/v1/wiki/revisions/{revision}",
		]) {
			expect(json.paths).toHaveProperty(path)
		}
		for (const path of [
			"/v1/import/conversations",
			"/v1/read-file",
			"/v1/status/detailed",
			"/v1/stats",
			"/v1/sync",
			"/v1/admin/relevance/explain",
			"/v1/admin/relevance/benchmark",
			"/v1/admin/benchmarks/ingest",
			"/v1/admin/relevance/report",
			"/v1/admin/relevance/sample-rate",
			"/v1/admin/access-trends",
			"/v1/admin/traces",
			"/v1/admin/traces/{traceId}",
			"/v1/admin/access-summaries",
			"/v1/jobs",
			"/v1/jobs/{jobId}",
			"/v1/chain-trace",
			"/v1/novelty-scan",
			"/v1/consolidate",
			"/v1/self-edit",
		]) {
			expect(json.paths).not.toHaveProperty(path)
		}
		for (const path of contractFixtures.removedTenantControlPaths) {
			expect(json.paths).not.toHaveProperty(path)
		}
	})

	it("validates missing search queries", async () => {
		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: { code: "VALIDATION_ERROR", message: "query is required" },
		})
	})

	it("forwards scoped search options", async () => {
		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: "workspace checkpoint",
				agentId: "codex",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
				limit: 3,
			}),
		})

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeSearch).toHaveBeenCalledWith({
			query: "workspace checkpoint",
			agentId: "codex",
			maxResults: 3,
			minScore: undefined,
			sessionKey: undefined,
			scope: "workspace",
			scopeRef: "/workspace/mdbrain",
		})
	})

	it("preserves safe Memongo failure status and retry metadata", async () => {
		bridgeMocks.mdbrainBridgeSearch.mockRejectedValueOnce(
			Object.assign(new Error("temporarily unavailable"), {
				code: "UPSTREAM_UNAVAILABLE",
				status: 503,
				retryable: true,
				outcome: "unknown",
				retryAfterMs: 2500,
			}),
		)

		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: "retry me" }),
		})

		expect(res.status).toBe(503)
		expect(res.headers.get("Retry-After")).toBe("3")
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "UPSTREAM_UNAVAILABLE",
				message: "temporarily unavailable",
				retryable: true,
				outcome: "unknown",
				retryAfterMs: 2500,
			},
		})
	})

	for (const aliasCase of contractFixtures.aliasCases) {
		it(`preserves ${aliasCase.name}`, async () => {
			const res = await createApp().request(aliasCase.path, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(aliasCase.path === "/v1/add"
						? { "Idempotency-Key": `alias-${aliasCase.name}` }
						: {}),
				},
				body: JSON.stringify(aliasCase.body),
			})

			expect(res.status).toBe(200)
			// Write routes dispatch an explicit identity (never a body-derived or
			// upstream default); read routes leave agentId unset for the bridge.
			const isWriteRoute =
				aliasCase.path.startsWith("/v1/write") || aliasCase.path === "/v1/add"
			expect(
				bridgeMocks[aliasCase.bridgeMock as keyof typeof bridgeMocks],
			).toHaveBeenCalledWith(
				expect.objectContaining({
					agentId: isWriteRoute ? "default" : undefined,
					...aliasCase.expected,
				}),
			)
		})
	}

	it("marks deprecated request properties in the OpenAPI document", async () => {
		const res = await createApp().request("/openapi.json")
		const json = (await res.json()) as {
			paths?: Record<
				string,
				{
					post?: {
						requestBody?: {
							content?: {
								"application/json"?: {
									schema?: {
										properties?: Record<string, { deprecated?: boolean }>
									}
								}
							}
						}
					}
				}
			>
		}

		expect(res.status).toBe(200)
		for (const [path, propertyNames] of Object.entries(
			contractFixtures.deprecatedRequestProperties,
		)) {
			const properties =
				json.paths?.[path]?.post?.requestBody?.content?.["application/json"]
					?.schema?.properties ?? {}
			for (const propertyName of propertyNames) {
				expect(properties[propertyName]?.deprecated).toBe(true)
			}
		}
	})

	it("documents state, recall, and lifecycle routes in OpenAPI", async () => {
		const res = await createApp().request("/openapi.json")
		const json = (await res.json()) as {
			paths?: Record<
				string,
				{
					summary?: string
					get?: {
						parameters?: Array<{ name?: string }>
					}
					post?: {
						summary?: string
						requestBody?: {
							content?: {
								"application/json"?: {
									schema?: {
										properties?: Record<
											string,
											{ enum?: string[]; items?: { enum?: string[] } }
										>
									}
								}
							}
						}
					}
				}
			>
		}

		expect(json.paths?.["/v1/state"]?.get?.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "agentId" }),
				expect.objectContaining({ name: "scope" }),
				expect.objectContaining({ name: "scopeRef" }),
			]),
		)
		expect(
			json.paths?.["/v1/context-bundle"]?.post?.requestBody?.content?.[
				"application/json"
			]?.schema?.properties?.mode?.enum,
		).toEqual(["full", "wake-up"])
		expect(
			json.paths?.["/v1/recall-conversation"]?.post?.requestBody?.content?.[
				"application/json"
			]?.schema?.properties?.roles?.items?.enum,
		).toEqual(["user", "assistant", "system", "tool"])
		expect(json.paths?.["/v1/lifecycle/get"]?.post).toBeDefined()
		expect(json.paths?.["/v1/lifecycle/update"]?.post).toBeDefined()
		expect(json.paths?.["/v1/lifecycle/delete"]?.post?.summary).toContain(
			"invalidate",
		)
		expect(json.paths?.["/v1/lifecycle/history"]?.post).toBeDefined()
	})

	it("does not expose Memongo control operations to authenticated tenants", async () => {
		process.env.MDBRAIN_API_KEY = "secret"

		for (const path of [
			"/v1/status",
			"/v1/probes/embedding",
			"/v1/probes/vector",
		]) {
			const response = await createApp().request(path, {
				headers: { Authorization: "Bearer secret" },
			})
			expect(response.status).toBe(404)
		}

		expect(bridgeMocks.mdbrainBridgeStatus).not.toHaveBeenCalled()
		expect(bridgeMocks.mdbrainBridgeProbeEmbedding).not.toHaveBeenCalled()
		expect(bridgeMocks.mdbrainBridgeProbeVector).not.toHaveBeenCalled()
	})

	it("logs a prominent warning once when API auth is disabled", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const { resetUnauthenticatedApiWarningForTests } = await import(
				"./app.js"
			)
			resetUnauthenticatedApiWarningForTests()

			createApp()
			createApp()

			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn.mock.calls[0]?.[0]).toContain(
				"routes run as the unauthenticated development principal",
			)
		} finally {
			warn.mockRestore()
		}
	})

	it("does not warn when admin or scoped API auth is configured", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const { resetUnauthenticatedApiWarningForTests } = await import(
				"./app.js"
			)
			resetUnauthenticatedApiWarningForTests()

			process.env.MDBRAIN_API_KEY = "secret"
			createApp()
			process.env.MDBRAIN_API_KEY = ""
			process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
				{ token: "scoped-secret", agentIds: ["agent"] },
			])
			createApp()

			expect(warn).not.toHaveBeenCalled()
		} finally {
			warn.mockRestore()
		}
	})

	it("registers a graceful shutdown handler that runs bridge close on SIGTERM/SIGINT (bridge shutdown part 2)", async () => {
		const { registerGracefulShutdown } = await import("./app.js")
		expect(typeof registerGracefulShutdown).toBe("function")

		const emitter = new (await import("node:events")).EventEmitter()
		const shutdownCalls: string[] = []
		const closeBridge = vi.fn(async () => {
			shutdownCalls.push("bridge-closed")
		})
		const closeServer = vi.fn(async () => {
			shutdownCalls.push("server-closed")
		})
		const exit = vi.fn()

		registerGracefulShutdown({
			signals: ["SIGTERM", "SIGINT"],
			process: emitter as unknown as NodeJS.Process,
			closeBridge,
			closeServer,
			exit,
			timeoutMs: 50,
		})

		// Emit SIGTERM — expect closeBridge and closeServer both called, process.exit(0).
		emitter.emit("SIGTERM")
		// Handler is async; give it a tick to run.
		await new Promise((r) => setTimeout(r, 10))
		expect(closeBridge).toHaveBeenCalledOnce()
		expect(closeServer).toHaveBeenCalledOnce()
		expect(exit).toHaveBeenCalledWith(0)
		expect(shutdownCalls).toEqual(["server-closed", "bridge-closed"])
	})

	it("shutdown forces exit(1) when close handlers exceed the timeout (bridge shutdown part 2)", async () => {
		const { registerGracefulShutdown } = await import("./app.js")
		const emitter = new (await import("node:events")).EventEmitter()

		// closeBridge hangs past the timeout.
		const closeBridge = vi.fn(
			() => new Promise<void>((resolve) => setTimeout(resolve, 500)),
		)
		const closeServer = vi.fn(async () => {})
		const exit = vi.fn()

		registerGracefulShutdown({
			signals: ["SIGTERM"],
			process: emitter as unknown as NodeJS.Process,
			closeBridge,
			closeServer,
			exit,
			timeoutMs: 20,
		})

		emitter.emit("SIGTERM")
		// Wait past the timeout.
		await new Promise((r) => setTimeout(r, 60))
		expect(exit).toHaveBeenCalledWith(1)
	})

	it("compares bearer tokens in constant time (MED timing-safe)", async () => {
		// Behavioral regression: rejection must hold for tokens of the same length
		// AND different length; the implementation must not short-circuit on length
		// alone (which would leak length via timing). Both must reject with 401.
		const { timingSafeBearerEquals } = await import("./app.js")
		expect(typeof timingSafeBearerEquals).toBe("function")

		// Exact match.
		expect(
			timingSafeBearerEquals("supersecret-token", "supersecret-token"),
		).toBe(true)

		// Same length, one char off — rejects.
		expect(
			timingSafeBearerEquals("supersecret-token", "supersecret-tokeX"),
		).toBe(false)

		// Different length — rejects without throwing.
		expect(timingSafeBearerEquals("short", "supersecret-token")).toBe(false)
		expect(timingSafeBearerEquals("supersecret-token", "short")).toBe(false)

		// Empty inputs — rejects (never accept empty bearer).
		expect(timingSafeBearerEquals("", "any")).toBe(false)
		expect(timingSafeBearerEquals("any", "")).toBe(false)
		expect(timingSafeBearerEquals("", "")).toBe(false)
	})

	it("fails closed when scoped API key policy JSON is invalid", () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = "not-json"

		expect(() => createApp()).toThrow(
			"MDBRAIN_API_SCOPED_KEYS must be valid JSON",
		)
	})

	it("fails closed when scoped API key policies are unconstrained", () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{ token: "scoped-secret" },
		])

		expect(() => createApp()).toThrow(
			"MDBRAIN_API_SCOPED_KEYS policy at index 0 must constrain agentIds, scopes, scopeRefs, or grants",
		)
	})

	it("allows scoped API keys only inside their agent and scope policy", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
			},
		])

		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: {
				Authorization: "Bearer scoped-secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "scoped gates",
				agentId: "codex",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
			}),
		})

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeSearch).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
			}),
		)
	})

	it("forwards query-only authorized scope through search", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
				capabilities: ["read"],
			},
		])

		const res = await createApp().request(
			"/v1/search?agentId=codex&scope=workspace&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer scoped-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "query-only scope" }),
			},
		)

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeSearch).toHaveBeenCalledWith({
			query: "query-only scope",
			agentId: "codex",
			maxResults: undefined,
			minScore: undefined,
			sessionKey: undefined,
			scope: "workspace",
			scopeRef: "/workspace/mdbrain",
		})
	})

	it("rejects an invalid canonical scope before Memongo", async () => {
		process.env.MDBRAIN_API_KEY = "admin-secret"

		const res = await createApp().request(
			"/v1/search?agentId=codex&scope=project&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "invalid canonical scope" }),
			},
		)

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "scope must be session|user|agent|workspace|tenant|global",
			},
		})
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("rejects JSON bodies sent with a non-JSON content type before Memongo", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
			},
		])

		const res = await createApp().request(
			"/v1/search?agentId=codex&scope=workspace&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer scoped-secret",
					"Content-Type": "text/plain",
				},
				body: JSON.stringify({
					query: "scope bypass",
					agentId: "codex",
					scope: "workspace",
					scopeRef: "/workspace/other",
				}),
			},
		)

		expect(res.status).toBe(415)
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("rejects request bodies without a JSON content type before Memongo", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
			},
		])
		const request = new Request(
			"http://localhost/v1/search?agentId=codex&scope=workspace&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: { Authorization: "Bearer scoped-secret" },
				body: new TextEncoder().encode(
					JSON.stringify({
						query: "scope bypass",
						agentId: "codex",
						scope: "workspace",
						scopeRef: "/workspace/other",
					}),
				),
			},
		)

		const res = await createApp().request(request)

		expect(res.status).toBe(415)
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("forwards the authorized search-kb scope unchanged", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
				capabilities: ["read"],
			},
		])
		bridgeMocks.mdbrainBridgeSearchKB.mockResolvedValueOnce([])

		const res = await createApp().request(
			"/v1/search-kb?agentId=codex&scope=workspace&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer scoped-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "authorized knowledge" }),
			},
		)

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeSearchKB).toHaveBeenCalledWith({
			query: "authorized knowledge",
			agentId: "codex",
			maxResults: undefined,
			minScore: undefined,
			filter: undefined,
			scope: "workspace",
			scopeRef: "/workspace/mdbrain",
		})
	})

	it("forwards authenticated scoped recall authority unchanged", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
				capabilities: ["read"],
			},
		])

		const res = await createApp().request(
			"/v1/recall-conversation?agentId=codex&scope=workspace&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer scoped-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ query: "scoped recall", limit: 2 }),
			},
		)

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeRecallConversation).toHaveBeenCalledWith({
			agentId: "codex",
			query: "scoped recall",
			scope: "workspace",
			scopeRef: "/workspace/mdbrain",
			sessionId: undefined,
			roles: undefined,
			startTime: undefined,
			endTime: undefined,
			timezone: undefined,
			includeToolMessages: undefined,
			limit: 2,
		})
	})

	it("enforces server-assigned capabilities by route", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "read-only-secret",
				subjectId: "service:reader",
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
				capabilities: ["read"],
			},
		])
		const headers = {
			Authorization: "Bearer read-only-secret",
			"Content-Type": "application/json",
		}

		const search = await createApp().request("/v1/search", {
			method: "POST",
			headers,
			body: JSON.stringify({
				query: "allowed read",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
			}),
		})
		expect(search.status).toBe(200)

		const write = await createApp().request("/v1/add", {
			method: "POST",
			headers,
			body: JSON.stringify({
				content: "forbidden write",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
			}),
		})
		expect(write.status).toBe(403)
		await expect(write.json()).resolves.toEqual({
			error: {
				code: "FORBIDDEN",
				message: "capability is not allowed for this API key",
			},
		})
		expect(bridgeMocks.mdbrainBridgeAdd).not.toHaveBeenCalled()
	})

	it("rejects scoped API keys outside their allowed scopeRef", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
			},
		])

		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: {
				Authorization: "Bearer scoped-secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "scoped gates",
				agentId: "codex",
				scope: "workspace",
				scopeRef: "/workspace/other",
			}),
		})

		expect(res.status).toBe(403)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "FORBIDDEN",
				message: "scopeRef is not allowed for this API key",
			},
		})
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("rejects conflicting query and body scope before Memongo", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace", "tenant"],
				scopeRefs: ["/workspace/mdbrain", "tenant-2"],
				capabilities: ["read"],
			},
		])

		const res = await createApp().request(
			"/v1/search?agentId=codex&scope=workspace&scopeRef=%2Fworkspace%2Fmdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer scoped-secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					query: "conflicting scope",
					agentId: "codex",
					scope: "tenant",
					scopeRef: "tenant-2",
				}),
			},
		)

		expect(res.status).toBe(403)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "FORBIDDEN",
				message: "conflicting scope values are not allowed",
			},
		})
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("rejects conflicting top-level and nested scoped authority", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
				capabilities: ["write"],
			},
		])

		const res = await createApp().request("/v1/lifecycle/update", {
			method: "POST",
			headers: {
				Authorization: "Bearer scoped-secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				agentId: "codex",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
				handle: {
					family: "structured",
					id: "structured:other",
					agentId: "other-agent",
					scope: "tenant",
					scopeRef: "other-tenant",
					revision: 1,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				patch: { value: "forbidden" },
			}),
		})

		expect(res.status).toBe(403)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "FORBIDDEN",
				message: "conflicting agentId values are not allowed",
			},
		})
		expect(bridgeMocks.mdbrainBridgeUpdateLifecycleItem).not.toHaveBeenCalled()
	})

	it("requires explicit scoped fields for scoped API keys", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
			},
		])

		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: {
				Authorization: "Bearer scoped-secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "scoped gates",
				agentId: "codex",
			}),
		})

		expect(res.status).toBe(403)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "FORBIDDEN",
				message: "scope is required for this API key",
			},
		})
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("keeps MDBRAIN_API_KEY as the admin key when scoped keys are configured", async () => {
		process.env.MDBRAIN_API_KEY = "admin-secret"
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["/workspace/mdbrain"],
			},
		])

		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: {
				Authorization: "Bearer admin-secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "admin can inspect another scope",
				agentId: "other-agent",
				scope: "global",
				scopeRef: "global",
			}),
		})

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeSearch).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "other-agent",
				scope: "global",
				scopeRef: "global",
			}),
		)
	})

	it("forwards add scope and scopeRef when provided", async () => {
		const res = await createApp().request("/v1/add", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "add-scope-1",
			},
			body: JSON.stringify({
				content: "remember the scoped thing",
				agentId: "codex",
				sessionId: "session-9",
				scope: "session",
				scopeRef: "session:session-9",
				idempotencyKey: "add-scope-1",
			}),
		})

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				content: "remember the scoped thing",
				agentId: "codex",
				sessionId: "session-9",
				scope: "session",
				scopeRef: "session:session-9",
				idempotencyKey: "add-scope-1",
			}),
		)
	})

	it("forwards write-event scopeRef when provided", async () => {
		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "write-scope-1",
				"X-Request-ID": "request-1",
			},
			body: JSON.stringify({
				role: "assistant",
				body: "scoped assistant memory",
				agentId: "codex",
				sessionId: "session-9",
				scope: "session",
				scopeRef: "session:session-9",
				idempotencyKey: "write-scope-1",
				requestId: "request-1",
			}),
		})

		expect(res.status).toBe(200)
		expect(
			bridgeMocks.mdbrainBridgeWriteConversationEvent,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "assistant",
				body: "scoped assistant memory",
				agentId: "codex",
				sessionId: "session-9",
				scope: "session",
				scopeRef: "session:session-9",
			}),
		)
	})

	it("resolves the canonical agent scopeRef when none is provided", async () => {
		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "write-canonical-scope-1",
			},
			body: JSON.stringify({
				role: "user",
				body: "unscoped agent memory",
				agentId: "codex",
				idempotencyKey: "write-canonical-scope-1",
			}),
		})

		expect(res.status).toBe(200)
		expect(
			bridgeMocks.mdbrainBridgeWriteConversationEvent,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex",
				scope: "agent",
				scopeRef: "agent:codex",
			}),
		)
	})

	it("accepts explicit receipt-gated wiki promotion on a memory write", async () => {
		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "YOUR_IDEMPOTENCY_KEY_HERE",
			},
			body: JSON.stringify({
				role: "user",
				body: "Deployments happen on Friday.",
				agentId: "codex",
				scope: "workspace",
				scopeRef: "workspace-1",
				promotionPolicy: "wiki",
				wikiPromotion: {
					page: {
						kind: "procedure",
						title: "Deployment schedule",
						slug: "procedures/deployment-schedule",
						summary: "Deployments happen on Friday.",
						body: "Deployments happen on Friday.",
						frontmatter: { type: "procedure", status: "stable" },
						claims: [
							{
								id: "deploy-day",
								text: "Deployments happen on Friday.",
							},
						],
						scope: "workspace",
						scopeRef: "workspace-1",
						trustTier: "standard",
					},
				},
			}),
		})

		expect(res.status).toBe(200)
		expect(deliveryMocks.deliverMemoryWrite).toHaveBeenCalledWith(
			expect.objectContaining({
				promotion: expect.objectContaining({
					key: expect.stringMatching(
						/^write-event:[a-f0-9]{64}:wiki:procedures\/deployment-schedule:v1$/,
					),
					mutateWiki: expect.any(Function),
				}),
				payload: expect.objectContaining({
					promotionPolicy: "wiki",
					wikiPromotion: expect.any(Object),
				}),
			}),
		)
		expect(
			bridgeMocks.mdbrainBridgeWriteConversationEvent,
		).toHaveBeenCalledWith(
			expect.not.objectContaining({
				promotionPolicy: expect.anything(),
				wikiPromotion: expect.anything(),
			}),
		)
	})

	it("rejects system-role writes from principals without write-trusted", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{ token: "scoped-secret", agentIds: ["codex"] },
		])

		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer scoped-secret",
				"Idempotency-Key": "system-role-1",
			},
			body: JSON.stringify({
				role: "system",
				body: "platform-authored write",
				agentId: "codex",
				idempotencyKey: "system-role-1",
			}),
		})

		expect(res.status).toBe(403)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "FORBIDDEN",
				message:
					"system and tool write roles require the write-trusted capability",
			},
		})
		expect(deliveryMocks.deliverMemoryWrite).not.toHaveBeenCalled()
		expect(
			bridgeMocks.mdbrainBridgeWriteConversationEvent,
		).not.toHaveBeenCalled()
	})

	it("accepts system-role writes from principals with write-trusted", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "scoped-secret",
				agentIds: ["codex"],
				capabilities: ["read", "write", "write-trusted"],
			},
		])

		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer scoped-secret",
				"Idempotency-Key": "system-role-2",
			},
			body: JSON.stringify({
				role: "system",
				body: "platform-authored write",
				agentId: "codex",
				idempotencyKey: "system-role-2",
			}),
		})

		expect(res.status).toBe(200)
		expect(deliveryMocks.deliverMemoryWrite).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "write-event",
				payload: expect.objectContaining({ role: "system" }),
			}),
		)
	})

	it("approves pending wiki promotions through the admin route", async () => {
		deliveryMocks.approvePendingWikiPromotion.mockResolvedValue({
			ok: true,
			operationId: "write-event:queued",
			pageSlug: "procedures/deployment-schedule",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/write-event%3Aqueued/approve",
			{ method: "POST" },
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			ok: true,
			operationId: "write-event:queued",
			state: "promoted",
			pageSlug: "procedures/deployment-schedule",
		})
		expect(deliveryMocks.approvePendingWikiPromotion).toHaveBeenCalledWith({
			operationId: "write-event:queued",
		})
	})

	it("surfaces approval failures from the admin route", async () => {
		deliveryMocks.approvePendingWikiPromotion.mockResolvedValue({
			ok: false,
			status: 404,
			code: "NOT_FOUND",
			message: "no such delivery intent",
		})

		const res = await createApp().request(
			"/v1/admin/wiki-promotions/write-event%3Amissing/approve",
			{ method: "POST" },
		)

		expect(res.status).toBe(404)
		await expect(res.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "no such delivery intent" },
		})
	})
	it("redrives dead-lettered deliveries through the admin route", async () => {
		deliveryMocks.redriveDeadLetteredMemoryDelivery.mockResolvedValue({
			ok: true,
			operationId: "write-event:dead",
			state: "recorded",
		})
		const res = await createApp().request(
			"/v1/admin/deliveries/write-event%3Adead/redrive",
			{ method: "POST" },
		)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			ok: true,
			operationId: "write-event:dead",
			state: "recorded",
		})
		expect(
			deliveryMocks.redriveDeadLetteredMemoryDelivery,
		).toHaveBeenCalledWith({ operationId: "write-event:dead" })
	})
	it("maps redrive failures to the runtime's status and code", async () => {
		deliveryMocks.redriveDeadLetteredMemoryDelivery.mockResolvedValue({
			ok: false,
			status: 409,
			code: "INVALID_DELIVERY_STATE",
			message: "delivery cannot be redriven from state promoted",
		})
		const res = await createApp().request(
			"/v1/admin/deliveries/write-event%3Aalive/redrive",
			{ method: "POST" },
		)
		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "INVALID_DELIVERY_STATE",
				message: "delivery cannot be redriven from state promoted",
			},
		})
	})
	it("maps a lost dispatch lease to a typed 409, not a 500", async () => {
		deliveryMocks.deliverMemoryWrite.mockRejectedValue(
			new deliveryMocks.MemoryDeliveryDispatchError(
				"write-event:contested",
				"outcome-unknown",
				"LEASE_LOST",
			),
		)
		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "lease-lost-1",
			},
			body: JSON.stringify({
				role: "user",
				body: "contested write",
				agentId: "codex",
			}),
		})
		expect(res.status).toBe(409)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "DELIVERY_LEASE_LOST",
				message: expect.stringContaining("claimed by another worker"),
			},
		})
	})
	it("rejects oversized memory payloads with 413", async () => {
		deliveryMocks.deliverMemoryWrite.mockRejectedValue(
			new MemoryDeliveryPayloadTooLargeError(300_000, 262_144),
		)
		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "oversized-1",
			},
			body: JSON.stringify({
				role: "user",
				body: "oversized write",
				agentId: "codex",
			}),
		})
		expect(res.status).toBe(413)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "PAYLOAD_TOO_LARGE",
				message: expect.stringContaining("262144 bytes"),
			},
		})
	})

	it("requires caller-owned idempotency for event writes", async () => {
		const res = await createApp().request("/v1/write-event", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				role: "user",
				body: "must be idempotent",
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "IDEMPOTENCY_KEY_REQUIRED",
				message: "Idempotency-Key header is required",
			},
		})
		expect(
			bridgeMocks.mdbrainBridgeWriteConversationEvent,
		).not.toHaveBeenCalled()
	})

	it.each([
		["POST", "/v1/read-file"],
		["GET", "/v1/status/detailed"],
		["GET", "/v1/stats"],
		["POST", "/v1/sync"],
		["POST", "/v1/admin/relevance/explain"],
		["POST", "/v1/admin/relevance/benchmark"],
		["GET", "/v1/admin/relevance/report"],
		["GET", "/v1/admin/relevance/sample-rate"],
		["POST", "/v1/admin/benchmarks/ingest"],
		["POST", "/v1/import/conversations"],
		["GET", "/v1/admin/access-trends"],
		["GET", "/v1/admin/access-summaries"],
		["POST", "/v1/chain-trace"],
		["POST", "/v1/novelty-scan"],
		["POST", "/v1/consolidate"],
		["POST", "/v1/self-edit"],
		["GET", "/v1/admin/traces"],
		["GET", "/v1/admin/traces/trace-1"],
		["GET", "/v1/jobs"],
		["GET", "/v1/jobs/job-1"],
		["POST", "/v1/wiki/maintain"],
	])("does not expose unsupported operation %s %s", async (method, path) => {
		const res = await createApp().request(path, { method })
		expect(res.status).toBe(404)
	})

	it("rejects invalid scope values before calling the bridge", async () => {
		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: "scoped launch note",
				scope: "project",
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "scope must be session|user|agent|workspace|tenant|global",
			},
		})
		expect(bridgeMocks.mdbrainBridgeSearch).not.toHaveBeenCalled()
	})

	it("rejects invalid search-detailed scope values before calling the bridge", async () => {
		const res = await createApp().request("/v1/search-detailed", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: "scoped launch note",
				scope: "project",
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "scope must be session|user|agent|workspace|tenant|global",
			},
		})
		expect(bridgeMocks.mdbrainBridgeSearchDetailed).not.toHaveBeenCalled()
	})

	it("rejects user and tenant scopes without scopeRef", async () => {
		const res = await createApp().request("/v1/add", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "tenant-validation-1",
			},
			body: JSON.stringify({
				content: "remember this for a tenant",
				scope: "tenant",
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "tenant scope requires scopeRef",
			},
		})
		expect(bridgeMocks.mdbrainBridgeAdd).not.toHaveBeenCalled()
	})

	it("rejects state user scope without scopeRef", async () => {
		const res = await createApp().request("/v1/state?scope=user")

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "user scope requires scopeRef",
			},
		})
		expect(bridgeMocks.mdbrainBridgeGetState).not.toHaveBeenCalled()
	})

	it("forwards profile scope when provided", async () => {
		const res = await createApp().request("/v1/profile", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				scope: "session",
				scopeRef: "session:demo",
				maxEpisodes: 3,
			}),
		})

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeProfile).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: "session",
				scopeRef: "session:demo",
				maxEpisodes: 3,
			}),
		)
	})

	it("forwards hydrate-active-slate requests with explicit scope", async () => {
		bridgeMocks.mdbrainBridgeHydrateActiveSlate.mockResolvedValue({
			agentId: "agent-42",
			scope: "workspace",
			scopeRef: "workspace:demo",
			items: [
				{
					kind: "active-critical",
					title: "blocker-db-migration",
					summary: "Database migration is blocked on rollout approval.",
					path: "structured:todo:blocker-db-migration?scope=workspace&scopeRef=workspace%3Ademo",
					source: "structured",
					scope: "workspace",
					scopeRef: "workspace:demo",
				},
			],
			metadata: {
				maxItems: 4,
				truncated: false,
				partial: false,
				countsByKind: { "active-critical": 1 },
				sourceCounts: { structured: 1 },
			},
			hydratedAt: "2026-04-05T12:00:00.000Z",
		})

		const res = await createApp().request("/v1/hydrate-active-slate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId: "agent-42",
				scope: "workspace",
				scopeRef: "workspace:demo",
				maxItems: 4,
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			agentId: "agent-42",
			scope: "workspace",
			scopeRef: "workspace:demo",
			items: [
				expect.objectContaining({
					kind: "active-critical",
					source: "structured",
				}),
			],
			metadata: expect.objectContaining({
				maxItems: 4,
			}),
			hydratedAt: "2026-04-05T12:00:00.000Z",
		})
		expect(bridgeMocks.mdbrainBridgeHydrateActiveSlate).toHaveBeenCalledWith({
			agentId: "agent-42",
			scope: "workspace",
			scopeRef: "workspace:demo",
			maxItems: 4,
		})
	})

	it("forwards discovery projection requests and returns projection metadata", async () => {
		bridgeMocks.mdbrainBridgeBuildDiscoveryProjection.mockResolvedValue({
			kind: "what-changed",
			query: "routing",
			title: "What changed for routing",
			summary: "Two durable updates were recorded in the last 7 days.",
			scope: "workspace",
			scopeRef: "workspace:demo",
			sections: [
				{
					title: "Structured changes",
					summary: "One superseded decision was found.",
					evidence: [
						{
							title: "routing-policy",
							summary: "Old routing policy",
							path: "structured:decision:routing-policy?scope=workspace&scopeRef=workspace%3Ademo",
							source: "structured",
						},
					],
				},
			],
			metadata: {
				partial: false,
				evidenceCount: 1,
				sourceCounts: { structured: 1 },
				timeRange: {
					label: "last-7d",
					start: "2026-03-29T12:00:00.000Z",
					end: "2026-04-05T12:00:00.000Z",
				},
			},
			builtAt: "2026-04-05T12:00:00.000Z",
		})

		const res = await createApp().request("/v1/discovery-projection", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId: "agent-42",
				kind: "what-changed",
				query: "routing",
				scope: "workspace",
				scopeRef: "workspace:demo",
				maxItems: 4,
				timeRange: { preset: "last-7d" },
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			kind: "what-changed",
			query: "routing",
			title: "What changed for routing",
			summary: "Two durable updates were recorded in the last 7 days.",
			scope: "workspace",
			scopeRef: "workspace:demo",
			sections: expect.any(Array),
			metadata: expect.objectContaining({
				evidenceCount: 1,
			}),
			builtAt: "2026-04-05T12:00:00.000Z",
		})
		expect(
			bridgeMocks.mdbrainBridgeBuildDiscoveryProjection,
		).toHaveBeenCalledWith({
			agentId: "agent-42",
			kind: "what-changed",
			query: "routing",
			scope: "workspace",
			scopeRef: "workspace:demo",
			maxItems: 4,
			timeRange: { preset: "last-7d" },
		})
	})

	it("forwards context bundle requests and returns bundle metadata", async () => {
		bridgeMocks.mdbrainBridgeBuildContextBundle.mockResolvedValue({
			agentId: "agent-42",
			query: "Phoenix handoff",
			scope: "agent",
			scopeRef: "agent:main",
			sessionId: "session-main",
			rendered: "## Active Slate\n- blocker",
			sections: [
				{
					kind: "active-slate",
					title: "Active Slate",
					items: [
						{
							title: "blocker-db-migration",
							summary: "Database migration is blocked on rollout approval.",
							source: "structured",
						},
					],
					estimatedTokens: 18,
					truncated: false,
					partial: false,
				},
			],
			metadata: {
				tokenBudget: 320,
				estimatedTokensUsed: 18,
				partial: false,
				truncated: false,
				pathsExecuted: ["active-slate", "structured"],
				sectionsIncluded: ["active-slate"],
			},
			builtAt: "2026-04-05T12:00:00.000Z",
		})

		const res = await createApp().request("/v1/context-bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId: "agent-42",
				query: "Phoenix handoff",
				scope: "agent",
				scopeRef: "agent:main",
				sessionId: "session-main",
				tokenBudget: 320,
				maxEvidenceItems: 3,
				includeDiscoveryProjection: true,
				discoveryKind: "topic-brief",
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			agentId: "agent-42",
			query: "Phoenix handoff",
			scope: "agent",
			scopeRef: "agent:main",
			sessionId: "session-main",
			rendered: "## Active Slate\n- blocker",
			sections: expect.any(Array),
			metadata: expect.objectContaining({
				tokenBudget: 320,
				pathsExecuted: ["active-slate", "structured"],
			}),
			builtAt: "2026-04-05T12:00:00.000Z",
		})
		expect(bridgeMocks.mdbrainBridgeBuildContextBundle).toHaveBeenCalledWith({
			agentId: "agent-42",
			query: "Phoenix handoff",
			scope: "agent",
			scopeRef: "agent:main",
			sessionId: "session-main",
			tokenBudget: 320,
			maxActiveItems: undefined,
			maxEvidenceItems: 3,
			maxRecentEvents: undefined,
			includeDiscoveryProjection: true,
			discoveryKind: "topic-brief",
			includeProfile: undefined,
			timeRange: undefined,
			mode: undefined,
		})
	})

	it("forwards wake-up mode for context bundle requests", async () => {
		const res = await createApp().request("/v1/context-bundle", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId: "agent-42",
				scope: "workspace",
				scopeRef: "workspace:demo",
				mode: "wake-up",
			}),
		})

		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeBuildContextBundle).toHaveBeenCalledWith({
			agentId: "agent-42",
			query: undefined,
			scope: "workspace",
			scopeRef: "workspace:demo",
			sessionId: undefined,
			tokenBudget: undefined,
			maxActiveItems: undefined,
			maxEvidenceItems: undefined,
			maxRecentEvents: undefined,
			includeDiscoveryProjection: undefined,
			discoveryKind: undefined,
			includeProfile: undefined,
			timeRange: undefined,
			mode: "wake-up",
		})
	})

	it("forwards state route requests to the canonical bridge method", async () => {
		bridgeMocks.mdbrainBridgeGetState.mockResolvedValue({
			profile: { profile: [] },
			blocks: {
				blocks: [
					{
						label: "working-memory",
						title: "Current work",
						content: "Finish packaging alignment",
						tokenBudget: 120,
						actualTokens: 24,
						sourcePaths: ["structured:task:packaging-alignment"],
					},
				],
				totalTokenBudget: 120,
				totalActualTokens: 24,
			},
			bundle: {
				agentId: "agent-42",
				scope: "workspace",
				scopeRef: "workspace:demo",
				rendered: "## Wake-up\nContinue packaging alignment.",
				sections: [],
				metadata: {
					tokenBudget: 320,
					estimatedTokensUsed: 24,
					partial: false,
					truncated: false,
					pathsExecuted: ["active-slate"],
					sectionsIncluded: ["active-slate"],
				},
				builtAt: "2026-04-05T12:00:00.000Z",
			},
		})

		const res = await createApp().request(
			"/v1/state?agentId=agent-42&scope=workspace&scopeRef=workspace%3Ademo",
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				blocks: expect.objectContaining({
					blocks: expect.arrayContaining([
						expect.objectContaining({
							label: "working-memory",
						}),
					]),
				}),
			}),
		)
		expect(bridgeMocks.mdbrainBridgeGetState).toHaveBeenCalledWith({
			agentId: "agent-42",
			scope: "workspace",
			scopeRef: "workspace:demo",
		})
	})

	it("schedules background extraction for one event", async () => {
		const res = await createApp().request("/v1/extract", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ eventId: "evt-1", agentId: "agent-42" }),
		})

		expect(res.status).toBe(202)
		await expect(res.json()).resolves.toEqual({
			ok: true,
			jobId: "extraction-evt-1",
			scheduled: true,
		})
		expect(bridgeMocks.mdbrainBridgeExtractEvent).toHaveBeenCalledWith({
			agentId: "agent-42",
			eventId: "evt-1",
		})
	})

	it("rejects extract when eventId is missing", async () => {
		const res = await createApp().request("/v1/extract", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: { code: "VALIDATION_ERROR", message: "eventId is required" },
		})
	})

	it("forwards searchDetailed request options and returns bridge metadata", async () => {
		bridgeMocks.mdbrainBridgeSearchDetailed.mockResolvedValue({
			results: [
				{
					path: "structured:decision:phoenix",
					startLine: 0,
					endLine: 0,
					snippet: "exact answer",
					score: 0.92,
					source: "structured",
				},
			],
			metadata: {
				mode: "agentic",
				classification: "temporal",
				sourceOrder: ["structured", "conversation"],
				resolvedSearchConfig: {
					recipe: "deep",
					recallProfile: "balanced",
					maxResults: 4,
					searchMode: "agentic",
					maxPasses: 3,
					sourcePreference: ["structured", "conversation"],
					needExactEvidence: true,
					numCandidates: 60,
					fusionMethod: "rankFusion",
					hybridMode: "hybrid",
					allowHybridBackstop: true,
					lexicalPrefilter: "disabled",
				},
				passes: [
					{
						pass: 1,
						query: "what changed",
						reason: "baseline",
						pathsExecuted: ["structured"],
						resultCount: 1,
						queryRewritten: false,
						reranked: true,
					},
				],
				queriesTried: ["what changed"],
				constraintsApplied: ["scope:workspace"],
				resultsRejected: [],
				evidenceCoverage: "direct",
				pathsExecuted: ["structured"],
				resultsByPath: { structured: 1 },
				queryRewritten: false,
				reranked: true,
			},
		})

		const res = await createApp().request("/v1/search-detailed", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: "what changed",
				agentId: "agent-42",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
				limit: 4,
				minScore: 0.4,
				searchMode: "agentic",
				sourcePreference: ["structured", "conversation"],
				timeRange: {
					preset: "last-7d",
					start: "2026-04-01T00:00:00.000Z",
					end: "2026-04-05T00:00:00.000Z",
				},
				needExactEvidence: true,
				maxPasses: 3,
				returnPlan: true,
				conversationScope: { sessionKey: "session-9" },
				structuredScope: {
					type: "decision",
					state: ["active"],
					salience: ["high"],
				},
				referenceScope: {
					source: "kb",
					category: "runbook",
					tags: ["memory"],
				},
				proceduralScope: {
					state: "active",
					intentTags: ["recall"],
				},
				searchConfig: {
					recipe: "deep",
					numCandidates: 60,
					fusionMethod: "rankFusion",
				},
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			results: [
				{
					path: "structured:decision:phoenix",
					startLine: 0,
					endLine: 0,
					snippet: "exact answer",
					score: 0.92,
					source: "structured",
				},
			],
			metadata: expect.objectContaining({
				mode: "agentic",
				classification: "temporal",
				resolvedSearchConfig: expect.objectContaining({
					recipe: "deep",
					fusionMethod: "rankFusion",
				}),
			}),
		})
		expect(bridgeMocks.mdbrainBridgeSearchDetailed).toHaveBeenCalledWith({
			query: "what changed",
			agentId: "agent-42",
			scope: "workspace",
			scopeRef: "/workspace/mdbrain",
			maxResults: 4,
			minScore: 0.4,
			searchMode: "agentic",
			sourcePreference: ["structured", "conversation"],
			timeRange: {
				preset: "last-7d",
				start: "2026-04-01T00:00:00.000Z",
				end: "2026-04-05T00:00:00.000Z",
			},
			needExactEvidence: true,
			maxPasses: 3,
			returnPlan: true,
			conversationScope: { sessionKey: "session-9" },
			structuredScope: {
				type: "decision",
				state: ["active"],
				salience: ["high"],
			},
			referenceScope: {
				source: "kb",
				category: "runbook",
				tags: ["memory"],
			},
			proceduralScope: {
				state: "active",
				intentTags: ["recall"],
			},
			searchConfig: {
				recipe: "deep",
				numCandidates: 60,
				fusionMethod: "rankFusion",
			},
		})
	})

	it("forwards recall-conversation filters and returns cited results", async () => {
		bridgeMocks.mdbrainBridgeRecallConversation.mockResolvedValue({
			results: [
				{
					citation: {
						eventId: "evt-42",
						sessionId: "session-9",
						role: "assistant",
						timestamp: "2026-04-08T14:30:00.000Z",
						preview: "Assistant: Phoenix ships on Friday.",
					},
					score: 0.91,
					matchType: "semantic",
				},
			],
			metadata: {
				totalMatched: 1,
				queryUsed: "phoenix",
				filtersApplied: [
					"sessionId:session-9",
					"roles:assistant",
					"startTime:2026-04-08T00:00:00.000Z",
					"endTime:2026-04-08T23:59:59.999Z",
				],
				searchMethod: "semantic",
				durationMs: 12,
			},
		})

		const res = await createApp().request("/v1/recall-conversation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId: "agent-42",
				query: "phoenix",
				scope: "workspace",
				scopeRef: "/workspace/mdbrain",
				sessionId: "session-9",
				roles: ["assistant"],
				startTime: "2026-04-08",
				endTime: "2026-04-08",
				timezone: "America/New_York",
				includeToolMessages: true,
				limit: 3,
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			results: [
				{
					citation: {
						eventId: "evt-42",
						sessionId: "session-9",
						role: "assistant",
						timestamp: "2026-04-08T14:30:00.000Z",
						preview: "Assistant: Phoenix ships on Friday.",
					},
					score: 0.91,
					matchType: "semantic",
				},
			],
			metadata: {
				totalMatched: 1,
				queryUsed: "phoenix",
				filtersApplied: [
					"sessionId:session-9",
					"roles:assistant",
					"startTime:2026-04-08T00:00:00.000Z",
					"endTime:2026-04-08T23:59:59.999Z",
				],
				searchMethod: "semantic",
				durationMs: 12,
			},
		})
		expect(bridgeMocks.mdbrainBridgeRecallConversation).toHaveBeenCalledWith({
			agentId: "agent-42",
			query: "phoenix",
			scope: "workspace",
			scopeRef: "/workspace/mdbrain",
			sessionId: "session-9",
			roles: ["assistant"],
			startTime: "2026-04-08",
			endTime: "2026-04-08",
			timezone: "America/New_York",
			includeToolMessages: true,
			limit: 3,
		})
	})

	it("gets lifecycle item by stable handle", async () => {
		const handle = {
			family: "structured",
			id: "structured:agent-42:agent:agent-42:decision:db",
			agentId: "agent-42",
			scope: "agent",
			scopeRef: "agent-42",
			revision: 2,
			state: "active",
			structured: { type: "decision", key: "db" },
			updatedAt: "2026-04-10T12:00:00.000Z",
		}

		const res = await createApp().request("/v1/lifecycle/get", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ handle }),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				family: "structured",
				data: expect.objectContaining({ value: "Use MongoDB Atlas Local" }),
			}),
		)
		expect(bridgeMocks.mdbrainBridgeGetLifecycleItem).toHaveBeenCalledWith({
			handle: expect.objectContaining({
				family: "structured",
				agentId: "agent-42",
				structured: { type: "decision", key: "db" },
			}),
		})
	})

	it("updates lifecycle item with a family-aware patch", async () => {
		const handle = {
			family: "structured",
			id: "structured:agent-42:agent:agent-42:decision:db",
			agentId: "agent-42",
			scope: "agent",
			scopeRef: "agent-42",
			revision: 2,
			state: "active",
			structured: { type: "decision", key: "db" },
		}

		const res = await createApp().request("/v1/lifecycle/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle,
				patch: {
					value: "Use MongoDB Atlas Preview",
					sourceAgent: { id: "dreamer", name: "Dreamer" },
				},
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				handle: expect.objectContaining({ revision: 3 }),
				data: expect.objectContaining({ value: "Use MongoDB Atlas Preview" }),
			}),
		)
		expect(bridgeMocks.mdbrainBridgeUpdateLifecycleItem).toHaveBeenCalledWith({
			handle: expect.objectContaining({
				family: "structured",
				structured: { type: "decision", key: "db" },
			}),
			patch: {
				value: "Use MongoDB Atlas Preview",
				sourceAgent: { id: "dreamer", name: "Dreamer" },
			},
		})
	})

	it("deletes lifecycle item with invalidate-with-history semantics", async () => {
		const handle = {
			family: "structured",
			id: "structured:agent-42:agent:agent-42:decision:db",
			agentId: "agent-42",
			scope: "agent",
			scopeRef: "agent-42",
			revision: 2,
			state: "active",
			structured: { type: "decision", key: "db" },
		}

		const res = await createApp().request("/v1/lifecycle/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle,
				invalidatedBy: { reason: "user-delete" },
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				handle: expect.objectContaining({ state: "invalidated" }),
			}),
		)
		expect(bridgeMocks.mdbrainBridgeDeleteLifecycleItem).toHaveBeenCalledWith({
			handle: expect.objectContaining({
				family: "structured",
				structured: { type: "decision", key: "db" },
			}),
			invalidatedBy: { reason: "user-delete" },
		})
	})

	it("returns ordered lifecycle history for a stable handle", async () => {
		const res = await createApp().request("/v1/lifecycle/history", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle: {
					family: "structured",
					id: "structured:agent-42:agent:agent-42:decision:db",
					agentId: "agent-42",
					scope: "agent",
					scopeRef: "agent-42",
					revision: 2,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				limit: 20,
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ historyKind: "revision" }),
				expect.objectContaining({ historyKind: "current" }),
			]),
		)
		expect(bridgeMocks.mdbrainBridgeGetLifecycleHistory).toHaveBeenCalledWith({
			handle: expect.objectContaining({
				family: "structured",
				structured: { type: "decision", key: "db" },
			}),
			limit: 20,
		})
	})

	it("records procedure outcomes through the stable handle route", async () => {
		bridgeMocks.mdbrainBridgeReportProcedureOutcome.mockResolvedValue({
			family: "procedure",
			handle: {
				family: "procedure",
				id: "procedure:agent-42:agent:agent-42:deploy",
				agentId: "agent-42",
				scope: "agent",
				scopeRef: "agent-42",
				revision: 2,
				state: "active",
				procedure: { procedureId: "deploy" },
			},
			data: {
				procedureId: "deploy",
				name: "Deploy",
				steps: ["Build", "Ship"],
				successCount: 4,
				failCount: 1,
			},
		})

		const handle = {
			family: "procedure",
			id: "procedure:agent-42:agent:agent-42:deploy",
			agentId: "agent-42",
			scope: "agent",
			scopeRef: "agent-42",
			revision: 2,
			state: "active",
			procedure: { procedureId: "deploy" },
		}

		const res = await createApp().request("/v1/procedures/outcome", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle,
				success: true,
				note: "Passed production deploy",
				actorRole: "assistant",
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				family: "procedure",
				data: expect.objectContaining({ successCount: 4 }),
			}),
		)
		expect(
			bridgeMocks.mdbrainBridgeReportProcedureOutcome,
		).toHaveBeenCalledWith({
			handle,
			success: true,
			note: "Passed production deploy",
			actorRole: "assistant",
		})
	})

	it("applies structured memory feedback through the public feedback route", async () => {
		bridgeMocks.mdbrainBridgeApplyMemoryFeedback.mockResolvedValue({
			family: "structured",
			handle: {
				family: "structured",
				id: "structured:agent-42:agent:agent-42:decision:db",
				agentId: "agent-42",
				scope: "agent",
				scopeRef: "agent-42",
				revision: 3,
				state: "active",
				structured: { type: "decision", key: "db" },
			},
			data: {
				type: "decision",
				key: "db",
				value: "Use MongoDB Atlas Local",
				reinforcementCount: 7,
			},
		})

		const handle = {
			family: "structured",
			id: "structured:agent-42:agent:agent-42:decision:db",
			agentId: "agent-42",
			scope: "agent",
			scopeRef: "agent-42",
			revision: 3,
			state: "active",
			structured: { type: "decision", key: "db" },
		}

		const res = await createApp().request("/v1/memory/feedback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle,
				signal: "confirm",
				note: "Still true",
				actorRole: "user",
			}),
		})

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual(
			expect.objectContaining({
				family: "structured",
				data: expect.objectContaining({ reinforcementCount: 7 }),
			}),
		)
		expect(bridgeMocks.mdbrainBridgeApplyMemoryFeedback).toHaveBeenCalledWith({
			handle,
			signal: "confirm",
			note: "Still true",
			actorRole: "user",
		})
	})

	it("rejects lifecycle update when patch does not match the handle family", async () => {
		const res = await createApp().request("/v1/lifecycle/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle: {
					family: "structured",
					id: "structured:agent-42:agent:agent-42:decision:db",
					agentId: "agent-42",
					scope: "agent",
					scopeRef: "agent-42",
					revision: 2,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				patch: {
					steps: ["Build", "Ship"],
				},
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "patch must be a valid lifecycle patch for the handle family",
			},
		})
	})

	it("rejects correct feedback when patch is missing", async () => {
		const res = await createApp().request("/v1/memory/feedback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle: {
					family: "structured",
					id: "structured:agent-42:agent:agent-42:decision:db",
					agentId: "agent-42",
					scope: "agent",
					scopeRef: "agent-42",
					revision: 2,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				signal: "correct",
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message:
					"patch must be a valid structured lifecycle patch for correct feedback",
			},
		})
	})

	it("rejects correct feedback when patch is empty", async () => {
		const res = await createApp().request("/v1/memory/feedback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle: {
					family: "structured",
					id: "structured:agent-42:agent:agent-42:decision:db",
					agentId: "agent-42",
					scope: "agent",
					scopeRef: "agent-42",
					revision: 2,
					state: "active",
					structured: { type: "decision", key: "db" },
				},
				signal: "correct",
				patch: {},
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message:
					"patch must be a valid structured lifecycle patch for correct feedback",
			},
		})
	})

	it("rejects recall-conversation when roles contain unsupported values", async () => {
		const res = await createApp().request("/v1/recall-conversation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				roles: ["assistant", "narrator"],
			}),
		})

		expect(res.status).toBe(400)
		await expect(res.json()).resolves.toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: "roles must contain only user|assistant|system|tool",
			},
		})
	})

	it("executes /v1/add under the authorized request scope instead of body defaults (REV-01 A1)", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "identity-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["ws:mdbrain"],
			},
		])
		const res = await createApp().request(
			"/v1/add?agentId=codex&scope=workspace&scopeRef=ws:mdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer identity-secret",
					"Content-Type": "application/json",
					"Idempotency-Key": "ws1-add-authorized-identity",
				},
				body: JSON.stringify({ content: "authorized identity write" }),
			},
		)
		expect(res.status).toBe(200)
		const delivery = deliveryMocks.deliverMemoryWrite.mock.calls[0][0]
		expect(delivery.agentId).toBe("codex")
		expect(delivery.scope).toBe("workspace")
		expect(delivery.scopeRef).toBe("ws:mdbrain")
		expect(delivery.payload).toMatchObject({
			agentId: "codex",
			scope: "workspace",
			scopeRef: "ws:mdbrain",
		})
		expect(bridgeMocks.mdbrainBridgeAdd.mock.calls[0][0]).toMatchObject({
			agentId: "codex",
			scope: "workspace",
			scopeRef: "ws:mdbrain",
		})
	})

	it("executes /v1/write-event under the authorized request scope instead of body defaults", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "identity-secret",
				agentIds: ["codex"],
				scopes: ["workspace"],
				scopeRefs: ["ws:mdbrain"],
			},
		])
		const res = await createApp().request(
			"/v1/write-event?agentId=codex&scope=workspace&scopeRef=ws:mdbrain",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer identity-secret",
					"Content-Type": "application/json",
					"Idempotency-Key": "ws1-write-event-authorized-identity",
				},
				body: JSON.stringify({ role: "user", body: "hello" }),
			},
		)
		expect(res.status).toBe(200)
		const delivery = deliveryMocks.deliverMemoryWrite.mock.calls[0][0]
		expect(delivery).toMatchObject({
			agentId: "codex",
			scope: "workspace",
			scopeRef: "ws:mdbrain",
		})
		expect(
			bridgeMocks.mdbrainBridgeWriteConversationEvent.mock.calls[0][0],
		).toMatchObject({
			agentId: "codex",
			scope: "workspace",
			scopeRef: "ws:mdbrain",
		})
	})

	it("executes /v1/extract under the authorized agentId", async () => {
		const res = await createApp().request("/v1/extract?agentId=codex", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ eventId: "evt-ws1" }),
		})
		expect(res.status).toBe(202)
		expect(bridgeMocks.mdbrainBridgeExtractEvent).toHaveBeenCalledWith(
			expect.objectContaining({ agentId: "codex", eventId: "evt-ws1" }),
		)
	})

	it("dispatches /v1/write-structured under the entry-authorized agentId", async () => {
		const res = await createApp().request("/v1/write-structured", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				entry: { agentId: "codex", kind: "decision", key: "k" },
			}),
		})
		expect(res.status).toBe(200)
		expect(bridgeMocks.mdbrainBridgeWriteStructuredMemory).toHaveBeenCalledWith(
			expect.objectContaining({ agentId: "codex" }),
		)
	})

	it("rejects structured entries that launder a different agentId", async () => {
		bridgeMocks.mdbrainBridgeWriteStructuredMemory.mockClear()
		const res = await createApp().request("/v1/write-structured", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				agentId: "codex",
				entry: { agentId: "other-agent", kind: "decision", key: "k" },
			}),
		})
		expect(res.status).toBe(403)
		expect(
			bridgeMocks.mdbrainBridgeWriteStructuredMemory,
		).not.toHaveBeenCalled()
	})

	it("refuses the fail-open development principal without explicit opt-in", () => {
		delete process.env.MDBRAIN_ALLOW_DEV_PRINCIPAL
		expect(() => createApp()).toThrow(/MDBRAIN_ALLOW_DEV_PRINCIPAL/)
	})

	it("still refuses unauthenticated routes in production even with opt-in", () => {
		process.env.NODE_ENV = "production"
		process.env.MDBRAIN_ALLOW_DEV_PRINCIPAL = "1"
		expect(() => createApp()).toThrow(/production mode/)
	})

	it("rejects duplicate scoped-key tokens at startup", () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{ token: "dup-secret", agentIds: ["a"] },
			{ token: "dup-secret", agentIds: ["b"] },
		])
		expect(() => createApp()).toThrow(
			"MDBRAIN_API_SCOPED_KEYS must use unique tokens",
		)
	})

	it("rejects an admin token that duplicates a scoped-key token", () => {
		process.env.MDBRAIN_API_KEY = "admin-dup-secret"
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{ token: "admin-dup-secret", agentIds: ["a"] },
		])
		expect(() => createApp()).toThrow(/duplicates a scoped API key token/)
	})

	it("rejects object-form policies that override the key token", () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify({
			"real-token": { token: "injected-token", agentIds: ["a"] },
		})
		expect(() => createApp()).toThrow(
			"MDBRAIN_API_SCOPED_KEYS object-form policy must not contain a token field",
		)
	})

	it("honors exact pair grants without the Cartesian cross product", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "pair-secret",
				grants: [
					{ scope: "workspace", scopeRef: "ws:a" },
					{ scope: "user", scopeRef: "ws:b" },
				],
			},
		])
		const headers = {
			Authorization: "Bearer pair-secret",
			"Content-Type": "application/json",
		}
		const okA = await createApp().request("/v1/search", {
			method: "POST",
			headers,
			body: JSON.stringify({
				query: "q",
				scope: "workspace",
				scopeRef: "ws:a",
			}),
		})
		expect(okA.status).toBe(200)
		const cross = await createApp().request("/v1/search", {
			method: "POST",
			headers,
			body: JSON.stringify({
				query: "q",
				scope: "workspace",
				scopeRef: "ws:b",
			}),
		})
		expect(cross.status).toBe(403)
	})

	it("keeps the documented Cartesian semantics for scope arrays", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{
				token: "cartesian-secret",
				scopes: ["workspace", "user"],
				scopeRefs: ["ws:a", "ws:b"],
			},
		])
		const res = await createApp().request("/v1/search", {
			method: "POST",
			headers: {
				Authorization: "Bearer cartesian-secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "q",
				scope: "workspace",
				scopeRef: "ws:b",
			}),
		})
		// (workspace, ws:b) is granted: arrays expand to the full cross product.
		expect(res.status).toBe(200)
	})
})
