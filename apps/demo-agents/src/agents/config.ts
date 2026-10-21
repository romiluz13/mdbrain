/** Ticket-10 role roster and operator ceilings for the agent runner.
 * The ceilings mirror ticket-07: 8 steps per task, 90 seconds per task and
 * 150k tokens per run. Operators override them through the environment;
 * invalid values fall back to the defaults instead of failing the run. */
export const AGENT_ROLES = ["support", "account", "product"] as const

export type AgentRole = (typeof AGENT_ROLES)[number]

export const ROLE_LABELS: Record<AgentRole, string> = {
	support: "Support Lead",
	account: "Account Manager",
	product: "Product Lead",
}

export type AgentCeilings = {
	steps: number
	taskDeadlineMs: number
	tokens: number
}

export const DEFAULT_AGENT_CEILINGS: AgentCeilings = {
	steps: 8,
	taskDeadlineMs: 90_000,
	tokens: 150_000,
}

function positiveInt(raw: string | undefined): number | undefined {
	const value = raw?.trim() ?? ""
	if (!/^[1-9]\d*$/.test(value)) return undefined
	return Number(value)
}

export function agentCeilings(
	env: Record<string, string | undefined>,
): AgentCeilings {
	return {
		steps: positiveInt(env.DEMO_AGENT_STEPS) ?? DEFAULT_AGENT_CEILINGS.steps,
		taskDeadlineMs:
			positiveInt(env.DEMO_AGENT_TASK_DEADLINE_MS) ??
			DEFAULT_AGENT_CEILINGS.taskDeadlineMs,
		tokens: positiveInt(env.DEMO_AGENT_TOKENS) ?? DEFAULT_AGENT_CEILINGS.tokens,
	}
}
