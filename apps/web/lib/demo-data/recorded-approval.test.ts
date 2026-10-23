import { describe, expect, it } from "vitest"
import type { WikiMapPage, WikiMapView } from "./loaders.js"
import type { Boundaries, Timeline } from "./playback.js"
import { recordedApproval } from "./recorded-approval.js"
import type { RunRecord } from "./run-record.js"

const page = (slug: string) => ({ slug }) as WikiMapPage
const map = (...slugs: string[]): WikiMapView => ({
	pages: slugs.map(page),
	pageTotal: slugs.length,
	claimTotal: 0,
	sourceTotal: 0,
	unresolvedContradictionCount: 0,
})
const run = (proposal?: { title: string; slug: string }): RunRecord => ({
	state: "used",
	createdAt: "2026-10-20T09:00:00.000Z",
	eventsPlanned: 0,
	pagesPlanned: 0,
	arrivals: [],
	pagesWritten: [],
	agentRun: {
		state: "complete",
		startedAt: "2026-10-20T09:03:00.000Z",
		...(proposal ? { pendingProposal: proposal } : {}),
	},
})
const PROPOSAL = { title: "Renewal brief", slug: "syntheses/renewal" }

describe("recordedApproval", () => {
	it("says nothing while the record or the page list is not known", () => {
		expect(recordedApproval(null, map("a"))).toBeNull()
		expect(recordedApproval(run(PROPOSAL), null)).toBeNull()
	})

	it("reports a run without a proposal as having none", () => {
		expect(recordedApproval(run(), map("a"))).toEqual({ kind: "none" })
	})

	it("reports a proposal whose page no wiki read returns as still pending", () => {
		expect(recordedApproval(run(PROPOSAL), map("a"))).toEqual({
			kind: "pending",
			title: "Renewal brief",
		})
	})

	it("reports a proposal whose page is stored as approved, with when the page was stored", () => {
		const timeline = {
			points: [
				{ at: "2026-10-20T09:01:00.000Z" },
				{ at: "2026-10-20T09:12:00.000Z" },
			],
		} as Timeline
		const marks: Boundaries = { sourcesEnd: 1, agentsEnd: 1, approval: 2 }
		expect(
			recordedApproval(run(PROPOSAL), map("a", PROPOSAL.slug), timeline, marks),
		).toEqual({
			kind: "approved",
			title: "Renewal brief",
			at: "2026-10-20T09:12:00.000Z",
		})
		expect(recordedApproval(run(PROPOSAL), map(PROPOSAL.slug))).toEqual({
			kind: "approved",
			title: "Renewal brief",
		})
	})
})
