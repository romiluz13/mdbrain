import { beforeEach, describe, expect, it, vi } from "vitest"

const gatewayMocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock("./memongo-runtime.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./memongo-runtime.js")>()),
	getMemongoGateway: () => gatewayMocks,
}))

import { mdbrainBridgeGetEvent } from "./mdbrain-bridge.js"
import { MemongoHttpClient } from "./memongo-http-client.js"
import { MemongoMemoryGateway } from "./memongo-memory-gateway.js"
import { getMemongoOperationPolicy } from "./memongo-operation-policy.js"

const openApiBody = JSON.stringify({
	openapi: "3.0.3",
	info: { title: "Memongo API", version: "2.0.1" },
	paths: {},
})

const EVENT = {
	eventId: "evt-1",
	role: "user",
	body: "Tobias asked for a written ETA recovery plan.",
	timestamp: "2026-09-28T08:30:00.000Z",
	scope: "workspace",
	scopeRef: "ws-1",
	validAt: "2026-09-28T08:30:00.000Z",
}

const INPUT = {
	eventId: "evt-1",
	agentId: "agent-1",
	scope: "workspace" as const,
	scopeRef: "ws-1",
}

function gatewayAnswering(status: number, body: unknown) {
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(openApiBody))
		.mockResolvedValueOnce(
			new Response(typeof body === "string" ? body : JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
		)
	const gateway = new MemongoMemoryGateway(
		new MemongoHttpClient({
			baseUrl: "https://memongo.example.test",
			tenantApiKey: "test-key",
			expectedVersion: "2.0.1",
			expectedContractSha256:
				"0af839ab5bc5cde889a66234f190d8b4497e6701a18a3f6975ea43ec6601299b",
			fetchImpl,
		}),
	)
	return { gateway, fetchImpl }
}

describe("eventGet over Memongo HTTP", () => {
	it("is a bounded tenant read", () => {
		expect(getMemongoOperationPolicy("eventGet")).toEqual({
			kind: "read",
			credential: "tenant",
			idempotency: "none",
			retry: "transient",
			method: "POST",
			path: "/v1/events/get",
		})
	})

	it("posts the id and identity and returns the validated event", async () => {
		const { gateway, fetchImpl } = gatewayAnswering(200, EVENT)

		await expect(gateway.execute("eventGet", INPUT)).resolves.toEqual(EVENT)

		const [url, init] = fetchImpl.mock.calls[1]
		expect(String(url)).toBe("https://memongo.example.test/v1/events/get")
		expect(JSON.parse(String(init?.body))).toEqual(INPUT)
	})

	it("answers Memongo's EVENT_NOT_FOUND with a typed not-found, not an error", async () => {
		const { gateway } = gatewayAnswering(404, {
			error: { code: "EVENT_NOT_FOUND", message: "event not found" },
		})

		await expect(gateway.execute("eventGet", INPUT)).resolves.toBeNull()
	})

	it("keeps any other 404 an error, so a server without the route is never read as a missing event", async () => {
		const { gateway } = gatewayAnswering(404, "404 Not Found")

		await expect(gateway.execute("eventGet", INPUT)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
	})

	it.each([
		["without a body", { ...EVENT, body: undefined }],
		["with a numeric timestamp", { ...EVENT, timestamp: 1 }],
		["with an unknown scope", { ...EVENT, scope: "galaxy" }],
		["with a non-string validAt", { ...EVENT, validAt: 7 }],
		["as an array", [EVENT]],
	])("rejects a malformed event %s", async (_label, body) => {
		const { gateway } = gatewayAnswering(200, body)

		await expect(gateway.execute("eventGet", INPUT)).rejects.toMatchObject({
			code: "MALFORMED_RESPONSE",
		})
	})
})

describe("mdbrainBridgeGetEvent", () => {
	beforeEach(() => gatewayMocks.execute.mockReset())

	it("passes agentId, scope and scopeRef the way recall does", async () => {
		gatewayMocks.execute.mockResolvedValue(EVENT)

		await expect(mdbrainBridgeGetEvent(INPUT)).resolves.toEqual(EVENT)

		expect(gatewayMocks.execute).toHaveBeenCalledWith("eventGet", INPUT)
	})

	it("returns null for a typed not-found", async () => {
		gatewayMocks.execute.mockResolvedValue(null)

		await expect(mdbrainBridgeGetEvent(INPUT)).resolves.toBeNull()
	})
})
