import { beforeEach, describe, expect, it, vi } from "vitest"

const gatewayMocks = vi.hoisted(() => ({
	execute: vi.fn(),
}))

vi.mock("./memongo-runtime.js", () => ({
	getMemongoGateway: () => gatewayMocks,
}))

import {
	mdbrainBridgeGetLifecycleHistory,
	mdbrainBridgeGetState,
	mdbrainBridgeRecallConversation,
	mdbrainBridgeSearch,
	mdbrainBridgeSearchKB,
	mdbrainBridgeWriteConversationEvent,
} from "./mdbrain-bridge.js"

describe("Mdbrain bridge over Memongo HTTP", () => {
	beforeEach(() => {
		gatewayMocks.execute.mockReset()
	})

	it("maps search compatibility fields onto the retained HTTP operation", async () => {
		gatewayMocks.execute.mockResolvedValue([{ path: "memory/item" }])

		await expect(
			mdbrainBridgeSearch({
				query: "contract",
				agentId: "agent-1",
				maxResults: 5,
				minScore: 0.4,
				sessionKey: "session-1",
				scope: "workspace",
				scopeRef: "workspace-1",
			}),
		).resolves.toEqual([{ path: "memory/item" }])

		expect(gatewayMocks.execute).toHaveBeenCalledWith("search", {
			query: "contract",
			agentId: "agent-1",
			limit: 5,
			minScore: 0.4,
			sessionKey: "session-1",
			scope: "workspace",
			scopeRef: "workspace-1",
		})
	})

	it("preserves search-kb scope through the Memongo adapter", async () => {
		gatewayMocks.execute.mockResolvedValue([])

		await mdbrainBridgeSearchKB({
			query: "contract",
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "workspace-1",
		})

		expect(gatewayMocks.execute).toHaveBeenCalledWith("searchKb", {
			query: "contract",
			agentId: "agent-1",
			limit: undefined,
			minScore: undefined,
			filter: undefined,
			scope: "workspace",
			scopeRef: "workspace-1",
		})
	})

	it("preserves recall-conversation scope through the Memongo adapter", async () => {
		gatewayMocks.execute.mockResolvedValue({
			results: [],
			metadata: {},
		})

		await mdbrainBridgeRecallConversation({
			agentId: "agent-1",
			query: "contract",
			scope: "workspace",
			scopeRef: "workspace-1",
		})

		expect(gatewayMocks.execute).toHaveBeenCalledWith("recallConversation", {
			agentId: "agent-1",
			query: "contract",
			scope: "workspace",
			scopeRef: "workspace-1",
			sessionId: undefined,
			roles: undefined,
			startTime: undefined,
			endTime: undefined,
			timezone: undefined,
			includeToolMessages: undefined,
			limit: undefined,
		})
	})

	it("passes caller-owned idempotency to event delivery", async () => {
		gatewayMocks.execute.mockResolvedValue({
			eventId: "event-1",
			chunkCreated: true,
		})

		await mdbrainBridgeWriteConversationEvent({
			agentId: "agent-1",
			role: "user",
			body: "remember",
			timestamp: "2026-08-17T00:00:00.000Z",
			scope: "workspace",
			scopeRef: "workspace-1",
			idempotencyKey: "YOUR_IDEMPOTENCY_KEY_HERE",
			requestId: "request-1",
		})

		expect(gatewayMocks.execute).toHaveBeenCalledWith(
			"writeEvent",
			{
				agentId: "agent-1",
				role: "user",
				body: "remember",
				timestamp: "2026-08-17T00:00:00.000Z",
				scope: "workspace",
				scopeRef: "workspace-1",
			},
			{
				idempotencyKey: "YOUR_IDEMPOTENCY_KEY_HERE",
				requestId: "request-1",
			},
		)
	})

	it("uses the remote state operation without local materialization", async () => {
		gatewayMocks.execute.mockResolvedValue({
			profile: {},
			blocks: {
				blocks: [],
				totalTokenBudget: 0,
				totalActualTokens: 0,
			},
			bundle: {},
		})

		await mdbrainBridgeGetState({
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "workspace-1",
		})

		expect(gatewayMocks.execute).toHaveBeenCalledWith("state", {
			agentId: "agent-1",
			scope: "workspace",
			scopeRef: "workspace-1",
		})
	})

	it("passes lifecycle handles through the retained operation", async () => {
		const handle = {
			family: "structured" as const,
			id: "memory-1",
			agentId: "agent-1",
			scope: "workspace" as const,
			scopeRef: "workspace-1",
			revision: 1,
			state: "active" as const,
			structured: { type: "fact", key: "contract" },
		}
		gatewayMocks.execute.mockResolvedValue([])

		await mdbrainBridgeGetLifecycleHistory({ handle, limit: 20 })

		expect(gatewayMocks.execute).toHaveBeenCalledWith("lifecycleHistory", {
			handle,
			limit: 20,
		})
	})
})
