import { describe, expect, it } from "vitest"
import {
	CLAIM_B,
	CLAIM_PAGE_A,
	CLAIM_PAGE_B,
	LOADING,
	RUN,
	RUN_NOT_FOUND,
	SUPPORT_TITLE,
	ACCOUNT_TITLE,
	claim,
	contradiction,
	input,
	ready,
} from "./story-fixtures.js"
import { FAILED_LABEL, type RunRecord } from "./run-record.js"
import {
	buildStory,
	READINESS_LABEL,
	STORY_DEFINITION,
	STORY_SECTION_LINE,
} from "./story.js"

describe("buildStory: the copy that always renders", () => {
	it("keeps the definition and the section line whatever the reads say", () => {
		const story = buildStory({
			map: { kind: "error", code: "X", message: "down" },
			contradiction: LOADING,
			run: { kind: "error", code: "Y", message: "down" },
		})
		expect(story.definition).toBe(
			"mdbrain is shared, source-linked memory for a company's people and AI agents.",
		)
		expect(STORY_DEFINITION).toBe(story.definition)
		expect(STORY_SECTION_LINE).toBe(
			"These are design properties you can check on this page, not benchmark results.",
		)
	})

	it("always has six beats and five properties, each with a readiness", () => {
		const story = buildStory({
			map: LOADING,
			contradiction: LOADING,
			run: LOADING,
		})
		expect(story.beats.map((beat) => beat.n)).toEqual([1, 2, 3, 4, 5, 6])
		expect(story.properties).toHaveLength(5)
		for (const beat of story.beats) {
			expect(READINESS_LABEL[beat.readiness]).toBeDefined()
		}
	})

	it("labels the four readiness states in the words the page shows", () => {
		expect(READINESS_LABEL).toEqual({
			shown: "shown in this run",
			"not-recorded": "not recorded",
			loading: "still loading",
			unreadable: "could not be read",
		})
	})

	it("property 5 is always shown, with its fixed explanation", () => {
		const story = buildStory({
			map: LOADING,
			contradiction: LOADING,
			run: LOADING,
		})
		expect(story.properties[4]).toMatchObject({
			readiness: "shown",
			text: "This public page reads through a dedicated read-only key; the reads it makes are listed live. Refusals of writes and other scopes are covered by the proxy's tests and deploy checks.",
		})
	})
})

describe("lead, beats 1 and 2, property 2 (the contradiction)", () => {
	it("fills the lead, both beats and property 2 from two readable claims", () => {
		const story = buildStory(input())
		expect(story.lead).toEqual({
			readiness: "shown",
			text: `In this recorded run, two pages disagree. ${SUPPORT_TITLE} says “The renewal is not on track for November signature”. ${ACCOUNT_TITLE} says “The renewal is healthy and on track for November signature”. mdbrain kept both and recorded the disagreement as unresolved. Inspect the stored citations behind these claims.`,
		})
		expect(story.beats[0]).toMatchObject({
			readiness: "shown",
			text: `${SUPPORT_TITLE} and ${ACCOUNT_TITLE} disagree.`,
		})
		expect(story.beats[1]).toMatchObject({
			readiness: "shown",
			text: "Both claims are kept, recorded as unresolved.",
		})
		expect(story.properties[1]).toMatchObject({
			readiness: "shown",
			text: "In this recorded case, both claims are still readable and the disagreement is recorded as unresolved.",
		})
	})

	it("is not recorded when no contradiction is stored", () => {
		const story = buildStory(input({ contradiction: { kind: "empty" } }))
		expect(story.lead).toEqual({ readiness: "not-recorded" })
		expect(story.beats[0].readiness).toBe("not-recorded")
		expect(story.properties[1].readiness).toBe("not-recorded")
	})

	it("is not recorded with only one claim, and never shows a half lead", () => {
		const story = buildStory(
			input({ contradiction: ready(contradiction([CLAIM_PAGE_A])) }),
		)
		expect(story.lead).toEqual({ readiness: "not-recorded" })
		expect(story.beats[1].readiness).toBe("not-recorded")
		expect(story.properties[1].readiness).toBe("not-recorded")
		expect(story.beats[1].text).toBeUndefined()
	})

	it("could not be read when the read failed or the record is not readable back", () => {
		const failed = buildStory(
			input({
				contradiction: { kind: "error", code: "X", message: "down" },
			}),
		)
		expect(failed.lead.readiness).toBe("unreadable")
		expect(failed.properties[1].readiness).toBe("unreadable")

		const notReadable = buildStory(
			input({
				contradiction: {
					kind: "incomplete",
					reason: "CONTRADICTION_NOT_READABLE",
					state: null,
				},
			}),
		)
		expect(notReadable.lead.readiness).toBe("unreadable")
		expect(notReadable.beats[0].readiness).toBe("unreadable")
	})

	it("is still loading while the contradiction read is loading", () => {
		const story = buildStory(input({ contradiction: LOADING }))
		expect(story.lead.readiness).toBe("loading")
		expect(story.beats[0].readiness).toBe("loading")
		expect(story.beats[1].readiness).toBe("loading")
		expect(story.properties[1].readiness).toBe("loading")
		expect(story.lead.text).toBeUndefined()
	})
})

