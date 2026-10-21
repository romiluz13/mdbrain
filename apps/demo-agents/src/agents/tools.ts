import { jsonSchema, tool, type ToolSet } from "ai"
import type { MdbrainClient } from "@mdbrain/client"
import { handleToolCall, toolList } from "@mdbrain/mcp"
import type { AgentRole } from "./config.js"

/** Read tools every role gets: memory search plus the wiki read surface. */
const SHARED_READ_TOOLS = [
	"mdbrain_search",
	"mdbrain_search_kb",
	"mdbrain_wiki_search",
	"mdbrain_wiki_get",
	"mdbrain_wiki_overview",
	"mdbrain_wiki_changes",
] as const

/** Writers (support, account) write memory events and apply wiki pages
 * directly; they never propose, so they hold no propose capability. */
const WRITER_TOOLS = ["mdbrain_write_event", "mdbrain_wiki_apply"] as const

/** The product lead writes memory events and proposes new pages through
 * mdbrain_add; it never applies a page directly (ticket 10, key rule). */
const PROPOSER_TOOLS = ["mdbrain_write_event", "mdbrain_add"] as const

export function agentToolNames(role: AgentRole): string[] {
	const extra = role === "product" ? PROPOSER_TOOLS : WRITER_TOOLS
	return [...SHARED_READ_TOOLS, ...extra]
}

/** Builds the role's tool set from the MCP server's own tool table, so the
 * schemas and argument handling stay in one place. Every call is routed
 * through the MCP dispatcher with the run identity injected: the shared
 * run agentId and the exact workspace/scopeRef grant the role's key
 * holds, so a model-authored argument can never reach outside the slot. */
export function agentTools(input: {
	client: MdbrainClient
	role: AgentRole
	agentId: string
	scopeRef: string
}): ToolSet {
	const names = new Set<string>(agentToolNames(input.role))
	const tools: ToolSet = {}
	for (const def of toolList) {
		if (!names.has(def.name)) continue
		tools[def.name] = tool({
			description: def.description,
			inputSchema: jsonSchema(
				def.inputSchema as unknown as Parameters<typeof jsonSchema>[0],
			),
			execute: async (args) =>
				handleToolCall(def.name, identity(args, input), input.client),
		})
	}
	return tools
}

function identity(
	args: unknown,
	input: { agentId: string; scopeRef: string },
): Record<string, unknown> {
	return {
		...(args as Record<string, unknown>),
		agentId: input.agentId,
		scope: "workspace",
		scopeRef: input.scopeRef,
	}
}
