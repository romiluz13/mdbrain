// The agents-at-work chapter's data: what the run's record says its three role
// agents did, and the reads that check the parts the API can answer. The record
// is the run's own account; a wiki read says whether the page it names is
// stored, and whether the proposal it left pending is still absent.

import { MdbrainClientError } from "@mdbrain/client"
import { errorState, type DemoDataUpstream } from "./loaders.js"
import { readsFor } from "./reads.js"
import type { DataState } from "./states.js"
import {
	AGENT_ROLE_IDS,
	AGENT_ROLE_LABELS,
	type AgentRoleId,
	type AgentRunRecord,
	type AgentRunUsage,
	type AgentStep,
	type RunRecord,
} from "./run-record.js"

/** The ceiling the demo's agent run is held to (apps/demo-agents, the default
 * agent ceilings). The record does not store it. */
export const TOKEN_CEILING = 150_000

export type AgentStage =
	| "none"
	| "running"
	| "incomplete"
	| "complete"
	/** A finished run that predates step indexing. */
	| "complete-unindexed"

export function agentStage(record: RunRecord): AgentStage {
	const run = record.agentRun
	if (run === undefined) {
		return "none"
	}
	if (run.state !== "complete") {
		return run.state
	}
	return run.steps === undefined ? "complete-unindexed" : "complete"
}

/** The agent run as a state a screen can render: only a finished run is ready;
 * a run that has not started, is running, or stopped early says so, and shows
 * what it recorded. */
export function agentRunState(record: RunRecord): DataState<AgentRunRecord> {
	const run = record.agentRun
	if (run === undefined) {
		return { kind: "incomplete", reason: "AGENT_RUN_NOT_STARTED", state: null }
	}
	if (run.state === "running") {
		return {
			kind: "incomplete",
			reason: "AGENT_RUN_RUNNING",
			state: run.state,
			data: run,
		}
	}
	if (run.state === "incomplete") {
		return {
			kind: "incomplete",
			reason: "AGENT_RUN_INCOMPLETE",
			state: run.state,
			data: run,
		}
	}
	return { kind: "ready", data: run }
}

export const totalTokens = (usage: AgentRunUsage): number =>
	usage.uncachedInput + usage.cacheRead + usage.cacheWrite + usage.output

/** Start to end, or undefined while the run has not ended or its stamps do not
 * make a duration. */
export function wallTimeMs(run: AgentRunRecord): number | undefined {
	if (run.endedAt === undefined) {
		return undefined
	}
	const span = Date.parse(run.endedAt) - Date.parse(run.startedAt)
	return Number.isFinite(span) && span >= 0 ? span : undefined
}

export function formatWallTime(ms: number): string {
	const seconds = Math.round(ms / 1000)
	return seconds < 60
		? `${seconds} s`
		: `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export type RoleStory = {
	role: AgentRoleId
	label: string
	/** In step order; empty when the run's steps were not indexed. */
	steps: AgentStep[]
}

export function roleStories(run: AgentRunRecord): RoleStory[] {
	return AGENT_ROLE_IDS.map((role) => ({
		role,
		label: AGENT_ROLE_LABELS[role],
		steps: (run.steps ?? [])
			.filter((step) => step.role === role)
			.sort((a, b) => a.n - b.n),
	}))
}

export type PageCheck =
	| {
			kind: "stored"
			title: string
			revision: number
			state: string
			updatedAt: string
	  }
	| { kind: "absent" }
	| { kind: "unreadable"; code: string; message: string }

export type AgentRunChecks = {
	/** The page Support wrote and Account read. */
	reusedPage?: PageCheck
	/** The proposal Product left pending: absent from the wiki until approved. */
	proposal?: PageCheck
}

/** What a role card calls the page Support wrote: the title the wiki read
 * returned. Null while that read is out, so a slug is never shown for a moment
 * and then replaced; the slug stands in only when the wiki has no title to give. */
export function reusedPageName(
	run: AgentRunRecord,
	checks: AgentRunChecks | null,
): string | null {
	const slug = run.reusedPage?.slug
	const found = checks?.reusedPage
	if (slug === undefined || found === undefined) {
		return null
	}
	return found.kind === "stored" ? found.title : slug
}

async function checkPage(
	upstream: DemoDataUpstream,
	slug: string,
): Promise<PageCheck> {
	try {
		const page = await readsFor(upstream).wikiGet(slug)
		return {
			kind: "stored",
			title: page.title,
			revision: page.revision,
			state: page.state,
			updatedAt: page.updatedAt,
		}
	} catch (error) {
		if (error instanceof MdbrainClientError && error.status === 404) {
			return { kind: "absent" }
		}
		const failed = errorState(error, upstream.readKey)
		return failed.kind === "error"
			? { kind: "unreadable", code: failed.code, message: failed.message }
			: { kind: "unreadable", code: "UPSTREAM_ERROR", message: "read failed" }
	}
}

export async function loadAgentRunChecks(
	upstream: DemoDataUpstream,
	run: AgentRunRecord,
): Promise<AgentRunChecks> {
	const [reusedPage, proposal] = await Promise.all([
		run.reusedPage ? checkPage(upstream, run.reusedPage.slug) : undefined,
		run.pendingProposal
			? checkPage(upstream, run.pendingProposal.slug)
			: undefined,
	])
	return {
		...(reusedPage !== undefined ? { reusedPage } : {}),
		...(proposal !== undefined ? { proposal } : {}),
	}
}
