/**
 * OpenAPI 3.0 document for the Mdbrain HTTP API.
 * Keep this aligned with the supported route contract in `routes/v1.ts`.
 */
const benchmarkOfficialRetrievalMetricsSchema = {
	type: "object",
	required: [
		"recallAnyAt1",
		"recallAllAt1",
		"ndcgAnyAt1",
		"recallAnyAt3",
		"recallAllAt3",
		"ndcgAnyAt3",
		"recallAnyAt5",
		"recallAllAt5",
		"ndcgAnyAt5",
		"recallAnyAt10",
		"recallAllAt10",
		"ndcgAnyAt10",
		"recallAnyAt30",
		"recallAllAt30",
		"ndcgAnyAt30",
		"recallAnyAt50",
		"recallAllAt50",
		"ndcgAnyAt50",
	],
	properties: {
		recallAnyAt1: { type: "number" },
		recallAllAt1: { type: "number" },
		ndcgAnyAt1: { type: "number" },
		recallAnyAt3: { type: "number" },
		recallAllAt3: { type: "number" },
		ndcgAnyAt3: { type: "number" },
		recallAnyAt5: { type: "number" },
		recallAllAt5: { type: "number" },
		ndcgAnyAt5: { type: "number" },
		recallAnyAt10: { type: "number" },
		recallAllAt10: { type: "number" },
		ndcgAnyAt10: { type: "number" },
		recallAnyAt30: { type: "number" },
		recallAllAt30: { type: "number" },
		ndcgAnyAt30: { type: "number" },
		recallAnyAt50: { type: "number" },
		recallAllAt50: { type: "number" },
		ndcgAnyAt50: { type: "number" },
	},
} as const

const benchmarkOfficialMetricsSchema = {
	type: "object",
	properties: {
		longMemEval: {
			type: "object",
			required: ["retrievalCases", "abstentionCases", "session"],
			properties: {
				retrievalCases: { type: "integer" },
				abstentionCases: { type: "integer" },
				session: benchmarkOfficialRetrievalMetricsSchema,
				turn: benchmarkOfficialRetrievalMetricsSchema,
			},
		},
		loCoMo: {
			type: "object",
			required: [
				"qaCases",
				"abstentionCases",
				"sessionEvidenceRecallAt5",
				"sessionEvidenceRecallAt10",
			],
			properties: {
				qaCases: { type: "integer" },
				abstentionCases: { type: "integer" },
				sessionEvidenceRecallAt5: { type: "number" },
				sessionEvidenceRecallAt10: { type: "number" },
				dialogEvidenceRecallAt5: { type: "number" },
				dialogEvidenceRecallAt10: { type: "number" },
			},
		},
	},
} as const

const benchmarkRunReportSchema = {
	type: "object",
	required: [
		"generatedAt",
		"build",
		"corpus",
		"metrics",
		"releaseGates",
		"warnings",
		"degradations",
	],
	properties: {
		generatedAt: { type: "string", format: "date-time" },
		build: {
			type: "object",
			required: ["source"],
			properties: {
				source: { type: "string", enum: ["env", "unknown"] },
				commitSha: { type: "string" },
				buildId: { type: "string" },
				buildLabel: { type: "string" },
			},
		},
		corpus: {
			type: "object",
			required: ["datasetVersion", "cases"],
			properties: {
				datasetVersion: { type: "string" },
				datasetName: { type: "string" },
				datasetKind: {
					type: "string",
					enum: ["generic", "longmemeval", "locomo", "legacy-query"],
				},
				scenarios: { type: "integer" },
				cases: { type: "integer" },
				scoredCases: { type: "integer" },
				skippedCases: { type: "integer" },
			},
		},
		metrics: {
			type: "object",
			required: ["internal"],
			properties: {
				internal: {
					type: "object",
					required: ["hitRate", "emptyRate", "avgTopScore", "p95LatencyMs"],
					properties: {
						hitRate: { type: "number" },
						emptyRate: { type: "number" },
						avgTopScore: { type: "number" },
						p95LatencyMs: { type: "number" },
						rAt5: { type: "number" },
						rAt10: { type: "number" },
						ndcgAt10: { type: "number" },
					},
				},
				official: benchmarkOfficialMetricsSchema,
			},
		},
		releaseGates: {
			type: "array",
			items: {
				type: "object",
				required: ["gate", "status", "evidence"],
				properties: {
					gate: {
						type: "string",
						enum: [
							"official-retrieval",
							"internal-retrieval",
							"conversation-recall-regression",
							"query-governance",
						],
					},
					status: {
						type: "string",
						enum: ["passed", "warning", "not-run", "advisory-only"],
					},
					evidence: { type: "string" },
				},
			},
		},
		warnings: { type: "array", items: { type: "string" } },
		degradations: { type: "array", items: { type: "string" } },
	},
} as const

const lifecycleSourceAgentSchema = {
	type: "object",
	required: ["id", "name"],
	properties: {
		id: { type: "string" },
		name: { type: "string" },
		runId: { type: "string" },
	},
} as const

const actorRoleSchema = {
	type: "string",
	enum: ["user", "assistant", "system"],
} as const

const lifecycleStructuredHandleSchema = {
	type: "object",
	required: [
		"family",
		"id",
		"agentId",
		"scope",
		"scopeRef",
		"revision",
		"state",
		"structured",
	],
	properties: {
		family: { type: "string", enum: ["structured"] },
		id: { type: "string" },
		agentId: { type: "string" },
		scope: {
			type: "string",
			enum: ["session", "user", "agent", "workspace", "tenant", "global"],
		},
		scopeRef: { type: "string" },
		revision: { type: "integer", minimum: 1 },
		state: { type: "string", enum: ["active", "invalidated", "conflicted"] },
		validFrom: { type: "string", format: "date-time" },
		validTo: { type: "string", format: "date-time" },
		updatedAt: { type: "string", format: "date-time" },
		structured: {
			type: "object",
			required: ["type", "key"],
			properties: {
				type: { type: "string" },
				key: { type: "string" },
			},
		},
	},
} as const

const lifecycleProcedureHandleSchema = {
	type: "object",
	required: [
		"family",
		"id",
		"agentId",
		"scope",
		"scopeRef",
		"revision",
		"state",
		"procedure",
	],
	properties: {
		family: { type: "string", enum: ["procedure"] },
		id: { type: "string" },
		agentId: { type: "string" },
		scope: {
			type: "string",
			enum: ["session", "user", "agent", "workspace", "tenant", "global"],
		},
		scopeRef: { type: "string" },
		revision: { type: "integer", minimum: 1 },
		state: { type: "string", enum: ["active", "invalidated", "conflicted"] },
		validFrom: { type: "string", format: "date-time" },
		validTo: { type: "string", format: "date-time" },
		updatedAt: { type: "string", format: "date-time" },
		procedure: {
			type: "object",
			required: ["procedureId"],
			properties: {
				procedureId: { type: "string" },
			},
		},
	},
} as const

const lifecycleHandleSchema = {
	oneOf: [lifecycleStructuredHandleSchema, lifecycleProcedureHandleSchema],
} as const

const structuredLifecyclePatchSchema = {
	type: "object",
	properties: {
		value: { type: "string" },
		context: { type: "string" },
		confidence: { type: "number" },
		source: { type: "string" },
		sessionId: { type: "string" },
		tags: { type: "array", items: { type: "string" } },
		salience: { type: "string" },
		temporalScope: { type: "string" },
		provenance: { type: "object" },
		sourceEventIds: { type: "array", items: { type: "string" } },
		validTo: { type: "string", format: "date-time" },
		reviewAt: { type: "string", format: "date-time" },
		lastConfirmedAt: { type: "string", format: "date-time" },
		sourceReliability: { type: "number" },
		sourceAgent: lifecycleSourceAgentSchema,
		artifact: { type: "object" },
	},
} as const

const procedureLifecyclePatchSchema = {
	type: "object",
	properties: {
		name: { type: "string" },
		intentTags: { type: "array", items: { type: "string" } },
		triggerQueries: { type: "array", items: { type: "string" } },
		steps: { type: "array", items: { type: "string" } },
		successSignals: { type: "array", items: { type: "string" } },
		confidence: { type: "number" },
		provenance: { type: "object" },
		sourceEventIds: { type: "array", items: { type: "string" } },
		sourceAgent: lifecycleSourceAgentSchema,
	},
} as const

