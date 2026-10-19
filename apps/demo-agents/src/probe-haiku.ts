// Probe: the demo model answers through the AI SDK Anthropic provider and makes
// one tool call. Usage: bun run probe -- <secrets file>
import { readFileSync } from "node:fs"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText, stepCountIs, tool } from "ai"
import { z } from "zod"

const DEMO_MODEL = "claude-haiku-5-5"

const secrets = readFileSync(process.argv[2] ?? "", "utf8")
const read = (key: string) =>
	new RegExp(`^${key}=(.+)$`, "m").exec(secrets)?.[1]?.trim()
const model = read("DEMO_AGENT_MODEL")
if (model !== DEMO_MODEL)
	throw new Error(`demo agents run on ${DEMO_MODEL} only`)
const anthropic = createAnthropic({ apiKey: read("ANTHROPIC_API_KEY") })

const calls: unknown[] = []
const started = Date.now()
const result = await generateText({
	model: anthropic(DEMO_MODEL),
	maxOutputTokens: 300,
	stopWhen: stepCountIs(3),
	tools: {
		lookupAccount: tool({
			description: "Look up a customer account's renewal status by name",
			inputSchema: z.object({ name: z.string() }),
			execute: async ({ name }) => {
				calls.push({ name })
				return {
					name,
					renewal: "at risk",
					reason: "fleet telemetry rollout slipped six weeks",
				}
			},
		}),
	},
	prompt:
		"Use the lookupAccount tool for Halvorsen Logistics, then answer in one sentence: is the renewal safe?",
})

console.log(
	JSON.stringify(
		{
			model: result.response.modelId,
			steps: result.steps.length,
			toolCalls: result.steps.flatMap((s) =>
				s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
			),
			executed: calls,
			text: result.text,
			usage: result.totalUsage,
			finishReason: result.finishReason,
			ms: Date.now() - started,
		},
		null,
		2,
	),
)
