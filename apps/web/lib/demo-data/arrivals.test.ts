import { describe, expect, it } from "vitest"
import {
	ARRIVALS_PAGE,
	arrivalRows,
	outsideRecordNote,
	summarizeArrivals,
} from "./arrivals.js"
import type { AgentRunRecord, AgentStep } from "./run-record.js"
import { claimView, runRecord } from "./test-upstream.js"
import type { SourceIndexEntry } from "./views.js"

function cited(eventId: string, extra: string[] = []): SourceIndexEntry {
	return {
		eventId,
		pageSlug: "accounts/halvorsen-freight-group",
		pageTitle: "Halvorsen Freight Group",
		revision: 2,
		claim: {
			...claimView(),
			marker: "[[wiki:accounts/halvorsen-freight-group#claim-1@2]]",
			evidence: [eventId, ...extra].map((sourceId) => ({
				kind: "event" as const,
				sourceId,
			})),
		},
	}
}

describe("arrivalRows", () => {
	it("lists the run's arrivals in the order its record holds them, numbered from one", () => {
		const rows = arrivalRows(runRecord(), [])
		expect(
			rows.map((row) => [row.position, row.sourceId, row.eventId]),
		).toEqual([
			[1, "src-b", "evt-b"],
			[2, "src-a", "evt-a"],
			[3, "src-c", "evt-c"],
		])
	})

	it("names the stored claim that cites an arrival, and leaves the rest unnamed", () => {
		const index = [cited("evt-a"), cited("evt-c")]
		const rows = arrivalRows(runRecord(), index)
		expect(rows.map((row) => row.citedBy?.eventId)).toEqual([
			undefined,
			"evt-a",
			"evt-c",
		])
	})
})

describe("summarizeArrivals", () => {
	it("counts what the record holds apart from what a stored claim cites", () => {
		const index = [cited("evt-a", ["evt-x"]), cited("evt-x"), cited("evt-c")]
		expect(summarizeArrivals(runRecord(), index)).toEqual({
			arrived: 3,
			planned: 4,
			cited: 2,
			citedOutsideRecord: 1,
			writtenByAgent: 0,
		})
	})

	it("counts no arrival as cited when no stored claim cites any", () => {
		expect(summarizeArrivals(runRecord(), [])).toMatchObject({
			cited: 0,
			citedOutsideRecord: 0,
		})
	})
})

const PAGE = "accounts/halvorsen-freight-group"

const WRITES_EVENTS: AgentStep = {
	n: 3,
	role: "support",
	name: "step 3",
	detail: "mdbrain_write_event, mdbrain_write_event",
	eventId: "evt-step-3",
}
const READS_ONLY: AgentStep = {
	n: 1,
	role: "support",
	name: "step 1",
	detail: "mdbrain_recall",
	eventId: "evt-step-1",
}

function agentRun(steps: AgentStep[] | undefined, slug = PAGE): AgentRunRecord {
	return {
		state: "complete",
		startedAt: "2026-10-20T09:35:00.000Z",
		endedAt: "2026-10-20T09:39:12.000Z",
		reusedPage: { slug, writtenBy: "support", readBy: "account" },
		...(steps !== undefined ? { steps } : {}),
	}
}

describe("summarizeArrivals: events an agent wrote during the run", () => {
	const outside = [cited("evt-x")]

	it("counts a cited event the record does not list as written by an agent when the page citing it is the one an agent wrote and that role's steps wrote events", () => {
		const record = runRecord({
			agentRun: agentRun([READS_ONLY, WRITES_EVENTS]),
		})
		expect(summarizeArrivals(record, outside)).toMatchObject({
			citedOutsideRecord: 1,
			writtenByAgent: 1,
		})
	})

	it("says nothing of an agent when the run's steps were not indexed, since nothing then shows who wrote it", () => {
		const record = runRecord({ agentRun: agentRun(undefined) })
		expect(summarizeArrivals(record, outside).writtenByAgent).toBe(0)
	})

	it("says nothing of an agent when the page that cites the event is not the one an agent wrote", () => {
		const record = runRecord({
			agentRun: agentRun([WRITES_EVENTS], "accounts/someone-else"),
		})
		expect(summarizeArrivals(record, outside).writtenByAgent).toBe(0)
	})

	it("says nothing of an agent when none of that role's steps wrote an event", () => {
		const record = runRecord({ agentRun: agentRun([READS_ONLY]) })
		expect(summarizeArrivals(record, outside).writtenByAgent).toBe(0)
	})

	it("says nothing of an agent when the run has no agent run at all", () => {
		expect(summarizeArrivals(runRecord(), outside).writtenByAgent).toBe(0)
	})

	it("counts an event the record lists as neither outside it nor written by an agent", () => {
		const record = runRecord({ agentRun: agentRun([WRITES_EVENTS]) })
		expect(summarizeArrivals(record, [cited("evt-a")])).toMatchObject({
			citedOutsideRecord: 0,
			writtenByAgent: 0,
		})
	})
})

describe("outsideRecordNote", () => {
	const base = { arrived: 3, planned: 4, cited: 2 }

	it("says nothing when every cited event is in the record", () => {
		expect(
			outsideRecordNote({ ...base, citedOutsideRecord: 0, writtenByAgent: 0 }),
		).toBe("")
	})

	it("says where the one event came from when an agent wrote it during the run", () => {
		expect(
			outsideRecordNote({ ...base, citedOutsideRecord: 1, writtenByAgent: 1 }),
		).toBe(
			"1 stored source event cited by claims is not in this record. It was written by an agent during the run.",
		)
	})

	it("says the same of several events when an agent wrote them all", () => {
		expect(
			outsideRecordNote({ ...base, citedOutsideRecord: 2, writtenByAgent: 2 }),
		).toBe(
			"2 stored source events cited by claims are not in this record. They were written by an agent during the run.",
		)
	})

	it("claims only as many as were checked when an agent wrote some of them", () => {
		expect(
			outsideRecordNote({ ...base, citedOutsideRecord: 2, writtenByAgent: 1 }),
		).toBe(
			"2 stored source events cited by claims are not in this record. 1 of them was written by an agent during the run.",
		)
	})

	it("leaves an unexplained event unexplained rather than guessing where it came from", () => {
		expect(
			outsideRecordNote({ ...base, citedOutsideRecord: 1, writtenByAgent: 0 }),
		).toBe("1 stored source event cited by claims is not in this record.")
	})
})

describe("ARRIVALS_PAGE", () => {
	it("is a first page of ten", () => {
		expect(ARRIVALS_PAGE).toBe(10)
	})
})
