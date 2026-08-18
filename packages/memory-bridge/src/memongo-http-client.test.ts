import { describe, expect, it, vi } from "vitest"
import {
	MemongoHttpClient,
	MemongoHttpError,
	type MemongoHttpClientOptions,
} from "./memongo-http-client.js"

const openApiBody = JSON.stringify({
	openapi: "3.0.3",
	info: { title: "Memongo API", version: "2.0.1" },
	paths: {},
})
const contractSha256 =
	"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b"

function response(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	})
}

function options(
	fetchImpl: typeof fetch,
	overrides: Partial<MemongoHttpClientOptions> = {},
): MemongoHttpClientOptions {
	return {
		baseUrl: "https://memongo.example.test",
		tenantApiKey: "tenant-secret",
		controlApiKey: "control-secret",
		expectedVersion: "2.0.1",
		expectedContractSha256: contractSha256,
		fetchImpl,
		...overrides,
	}
}

describe("MemongoHttpClient", () => {
	it("locks the OpenAPI contract before sending a scoped tenant request", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(
				response(JSON.stringify({ results: [{ id: "r1" }] })),
			)
		const client = new MemongoHttpClient(options(fetchImpl))

		const result = await client.request<{ results: Array<{ id: string }> }>({
			operation: "search",
			body: {
				query: "contract",
				agentId: "agent-1",
				scope: "workspace",
				scopeRef: "ws-1",
			},
			validate: (value) =>
				typeof value === "object" &&
				value !== null &&
				Array.isArray((value as { results?: unknown }).results),
		})

		expect(result).toEqual({ results: [{ id: "r1" }] })
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		const [requestUrl, requestInit] = fetchImpl.mock.calls[1]
		expect(String(requestUrl)).toBe("https://memongo.example.test/v1/search")
		expect(requestInit?.redirect).toBe("error")
		expect(new Headers(requestInit?.headers).get("authorization")).toBe(
			"Bearer tenant-secret",
		)
		expect(new Headers(requestInit?.headers).get("x-request-id")).toBeTruthy()
	})

	it("sends idempotency keys and never substitutes control credentials", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(response(JSON.stringify({ eventId: "evt-1" })))
		const client = new MemongoHttpClient(options(fetchImpl))

		await client.request({
			operation: "writeEvent",
			body: { role: "user", body: "hello" },
			idempotencyKey: "op-123",
			validate: (value) => typeof value === "object" && value !== null,
		})

		const headers = new Headers(fetchImpl.mock.calls[1][1]?.headers)
		expect(headers.get("authorization")).toBe("Bearer tenant-secret")
		expect(headers.get("idempotency-key")).toBe("op-123")
	})

	it("serializes typed query parameters for GET operations without a body", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(
				response(
					JSON.stringify({
						profile: {},
						blocks: {
							blocks: [],
							totalTokenBudget: 0,
							totalActualTokens: 0,
						},
						bundle: {},
					}),
				),
			)
		const client = new MemongoHttpClient(options(fetchImpl))

		await client.request({
			operation: "state",
			query: {
				agentId: "agent/one",
				scope: "workspace",
				scopeRef: "team alpha",
				ignored: undefined,
			},
			validate: (value) => typeof value === "object" && value !== null,
		})

		const [requestUrl, requestInit] = fetchImpl.mock.calls[1]
		expect(String(requestUrl)).toBe(
			"https://memongo.example.test/v1/state?agentId=agent%2Fone&scope=workspace&scopeRef=team+alpha",
		)
		expect(requestInit?.body).toBeUndefined()
	})

	it("fails closed when the advertised contract version differs", async () => {
		const incompatible = JSON.stringify({
			openapi: "3.0.3",
			info: { title: "Memongo API", version: "3.0.0" },
			paths: {},
		})
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(response(incompatible))
		const client = new MemongoHttpClient(options(fetchImpl))

		await expect(client.checkCompatibility()).rejects.toMatchObject({
			code: "INCOMPATIBLE_CONTRACT",
			retryable: false,
			outcome: "not-applied",
		})
	})

	it("rejects malformed successful responses", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(response(JSON.stringify({ unexpected: true })))
		const client = new MemongoHttpClient(options(fetchImpl))

		await expect(
			client.request({
				operation: "search",
				body: { query: "x" },
				validate: (value) =>
					typeof value === "object" &&
					value !== null &&
					Array.isArray((value as { results?: unknown }).results),
			}),
		).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" })
	})

	it("marks an aborted write as outcome unknown", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
		const client = new MemongoHttpClient(options(fetchImpl, { timeoutMs: 5 }))

		await expect(
			client.request({
				operation: "writeEvent",
				body: { body: "x" },
				idempotencyKey: "op-ambiguous",
				validate: () => true,
			}),
		).rejects.toMatchObject({
			code: "OUTCOME_UNKNOWN",
			retryable: true,
			outcome: "unknown",
		})
	})

	it("does not contact Memongo for a request cancelled before dispatch", async () => {
		const fetchImpl = vi.fn<typeof fetch>()
		const client = new MemongoHttpClient(options(fetchImpl))
		const controller = new AbortController()
		controller.abort(new DOMException("cancelled", "AbortError"))

		await expect(
			client.request({
				operation: "writeEvent",
				body: { body: "x" },
				idempotencyKey: "op-cancelled",
				signal: controller.signal,
				validate: () => true,
			}),
		).rejects.toMatchObject({
			code: "DEADLINE_EXCEEDED",
			retryable: false,
			outcome: "not-applied",
		})
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it("revalidates compatibility after the configured ttl", async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"))
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(response(JSON.stringify({ results: [] })))
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(response(JSON.stringify({ results: [] })))
		const client = new MemongoHttpClient(
			options(fetchImpl, { compatibilityTtlMs: 1_000 }),
		)
		const request = {
			operation: "search" as const,
			body: { query: "ttl" },
			validate: (value: unknown) =>
				typeof value === "object" &&
				value !== null &&
				Array.isArray((value as { results?: unknown }).results),
		}

		try {
			await client.request(request)
			vi.advanceTimersByTime(1_001)
			await client.request(request)
			expect(fetchImpl).toHaveBeenCalledTimes(4)
		} finally {
			vi.useRealTimers()
		}
	})

	it("rejects idempotency headers for operations that do not support them", async () => {
		const fetchImpl = vi.fn<typeof fetch>()
		const client = new MemongoHttpClient(options(fetchImpl))

		await expect(
			client.request({
				operation: "memoryFeedback",
				body: { signal: "confirm" },
				idempotencyKey: "unsafe-key",
				validate: () => true,
			}),
		).rejects.toMatchObject({
			code: "VALIDATION",
			retryable: false,
			outcome: "not-applied",
		})
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it("classifies upstream failures using the operation retry policy", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(openApiBody))
			.mockResolvedValueOnce(response("{}", 503))
			.mockResolvedValueOnce(response("{}", 503))
		const client = new MemongoHttpClient(options(fetchImpl))

		await expect(
			client.request({
				operation: "writeEvent",
				body: { role: "user", body: "hello" },
				idempotencyKey: "safe-event",
				validate: () => true,
			}),
		).rejects.toMatchObject({
			code: "UPSTREAM_UNAVAILABLE",
			retryable: true,
			outcome: "unknown",
		})
		await expect(
			client.request({
				operation: "memoryFeedback",
				body: { signal: "confirm" },
				validate: () => true,
			}),
		).rejects.toMatchObject({
			code: "UPSTREAM_UNAVAILABLE",
			retryable: false,
			outcome: "unknown",
		})
	})

	it("rejects plain HTTP outside explicit loopback development", () => {
		expect(
			() =>
				new MemongoHttpClient(
					options(vi.fn<typeof fetch>(), {
						baseUrl: "http://memongo.example.test",
					}),
				),
		).toThrow(MemongoHttpError)
	})
})
