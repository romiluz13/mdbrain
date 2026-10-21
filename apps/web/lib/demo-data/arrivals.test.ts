import { describe, expect, it } from "vitest"
import {
	ARRIVALS_PAGE,
	arrivalRows,
	arrivalSubject,
	summarizeArrivals,
} from "./arrivals.js"
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
	it("counts what the record holds apart from what a stored claim lets this page confirm", () => {
		const index = [cited("evt-a", ["evt-x"]), cited("evt-x"), cited("evt-c")]
		expect(summarizeArrivals(runRecord(), index)).toEqual({
			arrived: 3,
			planned: 4,
			confirmable: 2,
			notConfirmable: 1,
			citedOutsideRecord: 1,
		})
	})

	it("counts every arrival as not confirmable when no stored claim cites any", () => {
		expect(summarizeArrivals(runRecord(), [])).toMatchObject({
			confirmable: 0,
			notConfirmable: 3,
			citedOutsideRecord: 0,
		})
	})
})

describe("arrivalSubject", () => {
	it("asks through the citing claim when a stored claim cites the arrival", () => {
		const [row] = arrivalRows(runRecord(), [cited("evt-b")])
		if (row === undefined) {
			throw new Error("expected a row")
		}
		const subject = arrivalSubject(row)
		expect(subject).toMatchObject({ kind: "arrival", eventId: "evt-b" })
		expect(subject.kind === "arrival" ? subject.via?.ref.eventId : "").toBe(
			"evt-b",
		)
	})

	it("has no way to ask when no stored claim cites the arrival", () => {
		const [row] = arrivalRows(runRecord(), [])
		if (row === undefined) {
			throw new Error("expected a row")
		}
		const subject = arrivalSubject(row)
		expect(subject.kind === "arrival" ? subject.via : "step").toBeUndefined()
	})
})

describe("ARRIVALS_PAGE", () => {
	it("is a first page of ten", () => {
		expect(ARRIVALS_PAGE).toBe(10)
	})
})
