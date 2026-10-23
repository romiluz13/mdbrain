// Regression for the live failure of 2026-10-23: at the documented 8,000-token
// context, 19 of 20 visitor questions were refused "limits" because the cap
// counted bytes. This replays one live question's shape through the route's
// own model wiring over fake HTTP: a search result and a page read at the
// tool-result cap, then an answer, with each step counted at the input
// tokens the live steps billed (1,153, 2,314 and 2,820).
import type { BudgetUsage, ModelBudget } from "@mdbrain/lib/budget"
import { describe, expect, it } from "vitest"
import { createAnswerService } from "./answer-service.js"
import { answerModel } from "./answer-token-cap.js"
import type { AnswerLimits } from "./answer-types.js"
import type { DemoReads } from "./reads.js"

const LIVE_STEP_INPUT_TOKENS = [1_153, 2_314, 2_820]
const QUESTION = "Is the Halvorsen renewal safe?"

function wire(http: typeof fetch) {
	return answerModel("test-key", { modelId: "claude-haiku-5-5", fetch: http })
}

function page(n: number) {
	return {
		_id: `page:p${n}`,
		kind: "entity",
		title: `Page ${n}`,
		slug: `p${n}`,
		aliases: [],
		summary: "s".repeat(300),
		body: "b".repeat(20_000),
		frontmatter: {},
		claims: Array.from({ length: 5 }, (_, c) => ({
			id: `c${c}`,
			text: "t".repeat(240),
			status: "active",
			confidence: 0.8,
			evidence: [],
			derivedFrom: [],
		})),
		contradictions: [],
		questions: [],
		relationships: [],
		personCard: null,
		scope: "workspace",
		scopeRef: "demo-run-12",
		trustTier: "standard",
		permissions: {},
		state: "active",
		revision: 1,
		validFrom: null,
		freshness: "fresh",
		transcludes: [],
		backlinks: [],
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
	}
}

const reads = {
	search: async () => ({
		results: [1, 2, 3, 4, 5].map((n) => ({
			page: page(n),
			score: 1,
			source: "text",
		})),
		total: 5,
		recipe: "text",
		mode: "text",
	}),
	wikiGet: async () => page(1),
} as unknown as DemoReads

const limits: AnswerLimits = {
	acquireLease: async () => true,
	releaseLease: async () => {},
	countQuestion: async () => 1,
}

function budget() {
	const settled: BudgetUsage[] = []
	const uncertain: string[] = []
	const value: ModelBudget = {
		reserve: async () => `r${settled.length + uncertain.length + 1}`,
		settle: async (_id, usage) => {
			settled.push(usage)
		},
		markUncertain: async (id) => {
			uncertain.push(id)
		},
		read: async () => null,
	}
	return { value, settled, uncertain }
}

function liveShapedHttp() {
	const sent: Array<{ path: string; bytes: number }> = []
	let step = 0
	const usageFor = (n: number) => ({
		input_tokens: LIVE_STEP_INPUT_TOKENS[n] ?? 0,
		output_tokens: 80,
	})
	const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input))
		sent.push({ path: url.pathname, bytes: String(init?.body ?? "").length })
		if (url.pathname.endsWith("/count_tokens")) {
			return Response.json({ input_tokens: LIVE_STEP_INPUT_TOKENS[step] })
		}
		const n = step++
		const message = (content: unknown[], stop: string) =>
			Response.json({
				type: "message",
				id: `msg_${n}`,
				role: "assistant",
				model: "claude-haiku-5-5",
				content,
				stop_reason: stop,
				stop_sequence: null,
				usage: usageFor(n),
			})
		if (n === 0) {
			return message(
				[
					{
						type: "tool_use",
						id: "toolu_0",
						name: "search_brain",
						input: { query: QUESTION },
					},
				],
				"tool_use",
			)
		}
		if (n === 1) {
			return message(
				[
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_page",
						input: { slug: "p1" },
					},
				],
				"tool_use",
			)
		}
		return message(
			[{ type: "text", text: "The stored pages do not settle it." }],
			"end_turn",
		)
	}) as typeof fetch
	return { http, sent }
}

describe("the documented 8,000-token context (live regression)", () => {
	it("answers a question whose steps bill as the live ones did, though the last step's bytes pass 8,000", async () => {
		const { http, sent } = liveShapedHttp()
		const spend = budget()
		const service = createAnswerService({
			reads,
			limits,
			budget: spend.value,
			...wire(http),
			ceiling: 500_000,
			agentId: "demo-run-12",
		})
		const outcome = await service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
		})
		expect(outcome).toEqual({
			state: "answered",
			text: "The stored pages do not settle it.",
			citations: [],
		})
		const messages = sent.filter((s) => s.path === "/v1/messages")
		expect(messages).toHaveLength(3)
		expect(messages[2]?.bytes).toBeGreaterThan(8_000)
		expect(spend.settled.map((u) => u.uncachedInput)).toEqual(
			LIVE_STEP_INPUT_TOKENS,
		)
		expect(spend.uncertain).toEqual([])
	})
})