const lifecycleStructuredItemSchema = {
	type: "object",
	required: ["family", "handle", "data"],
	properties: {
		family: { type: "string", enum: ["structured"] },
		handle: lifecycleStructuredHandleSchema,
		data: {
			type: "object",
			required: ["type", "key", "value"],
			properties: {
				type: { type: "string" },
				key: { type: "string" },
				value: { type: "string" },
				context: { type: "string" },
				confidence: { type: "number" },
				source: { type: "string" },
				sessionId: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				salience: { type: "string" },
				temporalScope: { type: "string" },
				provenance: { type: "object" },
				sourceEventIds: { type: "array", items: { type: "string" } },
				sourceReliability: { type: "number" },
				reinforcementCount: { type: "number" },
				reviewAt: { type: "string", format: "date-time" },
				lastConfirmedAt: { type: "string", format: "date-time" },
				sourceAgent: lifecycleSourceAgentSchema,
				artifact: { type: "object" },
			},
		},
		createdAt: { type: "string", format: "date-time" },
		updatedAt: { type: "string", format: "date-time" },
	},
} as const

const lifecycleProcedureItemSchema = {
	type: "object",
	required: ["family", "handle", "data"],
	properties: {
		family: { type: "string", enum: ["procedure"] },
		handle: lifecycleProcedureHandleSchema,
		data: {
			type: "object",
			required: ["procedureId", "name", "steps"],
			properties: {
				procedureId: { type: "string" },
				name: { type: "string" },
				intentTags: { type: "array", items: { type: "string" } },
				triggerQueries: { type: "array", items: { type: "string" } },
				steps: { type: "array", items: { type: "string" } },
				successSignals: { type: "array", items: { type: "string" } },
				confidence: { type: "number" },
				provenance: { type: "object" },
				sourceEventIds: { type: "array", items: { type: "string" } },
				successCount: { type: "number" },
				failCount: { type: "number" },
				lastSuccessAt: { type: "string", format: "date-time" },
				lastFailureAt: { type: "string", format: "date-time" },
				sourceAgent: lifecycleSourceAgentSchema,
			},
		},
		createdAt: { type: "string", format: "date-time" },
		updatedAt: { type: "string", format: "date-time" },
	},
} as const

const lifecycleItemSchema = {
	oneOf: [lifecycleStructuredItemSchema, lifecycleProcedureItemSchema],
} as const

const lifecycleHistoryEntrySchema = {
	oneOf: [
		{
			allOf: [
				lifecycleStructuredItemSchema,
				{
					type: "object",
					required: ["historyKind"],
					properties: {
						historyKind: { type: "string", enum: ["revision", "current"] },
						supersededAt: { type: "string", format: "date-time" },
					},
				},
			],
		},
		{
			allOf: [
				lifecycleProcedureItemSchema,
				{
					type: "object",
					required: ["historyKind"],
					properties: {
						historyKind: { type: "string", enum: ["revision", "current"] },
						supersededAt: { type: "string", format: "date-time" },
					},
				},
			],
		},
	],
} as const

const searchDegradationSchema = {
	type: "object",
	required: ["kind", "scope", "retryAfterMs"],
	properties: {
		kind: { type: "string", enum: ["throttled"] },
		scope: {
			type: "string",
			enum: ["denied", "legacy-fallback-skipped", "vector-lane-skipped"],
		},
		retryAfterMs: { type: "number", minimum: 0 },
	},
} as const

const searchResponseSchema = {
	type: "object",
	required: ["results"],
	properties: {
		results: { type: "array", items: { type: "object" } },
		degradation: searchDegradationSchema,
	},
} as const

const throttledSchema = {
	type: "object",
	required: ["retryAfterMs"],
	properties: { retryAfterMs: { type: "number", minimum: 0 } },
} as const

