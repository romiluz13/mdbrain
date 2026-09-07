import type { MdbrainClient } from "@mdbrain/client"
import { describe, expect, it, vi } from "vitest"
import { createMdbrainTools } from "./index.js"

describe("createMdbrainTools", () => {
	it("does not expose the Memongo status control operation", () => {
		const tools = createMdbrainTools({} as MdbrainClient)

		expect(tools).not.toHaveProperty("mdbrain_status")
	})

	it("validates and forwards canonical scope for KB and conversation recall", async () => {
		const searchKB = vi.fn().mockResolvedValue({ results: [] })
		const recallConversation = vi.fn().mockResolvedValue({ results: [] })
		const tools = createMdbrainTools({
			searchKB,
			recallConversation,
		} as unknown as MdbrainClient)
		const options = { toolCallId: "test", messages: [] }
		const scope = { scope: "tenant", scopeRef: "tenant-1" } as const

		const kbSchema = tools.mdbrain_search_kb?.inputSchema as {
			parse(input: unknown): Record<string, unknown>
		}
		const recallSchema = tools.mdbrain_recall_conversation?.inputSchema as {
			parse(input: unknown): Record<string, unknown>
		}
		const kbInput = kbSchema.parse({ query: "knowledge", ...scope })
		const recallInput = recallSchema.parse({ query: "conversation", ...scope })

		await tools.mdbrain_search_kb?.execute?.(kbInput, options)
		await tools.mdbrain_recall_conversation?.execute?.(recallInput, options)

		expect(kbInput).toEqual(expect.objectContaining(scope))
		expect(recallInput).toEqual(expect.objectContaining(scope))
		expect(searchKB).toHaveBeenCalledWith(expect.objectContaining(scope))
		expect(recallConversation).toHaveBeenCalledWith(
			expect.objectContaining(scope),
		)
	})

	it("keeps scoped tool inputs optional", () => {
		const tools = createMdbrainTools({} as MdbrainClient)
		const kbSchema = tools.mdbrain_search_kb?.inputSchema as {
			parse(input: unknown): Record<string, unknown>
		}
		const recallSchema = tools.mdbrain_recall_conversation?.inputSchema as {
			parse(input: unknown): Record<string, unknown>
		}

		expect(kbSchema.parse({ query: "knowledge" })).not.toHaveProperty("scope")
		expect(recallSchema.parse({ query: "conversation" })).not.toHaveProperty(
			"scope",
		)
	})
})
