import { describe, expect, it } from "vitest"
import { AGENT_ROLES, ROLE_LABELS, agentCeilings } from "./config.js"

describe("agentCeilings", () => {
	it("defaults to the ticket-07 ceilings: 8 steps, 90s per task, 150k tokens", () => {
		expect(agentCeilings({})).toEqual({
			steps: 8,
			taskDeadlineMs: 90_000,
			tokens: 150_000,
		})
	})

	it("honors operator overrides and falls back to defaults on invalid values", () => {
		expect(
			agentCeilings({
				DEMO_AGENT_STEPS: "3",
				DEMO_AGENT_TASK_DEADLINE_MS: "1234",
				DEMO_AGENT_TOKENS: "2000",
			}),
		).toEqual({ steps: 3, taskDeadlineMs: 1234, tokens: 2000 })
		expect(agentCeilings({ DEMO_AGENT_STEPS: "0" }).steps).toBe(8)
		expect(agentCeilings({ DEMO_AGENT_STEPS: "x" }).steps).toBe(8)
		expect(
			agentCeilings({ DEMO_AGENT_TASK_DEADLINE_MS: "-1" }).taskDeadlineMs,
		).toBe(90_000)
	})
})

describe("agent roles", () => {
	it("names exactly the three demo roles with their labels", () => {
		expect(AGENT_ROLES).toEqual(["support", "account", "product"])
		expect(ROLE_LABELS).toEqual({
			support: "Support Lead",
			account: "Account Manager",
			product: "Product Lead",
		})
	})
})