// REV-07 C2: kept as a private literal; the exported `openApiSpec` (bottom of
// file) runs `withStandardResponses` over it to add the cross-cutting auth
// and middleware responses so they cannot drift out of sync with app.ts.
const openApiDocument = {
	openapi: "3.0.3",
	info: {
		title: "Mdbrain API",
		version: "2.0.0",
		description:
			"HTTP API for the Mdbrain wiki and the versioned Memongo memory gateway.",
	},
	servers: [{ url: "/", description: "Default" }],
	// Every /v1/* operation requires a bearer credential (see app.ts; the
	// auth middleware is mounted ahead of the v1 router). /health, /ready and
	// /openapi.json opt out per-operation with `security: []`.
	security: [{ bearerAuth: [] }],
	paths: {
		"/health": {
			get: {
				summary: "Health check",
				security: [],
				responses: { "200": { description: "OK" } },
			},
		},
		"/ready": {
			get: {
				summary:
					"Memongo contract and transactional wiki-store dependency readiness",
				security: [],
				responses: {
					"200": {
						description:
							'All required dependencies are ready. `wiki.search` is a per-lane capability block: `text: "ready"` (fail-closed — a broken text lane yields 503 instead), and `vector`/`autoEmbed` reporting `"ready"` or `"unavailable"` with a `detail` diagnostic. `unavailable` means the Atlas Model API key (VOYAGE_API_KEY, `al-...`) is missing or rejected: the auto-embed vector lane is not serving, text search remains available, and readiness stays 200.',
					},
					"503": {
						description:
							"Memongo is unavailable or incompatible, the wiki text-search lane is unavailable, or wiki transactions are unavailable",
					},
				},
			},
		},
		"/openapi.json": {
			get: {
				summary: "OpenAPI document",
				security: [],
				responses: { "200": { description: "OpenAPI JSON" } },
			},
		},
		"/v1/search": {
			post: {
				summary: "Search memory",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["query"],
								properties: {
									query: { type: "string" },
									limit: { type: "number" },
									agentId: { type: "string" },
									minScore: { type: "number" },
									sessionKey: {
										type: "string",
										description:
											"Optional session scope for conversational retrieval.",
									},
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
										description:
											"Optional memory isolation scope for retrieval.",
									},
									scopeRef: {
										type: "string",
										description:
											"Optional scope reference, for example a workspace path.",
									},
									containerTag: {
										type: "string",
										deprecated: true,
										description:
											"Deprecated compatibility alias for sessionKey.",
									},
									maxResults: {
										type: "number",
										deprecated: true,
										description: "Deprecated compatibility alias for limit.",
									},
									q: {
										type: "string",
										deprecated: true,
										description: "Deprecated compatibility alias for query.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description:
							"Search results; degradation marks a throttled retrieval verdict",
						content: { "application/json": { schema: searchResponseSchema } },
					},
				},
			},
		},
		"/v1/search-detailed": {
			post: {
				summary:
					"Advanced search with CRAG corrective retrieval, MMR diversity, constraint relaxation, and multi-source fusion",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["query"],
								properties: {
									query: { type: "string" },
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
										description:
											"Optional memory isolation scope for retrieval.",
									},
									scopeRef: {
										type: "string",
										description:
											"Optional scope reference, for example a workspace path.",
									},
									limit: {
										type: "number",
										description: "Maximum results to return.",
									},
									searchMode: {
										type: "string",
										enum: ["auto", "direct", "agentic"],
										description:
											"Search mode. 'auto' lets the engine classify; 'direct' skips multi-pass; 'agentic' enables full CRAG pipeline.",
									},
									sourcePreference: {
										type: "array",
										items: { type: "string" },
										description:
											"Ordered list of preferred retrieval sources (e.g. conversation, structured, kb, procedural).",
									},
									timeRange: {
										type: "object",
										properties: {
											preset: { type: "string" },
											start: {
												type: "string",
												format: "date-time",
											},
											end: {
												type: "string",
												format: "date-time",
											},
										},
										description:
											"Time range filter (preset name or explicit start/end).",
									},
									needExactEvidence: {
										type: "boolean",
										description:
											"When true, CRAG enforces stricter evidence coverage thresholds.",
									},
									maxPasses: {
										type: "number",
										description:
											"Maximum number of retrieval passes for multi-pass orchestration.",
									},
									returnPlan: {
										type: "boolean",
										description:
											"When true, include the retrieval plan in the response metadata.",
									},
									conversationScope: {
										type: "object",
										properties: {
											sessionKey: { type: "string" },
										},
										description:
											"Scope conversation retrieval to a specific session.",
									},
									structuredScope: {
										type: "object",
										description: "Scope structured memory retrieval.",
									},
									referenceScope: {
										type: "object",
										description: "Scope reference/KB retrieval.",
									},
									proceduralScope: {
										type: "object",
										description: "Scope procedural memory retrieval.",
									},
									searchConfig: {
										type: "object",
										description:
											"Named search recipe plus optional execution overrides. Top-level request fields override recipe defaults.",
										properties: {
											recipe: {
												type: "string",
												enum: [
													"fast",
													"hybrid",
													"deep",
													"temporal",
													"chain-of-thought",
												],
											},
											recallProfile: {
												type: "string",
												enum: ["latency", "balanced", "proof"],
											},
											maxResults: { type: "number" },
											searchMode: {
												type: "string",
												enum: ["auto", "direct", "agentic"],
											},
											maxPasses: { type: "number" },
											sourcePreference: {
												type: "array",
												items: { type: "string" },
											},
											timeRange: {
												type: "object",
												properties: {
													preset: { type: "string" },
													start: {
														type: "string",
														format: "date-time",
													},
													end: {
														type: "string",
														format: "date-time",
													},
												},
											},
											needExactEvidence: { type: "boolean" },
											allowConstraintRelaxation: { type: "boolean" },
											numCandidates: { type: "number" },
											fusionMethod: {
												type: "string",
												enum: ["scoreFusion", "rankFusion", "js-merge"],
											},
											hybridMode: {
												type: "string",
												enum: ["hybrid", "vector-only"],
											},
											allowHybridBackstop: { type: "boolean" },
											lexicalPrefilter: {
												type: "string",
												enum: ["disabled", "experimental"],
											},
										},
									},
									maxResults: {
										type: "number",
										deprecated: true,
										description: "Deprecated compatibility alias for limit.",
									},
									minScore: {
										type: "number",
										description: "Minimum relevance score threshold.",
									},
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Detailed search results with metadata",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										results: {
											type: "array",
											items: {
												type: "object",
												properties: {
													path: { type: "string" },
													startLine: { type: "integer" },
													endLine: { type: "integer" },
													filePath: { type: "string" },
													snippet: { type: "string" },
													score: { type: "number" },
													source: { type: "string" },
													canonicalId: { type: "string" },
													sessionId: { type: "string" },
													timestamp: {
														type: "string",
														format: "date-time",
													},
													scope: { type: "string" },
													scopeRef: { type: "string" },
													state: { type: "string" },
													provenance: { type: "object" },
													sourceEventIds: {
														type: "array",
														items: { type: "string" },
													},
													sourceReliability: { type: "number" },
													reinforcementCount: { type: "number" },
													validFrom: {
														type: "string",
														format: "date-time",
													},
													validTo: {
														type: "string",
														format: "date-time",
													},
													reviewAt: {
														type: "string",
														format: "date-time",
													},
													lastConfirmedAt: {
														type: "string",
														format: "date-time",
													},
													trust: {
														type: "object",
														properties: {
															score: { type: "number" },
															confidence: { type: "string" },
															exactness: { type: "string" },
															freshness: { type: "string" },
															contradiction: { type: "string" },
															scopeMatch: { type: "string" },
															provenance: { type: "string" },
															sourceDiversity: { type: "string" },
															factors: {
																type: "array",
																items: { type: "string" },
															},
														},
													},
												},
											},
										},
										metadata: {
											type: "object",
											properties: {
												mode: { type: "string" },
												classification: { type: "string" },
												sourceOrder: {
													type: "array",
													items: { type: "string" },
												},
												resolvedSearchConfig: {
													type: "object",
													properties: {
														recipe: { type: "string" },
														recallProfile: { type: "string" },
														maxResults: { type: "number" },
														searchMode: { type: "string" },
														maxPasses: { type: "number" },
														sourcePreference: {
															type: "array",
															items: { type: "string" },
														},
														timeRange: {
															type: "object",
															properties: {
																preset: { type: "string" },
																start: {
																	type: "string",
																	format: "date-time",
																},
																end: {
																	type: "string",
																	format: "date-time",
																},
															},
														},
														needExactEvidence: { type: "boolean" },
														allowConstraintRelaxation: { type: "boolean" },
														numCandidates: { type: "number" },
														fusionMethod: { type: "string" },
														hybridMode: { type: "string" },
														allowHybridBackstop: { type: "boolean" },
														lexicalPrefilter: { type: "string" },
													},
												},
												passes: {
													type: "array",
													items: {
														type: "object",
														properties: {
															pass: { type: "integer" },
															query: { type: "string" },
															reason: { type: "string" },
															pathsExecuted: {
																type: "array",
																items: {
																	type: "string",
																},
															},
															resultCount: {
																type: "integer",
															},
															queryRewritten: {
																type: "boolean",
															},
															reranked: {
																type: "boolean",
															},
															correctionApplied: {
																type: "string",
															},
														},
													},
												},
												queriesTried: {
													type: "array",
													items: { type: "string" },
												},
												constraintsApplied: {
													type: "array",
													items: { type: "string" },
												},
												resultsRejected: {
													type: "array",
													items: {
														type: "object",
														required: ["reason"],
														properties: {
															canonicalId: { type: "string" },
															path: { type: "string" },
															source: { type: "string" },
															reason: { type: "string" },
														},
													},
												},
												evidenceCoverage: { type: "string" },
												pathsExecuted: {
													type: "array",
													items: { type: "string" },
												},
												resultsByPath: {
													type: "object",
													additionalProperties: { type: "number" },
												},
												queryRewritten: { type: "boolean" },
												reranked: { type: "boolean" },
												noDirectEvidenceReason: { type: "string" },
												constraintRelaxations: {
													type: "array",
													items: {
														type: "object",
														properties: {
															constraint: { type: "string" },
															action: { type: "string" },
														},
													},
												},
												mmrApplied: { type: "boolean" },
												mmrLambda: { type: "number" },
												throttled: throttledSchema,
												trustSummary: {
													type: "object",
													properties: {
														topScore: { type: "number" },
														topConfidence: { type: "string" },
														averageScore: { type: "number" },
														distribution: {
															type: "object",
															additionalProperties: { type: "number" },
														},
														contradictionCount: { type: "number" },
														staleCount: { type: "number" },
														exactCount: { type: "number" },
														sourceDiversity: { type: "string" },
													},
												},
												plan: { type: "object" },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/hydrate-active-slate": {
			post: {
				summary:
					"Hydrate a tiny active-memory slate for recall-heavy turns and debugging surfaces",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									agentId: { type: "string" },
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
									},
									scopeRef: { type: "string" },
									maxItems: {
										type: "number",
										description: "Requested slate size. Clamped to 6 items.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Tiny active-memory slate",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										agentId: { type: "string" },
										scope: { type: "string" },
										scopeRef: { type: "string" },
										items: {
											type: "array",
											items: {
												type: "object",
												properties: {
													kind: { type: "string" },
													source: { type: "string" },
													title: { type: "string" },
													summary: { type: "string" },
													path: { type: "string" },
													canonicalId: { type: "string" },
													timestamp: { type: "string", format: "date-time" },
													scope: { type: "string" },
													scopeRef: { type: "string" },
												},
											},
										},
										metadata: {
											type: "object",
											properties: {
												maxItems: { type: "number" },
												truncated: { type: "boolean" },
												partial: { type: "boolean" },
												countsByKind: {
													type: "object",
													additionalProperties: { type: "number" },
												},
												sourceCounts: {
													type: "object",
													additionalProperties: { type: "number" },
												},
											},
										},
										hydratedAt: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/discovery-projection": {
			post: {
				summary:
					"Build a rebuildable discovery projection such as an entity brief, topic brief, what-changed brief, or contradiction report",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["kind"],
								properties: {
									agentId: { type: "string" },
									kind: {
										type: "string",
										enum: [
											"entity-brief",
											"topic-brief",
											"what-changed",
											"contradiction-report",
										],
									},
									query: { type: "string" },
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
									},
									scopeRef: { type: "string" },
									maxItems: { type: "number" },
									timeRange: {
										type: "object",
										properties: {
											preset: { type: "string" },
											start: { type: "string", format: "date-time" },
											end: { type: "string", format: "date-time" },
										},
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Discovery projection with provenance-backed sections",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										kind: { type: "string" },
										query: { type: "string" },
										title: { type: "string" },
										summary: { type: "string" },
										scope: { type: "string" },
										scopeRef: { type: "string" },
										sections: {
											type: "array",
											items: {
												type: "object",
												properties: {
													title: { type: "string" },
													summary: { type: "string" },
													evidence: {
														type: "array",
														items: {
															type: "object",
															properties: {
																title: { type: "string" },
																summary: { type: "string" },
																path: { type: "string" },
																source: { type: "string" },
																canonicalId: { type: "string" },
																timestamp: {
																	type: "string",
																	format: "date-time",
																},
															},
														},
													},
												},
											},
										},
										metadata: {
											type: "object",
											properties: {
												partial: { type: "boolean" },
												evidenceCount: { type: "number" },
												sourceCounts: {
													type: "object",
													additionalProperties: { type: "number" },
												},
												timeRange: {
													type: "object",
													properties: {
														label: { type: "string" },
														start: {
															type: "string",
															format: "date-time",
														},
														end: {
															type: "string",
															format: "date-time",
														},
													},
												},
											},
										},
										builtAt: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/context-bundle": {
			post: {
				summary:
					"Build a prompt-ready context bundle from active memory, durable evidence, summaries, and recent events",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									agentId: { type: "string" },
									query: { type: "string" },
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
									},
									scopeRef: { type: "string" },
									sessionId: { type: "string" },
									tokenBudget: { type: "number" },
									maxActiveItems: { type: "number" },
									maxEvidenceItems: { type: "number" },
									maxRecentEvents: { type: "number" },
									includeDiscoveryProjection: { type: "boolean" },
									discoveryKind: {
										type: "string",
										enum: [
											"entity-brief",
											"topic-brief",
											"what-changed",
											"contradiction-report",
										],
									},
									includeProfile: { type: "boolean" },
									timeRange: {
										type: "object",
										properties: {
											preset: { type: "string" },
											start: { type: "string", format: "date-time" },
											end: { type: "string", format: "date-time" },
										},
									},
									mode: {
										type: "string",
										enum: ["full", "wake-up"],
										description:
											"wake-up returns a compact session-start projection and skips query evidence",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Prompt-ready context bundle with structured sections",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										agentId: { type: "string" },
										query: { type: "string" },
										scope: { type: "string" },
										scopeRef: { type: "string" },
										sessionId: { type: "string" },
										rendered: { type: "string" },
										sections: {
											type: "array",
											items: {
												type: "object",
												properties: {
													kind: { type: "string" },
													title: { type: "string" },
													summary: { type: "string" },
													items: {
														type: "array",
														items: {
															type: "object",
															properties: {
																title: { type: "string" },
																summary: { type: "string" },
																path: { type: "string" },
																source: { type: "string" },
																canonicalId: { type: "string" },
																timestamp: {
																	type: "string",
																	format: "date-time",
																},
																scope: { type: "string" },
																scopeRef: { type: "string" },
																sourceEventIds: {
																	type: "array",
																	items: { type: "string" },
																},
															},
														},
													},
													estimatedTokens: { type: "number" },
													truncated: { type: "boolean" },
													partial: { type: "boolean" },
												},
											},
										},
										metadata: {
											type: "object",
											properties: {
												tokenBudget: { type: "number" },
												estimatedTokensUsed: { type: "number" },
												partial: { type: "boolean" },
												truncated: { type: "boolean" },
												pathsExecuted: {
													type: "array",
													items: { type: "string" },
												},
												sectionsIncluded: {
													type: "array",
													items: { type: "string" },
												},
											},
										},
										builtAt: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/principal/self": {
			get: {
				summary: "Read the calling key's own authority",
				description:
					"Returns the calling principal's subject ID, trust tier, capabilities and exact scope grants. A grant of `*` matches any scope or scopeRef. The request names no scope and needs no capability; it never returns another principal or any token.",
				responses: {
					"200": {
						description: "The calling principal's own authority",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: [
										"subjectId",
										"trustTier",
										"capabilities",
										"grants",
									],
									properties: {
										subjectId: { type: "string" },
										trustTier: {
											type: "string",
											enum: ["restricted", "standard", "admin", "development"],
										},
										capabilities: {
											type: "array",
											items: {
												type: "string",
												enum: [
													"read",
													"write",
													"write-trusted",
													"administer",
													"change-permissions",
													"hard-delete",
													"export",
													"manage-connectors",
													"propose",
												],
											},
										},
										grants: {
											type: "array",
											items: {
												type: "object",
												required: ["scope", "scopeRef"],
												properties: {
													scope: { type: "string" },
													scopeRef: { type: "string" },
												},
											},
										},
									},
								},
							},
						},
					},
					"401": {
						description: "Missing or unknown bearer key (UNAUTHORIZED)",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ApiError" },
							},
						},
					},
					"403": {
						description: "The key's identity is not active (FORBIDDEN)",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ApiError" },
							},
						},
					},
				},
			},
		},
		"/v1/state": {
			get: {
				summary: "Get the unified state family (profile, blocks, bundle)",
				parameters: [
					{
						name: "agentId",
						in: "query",
						schema: { type: "string" },
					},
					{
						name: "scope",
						in: "query",
						schema: {
							type: "string",
							enum: [
								"session",
								"user",
								"agent",
								"workspace",
								"tenant",
								"global",
							],
						},
					},
					{
						name: "scopeRef",
						in: "query",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Unified state family for the requested scope",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										profile: {
											type: "object",
											description: "Profile synthesis payload from /v1/profile",
										},
										blocks: {
											type: "object",
											properties: {
												blocks: {
													type: "array",
													items: {
														type: "object",
														properties: {
															label: { type: "string" },
															title: { type: "string" },
															content: { type: "string" },
															tokenBudget: { type: "number" },
															actualTokens: { type: "number" },
															sourcePaths: {
																type: "array",
																items: { type: "string" },
															},
														},
													},
												},
												totalTokenBudget: { type: "number" },
												totalActualTokens: { type: "number" },
											},
										},
										bundle: {
											type: "object",
											description:
												"Context bundle payload from /v1/context-bundle",
										},
										partial: { type: "boolean" },
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/recall-conversation": {
			post: {
				summary:
					"Recall prior conversation events by content, session, role, and exact time range",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									agentId: { type: "string" },
									query: {
										type: "string",
										description:
											"Semantic recall query. Omit for filter-only conversation recall.",
									},
									sessionId: {
										type: "string",
										description: "Restrict recall to one conversation session.",
									},
									roles: {
										type: "array",
										items: {
											type: "string",
											enum: ["user", "assistant", "system", "tool"],
										},
										description:
											"Filter to specific message roles. Overrides includeToolMessages when present.",
									},
									startTime: {
										type: "string",
										description:
											"Inclusive start boundary. Use ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ssZ`).",
									},
									endTime: {
										type: "string",
										description:
											"Inclusive end boundary. Use ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ssZ`).",
									},
									timezone: {
										type: "string",
										description:
											"IANA timezone used only when startTime/endTime are date-only strings.",
									},
									includeToolMessages: {
										type: "boolean",
										description: "Include `tool` role messages. Default false.",
									},
									limit: {
										type: "integer",
										minimum: 1,
										maximum: 200,
										description: "Maximum results to return.",
									},
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
										description:
											"Optional memory isolation scope for retrieval.",
									},
									scopeRef: {
										type: "string",
										description:
											"Optional scope reference, for example a workspace path.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Conversation recall results with canonical citations",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["results", "metadata"],
									properties: {
										results: {
											type: "array",
											items: {
												type: "object",
												required: ["citation", "matchType"],
												properties: {
													citation: {
														type: "object",
														required: [
															"eventId",
															"role",
															"timestamp",
															"preview",
														],
														properties: {
															eventId: { type: "string" },
															sessionId: { type: "string" },
															role: {
																type: "string",
																enum: ["user", "assistant", "system", "tool"],
															},
															timestamp: {
																type: "string",
																format: "date-time",
															},
															sourceRef: { type: "string" },
															preview: { type: "string" },
														},
													},
													score: { type: "number" },
													matchType: {
														type: "string",
														enum: ["filter", "semantic", "hybrid"],
													},
												},
											},
										},
										metadata: {
											type: "object",
											required: [
												"totalMatched",
												"filtersApplied",
												"searchMethod",
												"durationMs",
											],
											properties: {
												totalMatched: { type: "integer" },
												queryUsed: { type: "string" },
												filtersApplied: {
													type: "array",
													items: { type: "string" },
												},
												searchMethod: {
													type: "string",
													enum: ["standard", "semantic", "hybrid"],
												},
												durationMs: { type: "number" },
												throttled: throttledSchema,
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/lifecycle/get": {
			post: {
				summary: "Fetch the current lifecycle item for a stable handle",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["handle"],
								properties: {
									handle: lifecycleHandleSchema,
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Lifecycle item",
						content: {
							"application/json": {
								schema: lifecycleItemSchema,
							},
						},
					},
					"400": { description: "Validation error" },
					"404": { description: "Not found" },
					"500": { description: "Lifecycle read failed" },
				},
			},
		},
		"/v1/lifecycle/update": {
			post: {
				summary: "Update a lifecycle item using a family-aware patch",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["handle", "patch"],
								properties: {
									handle: lifecycleHandleSchema,
									patch: {
										oneOf: [
											structuredLifecyclePatchSchema,
											procedureLifecyclePatchSchema,
										],
										description:
											"Patch shape must match the stable handle family.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Updated lifecycle item",
						content: {
							"application/json": {
								schema: lifecycleItemSchema,
							},
						},
					},
					"400": { description: "Validation error" },
					"404": { description: "Not found" },
					"500": { description: "Lifecycle update failed" },
				},
			},
		},
		"/v1/lifecycle/delete": {
			post: {
				summary:
					"Delete a lifecycle item using invalidate-with-history semantics",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["handle"],
								properties: {
									handle: lifecycleHandleSchema,
									invalidatedBy: {
										type: "object",
										description:
											"Optional provenance describing why the item was invalidated.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Invalidated lifecycle item",
						content: {
							"application/json": {
								schema: lifecycleItemSchema,
							},
						},
					},
					"400": { description: "Validation error" },
					"404": { description: "Not found" },
					"500": { description: "Lifecycle invalidation failed" },
				},
			},
		},
		"/v1/lifecycle/history": {
			post: {
				summary: "List lifecycle revision history for a stable handle",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["handle"],
								properties: {
									handle: lifecycleHandleSchema,
									limit: {
										type: "integer",
										minimum: 1,
										maximum: 200,
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Ordered lifecycle history",
						content: {
							"application/json": {
								schema: {
									type: "array",
									items: lifecycleHistoryEntrySchema,
								},
							},
						},
					},
					"400": { description: "Validation error" },
					"404": { description: "Not found" },
					"500": { description: "Lifecycle history failed" },
				},
			},
		},
		"/v1/procedures/outcome": {
			post: {
				summary:
					"Record a success or failure outcome on a procedure using its stable handle",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["handle", "success"],
								properties: {
									handle: lifecycleProcedureHandleSchema,
									success: { type: "boolean" },
									note: { type: "string" },
									actorRole: actorRoleSchema,
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Updated procedure lifecycle item",
						content: {
							"application/json": {
								schema: lifecycleProcedureItemSchema,
							},
						},
					},
					"400": { description: "Validation error" },
					"404": { description: "Not found" },
					"500": { description: "Procedure outcome reporting failed" },
				},
			},
		},
		"/v1/memory/feedback": {
			post: {
				summary:
					"Apply structured memory feedback using stable handles without bypassing revision history",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								oneOf: [
									{
										type: "object",
										required: ["handle", "signal"],
										properties: {
											handle: lifecycleStructuredHandleSchema,
											signal: { type: "string", enum: ["confirm"] },
											note: { type: "string" },
											actorRole: actorRoleSchema,
										},
									},
									{
										type: "object",
										required: ["handle", "signal", "patch"],
										properties: {
											handle: lifecycleStructuredHandleSchema,
											signal: { type: "string", enum: ["correct"] },
											patch: structuredLifecyclePatchSchema,
											note: { type: "string" },
											actorRole: actorRoleSchema,
										},
									},
									{
										type: "object",
										required: ["handle", "signal"],
										properties: {
											handle: lifecycleStructuredHandleSchema,
											signal: { type: "string", enum: ["irrelevant"] },
											invalidatedBy: {
												type: "object",
												description:
													"Optional provenance describing why the memory was marked irrelevant.",
											},
											note: { type: "string" },
											actorRole: actorRoleSchema,
										},
									},
								],
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Updated structured lifecycle item",
						content: {
							"application/json": {
								schema: lifecycleStructuredItemSchema,
							},
						},
					},
					"400": { description: "Validation error" },
					"404": { description: "Not found" },
					"500": { description: "Memory feedback failed" },
				},
			},
		},
		"/v1/search-kb": {
			post: {
				summary: "Search imported knowledge base documents",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["query"],
								properties: {
									query: { type: "string" },
									agentId: { type: "string" },
									limit: { type: "number" },
									minScore: { type: "number" },
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
										description:
											"Optional memory isolation scope for retrieval.",
									},
									scopeRef: {
										type: "string",
										description:
											"Optional scope reference, for example a workspace path.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": {
						description:
							"KB results; degradation marks skipped retrieval lanes",
						content: { "application/json": { schema: searchResponseSchema } },
					},
				},
			},
		},
		"/v1/add": {
			post: {
				summary: "Append a user message to conversational memory",
				parameters: [
					{
						in: "header",
						name: "Idempotency-Key",
						required: true,
						schema: { type: "string", minLength: 1 },
					},
					{
						in: "header",
						name: "X-Request-ID",
						schema: { type: "string", minLength: 1 },
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["content"],
								properties: {
									content: { type: "string" },
									agentId: { type: "string" },
									sessionId: {
										type: "string",
										description:
											"Optional session identifier for this memory write.",
									},
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
									},
									scopeRef: { type: "string" },
									promotionPolicy: {
										type: "string",
										enum: ["none", "wiki"],
										description:
											"Explicitly request receipt-gated wiki promotion. A key with the `propose` capability and without `write` may append memory events and propose new pages only; its promotion always waits for an administrator's approval, whatever the payload says.",
									},
									wikiPromotion: {
										type: "object",
										description:
											"Required with promotionPolicy=wiki. Contains a stable wiki page with at least one claim.",
									},
									containerTag: {
										type: "string",
										deprecated: true,
										description:
											"Deprecated compatibility alias for sessionId.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Event id" },
					"409": {
						description:
							"Idempotency, dispatch lease, or active erasure conflict",
					},
					"422": { description: "Upstream idempotency key payload conflict" },
					"503": { description: "Delivery pending reconciliation" },
				},
			},
		},
		"/v1/write-event": {
			post: {
				summary: "Write conversation event (any role)",
				parameters: [
					{
						in: "header",
						name: "Idempotency-Key",
						required: true,
						schema: { type: "string", minLength: 1 },
					},
					{
						in: "header",
						name: "X-Request-ID",
						schema: { type: "string", minLength: 1 },
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["role", "body"],
								properties: {
									role: {
										type: "string",
										enum: ["user", "assistant", "system", "tool"],
									},
									body: { type: "string", minLength: 1 },
									agentId: { type: "string" },
									sessionId: { type: "string" },
									timestamp: { type: "string", format: "date-time" },
									metadata: { type: "object" },
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
									},
									scopeRef: { type: "string" },
									promotionPolicy: {
										type: "string",
										enum: ["none", "wiki"],
										description:
											"Explicitly request receipt-gated wiki promotion.",
									},
									wikiPromotion: {
										type: "object",
										description:
											"Required with promotionPolicy=wiki. Contains a stable wiki page with at least one claim.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Event id" },
					"409": {
						description:
							"Idempotency, dispatch lease, or active erasure conflict",
					},
					"422": { description: "Upstream idempotency key payload conflict" },
					"503": { description: "Delivery pending reconciliation" },
				},
			},
		},
		"/v1/extract": {
			post: {
				summary: "Schedule background extraction for one canonical event",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["eventId"],
								properties: {
									eventId: { type: "string", minLength: 1 },
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: { "202": { description: "Extraction scheduled" } },
			},
		},
		"/v1/write-structured": {
			post: {
				summary: "Structured memory write",
				responses: { "200": { description: "Upsert result" } },
			},
		},
		"/v1/write-procedure": {
			post: {
				summary: "Upsert procedure",
				responses: { "200": { description: "Upsert result" } },
			},
		},
		"/v1/profile": {
			post: {
				summary: "Synthesize a profile for a scope",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
										description:
											"Optional scope for profile synthesis. Defaults to agent.",
									},
									scopeRef: {
										type: "string",
										description:
											"Optional scope reference for profile synthesis.",
									},
									containerTag: {
										type: "string",
										deprecated: true,
										description: "Deprecated compatibility alias for scopeRef.",
									},
									agentId: { type: "string" },
									maxEntities: { type: "number" },
									maxEpisodes: { type: "number" },
									maxPerType: { type: "number" },
									activityWindowMs: { type: "number" },
								},
							},
						},
					},
				},
				responses: { "200": { description: "Profile" } },
			},
		},
		"/v1/admin/deliveries": {
			get: {
				summary: "List durable memory delivery state without stored payloads",
				parameters: [
					{
						in: "query",
						name: "state",
						schema: {
							type: "string",
							enum: [
								"recorded",
								"delivering",
								"retryable",
								"outcome-unknown",
								"confirmed",
								"promotion-pending",
								"promoted",
								"dead-letter",
								"conflict",
							],
						},
					},
					{ in: "query", name: "scope", schema: { type: "string" } },
					{ in: "query", name: "scopeRef", schema: { type: "string" } },
					{
						in: "query",
						name: "limit",
						schema: { type: "integer", minimum: 1, maximum: 100 },
					},
				],
				responses: {
					"200": { description: "Redacted memory delivery intents" },
					"400": { description: "Invalid delivery filter" },
				},
			},
		},
		"/v1/admin/deliveries/{operationId}/redrive": {
			post: {
				summary:
					"Requeue a dead-lettered memory delivery intent for a fresh delivery lifecycle",
				parameters: [
					{
						in: "path",
						name: "operationId",
						required: true,
						schema: { type: "string" },
						description: "Durable memory delivery operation identifier",
					},
				],
				responses: {
					"200": { description: "Delivery requeued with counters reset" },
					"400": { description: "Missing operationId path parameter" },
					"404": { description: "No delivery intent found for operationId" },
					"409": { description: "Delivery is not in the dead-letter state" },
					"500": { description: "Redrive failed" },
				},
			},
		},
		"/v1/admin/wiki-promotions": {
			get: {
				summary: "List the wiki proposals waiting for a decision",
				description:
					"The review queue. Each entry shows the page a proposal would create (slug, title, kind, summary, body, claims) and who proposed it. Requires the administer capability. A proposal-only key (capability `propose`, without `write`) cannot call it. Pending proposals are not wiki pages: they appear in no wiki read until approved.",
				parameters: [
					{ in: "query", name: "scope", schema: { type: "string" } },
					{ in: "query", name: "scopeRef", schema: { type: "string" } },
					{
						in: "query",
						name: "limit",
						schema: { type: "integer", minimum: 1, maximum: 100 },
					},
				],
				responses: {
					"200": { description: "Pending proposals, oldest first" },
					"400": { description: "Invalid limit or scope" },
					"403": { description: "The key lacks the administer capability" },
					"500": { description: "Unable to list pending proposals" },
				},
			},
		},
		"/v1/admin/wiki-promotions/{operationId}/approve": {
			post: {
				summary: "Approve a pending wiki proposal and promote its page",
				description:
					"Approving twice returns the same result. The proposer is checked again at approval, against the permission it proposed under: a proposal from a key that was removed, or that lost its capability, is refused with PROPOSER_REVOKED. Approval needs the administer capability and never the proposer's direct write permission. A rejected proposal answers PROPOSAL_REJECTED.",
				parameters: [
					{
						in: "path",
						name: "operationId",
						required: true,
						schema: { type: "string" },
						description: "Durable memory delivery operation identifier",
					},
				],
				responses: {
					"200": { description: "Promotion approved and page promoted" },
					"400": { description: "Missing operationId path parameter" },
					"403": { description: "The key lacks the administer capability" },
					"404": { description: "No promotion found for operationId" },
					"409": {
						description:
							"Not pending approval (INVALID_DELIVERY_STATE), rejected (PROPOSAL_REJECTED), the stored proposal differs from what was submitted (PROPOSAL_ALTERED), the proposer is revoked (PROPOSER_REVOKED), or the promotion failed",
					},
					"500": { description: "Approval failed" },
				},
			},
		},
		"/v1/admin/wiki-promotions/{operationId}/reject": {
			post: {
				summary: "Reject a pending wiki proposal",
				description:
					"Rejection is final: a later approve, redrive, replay of the write or reconciler pass never promotes the proposal, and the page never appears in a wiki read. Rejecting a rejected proposal returns the same result. Approve and reject racing on one proposal leave exactly one winner. Requires the administer capability.",
				parameters: [
					{
						in: "path",
						name: "operationId",
						required: true,
						schema: { type: "string" },
						description: "Durable memory delivery operation identifier",
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									reason: {
										type: "string",
										maxLength: 500,
										description:
											"Why the proposal was rejected. Optional; recorded on the rejected delivery.",
									},
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Proposal rejected (state: rejected)" },
					"400": { description: "Missing operationId or invalid reason" },
					"403": { description: "The key lacks the administer capability" },
					"404": { description: "No proposal found for operationId" },
					"409": {
						description:
							"The proposal was already promoted or is not pending approval",
					},
					"500": { description: "Rejection failed" },
				},
			},
		},
		"/v1/wiki": {
			post: {
				summary: "Create a wiki page",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								// REV-07 C5/C6 parity fix: matches the runtime contract
								// (routes/v1.ts POST /wiki) — summary, body, trustTier and
								// frontmatter.type are required at runtime, and
								// kind/scope/trustTier are enum-validated there.
								required: [
									"kind",
									"title",
									"slug",
									"summary",
									"body",
									"scope",
									"scopeRef",
									"trustTier",
									"frontmatter",
								],
								properties: {
									kind: {
										type: "string",
										enum: [
											"entity",
											"concept",
											"synthesis",
											"source",
											"report",
											"procedure",
										],
									},
									title: { type: "string" },
									slug: {
										type: "string",
										description:
											"OKF concept ID; may contain slashes (e.g. tables/users). Must not start with a reserved segment (lint, revisions, overview, changes): those first segments belong to GET /v1/wiki/lint, GET /v1/wiki/revisions, GET /v1/wiki/overview/{slug} and GET /v1/wiki/changes. Create refuses them. A page stored earlier under an overview/ slug is not touched: PATCH and DELETE still reach it, and GET reaches it by percent-encoding the slash (/v1/wiki/overview%2Fname); the raw-slash GET /v1/wiki/overview/name is the overview of the page named name.",
									},
									summary: { type: "string" },
									body: { type: "string" },
									frontmatter: {
										type: "object",
										required: ["type"],
										properties: { type: { type: "string" } },
									},
									scope: {
										type: "string",
										enum: [
											"session",
											"user",
											"agent",
											"workspace",
											"tenant",
											"global",
										],
									},
									scopeRef: { type: "string" },
									trustTier: {
										type: "string",
										enum: ["restricted", "standard", "admin"],
									},
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"201": { description: "Wiki page created" },
					"409": { description: "Duplicate slug" },
					"400": { description: "Validation error" },
				},
			},
			get: {
				summary: "List wiki pages",
				parameters: [
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{ name: "kind", in: "query", schema: { type: "string" } },
					{ name: "state", in: "query", schema: { type: "string" } },
					{
						name: "trustTier",
						in: "query",
						schema: {
							type: "string",
							enum: ["restricted", "standard", "admin"],
						},
					},
					{
						name: "skip",
						in: "query",
						schema: { type: "integer", minimum: 0 },
					},
					{ name: "limit", in: "query", schema: { type: "integer" } },
					{ name: "agentId", in: "query", schema: { type: "string" } },
				],
				responses: { "200": { description: "Wiki page list" } },
			},
		},
		"/v1/wiki/{slug}": {
			get: {
				summary: "Get a wiki page by slug",
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "format",
						in: "query",
						schema: {
							type: "string",
							enum: ["json", "markdown", "html"],
						},
					},
					{
						name: "transclude",
						in: "query",
						schema: { type: "boolean" },
						description:
							"Include inline dependents in the response (parity with the SDK and MCP surfaces).",
					},
					{ name: "agentId", in: "query", schema: { type: "string" } },
				],
				responses: {
					"200": { description: "Wiki page" },
					"400": { description: "Validation error" },
					"404": { description: "Wiki page not found" },
				},
			},
			patch: {
				summary: "Update a wiki page by slug (bumps revision)",
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["scope", "scopeRef"],
								properties: {
									kind: { type: "string" },
									title: { type: "string" },
									summary: { type: "string" },
									body: { type: "string" },
									frontmatter: { type: "object" },
									scope: { type: "string" },
									scopeRef: { type: "string" },
									trustTier: {
										type: "string",
										enum: ["restricted", "standard", "admin"],
									},
									permissions: { type: "object" },
									expectedRevision: {
										type: "integer",
										description:
											"Optional compare-and-swap precondition: apply the patch only if the page is still at this revision. Mismatch returns 409 REVISION_CONFLICT instead of a last-writer-wins overwrite.",
									},
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Wiki page updated" },
					"400": { description: "Validation error" },
					"404": { description: "Wiki page not found" },
					"409": {
						description:
							"Revision conflict (expectedRevision mismatch) or duplicate slug",
					},
				},
			},
			delete: {
				summary:
					"Delete (soft by default; hard=true for permanent) a wiki page by slug",
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{ name: "hard", in: "query", schema: { type: "boolean" } },
					{ name: "agentId", in: "query", schema: { type: "string" } },
				],
				responses: {
					"200": { description: "Wiki page deleted" },
					"404": { description: "Wiki page not found" },
				},
			},
		},
		"/v1/wiki/revisions": {
			get: {
				summary: "List governed revision history for a wiki page",
				parameters: [
					{
						name: "slug",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{ name: "limit", in: "query", schema: { type: "integer" } },
				],
				responses: {
					"200": { description: "Wiki page revisions" },
					"404": { description: "Wiki page not found" },
				},
			},
		},
		"/v1/wiki/revisions/{revision}": {
			get: {
				summary: "Get one governed wiki page revision",
				parameters: [
					{
						name: "revision",
						in: "path",
						required: true,
						schema: { type: "integer", minimum: 1 },
					},
					{
						name: "slug",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "Wiki page revision" },
					"404": { description: "Wiki page or revision not found" },
				},
			},
		},
		"/v1/wiki/overview/{slug}": {
			get: {
				summary:
					"Get a wiki page with its claims, open contradictions, backlinks, neighbors and recent revisions in one response",
				description:
					"One governed read of an entity. The response carries `page` (with its claims and their markers; its stored `backlinks` and `contradictions` are replaced by the governed sections below, and its `relationships` and `transcludes` list only pages the caller may read), `contradictions` (unresolved only, each with the claims it names and the page that holds each), `backlinks` (pages that link here, with the link kinds and, where one exists, the citing claim or body line), `neighbors` (pages this page links to, with their top claims by confidence), `revisions` (recent revision summaries, newest first) and `limits` (the bounds that applied). Every section is `{ items, hasMore }`. Scope and governance come from the request: a neighbor, backlink, contradiction counterpart or revision the caller may not read is left out before its content, existence or any count is computed, so `hasMore` reflects only what the caller can see and no total is returned. A contradiction is omitted whole when any claim it names cannot be shown to the caller. A missing page and a page the caller may not read answer the same 404. Each bound has a default and a maximum; a value above the maximum is clamped and `limits` reports the value used, a non-integer or a value below 1 is a 400. Reserved first slug segments: lint, revisions, overview, changes. A page cannot be created under them, because GET /v1/wiki/lint, GET /v1/wiki/revisions, GET /v1/wiki/changes and this route answer first. A page stored earlier under an `overview/` slug is not touched: PATCH and DELETE still reach it, and GET reaches it by percent-encoding the slash (/v1/wiki/overview%2Fname). The bare path /v1/wiki/overview names no page to summarize and reads the page called overview.",
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description:
							"Slug of the page. It may contain slashes, raw (/v1/wiki/overview/accounts/halvorsen) or percent-encoded.",
						schema: { type: "string" },
					},
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{ name: "agentId", in: "query", schema: { type: "string" } },
					{
						name: "maxBacklinks",
						in: "query",
						description: "Backlinks returned.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 100,
							default: 20,
						},
					},
					{
						name: "maxNeighbors",
						in: "query",
						description: "Neighbors returned.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 50,
							default: 10,
						},
					},
					{
						name: "maxNeighborClaims",
						in: "query",
						description: "Top claims returned per neighbor.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 10,
							default: 3,
						},
					},
					{
						name: "maxRevisions",
						in: "query",
						description: "Recent revisions returned.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 20,
							default: 5,
						},
					},
					{
						name: "maxContradictions",
						in: "query",
						description: "Open contradictions returned.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 100,
							default: 20,
						},
					},
				],
				responses: {
					"200": {
						description:
							"The overview: page, contradictions, backlinks, neighbors, revisions and the limits that applied",
					},
					"400": {
						description:
							"A missing scope or scopeRef, or a bound that is not a positive integer (VALIDATION_ERROR)",
					},
					"403": {
						description: "The key has no grant for the requested scope",
					},
					"404": {
						description:
							"WIKI_NOT_FOUND: the page does not exist in the scope, or the caller may not read it",
					},
					"500": { description: "Wiki overview failed (WIKI_OVERVIEW_FAILED)" },
				},
			},
		},
		"/v1/wiki/changes": {
			get: {
				summary:
					"List what changed across pages in a time window, oldest first, with the claims each revision added, changed and removed",
				description:
					"The what-changed-since feed. It returns revisions across all pages in the request's scope whose `createdAt` falls in the window `[since, until)` (`since` inclusive, `until` exclusive), ordered by `createdAt`, then page slug, then revision. Each entry carries `pageSlug`, `title`, `revision`, `editKind` (`create`, `update` or `delete`), `createdAt`, `editor`, `baseline` and `claims`. A created page is an entry with every claim in `added`; a deleted page is an entry with every claim in `removed`; both have `baseline: none`. An update is compared with the previous revision (`baseline: previous`, `baselineRevision` is its number): `added` and `removed` list claims by id, `changed` lists a claim whose text, status, confidence, evidence, derivation, supersession or `validTo` changed, with the changed `fields` and the claim `before` and `after`. `counts` are the full counts and `truncated` is true when `maxClaims` cut a list. Claims carry citation markers at the revision they were read from: `added` and `after` at the entry's revision, `removed` and `before` at `baselineRevision` (a deleted page's claims at the deleting revision), so each marker passes to GET /v1/cite. `since` is required on the first request. `until` is optional: when omitted the server fixes it at the first page to 15 seconds before its own clock, and the cursor carries it, so a long read never drifts. The default window ends 15 seconds ago because a revision's `createdAt` is stamped before its transaction commits, which takes several round trips to the database; a revision stamped just before `until` could otherwise commit after a reader had moved past it and never be returned. A transaction that takes longer than that can still be missed; the database's default one-minute transaction limit is the only hard bound on how late a revision can commit. An explicit `until` is honored, and `window.settled` is false while it is within 15 seconds of now. Paging: when `hasMore` is true, pass `nextCursor` back unchanged to read the next page; it is opaque, carries the window and the position after the last entry returned, and is refused with a 400 if `since` or `until` is given and differs from it. No total is returned. `limit` has a default and a maximum (a value above the maximum is clamped and `limits` reports the value used; a non-integer or a value below 1 is a 400). Scope and governance come from the request: a revision the caller may not read is left out before its content, existence or any count is computed, and it takes no part in paging, so `hasMore` and `nextCursor` reflect only what the caller can read. A diff is shown only against a previous revision the caller may also read; otherwise the entry has `baseline: unavailable`, `baselineRevision: null` and `claims: null`, the same answer whether that revision is hidden or missing. A call that has to look through more than 1000 revisions to find any the caller may read fails with WIKI_CHANGES_FAILED. Reserved first slug segments: lint, revisions, overview, changes. A page cannot be created under them, because GET /v1/wiki/lint, GET /v1/wiki/revisions, GET /v1/wiki/overview/{slug} and this route answer first. A page stored earlier under a `changes/` slug is not touched: GET, PATCH and DELETE still reach it. A page stored as exactly `changes` is reached by PATCH and DELETE; GET /v1/wiki/changes answers the feed.",
				parameters: [
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{ name: "agentId", in: "query", schema: { type: "string" } },
					{
						name: "since",
						in: "query",
						description:
							"Start of the window, inclusive: an ISO 8601 instant with a zone (2026-10-01T10:00:00Z). Required unless `cursor` is given. Encode a `+` offset as %2B.",
						schema: { type: "string", format: "date-time" },
					},
					{
						name: "until",
						in: "query",
						description:
							"End of the window, exclusive: an ISO 8601 instant with a zone. Defaults to 15 seconds before the server's clock at the first page and is then fixed by the cursor.",
						schema: { type: "string", format: "date-time" },
					},
					{
						name: "cursor",
						in: "query",
						description:
							"The `nextCursor` of the previous page, unchanged. It fixes the window.",
						schema: { type: "string" },
					},
					{
						name: "limit",
						in: "query",
						description: "Revisions returned per page.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 100,
							default: 25,
						},
					},
					{
						name: "maxClaims",
						in: "query",
						description:
							"Claims listed per bucket (added, changed, removed) per entry.",
						schema: {
							type: "integer",
							minimum: 1,
							maximum: 50,
							default: 10,
						},
					},
				],
				responses: {
					"200": {
						description:
							"One page of the feed: window (since, until, settled), limits, changes, hasMore and, when hasMore, nextCursor",
					},
					"400": {
						description:
							"A missing scope or scopeRef, a missing since without a cursor, a since later than until, an instant or bound that is malformed, or a cursor that is invalid or does not match since or until (VALIDATION_ERROR)",
					},
					"403": {
						description: "The key has no grant for the requested scope",
					},
					"500": { description: "Wiki changes failed (WIKI_CHANGES_FAILED)" },
				},
			},
		},
		"/v1/cite": {
			get: {
				summary: "Resolve a citation marker to the claim or event it names",
				description:
					"Markers are `[[wiki:SLUG#CLAIM_ID@rREVISION]]` and `[[event:EVENT_ID]]`, with reserved characters percent-encoded. Wiki claims and their event evidence carry their markers (`marker`) in wiki responses. Scope and agent come from the request, never from the marker. A wiki marker resolves to the claim text and evidence as stored at that exact revision under that revision's own governance; it never falls back to newer content, and a missing, hidden or claim-less revision gets the same 404 CITATION_NOT_FOUND with no content. An event marker resolves through Memongo's governed get-event-by-id read under the request's agentId, scope and scopeRef, and only while the event is unexpired; the response carries the event's text and business timestamp. An event that is missing, expired, or held by another agent, scope or scopeRef gets CITATION_UNRESOLVED with no content. `citedBy` (a wiki marker) is optional: when given, the citing claim must be readable at that revision (otherwise CITATION_NOT_FOUND) and must carry `evidence` with `kind: event` and `sourceId` equal to the event id (otherwise CITATION_UNRESOLVED), both decided before the event is read, and the response names it in `citedBy`.",
				parameters: [
					{
						name: "marker",
						in: "query",
						required: true,
						schema: { type: "string", maxLength: 2048 },
					},
					{
						name: "citedBy",
						in: "query",
						description:
							"Optional for an event marker: the wiki marker of a claim that cites the event. When given, that claim must be readable and cite the event.",
						schema: { type: "string", maxLength: 2048 },
					},
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{ name: "agentId", in: "query", schema: { type: "string" } },
				],
				responses: {
					"200": {
						description:
							"Resolved claim (page, claim with evidence as stored at the revision) or resolved event (text, timestamp, scope)",
					},
					"400": {
						description:
							"Malformed marker or citedBy (INVALID_MARKER), or a missing scope or scopeRef (VALIDATION_ERROR)",
					},
					"403": {
						description: "The key has no grant for the requested scope",
					},
					"404": {
						description:
							"CITATION_NOT_FOUND (revision or claim missing, hidden, or the given citing claim of an event marker is not found) or CITATION_UNRESOLVED (the event is not in the request's scope, or the given citing claim does not cite it). Neither carries content.",
					},
					"500": {
						description:
							"Citation resolution failed (CITATION_FAILED), or the event read failed with a non-Memongo error (CITATION_LOOKUP_FAILED)",
					},
					"502": {
						description:
							"The event read failed upstream; the Memongo failure code passes through. The event is not confirmed: retry rather than treating it as unresolved",
					},
					"503": {
						description:
							"Memongo was unavailable; the event is not confirmed, retry rather than treating it as unresolved",
					},
				},
			},
		},
		"/v1/wiki/okf-import": {
			post: {
				summary: "Import an OKF bundle into wiki pages",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: [
									"bundleDir",
									"scope",
									"scopeRef",
									"trustTier",
									"okfBundleId",
								],
								properties: {
									bundleDir: { type: "string" },
									scope: { type: "string" },
									scopeRef: { type: "string" },
									trustTier: {
										type: "string",
										enum: ["restricted", "standard", "admin"],
									},
									okfBundleId: { type: "string" },
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "OKF import result" },
					"400": { description: "Validation error" },
					"500": { description: "OKF import failed" },
				},
			},
		},
		"/v1/wiki/okf-export": {
			post: {
				summary: "Export wiki pages to an OKF bundle",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["scope", "scopeRef", "outDir"],
								properties: {
									scope: { type: "string" },
									scopeRef: { type: "string" },
									outDir: { type: "string" },
									okfBundleId: { type: "string" },
									trustTier: {
										type: "string",
										enum: ["restricted", "standard", "admin"],
									},
									returnContent: { type: "boolean" },
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "OKF export result" },
					"400": { description: "Validation error" },
					"500": { description: "OKF export failed" },
				},
			},
		},
		"/v1/wiki/search": {
			post: {
				summary: "Hybrid wiki search (vector + text + rank fusion)",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								// REV-07 C11 parity fix: scope and scopeRef are required at
								// runtime (routes/v1.ts POST /wiki/search rejects empty).
								required: ["query", "scope", "scopeRef"],
								properties: {
									query: { type: "string" },
									scope: { type: "string" },
									scopeRef: { type: "string" },
									kind: { type: "string" },
									trustTier: { type: "string" },
									state: { type: "string" },
									privacyTier: { type: "string" },
									recipe: {
										type: "string",
										enum: ["fast", "hybrid", "deep", "text"],
										description:
											"fast is vector-only, hybrid and deep fuse vector and text, text uses only the text index and works while the vector lane is unavailable",
									},
									maxResults: { type: "integer" },
									minScore: { type: "number" },
									agentId: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Wiki search results" },
					"500": { description: "Wiki search failed" },
					"503": {
						description:
							"Search subsystem unavailable (mongot or search index outage) — retry, do not treat as no-matches",
					},
				},
			},
		},
		"/v1/wiki/lint": {
			get: {
				summary:
					"List wiki pages and unresolved contradictions for lint review",
				parameters: [
					{
						name: "scope",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					{
						name: "scopeRef",
						in: "query",
						required: true,
						schema: { type: "string" },
					},
					// REV-07 placebo-parameter fix: the route now honors kind and
					// limit (clamped 1..100), matching the SDK and MCP surfaces.
					{ name: "kind", in: "query", schema: { type: "string" } },
					{
						name: "limit",
						in: "query",
						schema: { type: "integer", minimum: 1, maximum: 100 },
					},
					{ name: "agentId", in: "query", schema: { type: "string" } },
				],
				responses: {
					"200": { description: "Wiki lint report" },
					"400": { description: "Validation error" },
					"500": { description: "Wiki lint failed" },
				},
			},
		},
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description:
					"MDBRAIN_API_KEY (or a scoped key from MDBRAIN_API_SCOPED_KEYS) sent as an Authorization: Bearer token.",
			},
		},
		schemas: {
			ApiError: {
				type: "object",
				required: ["error"],
				properties: {
					error: {
						type: "object",
						required: ["code", "message"],
						properties: {
							code: { type: "string" },
							message: { type: "string" },
							retryable: { type: "boolean" },
							outcome: { type: "string" },
							retryAfterMs: { type: "number" },
						},
					},
				},
			},
		},
	},
} as const

