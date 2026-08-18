import { randomUUID } from "node:crypto"
import { MdbrainClient } from "@mdbrain/client"
import { writeProofArtifact } from "./proof-artifacts.js"

type ChatMessage =
	| {
			role: "system" | "user" | "assistant"
			content: string | null
			tool_calls?: ToolCall[]
	  }
	| { role: "tool"; tool_call_id: string; content: string }

type ToolCall = {
	id: string
	type: "function"
	function: {
		name: string
		arguments: string
	}
}

type ChatCompletionResponse = {
	choices?: Array<{
		message?: {
			role?: "assistant"
			content?: string | null
			tool_calls?: ToolCall[]
		}
		finish_reason?: string | null
	}>
	error?: {
		message?: string
	}
}

type LlmAuthStyle = "authorization-bearer" | "api-key" | "x-api-key"
type LlmTokenParam = "max_tokens" | "max_completion_tokens"

const llmBaseUrl = process.env.MDBRAIN_LLM_BASE_URL?.trim()
const llmApiKey = process.env.MDBRAIN_LLM_API_KEY?.trim()
const llmModel = process.env.MDBRAIN_LLM_MODEL?.trim()
const llmAuthStyle =
	(process.env.MDBRAIN_LLM_AUTH_STYLE?.trim() as LlmAuthStyle | undefined) ??
	"authorization-bearer"
const llmTokenParam =
	(process.env.MDBRAIN_LLM_TOKEN_PARAM?.trim() as LlmTokenParam | undefined) ??
	"max_tokens"
const mdbrainApiUrl =
	process.env.MDBRAIN_API_URL?.trim() ?? "http://127.0.0.1:3847"
const mdbrainApiKey = process.env.MDBRAIN_API_KEY?.trim() || undefined
const agentId =
	process.env.MDBRAIN_AGENT_ID?.trim() ??
	`real-agent-smoke-${randomUUID().slice(0, 8)}`
const sessionId =
	process.env.MDBRAIN_SESSION_ID?.trim() ??
	`real-agent-session-${randomUUID().slice(0, 8)}`
const agentScopeRef = `agent:${agentId}`
const marker = `Blue Finch ${randomUUID().slice(0, 8)}`

if (!llmBaseUrl || !llmApiKey || !llmModel) {
	throw new Error(
		"MDBRAIN_LLM_BASE_URL, MDBRAIN_LLM_API_KEY, and MDBRAIN_LLM_MODEL are required.",
	)
}
const configuredLlmBaseUrl = llmBaseUrl
const configuredLlmApiKey = llmApiKey
const configuredLlmModel = llmModel

const mdbrain = new MdbrainClient({
	baseUrl: mdbrainApiUrl,
	apiKey: mdbrainApiKey,
	maxRetries: 2,
})
const runLog: unknown[] = []

function emitRunStep(payload: unknown) {
	runLog.push(payload)
	console.log(JSON.stringify(payload, null, 2))
}

const tools = [
	{
		type: "function",
		function: {
			name: "mdbrain_write_event",
			description:
				"Persist a conversational event into Mdbrain canonical memory.",
			parameters: {
				type: "object",
				properties: {
					role: {
						type: "string",
						enum: ["user", "assistant", "system", "tool"],
					},
					body: { type: "string" },
				},
				required: ["role", "body"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "mdbrain_search_detailed",
			description:
				"Search Mdbrain memory and return the top evidence snippets.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string" },
					limit: { type: "integer", minimum: 1, maximum: 8 },
				},
				required: ["query"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "mdbrain_hydrate_active_slate",
			description:
				"Read a tiny active-state slate for current blockers, decisions, and live procedures.",
			parameters: {
				type: "object",
				properties: {
					maxItems: { type: "integer", minimum: 1, maximum: 6 },
				},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "mdbrain_build_discovery_projection",
			description:
				"Build a rebuildable synthesis view for changes, contradictions, entities, or topics.",
			parameters: {
				type: "object",
				properties: {
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
					maxItems: { type: "integer", minimum: 1, maximum: 6 },
				},
				required: ["kind"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "mdbrain_build_context_bundle",
			description:
				"Build a prompt-ready context bundle that combines active state, durable evidence, summaries, and recent events.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string" },
					tokenBudget: { type: "integer", minimum: 128, maximum: 600 },
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
				},
				additionalProperties: false,
			},
		},
	},
] as const

async function callModel(messages: ChatMessage[]): Promise<{
	content: string | null
	toolCalls: ToolCall[]
}> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	}
	if (llmAuthStyle === "authorization-bearer") {
		headers.Authorization = `Bearer ${configuredLlmApiKey}`
	} else if (llmAuthStyle === "x-api-key") {
		headers["x-api-key"] = configuredLlmApiKey
	} else if (llmAuthStyle === "api-key") {
		headers["api-key"] = configuredLlmApiKey
	} else {
		throw new Error(
			"MDBRAIN_LLM_AUTH_STYLE must be authorization-bearer, api-key, or x-api-key.",
		)
	}
	if (
		llmTokenParam !== "max_tokens" &&
		llmTokenParam !== "max_completion_tokens"
	) {
		throw new Error(
			"MDBRAIN_LLM_TOKEN_PARAM must be max_tokens or max_completion_tokens.",
		)
	}
	const body: Record<string, unknown> = {
		model: configuredLlmModel,
		temperature: 0,
		parallel_tool_calls: false,
		tools,
		messages,
	}
	body[llmTokenParam] = 1024

	const response = await fetch(
		`${configuredLlmBaseUrl.replace(/\/+$/, "")}/chat/completions`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(body),
		},
	)

	const payload = (await response.json()) as ChatCompletionResponse
	if (!response.ok) {
		throw new Error(
			`LLM chat completion failed (${response.status}): ${payload.error?.message ?? JSON.stringify(payload)}`,
		)
	}

	const choice = payload.choices?.[0]
	if (!choice?.message) {
		throw new Error(
			`Missing chat completion message: ${JSON.stringify(payload)}`,
		)
	}

	return {
		content: choice.message.content ?? null,
		toolCalls: choice.message.tool_calls ?? [],
	}
}

