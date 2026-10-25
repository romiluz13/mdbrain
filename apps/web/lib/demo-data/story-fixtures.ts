// Shared fixtures for the story seam and its view: a recorded run as the page
// reads it. Scenario names live here, in test code, and nowhere in the page.

import type { MdbrainWikiClaim } from "@mdbrain/client"
import type { WikiMapPage, WikiMapView } from "./loaders.js"
import type {
	ContradictionCase,
	ContradictionCaseClaim,
} from "./loaders-chapters.js"
import type { RunRecord, AgentRunRecord } from "./run-record.js"
import type { DataState } from "./states.js"
import type { StoryInput } from "./story.js"

export const SUPPORT_SLUG = "risks/halvorsen-renewal-support-view"
export const SUPPORT_TITLE = "Halvorsen renewal: support view"
export const ACCOUNT_SLUG = "accounts/halvorsen-freight-group"
export const ACCOUNT_TITLE = "Halvorsen Freight Group"
export const CLAIM_A = "The renewal is not on track for November signature."
export const CLAIM_B =
	"The renewal is healthy and on track for November signature."
export const LOADING = { kind: "loading" } as const

export function claim(
	id: string,
	text: string,
	overrides: Partial<MdbrainWikiClaim> = {},
): MdbrainWikiClaim {
	return {
		id,
		text,
		status: "contradicted",
		confidence: 0.9,
		marker: `[[wiki:${id}@r1]]`,
		evidence: [
			{ kind: "event", sourceId: `evt-${id}`, marker: `[[event:evt-${id}]]` },
		],
		derivedFrom: [],
		...overrides,
	}
}

export const CLAIM_PAGE_A: ContradictionCaseClaim = {
	pageSlug: SUPPORT_SLUG,
	pageTitle: SUPPORT_TITLE,
	revision: 1,
	claim: claim("support-renewal", CLAIM_A),
}
export const CLAIM_PAGE_B: ContradictionCaseClaim = {
	pageSlug: ACCOUNT_SLUG,
	pageTitle: ACCOUNT_TITLE,
	revision: 1,
	claim: claim("account-renewal", CLAIM_B),
}

export function contradiction(
	claims: ContradictionCaseClaim[] = [CLAIM_PAGE_A, CLAIM_PAGE_B],
): ContradictionCase {
	return {
		id: "contra-renewal",
		detectedAt: "2026-10-21T22:35:14.097Z",
		resolution: "unresolved",
		claims,
		unresolvedCount: 1,
	}
}

export function mapPage(slug: string, title: string): WikiMapPage {
	return {
		slug,
		title,
		kind: "synthesis",
		type: "synthesis",
		trustTier: "standard",
		state: "active",
		revision: 1,
		claimCount: 1,
		linkCount: 0,
		createdAt: "2026-10-21T22:35:12.821Z",
		updatedAt: "2026-10-21T22:35:12.821Z",
		links: [],
		sourceIds: [],
		contradictedClaims: 0,
		claims: [],
	}
}

export const MAP: WikiMapView = {
	pages: [
		mapPage(SUPPORT_SLUG, SUPPORT_TITLE),
		mapPage(ACCOUNT_SLUG, ACCOUNT_TITLE),
	],
	pageTotal: 110,
	claimTotal: 290,
	sourceTotal: 4,
	unresolvedContradictionCount: 1,
}

export const AGENT_RUN: AgentRunRecord = {
	state: "complete",
	startedAt: "2026-10-21T22:33:53.532Z",
	endedAt: "2026-10-21T22:37:55.694Z",
	stepsRecorded: 3,
	reusedPage: {
		slug: SUPPORT_SLUG,
		writtenBy: "support",
		readBy: "account",
	},
	pendingProposal: {
		title: "Silent ETA drift",
		slug: "syntheses/silent-eta-drift",
	},
	steps: [
		{ n: 1, role: "support", name: "read", eventId: "step-1" },
		{ n: 2, role: "account", name: "read", eventId: "step-2" },
		{ n: 3, role: "product", name: "read", eventId: "step-3" },
	],
}

export const RUN: RunRecord = {
	state: "used",
	createdAt: "2026-10-21T20:42:10.545Z",
	readyAt: "2026-10-21T22:30:35.425Z",
	usedAt: "2026-10-21T22:37:55.972Z",
	eventsPlanned: 3,
	pagesPlanned: 2,
	arrivals: [
		{ sourceId: "src-1", eventId: "evt-1" },
		{ sourceId: "src-2", eventId: "evt-2" },
		{ sourceId: "src-3", eventId: "evt-3" },
	],
	pagesWritten: [SUPPORT_SLUG, ACCOUNT_SLUG],
	agentRun: AGENT_RUN,
}

export const ready = <T>(data: T): DataState<T> => ({ kind: "ready", data })

export function input(over: Partial<StoryInput> = {}): StoryInput {
	return {
		map: ready(MAP),
		contradiction: ready(contradiction()),
		run: ready(RUN),
		...over,
	}
}

export function withRun(over: Partial<RunRecord>): DataState<RunRecord> {
	return ready({ ...RUN, ...over })
}

export function withAgentRun(
	over: Partial<NonNullable<RunRecord["agentRun"]>>,
): DataState<RunRecord> {
	return withRun({ agentRun: { ...AGENT_RUN, ...over } })
}