type OpenApiResponses = Record<
	string,
	{
		description?: string
		headers?: Record<string, unknown>
		content?: Record<string, { schema?: { $ref?: string } }>
	}
>

type OpenApiOperation = {
	requestBody?: unknown
	responses?: OpenApiResponses
	[key: string]: unknown
}

type OpenApiPathItem = Record<string, OpenApiOperation | unknown>

type OpenApiDocument = {
	paths: Record<string, OpenApiPathItem>
	[key: string]: unknown
}

const HTTP_METHODS = [
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"head",
	"options",
] as const

// REV-07 C3/C12: every /v1/* operation can actually emit these two responses
// (app.ts mounts the content-type guard and the rate limiter on /v1/*), so
// every /v1/* operation must document them. Merging them here, once, keeps
// the per-operation literals readable and drift-free.
const RATE_LIMITED_RESPONSE = {
	description:
		"Rate limited (RATE_LIMITED). Honor Retry-After before retrying; safe to retry the same request afterwards.",
	headers: {
		"Retry-After": {
			description:
				"Seconds (or HTTP-date) until the next allowed request; set on every 429.",
			schema: { type: "string" },
		},
	},
	content: {
		"application/json": {
			schema: { $ref: "#/components/schemas/ApiError" },
		},
	},
} as const

