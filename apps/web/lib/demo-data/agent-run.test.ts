import { afterEach, describe, expect, it, vi } from "vitest"
import {
	TOKEN_CEILING,
	agentRunState,
	agentStage,
	formatWallTime,
	loadAgentRunChecks,
	reusedPageName,
	roleStories,
	totalTokens,
	wallTimeMs,
} from "./agent-run.js"
import type { AgentRunRecord, AgentStep } from "./run-record.js"
import { json, pageView, runRecord, stubUpstream } from "./test-upstream.js"

const proxy = {
	apiBaseUrl: "http://demo-proxy.local/api/demo",
	readKey: "loader-placeholder-key",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

const steps: AgentStep[] = [
	{ n: 2, role: "account", name: "read page", eventId: "evt-2" },
	{
		n: 1,
		role: "support",
		name: "write page",
		detail: "risk",
		eventId: "evt-1",
	},
	{ n: 3, role: "product", name: "propose", eventId: "evt-3" },
	{ n: 4, role: "support", name: "replay events", eventId: "evt-4" },
]

function agentRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
	return {
		state: "complete",
		startedAt: "2026-10-20T09:55:00.000Z",
		endedAt: "2026-10-20T09:59:12.000Z",
		usage: {
			uncachedInput: 40_000,
			cacheRead: 30_000,
			cacheWrite: 5_000,
			output: 6_000,
		},
		stepsRecorded: 4,
		reusedPage: {
			slug: "accounts/halvorsen-freight-group",
			writtenBy: "support",
			readBy: "account",
		},
		pendingProposal: {
			title: "Silent ETA drift",
			slug: "syntheses/silent-eta-drift",
		},
		steps,
		...overrides,
	}
}

describe("agentStage", () => {
	it("is none for a run that has not started its agents", () => {
		expect(agentStage(runRecord())).toBe("none")
	})

	it("is running while the agents work", () => {
		expect(
			agentStage(
				runRecord({
					agentRun: { state: "running", startedAt: "2026-10-20T09:55:00.000Z" },
				}),
			),
		).toBe("running")
	})

	it("is incomplete for a run that stopped early", () => {
		expect(
			agentStage(
				runRecord({
					agentRun: agentRun({ state: "incomplete", steps: undefined }),
				}),
			),
		).toBe("incomplete")
	})

	it("is complete when the steps were indexed", () => {
		expect(agentStage(runRecord({ agentRun: agentRun() }))).toBe("complete")
	})

	it("is complete-unindexed for a finished run that predates steps", () => {
		expect(
			agentStage(runRecord({ agentRun: agentRun({ steps: undefined }) })),
		).toBe("complete-unindexed")
	})
})

describe("agentRunState", () => {
	it("is not yet in this run before the agents start", () => {
		expect(agentRunState(runRecord())).toEqual({
			kind: "incomplete",
			reason: "AGENT_RUN_NOT_STARTED",
			state: null,
		})
	})

	it("shows a running run as incomplete, with what it has recorded", () => {
		const running = {
			state: "running",
			startedAt: "2026-10-20T09:55:00.000Z",
		} as const
		expect(agentRunState(runRecord({ agentRun: running }))).toEqual({
			kind: "incomplete",
			reason: "AGENT_RUN_RUNNING",
			state: "running",
			data: running,
		})
	})

	it("shows a run that stopped early as incomplete, with its fixed label", () => {
		const stopped = agentRun({
			state: "incomplete",
			incompleteLabel: "The agent run stopped before it finished.",
		})
		expect(agentRunState(runRecord({ agentRun: stopped }))).toMatchObject({
			kind: "incomplete",
			reason: "AGENT_RUN_INCOMPLETE",
			data: { incompleteLabel: "The agent run stopped before it finished." },
		})
	})

	it("is ready for a finished run, with or without indexed steps", () => {
		for (const run of [agentRun(), agentRun({ steps: undefined })]) {
			expect(agentRunState(runRecord({ agentRun: run }))).toEqual({
				kind: "ready",
				data: run,
			})
		}
	})
})

describe("tokens and wall time", () => {
	it("adds every kind of token against a ceiling of 150,000", () => {
		expect(TOKEN_CEILING).toBe(150_000)
		expect(
			totalTokens(
				agentRun().usage ?? {
					uncachedInput: 0,
					cacheRead: 0,
					cacheWrite: 0,
					output: 0,
				},
			),
		).toBe(81_000)
	})

	it("measures the wall time from start to end", () => {
		expect(wallTimeMs(agentRun())).toBe(252_000)
	})

	it("has no wall time for a run that has not ended", () => {
		expect(
			wallTimeMs({ state: "running", startedAt: "2026-10-20T09:55:00.000Z" }),
		).toBeUndefined()
	})

	it("has no wall time when the stamps disagree", () => {
		expect(
			wallTimeMs(agentRun({ endedAt: "2026-10-20T09:00:00.000Z" })),
		).toBeUndefined()
	})

	it.each([
		[48_000, "48 s"],
		[60_000, "1 min 0 s"],
		[252_000, "4 min 12 s"],
	])("writes %i ms as %s", (ms, text) => {
		expect(formatWallTime(ms)).toBe(text)
	})
})

