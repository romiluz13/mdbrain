import { describe, expect, it } from "vitest"
import { agentToolNames, agentTools } from "./tools.js"
import { fakeAgentClients } from "./testing/fakes.js"

const execOptions = {
	toolCallId: "t1",
	messages: [],
	abortSignal: new AbortController().signal,
}

function textOf(result: unknown): string {
	const content = (
		result as {
			content: Array<{ type: string; text: string }>
		}
	).content
	return content.find((part) => part.type === "text")?.text ?? ""
}

describe("agentToolNames", () => {
	it("gives every role the shared read tools", () => {
		for (const role of ["support", "account", "product"] as const) {
			const names = agentToolNames(role)
			for (const shared of [
				"mdbrain_search",
				"mdbrain_search_kb",
				"mdbrain_wiki_search",
				"mdbrain_wiki_get",
				"mdbrain_wiki_overview",
				"mdbrain_wiki_changes",
			]) {
				expect(names).toContain(shared)
			}
		}
	})

	it("gives writers write_event + wiki_apply but not add; product gets write_event + add and never wiki_apply", () => {
		for (const role of ["support", "account"] as const) {
			expect(agentToolNames(role)).toContain("mdbrain_write_event")
			expect(agentToolNames(role)).toContain("mdbrain_wiki_apply")
			expect(agentToolNames(role)).not.toContain("mdbrain_add")
		}
		expect(agentToolNames("product")).toContain("mdbrain_write_event")
		expect(agentToolNames("product")).toContain("mdbrain_add")
		expect(agentToolNames("product")).not.toContain("mdbrain_wiki_apply")
	})
})

describe("agentTools", () => {
	it("routes mdbrain_write_event through the MCP dispatcher with the run identity injected", async () => {
		const { clients, logs } = fakeAgentClients()
		const tools = agentTools({
			client: clients.support,
			role: "support",
			agentId: "demo-run-1",
			scopeRef: "demo-run-1",
		})
		const result = await tools["mdbrain_write_event"]!.execute!(
			{
				role: "user",
				body: "renewal risk thread",
				idempotencyKey: "seed:demo-run-1:event:src-renewal-05",
			},
			execOptions,
		)
		expect(JSON.parse(textOf(result)).ok).toBe(true)
		expect(
			logs.find((log) => log.method === "writeEvent")?.input,
		).toMatchObject({
			role: "user",
			body: "renewal risk thread",
			idempotencyKey: "seed:demo-run-1:event:src-renewal-05",
			agentId: "demo-run-1",
			scope: "workspace",
			scopeRef: "demo-run-1",
		})
	})

	it("carries mdbrain_add promotion fields through untouched", async () => {
		const { clients, logs } = fakeAgentClients()
		const tools = agentTools({
			client: clients.product,
			role: "product",
			agentId: "demo-run-1",
			scopeRef: "demo-run-1",
		})
		const wikiPromotion = {
			page: {
				kind: "synthesis",
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
				summary: "s",
				body: "b",
				frontmatter: { type: "synthesis" },
				claims: [
					{ id: "silent-eta-drift-pattern", text: "pattern", confidence: 0.7 },
				],
				scope: "workspace",
				scopeRef: "demo-run-1",
				trustTier: "standard",
			},
		}
		const result = await tools["mdbrain_add"]!.execute!(
			{
				content: "propose a page",
				idempotencyKey: "k",
				promotionPolicy: "wiki",
				wikiPromotion,
			},
			execOptions,
		)
		expect(JSON.parse(textOf(result)).ok).toBe(true)
		expect(logs.find((log) => log.method === "add")?.input).toMatchObject({
			content: "propose a page",
			promotionPolicy: "wiki",
			wikiPromotion,
		})
	})

	it("returns a structured isError result when the API refuses, instead of throwing", async () => {
		const { clients } = fakeAgentClients()
		const tools = agentTools({
			client: clients.support,
			role: "support",
			agentId: "demo-run-1",
			scopeRef: "demo-run-1",
		})
		const result = await tools["mdbrain_wiki_get"]!.execute!(
			{ slug: "risks/missing", scope: "workspace", scopeRef: "demo-run-1" },
			execOptions,
		)
		expect((result as { isError?: boolean }).isError).toBe(true)
		expect(textOf(result)).toContain("error")
	})
})
