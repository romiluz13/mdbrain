/** Task 336: the runner's request body, proved through the installed SDK.
 * Drives the real runRoleAgents call with an Anthropic model whose fetch is
 * mocked (no network, no key, no model call), so the exact request body the
 * runner produces can be asserted: each role's tools end in one cache
 * breakpoint, and nothing else in the request asks for caching. The model is
 * wrapped in the real budgetMiddleware, so a body is only captured after the
 * budget guard has accepted the call's params. */
import { describe, expect, it } from "vitest"
import { createAnthropic } from "@ai-sdk/anthropic"
import { wrapLanguageModel } from "ai"
import { AGENT_MAX_INPUT_TOKENS, runRoleAgents } from "./runner.js"
import { budgetMiddleware } from "@mdbrain/lib/budget"
import { DEMO_MODEL } from "../corpus/render-config.js"
import type { AgentRole } from "./config.js"
import { FakeCollection } from "../seeding/testing/fakes.js"
import { createRunManifests, type RunManifestDoc } from "../seeding/manifest.js"
import { fakeAgentClients, fakeModelBudget } from "./testing/fakes.js"
import {
	REPLAY_SOURCE_IDS,
	RISK_SLUG,
	makeDemoRecords,
	makeDemoWorld,
} from "./testing/demo-world.js"

const SLOT = { index: 1, scopeRef: "demo-run-1", agentId: "demo-run-1" }
const RUN_ID = "run-1"
const CEILING = 1_000_000

type Body = {
	tools?: Array<Record<string, unknown>>
	[key: string]: unknown
}

/** One captured request body per model call. The mock answers every request
 * with a plain end-turn text response, so each role finishes in a single
 * step and the run completes without any tool call. */
function mockAnthropicModel() {
	const bodies: Body[] = []
	const mockFetch = (async (_url: unknown, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body ?? "{}")) as Body)
		return new Response(
			JSON.stringify({
				id: "msg_mock",
				type: "message",
				role: "assistant",
				model: DEMO_MODEL,
				content: [{ type: "text", text: "ok" }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 100, output_tokens: 10 },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		)
	}) as typeof fetch
	const model = createAnthropic({
		apiKey: "dummy-mock-key",
		fetch: mockFetch,
	})(DEMO_MODEL)
	return { bodies, model }
}

describe("runRoleAgents request body (prompt cache)", () => {
	it("carries exactly one cache_control, on the last tool for each role, past the budget guard", async () => {
		const collection = new FakeCollection<RunManifestDoc>([])
		const manifests = createRunManifests(collection)
		await manifests.createRun({
			runId: RUN_ID,
			slotIndex: SLOT.index,
			scopeRef: SLOT.scopeRef,
			agentId: SLOT.agentId,
			corpus: {
				sha256: "abc123",
				records: 8,
				eventsPlanned: 8,
				pagesPlanned: 1,
				replaySourceIds: [...REPLAY_SOURCE_IDS],
			},
			limitSources: undefined,
		})
		await manifests.markReady(RUN_ID)
		const { bodies, model: providerModel } = mockAnthropicModel()
		const { budget } = fakeModelBudget({ ceiling: CEILING })
		// The real guard wraps the provider call: a request whose params it
		// cannot bound is refused before any body is sent, so a captured
		// body is proof the budget guard accepted that call.
		const model = wrapLanguageModel({
			model: providerModel,
			middleware: budgetMiddleware({
				budget,
				key: `agents:${RUN_ID}`,
				ceiling: CEILING,
				maxInputTokens: AGENT_MAX_INPUT_TOKENS,
			}),
		})
		// The mock model never calls a tool, so the risk page the account
		// role must read in staging is pre-seeded into the fake client.
		const clients = fakeAgentClients({
			pinnedAgentId: SLOT.agentId,
			pages: { [RISK_SLUG]: { slug: RISK_SLUG } },
		})
		const used: number[] = []
		const outcome = await runRoleAgents({
			manifests,
			pool: {
				markUsed: async (index: number) => {
					used.push(index)
					return { index }
				},
			},
			runId: RUN_ID,
			slot: SLOT,
			clients: clients.clients,
			modelFor: (_role: AgentRole) => model,
			budget,
			ceilings: { steps: 8, taskDeadlineMs: 5000, tokens: CEILING },
			world: makeDemoWorld(),
			records: makeDemoRecords(),
		})
		// The guard accepted every call: a refusal fails the run instead.
		expect(outcome.state).toBe("complete")
		expect(outcome.failureReason).toBeUndefined()
		expect(used).toEqual([SLOT.index])
		expect(bodies).toHaveLength(3)
		const roles: AgentRole[] = ["support", "account", "product"]
		for (const [i, role] of roles.entries()) {
			const body = bodies[i]!
			const occurrences = (JSON.stringify(body).match(/cache_control/g) ?? [])
				.length
			const tools = (body.tools ?? []) as Array<Record<string, unknown>>
			expect(tools.length, `${role}: the role keeps its tool set`).toBe(8)
			expect(
				occurrences,
				`${role}: exactly one cache_control in the request body`,
			).toBe(1)
			expect(
				tools.at(-1)?.cache_control,
				`${role}: the breakpoint sits on the last tool`,
			).toEqual({ type: "ephemeral" })
			expect(
				tools.slice(0, -1).every((tool) => !("cache_control" in tool)),
				`${role}: no other tool carries a breakpoint`,
			).toBe(true)
			expect(
				"cache_control" in body,
				`${role}: no request-level cache_control`,
			).toBe(false)
		}
	})
})