async function executeToolCall(toolCall: ToolCall): Promise<unknown> {
	const rawArgs = toolCall.function.arguments?.trim() || "{}"
	const args = JSON.parse(rawArgs) as Record<string, unknown>

	switch (toolCall.function.name) {
		case "mdbrain_write_event":
			return mdbrain.writeEvent({
				idempotencyKey: toolCall.id,
				role: String(args.role ?? "user") as
					| "user"
					| "assistant"
					| "system"
					| "tool",
				body: String(args.body ?? ""),
				agentId,
				sessionId,
			})
		case "mdbrain_search_detailed": {
			const response = await mdbrain.searchDetailed({
				query: String(args.query ?? ""),
				agentId,
				limit:
					typeof args.limit === "number" && Number.isFinite(args.limit)
						? args.limit
						: 4,
				searchMode: "agentic",
				returnPlan: true,
			})
			return {
				metadata: {
					mode: response.metadata.mode,
					pathsExecuted: response.metadata.pathsExecuted,
					evidenceCoverage: response.metadata.evidenceCoverage,
				},
				results: response.results.slice(0, 4).map((result) => ({
					path: result.path,
					score: result.score,
					source: result.source,
					snippet: result.snippet,
				})),
			}
		}
		case "mdbrain_hydrate_active_slate":
			return mdbrain.hydrateActiveSlate({
				agentId,
				scope: "agent",
				scopeRef: agentScopeRef,
				maxItems:
					typeof args.maxItems === "number" && Number.isFinite(args.maxItems)
						? args.maxItems
						: 4,
			})
		case "mdbrain_build_discovery_projection":
			return mdbrain.buildDiscoveryProjection({
				agentId,
				kind: String(args.kind ?? "topic-brief") as
					| "entity-brief"
					| "topic-brief"
					| "what-changed"
					| "contradiction-report",
				query:
					typeof args.query === "string" && args.query.trim().length > 0
						? args.query
						: undefined,
				scope: "agent",
				scopeRef: agentScopeRef,
				maxItems:
					typeof args.maxItems === "number" && Number.isFinite(args.maxItems)
						? args.maxItems
						: 4,
			})
		case "mdbrain_build_context_bundle": {
			const requestedTokenBudget =
				typeof args.tokenBudget === "number" &&
				Number.isFinite(args.tokenBudget)
					? args.tokenBudget
					: 520

			return mdbrain.buildContextBundle({
				agentId,
				query:
					typeof args.query === "string" && args.query.trim().length > 0
						? args.query
						: undefined,
				scope: "agent",
				scopeRef: agentScopeRef,
				sessionId,
				tokenBudget: Math.max(520, Math.min(requestedTokenBudget, 600)),
				includeDiscoveryProjection:
					typeof args.includeDiscoveryProjection === "boolean"
						? args.includeDiscoveryProjection
						: true,
				discoveryKind:
					typeof args.discoveryKind === "string"
						? (args.discoveryKind as
								| "entity-brief"
								| "topic-brief"
								| "what-changed"
								| "contradiction-report")
						: "topic-brief",
			})
		}
		default:
			throw new Error(`Unsupported tool call: ${toolCall.function.name}`)
	}
}

