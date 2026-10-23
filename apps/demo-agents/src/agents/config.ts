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

/** The runner's waits that sit outside a task: the staging poll for the page
 * the support role wrote, and the final confirm of the step events. They match
 * DEFAULT_STAGING_DEADLINE_MS and CONFIRM_DEADLINE_MS in ./runner.ts. */
export const STAGING_ALLOWANCE_MS = 5_000
export const CONFIRM_ALLOWANCE_MS = 60_000

/** How long a whole run may take before it counts as stopped: three tasks at
 * their deadline plus the two waits. The web projection reads the same number
 * from its own env (MDBRAIN_DEMO_RUN_DEADLINE_MS); a test holds the defaults
 * equal. */
export function agentRunDeadlineMs(
	env: Record<string, string | undefined>,
): number {
	return (
		positiveInt(env.DEMO_AGENT_RUN_DEADLINE_MS) ??
		AGENT_ROLES.length * agentCeilings(env).taskDeadlineMs +
			STAGING_ALLOWANCE_MS +
			CONFIRM_ALLOWANCE_MS
	)
}
