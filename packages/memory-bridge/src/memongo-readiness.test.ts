import { describe, expect, it, vi } from "vitest"
import { MemongoHttpClient } from "./memongo-http-client.js"
import { MemongoMemoryGateway } from "./memongo-memory-gateway.js"

const openApiBody = JSON.stringify({
	openapi: "3.0.3",
	info: { title: "Memongo API", version: "2.0.1" },
	paths: {},
})

const readyState = {
	profile: {},
	blocks: {
		blocks: [],
		totalTokenBudget: 0,
		totalActualTokens: 0,
	},
	bundle: {},
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

function delayedResponse(response: Response, delayMs: number) {
	return (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
		new Promise((resolve, reject) => {
			const timeout = setTimeout(() => resolve(response), delayMs)
			const signal = init?.signal
			const onAbort = () => {
				clearTimeout(timeout)
				reject(signal?.reason)
			}
			signal?.addEventListener("abort", onAbort, { once: true })
		})
}

describe("Memongo readiness", () => {
	it("identifies invalid tenant credentials as a retrieval dependency failure", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "invalid-tenant-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		await expect(
			gateway.checkReadiness({
				agentId: "agent-1",
				requiredControlLanes: [],
				timeoutMs: 1_000,
			}),
		).rejects.toMatchObject({
			name: "MemongoReadinessError",
			dependency: "retrieval",
			cause: { code: "UNAUTHENTICATED" },
		})
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})

	it("bounds the complete non-mutating readiness sequence with one deadline", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(
				delayedResponse(
					new Response(openApiBody, {
						headers: { "content-type": "application/json" },
					}),
					20,
				),
			)
			.mockImplementationOnce(delayedResponse(jsonResponse(readyState), 20))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "tenant-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				timeoutMs: 1_000,
				fetchImpl,
			}),
		)

		await expect(
			gateway.checkReadiness({
				agentId: "agent-1",
				requiredControlLanes: [],
				timeoutMs: 30,
			}),
		).rejects.toMatchObject({
			name: "MemongoReadinessError",
			dependency: "retrieval",
			cause: { code: "DEADLINE_EXCEEDED" },
		})
		expect(
			fetchImpl.mock.calls.map(([input, init]) => ({
				url: String(input),
				method: init?.method,
			})),
		).toEqual([
			{
				url: "https://memongo.example.test/openapi.json",
				method: "GET",
			},
			{
				url: "https://memongo.example.test/v1/state?agentId=agent-1",
				method: "GET",
			},
		])
	})

	it("keeps the deadline when compatibility caching is disabled", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockImplementationOnce(
				delayedResponse(
					new Response(openApiBody, {
						headers: { "content-type": "application/json" },
					}),
					100,
				),
			)
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "tenant-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				compatibilityTtlMs: 0,
				timeoutMs: 1_000,
				fetchImpl,
			}),
		)

		await expect(
			gateway.checkReadiness({
				agentId: "agent-1",
				requiredControlLanes: [],
				timeoutMs: 30,
			}),
		).rejects.toMatchObject({
			name: "MemongoReadinessError",
			dependency: "retrieval",
		})
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})

	it.each([
		{
			lane: "control" as const,
			response: new Response(null, { status: 503 }),
		},
		{
			lane: "embedding" as const,
			response: jsonResponse({
				ok: false,
				error: "embedding provider unavailable",
			}),
		},
		{
			lane: "vector" as const,
			response: jsonResponse({
				ok: false,
				error: "vector index unavailable",
			}),
		},
	])("identifies an unavailable $lane lane", async ({ lane, response }) => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(jsonResponse(readyState))
			.mockResolvedValueOnce(response)
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "tenant-secret",
				controlApiKey: "control-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		await expect(
			gateway.checkReadiness({
				agentId: "agent-1",
				requiredControlLanes: [lane],
				timeoutMs: 1_000,
			}),
		).rejects.toMatchObject({
			name: "MemongoReadinessError",
			dependency: lane,
		})
		expect(fetchImpl).toHaveBeenCalledTimes(3)
	})

	it("does not probe optional control lanes when none are configured", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(jsonResponse(readyState))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "tenant-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		await expect(
			gateway.checkReadiness({
				agentId: "agent-1",
				requiredControlLanes: [],
				timeoutMs: 1_000,
			}),
		).resolves.toEqual({
			lanes: {
				retrieval: "ready",
			},
		})
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})

	it("reports every configured lane only after it succeeds", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(jsonResponse(readyState))
			.mockResolvedValueOnce(
				jsonResponse({
					version: "2.0.1",
					backend: "mongodb",
					provider: "voyage",
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ ok: true }))
			.mockResolvedValueOnce(jsonResponse({ ok: true }))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "tenant-secret",
				controlApiKey: "control-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)

		await expect(
			gateway.checkReadiness({
				agentId: "agent-1",
				requiredControlLanes: ["control", "embedding", "vector"],
				timeoutMs: 1_000,
			}),
		).resolves.toEqual({
			lanes: {
				retrieval: "ready",
				control: "ready",
				embedding: "ready",
				vector: "ready",
			},
		})
		expect(
			fetchImpl.mock.calls
				.slice(1)
				.map(([, init]) => new Headers(init?.headers).get("authorization")),
		).toEqual([
			"Bearer tenant-secret",
			"Bearer control-secret",
			"Bearer control-secret",
			"Bearer control-secret",
		])
	})

	it("recovers on a later readiness check after a transient credential failure", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(openApiBody, {
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(jsonResponse(readyState))
		const gateway = new MemongoMemoryGateway(
			new MemongoHttpClient({
				baseUrl: "https://memongo.example.test",
				tenantApiKey: "tenant-secret",
				expectedVersion: "2.0.1",
				expectedContractSha256:
					"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
				fetchImpl,
			}),
		)
		const options = {
			agentId: "agent-1",
			requiredControlLanes: [] as const,
			timeoutMs: 1_000,
		}

		await expect(gateway.checkReadiness(options)).rejects.toMatchObject({
			dependency: "retrieval",
		})
		await expect(gateway.checkReadiness(options)).resolves.toEqual({
			lanes: { retrieval: "ready" },
		})
		expect(fetchImpl).toHaveBeenCalledTimes(3)
	})
})
