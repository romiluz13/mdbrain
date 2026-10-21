import { jsonSchema, tool, type ToolSet } from "ai"
import type { MdbrainClient } from "@mdbrain/client"
import { handleToolCall, toolList } from "@mdbrain/mcp"
import type { AgentRole } from "./config.js"
import { resolveEventEvidence, type RunWrites } from "../evidence.js"
import type { PinnedEvent, PinnedPage } from "./story.js"

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
	/** Pinned replay events for this role (330): every write receipt is
	 * captured into the run ledger, keyed by corpus source id. */
	events?: PinnedEvent[]
	/** The page this role may apply (330): its claims' evidence refs are
	 * resolved to this run's event ids before the call reaches the API. */
	page?: PinnedPage
	/** The run's shared write ledger (330). */
	writes?: RunWrites
}): ToolSet {
	const names = new Set<string>(agentToolNames(input.role))
	const defs = toolList.filter((def) => names.has(def.name))
	const tools: ToolSet = {}
	for (const [index, def] of defs.entries()) {
		tools[def.name] = tool({
			description: def.description,
			inputSchema: jsonSchema(
				def.inputSchema as unknown as Parameters<typeof jsonSchema>[0],
			),
			// One cache breakpoint (336) on the last tool of the role's set:
			// the tool prefix is identical across every step of a run, so a
			// single ephemeral breakpoint at its end lets later steps read the
			// ~2.5k-token prefix from the cache instead of paying full input
			// price for it. The prefix is cached first (tools, then system,
			// then messages), and one breakpoint stays under the API's cap.
			...(index === defs.length - 1
				? {
						providerOptions: {
							anthropic: { cacheControl: { type: "ephemeral" } },
						},
					}
				: {}),
			execute: async (args) => {
				let callArgs = identity(args, input)
				if (def.name === "mdbrain_write_event") {
					callArgs = stampPinnedTimestamp(callArgs, input)
				}
				if (def.name === "mdbrain_wiki_apply") {
					const prepared = resolvePinnedPage(callArgs, input)
					if (typeof prepared === "string") {
						input.writes?.refusals.push(prepared)
						return {
							content: [
								{ type: "text", text: JSON.stringify({ error: prepared }) },
							],
							isError: true,
						}
					}
					callArgs = prepared
				}
				const result = await handleToolCall(def.name, callArgs, input.client)
				if (def.name === "mdbrain_write_event") {
					captureReceipt(result, callArgs, input)
				}
				return result
			},
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

/** Stamps the pinned business timestamp onto a pinned replay write: the
 * corpus source's date, so the replayed event carries business time. */
function stampPinnedTimestamp(
	args: Record<string, unknown>,
	input: { events?: PinnedEvent[] },
): Record<string, unknown> {
	const pinned = input.events?.find(
		(event) => event.idempotencyKey === args.idempotencyKey,
	)
	return pinned ? { ...args, timestamp: pinned.timestamp } : args
}

/** Captures a pinned write's receipt into the run ledger: the event id this
 * run's mdbrain_write_event returned, keyed by corpus source id. */
function captureReceipt(
	result: unknown,
	callArgs: Record<string, unknown>,
	input: { events?: PinnedEvent[]; writes?: RunWrites },
): void {
	if (!input.events || !input.writes) return
	const text = (
		result as { content?: Array<{ type: string; text?: string }> }
	).content?.find((part) => part.type === "text")?.text
	if (!text) return
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return
	}
	const receipt = parsed as { ok?: unknown; eventId?: unknown; error?: unknown }
	const pinned = input.events.find(
		(event) => event.idempotencyKey === callArgs.idempotencyKey,
	)
	if (!pinned) return
	if (receipt.ok === true && typeof receipt.eventId === "string") {
		input.writes.eventIdBySource.set(pinned.sourceId, receipt.eventId)
		// A successful retry clears any earlier refusal the same source hit.
		input.writes.writeRefusals.delete(pinned.sourceId)
		return
	}
	if (receipt.error !== undefined) {
		// The API refused the pinned write: record its reason so the run
		// fails closed with what the API actually said.
		input.writes.writeRefusals.set(
			pinned.sourceId,
			`mdbrain_write_event for ${pinned.sourceId} failed: ${JSON.stringify(receipt.error)}`,
		)
	}
}

/** Resolves the pinned page's claim evidence to this run's event ids. A
 * cited source with no written event refuses the whole call: no API call,
 * the refusal lands in the ledger, and the run fails closed. */
function resolvePinnedPage(
	args: Record<string, unknown>,
	input: { page?: PinnedPage; writes?: RunWrites },
): Record<string, unknown> | string {
	const page = input.page
	const writes = input.writes
	if (!page || !writes || !Array.isArray(args.claims)) return args
	const resolved: Array<Record<string, unknown>> = []
	for (const claim of args.claims as Array<Record<string, unknown>>) {
		const pinned = (page.claims ?? []).find(
			(candidate) => candidate.id === claim.id,
		)
		const refs = pinned?.evidence ?? []
		if (refs.length === 0) {
			resolved.push(claim)
			continue
		}
		const outcome = resolveEventEvidence({
			notes: refs.map((ref) => ({ sourceId: ref.sourceId, note: ref.note })),
			eventIdBySource: writes.eventIdBySource,
			missing: (sourceId) =>
				`fail-closed: page ${page.slug} cites ${sourceId}, which has no written event in this run (claim ${pinned?.id ?? claim.id})`,
		})
		if ("refusal" in outcome) return outcome.refusal
		resolved.push({ ...claim, evidence: outcome })
	}
	return { ...args, claims: resolved }
}
