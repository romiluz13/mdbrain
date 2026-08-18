import { describe, expect, it, vi } from "vitest"
import { MemongoHttpClient } from "./memongo-http-client.js"
import { MemongoMemoryGateway } from "./memongo-memory-gateway.js"

const openApiBody = JSON.stringify({
	openapi: "3.0.3",
	info: { title: "Memongo API", version: "2.0.1" },
	paths: {},
})

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

describe("MemongoMemoryGateway", () => {
	it("retrieves scoped search results through the domain interface", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				response({
					results: [
						{
							path: "memory/item",
							startLine: 1,
							endLine: 2,
							score: 0.9,
							snippet: "contract result",
							source: "structured",
							scope: "workspace",
							scopeRef: "workspace-1",
						},
					],
				}),
			)
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "YOUR_TENANT_API_KEY_HERE",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		const result = await gateway.retrieve(
			{ kind: "search", query: "contract", limit: 5 },
			{
				agentId: "agent-1",
				scope: "workspace",
				scopeRef: "workspace-1",
				requestId: "request-1",
			},
		)

		expect(result).toEqual({
			state: "complete",
			omissions: [],
			results: [
				expect.objectContaining({
					path: "memory/item",
					snippet: "contract result",
					scopeRef: "workspace-1",
				}),
			],
		})
		const request = fetchImpl.mock.calls[1]
		expect(String(request[0])).toBe("https://memongo.example.test/v1/search")
		expect(JSON.parse(String(request[1]?.body))).toEqual({
			query: "contract",
			limit: 5,
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "workspace-1",
		})
		expect(new Headers(request[1]?.headers).get("x-request-id")).toBe(
			"request-1",
		)
	})

	it("rejects malformed search results instead of returning empty success", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(response({ results: [{ score: "wrong" }] }))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "YOUR_TENANT_API_KEY_HERE",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		await expect(
			gateway.retrieve(
				{ kind: "search", query: "contract" },
				{
					agentId: "agent-1",
					scope: "workspace",
					scopeRef: "workspace-1",
				},
			),
		).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" })
	})

	it("retrieves scoped state through a GET query and validates its shape", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				response({
					profile: { entities: [] },
					blocks: {
						blocks: [],
						totalTokenBudget: 0,
						totalActualTokens: 0,
					},
					bundle: { sections: [] },
				}),
			)
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "YOUR_TENANT_API_KEY_HERE",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		const state = await gateway.execute("state", {
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "workspace-1",
		})

		expect(state).toEqual({
			profile: { entities: [] },
			blocks: {
				blocks: [],
				totalTokenBudget: 0,
				totalActualTokens: 0,
			},
			bundle: { sections: [] },
		})
		const request = fetchImpl.mock.calls[1]
		expect(String(request[0])).toBe(
			"https://memongo.example.test/v1/state?agentId=agent-1&scope=workspace&scopeRef=workspace-1",
		)
	})

	it("writes an event with caller-owned idempotency and unwraps its receipt", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				response({
					ok: true,
					eventId: "event-1",
					chunkCreated: true,
				}),
			)
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "YOUR_TENANT_API_KEY_HERE",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		const receipt = await gateway.execute(
			"writeEvent",
			{
				agentId: "agent-1",
				role: "user",
				body: "remember this",
				scope: "workspace",
				scopeRef: "workspace-1",
			},
			{ idempotencyKey: "YOUR_IDEMPOTENCY_KEY_HERE", requestId: "request-1" },
		)

		expect(receipt).toEqual({ eventId: "event-1", chunkCreated: true })
		const request = fetchImpl.mock.calls[1]
		expect(JSON.parse(String(request[1]?.body))).toEqual({
			agentId: "agent-1",
			role: "user",
			body: "remember this",
			scope: "workspace",
			scopeRef: "workspace-1",
		})
		const headers = new Headers(request[1]?.headers)
		expect(headers.get("idempotency-key")).toBe("YOUR_IDEMPOTENCY_KEY_HERE")
		expect(headers.get("x-request-id")).toBe("request-1")
	})

	it("passes through a validated detailed-search response", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				response({
					results: [],
					metadata: {
						passes: 1,
						pathsExecuted: ["structured"],
					},
				}),
			)
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "YOUR_TENANT_API_KEY_HERE",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		const result = await gateway.execute("searchDetailed", {
			query: "contract",
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "workspace-1",
			maxResults: 5,
		})

		expect(result).toEqual({
			results: [],
			metadata: {
				passes: 1,
				pathsExecuted: ["structured"],
			},
		})
		expect(String(fetchImpl.mock.calls[1][0])).toBe(
			"https://memongo.example.test/v1/search-detailed",
		)
	})

	it.each([
		{
			operation: "search",
			input: { query: "contract" },
			wire: { results: [] },
			output: [],
			path: "/v1/search",
		},
		{
			operation: "searchKb",
			input: {
				query: "contract",
				scope: "workspace",
				scopeRef: "workspace-1",
			},
			wire: { results: [] },
			output: [],
			path: "/v1/search-kb",
		},
		{
			operation: "recallConversation",
			input: {
				query: "contract",
				scope: "workspace",
				scopeRef: "workspace-1",
			},
			wire: {
				results: [],
				metadata: {
					totalMatched: 0,
					filtersApplied: [],
					searchMethod: "semantic",
					durationMs: 1,
				},
			},
			output: {
				results: [],
				metadata: {
					totalMatched: 0,
					filtersApplied: [],
					searchMethod: "semantic",
					durationMs: 1,
				},
			},
			path: "/v1/recall-conversation",
		},
		{
			operation: "profile",
			input: { agentId: "agent-1" },
			wire: { entities: [] },
			output: { entities: [] },
			path: "/v1/profile",
		},
		{
			operation: "hydrateActiveSlate",
			input: { agentId: "agent-1" },
			wire: {
				agentId: "agent-1",
				scope: "agent",
				scopeRef: "agent-1",
				items: [],
				metadata: {
					maxItems: 6,
					truncated: false,
					partial: false,
					countsByKind: {},
					sourceCounts: {},
				},
				hydratedAt: "2026-08-17T00:00:00.000Z",
			},
			output: {
				agentId: "agent-1",
				scope: "agent",
				scopeRef: "agent-1",
				items: [],
				metadata: {
					maxItems: 6,
					truncated: false,
					partial: false,
					countsByKind: {},
					sourceCounts: {},
				},
				hydratedAt: "2026-08-17T00:00:00.000Z",
			},
			path: "/v1/hydrate-active-slate",
		},
		{
			operation: "discoveryProjection",
			input: { kind: "topic-brief", query: "contract" },
			wire: {
				kind: "topic-brief",
				title: "Contract",
				summary: "Summary",
				scope: "agent",
				scopeRef: "agent-1",
				sections: [],
				metadata: {
					partial: false,
					evidenceCount: 0,
					sourceCounts: {},
				},
				builtAt: "2026-08-17T00:00:00.000Z",
			},
			output: {
				kind: "topic-brief",
				title: "Contract",
				summary: "Summary",
				scope: "agent",
				scopeRef: "agent-1",
				sections: [],
				metadata: {
					partial: false,
					evidenceCount: 0,
					sourceCounts: {},
				},
				builtAt: "2026-08-17T00:00:00.000Z",
			},
			path: "/v1/discovery-projection",
		},
		{
			operation: "contextBundle",
			input: { agentId: "agent-1" },
			wire: {
				agentId: "agent-1",
				scope: "agent",
				scopeRef: "agent-1",
				rendered: "",
				sections: [],
				metadata: {
					tokenBudget: 1000,
					estimatedTokensUsed: 0,
					partial: false,
					truncated: false,
					pathsExecuted: [],
					sectionsIncluded: [],
				},
				builtAt: "2026-08-17T00:00:00.000Z",
			},
			output: {
				agentId: "agent-1",
				scope: "agent",
				scopeRef: "agent-1",
				rendered: "",
				sections: [],
				metadata: {
					tokenBudget: 1000,
					estimatedTokensUsed: 0,
					partial: false,
					truncated: false,
					pathsExecuted: [],
					sectionsIncluded: [],
				},
				builtAt: "2026-08-17T00:00:00.000Z",
			},
			path: "/v1/context-bundle",
		},
		{
			operation: "add",
			input: { content: "remember" },
			wire: { ok: true, eventId: "event-1", chunkCreated: false },
			output: { eventId: "event-1", chunkCreated: false },
			path: "/v1/add",
			idempotencyKey: "add-1",
		},
		{
			operation: "writeEvents",
			input: {
				events: [{ role: "user", body: "remember", customId: "event-1" }],
			},
			wire: {
				ok: true,
				receipts: [
					{
						ok: true,
						eventId: "event-1",
						chunkCreated: false,
						replayed: true,
					},
				],
			},
			output: [
				{
					ok: true,
					eventId: "event-1",
					chunkCreated: false,
					replayed: true,
				},
			],
			path: "/v1/write-events",
		},
		{
			operation: "extract",
			input: { eventId: "event-1" },
			wire: { ok: true, jobId: "job-1", scheduled: true },
			output: { jobId: "job-1", scheduled: true },
			path: "/v1/extract",
		},
		{
			operation: "writeStructured",
			input: { entry: { type: "fact", key: "k", value: "v" } },
			wire: { upserted: true, id: "memory-1" },
			output: { upserted: true, id: "memory-1" },
			path: "/v1/write-structured",
		},
		{
			operation: "writeProcedure",
			input: { entry: { procedureId: "p", name: "P", steps: ["one"] } },
			wire: { upserted: true, id: "procedure-1" },
			output: { upserted: true, id: "procedure-1" },
			path: "/v1/write-procedure",
		},
		...[
			["lifecycleGet", "/v1/lifecycle/get"],
			["lifecycleUpdate", "/v1/lifecycle/update"],
			["lifecycleDelete", "/v1/lifecycle/delete"],
			["procedureOutcome", "/v1/procedures/outcome"],
			["memoryFeedback", "/v1/memory/feedback"],
		].map(([operation, path]) => ({
			operation,
			input: { handle: { family: "structured" } },
			wire: {
				family: operation === "procedureOutcome" ? "procedure" : "structured",
				handle: {},
				data: {},
			},
			output: {
				family: operation === "procedureOutcome" ? "procedure" : "structured",
				handle: {},
				data: {},
			},
			path,
		})),
		{
			operation: "lifecycleHistory",
			input: { handle: { family: "structured" } },
			wire: [
				{
					family: "structured",
					handle: {},
					data: {},
					historyKind: "current",
				},
			],
			output: [
				{
					family: "structured",
					handle: {},
					data: {},
					historyKind: "current",
				},
			],
			path: "/v1/lifecycle/history",
		},
		{
			operation: "status",
			input: { agentId: "agent-1" },
			wire: { version: "2.0.1", backend: "mongodb", provider: "voyage" },
			output: { version: "2.0.1", backend: "mongodb", provider: "voyage" },
			path: "/v1/status",
			query: "agentId=agent-1",
		},
		{
			operation: "embeddingProbe",
			input: { agentId: "agent-1" },
			wire: { ok: true },
			output: { ok: true },
			path: "/v1/probes/embedding",
			query: "agentId=agent-1",
		},
		{
			operation: "vectorProbe",
			input: { agentId: "agent-1" },
			wire: { ok: true },
			output: true,
			path: "/v1/probes/vector",
			query: "agentId=agent-1",
		},
	])("supports retained $operation wire semantics", async ({
		operation,
		input,
		wire,
		output,
		path,
		idempotencyKey,
		query,
	}) => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(response(wire))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "YOUR_TENANT_API_KEY_HERE",
				controlApiKey: "YOUR_CONTROL_API_KEY_HERE",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)
		const execute = gateway.execute.bind(gateway) as (
			name: string,
			body: Record<string, unknown>,
			options?: { idempotencyKey?: string },
		) => Promise<unknown>

		await expect(
			execute(operation, input, { idempotencyKey }),
		).resolves.toEqual(output)
		const [requestUrl] = fetchImpl.mock.calls[1]
		expect(String(requestUrl)).toBe(
			`https://memongo.example.test${path}${query ? `?${query}` : ""}`,
		)
		if (!query) {
			expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual(
				input,
			)
		}
	})
})