async function runAgentTurn(userPrompt: string): Promise<{
	answer: string
	toolCount: number
	toolsUsed: string[]
}> {
	const messages: ChatMessage[] = [
		{
			role: "system",
			content: [
				"You are a real Mdbrain smoke-test agent.",
				"Always persist the user's message with mdbrain_write_event before answering.",
				"When asked to recall prior facts, call mdbrain_search_detailed before answering.",
				"When asked about current state, blockers, or active work, call mdbrain_hydrate_active_slate before answering.",
				"When asked about changes or contradictions, call mdbrain_build_discovery_projection before answering.",
				"When asked for a handoff brief or prompt-ready context, call mdbrain_build_context_bundle before answering.",
				"Persist your final answer with mdbrain_write_event before you return it.",
				"Do not guess if memory evidence is missing.",
			].join(" "),
		},
		{
			role: "user",
			content: userPrompt,
		},
	]

	let toolCount = 0
	const toolsUsed: string[] = []
	for (let step = 0; step < 8; step += 1) {
		const completion = await callModel(messages)
		if (completion.toolCalls.length === 0) {
			const answer = completion.content?.trim()
			if (!answer) {
				throw new Error("Model returned neither tool calls nor final content.")
			}
			return { answer, toolCount, toolsUsed }
		}

		messages.push({
			role: "assistant",
			content: completion.content ?? null,
			tool_calls: completion.toolCalls,
		})

		for (const toolCall of completion.toolCalls) {
			toolCount += 1
			toolsUsed.push(toolCall.function.name)
			const result = await executeToolCall(toolCall)
			messages.push({
				role: "tool",
				tool_call_id: toolCall.id,
				content: JSON.stringify(result),
			})
		}
	}

	throw new Error("Agent exceeded tool-call loop budget.")
}

