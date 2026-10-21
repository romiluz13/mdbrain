// The public projection of the pinned run's manifest. The manifest is a
// private index kept in the demo control database; the web server reads it and
// answers with this shape. It carries no run id, scope, agent, corpus digest or
// replay list, and never the text of a failure: a stopped run gets a fixed
// label instead. The browser verifies every value here against the API.

export type RunState = "seeding" | "ready" | "used" | "failed"
export type AgentRoleId = "support" | "account" | "product"

export const AGENT_ROLE_IDS: readonly AgentRoleId[] = [
	"support",
	"account",
	"product",
]

/** The labels the step recorder writes into each event body
 * (apps/demo-agents/src/agents/config.ts); a test holds them equal. */
export const AGENT_ROLE_LABELS: Record<AgentRoleId, string> = {
	support: "Support Lead",
	account: "Account Manager",
	product: "Product Lead",
}

/** One source the run wrote, in the order it was written. `sourceId` is the
 * corpus's own id; `eventId` is the id the API returned for the write. */
export type RunArrival = { sourceId: string; eventId: string }

export type AgentStep = {
	n: number
	role: AgentRoleId
	name: string
	detail?: string
	eventId: string
}

export type AgentRunUsage = {
	uncachedInput: number
	cacheRead: number
	cacheWrite: number
	output: number
}

export type AgentRunRecord = {
	state: "running" | "complete" | "incomplete"
	startedAt: string
	endedAt?: string
	usage?: AgentRunUsage
	stepsRecorded?: number
	reusedPage?: { slug: string; writtenBy: AgentRoleId; readBy: AgentRoleId }
	pendingProposal?: { title: string; slug: string }
	/** Absent on a run that finished before steps were indexed. */
	steps?: AgentStep[]
	/** Set when the run stopped early; never the stored reason. */
	incompleteLabel?: string
}

export type RunRecord = {
	state: RunState
	createdAt: string
	readyAt?: string
	usedAt?: string
	failedAt?: string
	eventsPlanned: number
	pagesPlanned: number
	arrivals: RunArrival[]
	pagesWritten: string[]
	/** Set when seeding stopped; never the stored reason. */
	failedLabel?: string
	agentRun?: AgentRunRecord
}

export const INCOMPLETE_LABEL = "The agent run stopped before it finished."
export const FAILED_LABEL = "Seeding stopped before the run was ready."

export type RunRecordRefusal = "RUN_RECORD_MISMATCH" | "RUN_RECORD_MALFORMED"

export type RunProjection =
	| { ok: true; record: RunRecord }
	| { ok: false; code: RunRecordRefusal }

export const RUN_STATES: readonly string[] = [
	"seeding",
	"ready",
	"used",
	"failed",
]
export const AGENT_RUN_STATES: readonly string[] = [
	"running",
	"complete",
	"incomplete",
]

type Doc = Record<string, unknown>

const isDoc = (value: unknown): value is Doc =>
	typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined
const count = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined
const roleOf = (value: unknown): AgentRoleId | undefined =>
	AGENT_ROLE_IDS.find((role) => role === value)

function usageOf(value: unknown): AgentRunUsage | undefined {
	if (!isDoc(value)) {
		return undefined
	}
	const uncachedInput = count(value.uncachedInput)
	const cacheRead = count(value.cacheRead)
	const cacheWrite = count(value.cacheWrite)
	const output = count(value.output)
	return uncachedInput === undefined ||
		cacheRead === undefined ||
		cacheWrite === undefined ||
		output === undefined
		? undefined
		: { uncachedInput, cacheRead, cacheWrite, output }
}

function stepsOf(value: unknown): AgentStep[] | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}
	const steps: AgentStep[] = []
	for (const item of value) {
		if (!isDoc(item)) {
			continue
		}
		const role = roleOf(item.role)
		const n = count(item.n)
		const name = text(item.name)
		const eventId = text(item.eventId)
		if (role === undefined || n === undefined || !name || !eventId) {
			continue
		}
		const detail = text(item.detail)
		steps.push({
			n,
			role,
			name,
			...(detail !== undefined ? { detail } : {}),
			eventId,
		})
	}
	return steps
}