describe("beat 3 and property 1 (citations)", () => {
	it("shows a citation recorded for each claim with event evidence and a marker", () => {
		const story = buildStory(input())
		expect(story.citations).toEqual([
			{
				readiness: "shown",
				label: "citation recorded",
				pageTitle: SUPPORT_TITLE,
			},
			{
				readiness: "shown",
				label: "citation recorded",
				pageTitle: ACCOUNT_TITLE,
			},
		])
		expect(story.beats[2]).toMatchObject({ readiness: "shown" })
		expect(story.properties[0]).toMatchObject({ readiness: "shown" })
	})

	it("says no stored event source for a claim without event evidence", () => {
		const bare = claim("account-renewal", CLAIM_B, { evidence: [] })
		const story = buildStory(
			input({
				contradiction: ready(
					contradiction([CLAIM_PAGE_A, { ...CLAIM_PAGE_B, claim: bare }]),
				),
			}),
		)
		expect(story.citations[1]).toMatchObject({
			readiness: "not-recorded",
			label: "No stored event source",
		})
		expect(story.beats[2].readiness).toBe("shown")
	})

	it("ignores non-event evidence and still shows the event citation", () => {
		const mixed = claim("account-renewal", CLAIM_B, {
			evidence: [
				{ kind: "file", sourceId: "notes.md", path: "notes.md" },
				{
					kind: "event",
					sourceId: "evt-account",
					marker: "[[event:evt-account]]",
				},
			],
		})
		const story = buildStory(
			input({
				contradiction: ready(
					contradiction([CLAIM_PAGE_A, { ...CLAIM_PAGE_B, claim: mixed }]),
				),
			}),
		)
		expect(story.citations[1].readiness).toBe("shown")
	})

	it("could not be read when event evidence has no claim marker to cite through", () => {
		const unmarked = claim("account-renewal", CLAIM_B, { marker: undefined })
		const story = buildStory(
			input({
				contradiction: ready(
					contradiction([CLAIM_PAGE_A, { ...CLAIM_PAGE_B, claim: unmarked }]),
				),
			}),
		)
		expect(story.citations[1]).toMatchObject({
			readiness: "unreadable",
			label: "The citation marker is missing.",
		})
	})

	it("is still loading while the contradiction read is loading", () => {
		const story = buildStory(input({ contradiction: LOADING }))
		expect(story.citations).toEqual([])
		expect(story.beats[2].readiness).toBe("loading")
		expect(story.properties[0].readiness).toBe("loading")
	})
})