const UNSUPPORTED_MEDIA_TYPE_RESPONSE = {
	description:
		"Unsupported media type (UNSUPPORTED_MEDIA_TYPE). Requests with a body must send Content-Type: application/json.",
	content: {
		"application/json": {
			schema: { $ref: "#/components/schemas/ApiError" },
		},
	},
} as const

function operationOf(
	item: OpenApiPathItem,
	method: string,
): OpenApiOperation | undefined {
	const op = item[method]
	return op !== null && typeof op === "object" && "responses" in op
		? (op as OpenApiOperation)
		: undefined
}

/**
 * Deep-copies the base document and stamps the cross-cutting middleware
 * responses onto every /v1/* operation: 429 RATE_LIMITED (rate limiter is
 * mounted on all of /v1) and 415 UNSUPPORTED_MEDIA_TYPE (content-type guard
 * covers non-GET/HEAD requests that carry a body). Each references the
 * shared ApiError envelope schema instead of a bare description.
 */
function withStandardResponses(doc: OpenApiDocument): OpenApiDocument {
	const out = JSON.parse(JSON.stringify(doc)) as OpenApiDocument
	for (const [path, item] of Object.entries(out.paths)) {
		if (item === null || typeof item !== "object") continue
		for (const method of HTTP_METHODS) {
			const op = operationOf(item as OpenApiPathItem, method)
			if (!op) continue
			const responses: OpenApiResponses = op.responses ?? {}
			op.responses = responses
			if (!responses["429"] && path.startsWith("/v1/")) {
				responses["429"] = RATE_LIMITED_RESPONSE
			}
			if (
				!responses["415"] &&
				path.startsWith("/v1/") &&
				method !== "get" &&
				method !== "head" &&
				op.requestBody !== undefined
			) {
				responses["415"] = UNSUPPORTED_MEDIA_TYPE_RESPONSE
			}
		}
	}
	return out
}

export const openApiSpec: OpenApiDocument = withStandardResponses(
	openApiDocument as unknown as OpenApiDocument,
)