function agentRunOf(value: unknown): AgentRunRecord | undefined {
	if (!isDoc(value)) {
		return undefined
	}
	const state = text(value.state)
	const startedAt = text(value.startedAt)
	if (!state || !AGENT_RUN_STATES.includes(state) || !startedAt) {
		return undefined
	}
	const endedAt = text(value.endedAt)
	const usage = usageOf(value.usage)
	const stepsRecorded = count(value.stepsRecorded)
	const steps = stepsOf(value.steps)
	const page = isDoc(value.reusedPage) ? value.reusedPage : undefined
	const writtenBy = roleOf(page?.writtenBy)
	const readBy = roleOf(page?.readBy)
	const pageSlug = text(page?.slug)
	const proposal = isDoc(value.pendingProposal)
		? value.pendingProposal
		: undefined
	const proposalSlug = text(proposal?.slug)
	const proposalTitle = text(proposal?.title)
	return {
		state: state as AgentRunRecord["state"],
		startedAt,
		...(endedAt !== undefined ? { endedAt } : {}),
		...(usage !== undefined ? { usage } : {}),
		...(stepsRecorded !== undefined ? { stepsRecorded } : {}),
		...(pageSlug && writtenBy && readBy
			? { reusedPage: { slug: pageSlug, writtenBy, readBy } }
			: {}),
		...(proposalSlug && proposalTitle
			? { pendingProposal: { title: proposalTitle, slug: proposalSlug } }
			: {}),
		...(steps !== undefined ? { steps } : {}),
		...(state === "incomplete" ? { incompleteLabel: INCOMPLETE_LABEL } : {}),
	}
}

function arrivalsOf(value: unknown): RunArrival[] | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}
	const arrivals: RunArrival[] = []
	for (const item of value) {
		if (!isDoc(item)) {
			continue
		}
		const sourceId = text(item.sourceId)
		const eventId = text(item.eventId)
		if (sourceId && eventId) {
			arrivals.push({ sourceId, eventId })
		}
	}
	return arrivals
}

/** Turns the stored manifest into the public record, or refuses it. A manifest
 * that does not belong to the pinned scope and agent is refused whole. */
export function projectRunRecord(
	doc: unknown,
	pinned: { scopeRef: string; agentId: string },
): RunProjection {
	if (!isDoc(doc)) {
		return { ok: false, code: "RUN_RECORD_MALFORMED" }
	}
	const state = text(doc.state)
	const createdAt = text(doc.createdAt)
	const arrivals = arrivalsOf(doc.eventsWritten)
	const corpus = isDoc(doc.corpus) ? doc.corpus : undefined
	const eventsPlanned = count(corpus?.eventsPlanned)
	const pagesPlanned = count(corpus?.pagesPlanned)
	if (
		!state ||
		!RUN_STATES.includes(state) ||
		!createdAt ||
		arrivals === undefined ||
		eventsPlanned === undefined ||
		pagesPlanned === undefined ||
		!Array.isArray(doc.pagesWritten)
	) {
		return { ok: false, code: "RUN_RECORD_MALFORMED" }
	}
	if (doc.scopeRef !== pinned.scopeRef || doc.agentId !== pinned.agentId) {
		return { ok: false, code: "RUN_RECORD_MISMATCH" }
	}
	const readyAt = text(doc.readyAt)
	const usedAt = text(doc.usedAt)
	const failedAt = text(doc.failedAt)
	const agentRun = agentRunOf(doc.agentRun)
	return {
		ok: true,
		record: {
			state: state as RunState,
			createdAt,
			...(readyAt !== undefined ? { readyAt } : {}),
			...(usedAt !== undefined ? { usedAt } : {}),
			...(failedAt !== undefined ? { failedAt } : {}),
			eventsPlanned,
			pagesPlanned,
			arrivals,
			pagesWritten: doc.pagesWritten.filter(
				(slug): slug is string => typeof slug === "string",
			),
			...(state === "failed" ? { failedLabel: FAILED_LABEL } : {}),
			...(agentRun !== undefined ? { agentRun } : {}),
		},
	}
}