describe("beat 4 and the counts clause (the run and the map)", () => {
	it("fills the arrival count and the page and claim totals from ready reads", () => {
		const story = buildStory(input())
		expect(story.beats[3]).toMatchObject({
			readiness: "shown",
			text: "3 source records loaded for this run.",
		})
		expect(story.summary.counts).toEqual({
			readiness: "shown",
			text: "This recorded run loaded 3 source records, authored synthetic material for the demo; the brain now holds 110 pages and 290 claims.",
		})
	})

	it("is not recorded when the run is not configured", () => {
		const story = buildStory(
			input({
				run: { kind: "incomplete", reason: "RUN_NOT_CONFIGURED", state: null },
			}),
		)
		expect(story.beats[3].readiness).toBe("not-recorded")
		expect(story.summary.counts.readiness).toBe("not-recorded")
	})

	it("is not recorded when the pinned run has no stored record (proxy 404 RUN_NOT_FOUND)", () => {
		const story = buildStory(input({ run: RUN_NOT_FOUND }))
		expect(story.beats[3].readiness).toBe("not-recorded")
		expect(story.summary.counts.readiness).toBe("not-recorded")
	})

	it("is not recorded when the run is empty", () => {
		const story = buildStory(input({ run: { kind: "empty" } }))
		expect(story.beats[3].readiness).toBe("not-recorded")
	})

	it("could not be read when the run read failed", () => {
		const story = buildStory(
			input({ run: { kind: "error", code: "X", message: "down" } }),
		)
		expect(story.beats[3].readiness).toBe("unreadable")
		expect(story.summary.counts.readiness).toBe("unreadable")
		expect(story.summary.handoff.readiness).toBe("unreadable")
		expect(story.properties[2].readiness).toBe("unreadable")
	})

	it("could not be read when the run stopped, with the fixed stopped label", () => {
		const failed: RunRecord = {
			...RUN,
			state: "failed",
			failedAt: "2026-10-21T22:31:00.000Z",
			failedLabel: FAILED_LABEL,
		}
		const story = buildStory(
			input({
				run: {
					kind: "incomplete",
					reason: "RUN_FAILED",
					state: "failed",
					data: failed,
				},
			}),
		)
		expect(story.beats[3]).toMatchObject({
			readiness: "unreadable",
			note: FAILED_LABEL,
		})
	})

	it("is still loading while the run is loading", () => {
		const story = buildStory(input({ run: LOADING }))
		expect(story.beats[3].readiness).toBe("loading")
		expect(story.summary.counts.readiness).toBe("loading")
	})

	it("is loading with a clearly partial count while the run is still seeding", () => {
		const seeding: RunRecord = {
			...RUN,
			state: "seeding",
			readyAt: undefined,
			arrivals: [{ sourceId: "src-1", eventId: "evt-1" }],
		}
		const story = buildStory(
			input({
				run: {
					kind: "incomplete",
					reason: "RUN_NOT_READY",
					state: "seeding",
					data: seeding,
				},
			}),
		)
		expect(story.beats[3]).toMatchObject({
			readiness: "loading",
			note: "1 source record loaded so far; the run is still seeding.",
		})
		expect(story.beats[3].text).toBeUndefined()
	})

	it("keeps beat 4 shown when the map read fails, and marks only the counts unreadable", () => {
		const story = buildStory(
			input({ map: { kind: "error", code: "X", message: "down" } }),
		)
		expect(story.beats[3].readiness).toBe("shown")
		expect(story.summary.counts.readiness).toBe("unreadable")
		expect(story.summary.counts.text).toBeUndefined()
	})

	it("is still loading the counts while the map loads, and keeps beat 4 shown", () => {
		const story = buildStory(input({ map: LOADING }))
		expect(story.beats[3].readiness).toBe("shown")
		expect(story.summary.counts.readiness).toBe("loading")
	})
})

describe("beat titles (the plan's copy)", () => {
	it("titles beat 3 and beat 5 in the plan's words", () => {
		const story = buildStory(input())
		expect(story.beats[2].title).toBe(
			"Compare the source text and dates where available",
		)
		expect(story.beats[4].title).toBe("Agents handed work on")
	})
})

describe("honest copy", () => {
	it("never says approved, verified, a readable source, a proposer or a competitor", () => {
		const story = buildStory(input())
		const copy = JSON.stringify(story)
		expect(copy).not.toMatch(/approved/i)
		expect(copy).not.toMatch(/verified/i)
		expect(copy).not.toMatch(/readable source/i)
		expect(copy).not.toMatch(/proposer/i)
		for (const competitor of [
			"Glean",
			"Notion",
			"Confluence",
			"Mem0",
			"Zep",
			"Letta",
		]) {
			expect(copy).not.toContain(competitor)
		}
	})
})