async function main() {
	emitRunStep({
		step: "start",
		mdbrainApiUrl,
		llmBaseUrl: configuredLlmBaseUrl,
		model: configuredLlmModel,
		agentId,
		sessionId,
	})

	const readinessResponse = await fetch(
		`${mdbrainApiUrl.replace(/\/$/, "")}/ready`,
	)
	const readiness = await readinessResponse.json()
	if (!readinessResponse.ok) {
		throw new Error(
			`Mdbrain readiness check failed (${readinessResponse.status}): ${JSON.stringify(readiness)}`,
		)
	}
	emitRunStep({ step: "mdbrain-readiness", readiness })

	await mdbrain.writeStructured({
		agentId,
		entry: {
			type: "decision",
			key: "phoenix-release-window",
			value: "Phoenix deploys on Friday afternoon.",
			source: "agent",
			scope: "agent",
			sessionId,
			agentId,
			salience: "critical",
			state: "active",
			tags: ["phoenix", "release"],
		},
	})
	await mdbrain.writeStructured({
		agentId,
		entry: {
			type: "decision",
			key: "phoenix-release-window",
			value: "Phoenix deploys on Monday afternoon after validation.",
			source: "agent",
			scope: "agent",
			sessionId,
			agentId,
			salience: "critical",
			state: "active",
			tags: ["phoenix", "release"],
		},
	})
	await mdbrain.writeStructured({
		agentId,
		entry: {
			type: "project",
			key: "phoenix-current-blocker",
			value: "Atlas Local preview validation is blocking Phoenix launch.",
			source: "agent",
			scope: "agent",
			sessionId,
			agentId,
			salience: "critical",
			state: "active",
			tags: ["phoenix", "blocker"],
		},
	})
	await mdbrain.writeStructured({
		agentId,
		entry: {
			type: "fact",
			key: "phoenix-approval-policy",
			value: "Phoenix requires only Marcus approval.",
			source: "agent",
			scope: "agent",
			sessionId,
			agentId,
			salience: "high",
			state: "conflicted",
			tags: ["phoenix", "approval"],
		},
	})
	await mdbrain.writeProcedure({
		agentId,
		entry: {
			procedureId: "phoenix-rollback",
			name: "Phoenix rollback runbook",
			intentTags: ["phoenix", "rollback"],
			steps: [
				"Check health dashboards",
				"Roll back the deployment",
				"Notify the release channel",
			],
			scope: "agent",
			sessionId,
			agentId,
		},
	})
	await mdbrain.writeProcedure({
		agentId,
		entry: {
			procedureId: "phoenix-rollback",
			name: "Phoenix rollback runbook",
			intentTags: ["phoenix", "rollback"],
			steps: [
				"Check health dashboards",
				"Run proof-pack and capability stress",
				"Roll back the deployment",
				"Notify the release channel",
			],
			scope: "agent",
			sessionId,
			agentId,
		},
	})
	await mdbrain.writeProcedure({
		agentId,
		entry: {
			procedureId: "phoenix-contingency",
			name: "Phoenix contingency escalation",
			intentTags: ["phoenix", "contingency"],
			steps: ["Page Marcus only", "Skip proof lanes"],
			scope: "agent",
			sessionId,
			agentId,
			state: "conflicted",
		},
	})
	emitRunStep({ step: "seeded-durable-state", scopeRef: agentScopeRef })

	const turn1 = await runAgentTurn(
		`Please remember this exactly for later recall: the launch codeword is ${marker}. Confirm that you stored it in memory.`,
	)
	emitRunStep({ step: "turn-1", ...turn1 })

	const turn2 = await runAgentTurn(
		"What is the launch codeword from earlier in this conversation? Use memory tools before answering.",
	)
	emitRunStep({ step: "turn-2", ...turn2 })

	if (!turn2.answer.includes(marker)) {
		throw new Error(
			`Recall failed. Expected final answer to include marker "${marker}", got: ${turn2.answer}`,
		)
	}
	if (!turn2.toolsUsed.includes("mdbrain_search_detailed")) {
		throw new Error("Recall turn did not use mdbrain_search_detailed.")
	}

	const turn3 = await runAgentTurn(
		"What is my current Phoenix state right now? Use the active memory tools before answering.",
	)
	emitRunStep({ step: "turn-3", ...turn3 })
	if (
		!turn3.answer.includes("Monday") ||
		!turn3.answer.includes("Atlas Local preview validation")
	) {
		throw new Error(`Active-state recall failed. Got: ${turn3.answer}`)
	}
	if (!turn3.toolsUsed.includes("mdbrain_hydrate_active_slate")) {
		throw new Error(
			"Current-state turn did not use mdbrain_hydrate_active_slate.",
		)
	}

	const turn4 = await runAgentTurn(
		"What changed for Phoenix recently? Use the projection tools before answering.",
	)
	emitRunStep({ step: "turn-4", ...turn4 })
	if (
		!turn4.answer.includes("Monday") ||
		!turn4.answer.includes("proof-pack")
	) {
		throw new Error(`What-changed summary failed. Got: ${turn4.answer}`)
	}
	if (!turn4.toolsUsed.includes("mdbrain_build_discovery_projection")) {
		throw new Error(
			"What-changed turn did not use mdbrain_build_discovery_projection.",
		)
	}

	const turn5 = await runAgentTurn(
		"Are there any Phoenix contradictions I should watch? Use projection tools before answering.",
	)
	emitRunStep({ step: "turn-5", ...turn5 })
	if (
		!turn5.answer.toLowerCase().includes("contrad") &&
		!turn5.answer.includes("Marcus approval") &&
		!turn5.answer.includes("Skip proof lanes")
	) {
		throw new Error(`Contradiction summary failed. Got: ${turn5.answer}`)
	}
	if (!turn5.toolsUsed.includes("mdbrain_build_discovery_projection")) {
		throw new Error(
			"Contradiction turn did not use mdbrain_build_discovery_projection.",
		)
	}

	const turn6 = await runAgentTurn(
		"Give me a 250-token Phoenix handoff brief with the current blocker, latest release window, and any contradictions. Use the context bundle tool before answering.",
	)
	emitRunStep({ step: "turn-6", ...turn6 })
	if (
		!turn6.answer.includes("Monday") ||
		!turn6.answer.includes("Atlas Local preview validation") ||
		(!turn6.answer.toLowerCase().includes("contrad") &&
			!turn6.answer.includes("Marcus approval") &&
			!turn6.answer.includes("Skip proof lanes"))
	) {
		throw new Error(`Context-bundle handoff failed. Got: ${turn6.answer}`)
	}
	if (!turn6.toolsUsed.includes("mdbrain_build_context_bundle")) {
		throw new Error("Handoff turn did not use mdbrain_build_context_bundle.")
	}

	const directSearch = await mdbrain.searchDetailed({
		query: marker,
		agentId,
		limit: 4,
		searchMode: "agentic",
		returnPlan: true,
	})
	emitRunStep({
		step: "direct-search",
		metadata: {
			mode: directSearch.metadata.mode,
			pathsExecuted: directSearch.metadata.pathsExecuted,
			evidenceCoverage: directSearch.metadata.evidenceCoverage,
		},
		results: directSearch.results.slice(0, 4).map((result) => ({
			path: result.path,
			score: result.score,
			source: result.source,
			snippet: result.snippet,
		})),
	})

	const report = {
		ok: true,
		agentId,
		sessionId,
		marker,
		steps: runLog,
	}
	const artifactPath = await writeProofArtifact({
		suite: "real-agent-smoke",
		payload: report,
	})
	emitRunStep({
		step: "success",
		agentId,
		sessionId,
		marker,
		artifactPath: artifactPath ?? undefined,
	})
}

await main()