describe("roleStories", () => {
	it("lists the three roles in hand-off order, each with its steps in step order", () => {
		const stories = roleStories(agentRun())
		expect(stories.map((story) => story.role)).toEqual([
			"support",
			"account",
			"product",
		])
		expect(stories[0]?.steps.map((step) => step.n)).toEqual([1, 4])
		expect(stories.map((story) => story.label)).toEqual([
			"Support Lead",
			"Account Manager",
			"Product Lead",
		])
	})

	it("still lists the three roles, with no steps, for a run that predates steps", () => {
		const stories = roleStories(agentRun({ steps: undefined }))
		expect(stories.map((story) => story.steps)).toEqual([[], [], []])
	})
})

describe("loadAgentRunChecks", () => {
	const PAGE = "/api/demo/v1/wiki/accounts%2Fhalvorsen-freight-group"
	const PROPOSAL = "/api/demo/v1/wiki/syntheses%2Fsilent-eta-drift"
	const missing = () =>
		json({ error: { code: "WIKI_PAGE_NOT_FOUND", message: "no page" } }, 404)

	it("verifies the reused page and its revision through a wiki read", async () => {
		stubUpstream({
			[PAGE]: () =>
				json(
					pageView({
						slug: "accounts/halvorsen-freight-group",
						title: "Halvorsen Freight Group",
						revision: 2,
						updatedAt: "2026-10-20T09:57:00.000Z",
					}),
				),
			[PROPOSAL]: missing,
		})
		const checks = await loadAgentRunChecks(proxy, agentRun())
		expect(checks.reusedPage).toEqual({
			kind: "stored",
			title: "Halvorsen Freight Group",
			revision: 2,
			state: "active",
			updatedAt: "2026-10-20T09:57:00.000Z",
		})
	})

	it("finds the pending proposal absent from the wiki, which is what pending means", async () => {
		stubUpstream({ [PAGE]: () => json(pageView()), [PROPOSAL]: missing })
		expect((await loadAgentRunChecks(proxy, agentRun())).proposal).toEqual({
			kind: "absent",
		})
	})

	it("reports a proposal that has since become a page", async () => {
		stubUpstream({
			[PAGE]: () => json(pageView()),
			[PROPOSAL]: () =>
				json(
					pageView({
						slug: "syntheses/silent-eta-drift",
						title: "Silent ETA drift",
						revision: 1,
					}),
				),
		})
		expect(
			(await loadAgentRunChecks(proxy, agentRun())).proposal,
		).toMatchObject({
			kind: "stored",
			title: "Silent ETA drift",
		})
	})

	it("reports a page that could not be read, with the code, instead of calling it absent", async () => {
		stubUpstream({
			[PAGE]: () =>
				json({ error: { code: "UPSTREAM_ERROR", message: "down" } }, 502),
			[PROPOSAL]: missing,
		})
		expect(
			(await loadAgentRunChecks(proxy, agentRun())).reusedPage,
		).toMatchObject({
			kind: "unreadable",
			code: "UPSTREAM_ERROR",
		})
	})

	it("reads nothing for a run with neither a reused page nor a proposal", async () => {
		const calls = stubUpstream({})
		expect(
			await loadAgentRunChecks(
				proxy,
				agentRun({ reusedPage: undefined, pendingProposal: undefined }),
			),
		).toEqual({})
		expect(calls).toHaveLength(0)
	})
})

describe("reusedPageName", () => {
	const stored = {
		kind: "stored" as const,
		title: "Halvorsen renewal: support view",
		revision: 2,
		state: "published",
		updatedAt: "2026-10-20T09:57:00.000Z",
	}
	const run = agentRun({
		reusedPage: {
			slug: "risks/halvorsen-renewal-support-view",
			writtenBy: "support",
			readBy: "account",
		},
	})

	it("names the page by the title the wiki read returned, never by its slug", () => {
		expect(reusedPageName(run, { reusedPage: stored })).toBe(
			"Halvorsen renewal: support view",
		)
	})

	it("names nothing while the wiki read is still out, rather than showing a slug for a moment", () => {
		expect(reusedPageName(run, null)).toBeNull()
		expect(reusedPageName(run, {})).toBeNull()
	})

	it("falls back to the slug only when the wiki has no title to give", () => {
		expect(reusedPageName(run, { reusedPage: { kind: "absent" } })).toBe(
			"risks/halvorsen-renewal-support-view",
		)
		expect(
			reusedPageName(run, {
				reusedPage: { kind: "unreadable", code: "X", message: "x" },
			}),
		).toBe("risks/halvorsen-renewal-support-view")
	})

	it("has no name when the run recorded no page", () => {
		expect(reusedPageName(agentRun({ reusedPage: undefined }), {})).toBeNull()
	})
})
