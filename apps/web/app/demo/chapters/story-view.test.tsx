import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FAILED_LABEL } from "../../../lib/demo-data/run-record.js"
import {
	CLAIM_PAGE_A,
	CLAIM_PAGE_B,
	LOADING,
	RUN,
	claim,
	contradiction,
	input,
	ready,
	withAgentRun,
} from "../../../lib/demo-data/story-fixtures.js"
import {
	buildStory,
	STORY_SECTION_LINE,
	type Story,
} from "../../../lib/demo-data/story.js"
import { StoryView } from "./story-view.js"

const render = (story: Story) =>
	renderToStaticMarkup(<StoryView story={story} onSee={() => {}} />)

const PROPERTY_HEADLINES = [
	"Check the evidence behind a claim.",
	"See a disagreement without losing either account.",
	"A proposal can wait for a reviewer.",
	"Many agents work on one brain.",
	"Explore the recorded brain without editing it.",
]

describe("StoryView", () => {
	it("renders the definition, the section line and five properties, each with See it", () => {
		const html = render(buildStory(input()))
		expect(html).toContain(
			"mdbrain is shared, source-linked memory for a company&#x27;s people and AI agents.",
		)
		expect(html).toContain(STORY_SECTION_LINE)
		for (const headline of PROPERTY_HEADLINES) {
			expect(html).toContain(headline)
		}
		for (const beat of [1, 2, 3, 4, 5, 6]) {
			expect(html).toContain(`data-testid="story-beat-${beat}"`)
		}
		expect(html.match(/See it/g)).toHaveLength(11)
	})

	it("says each readiness state in the words of the table", () => {
		expect(
			render(
				buildStory({ map: LOADING, contradiction: LOADING, run: LOADING }),
			),
		).toContain("still loading")
		expect(render(buildStory(input()))).toContain("shown in this run")
		expect(
			render(
				buildStory(
					input({
						contradiction: { kind: "empty" },
						run: {
							kind: "incomplete",
							reason: "RUN_NOT_CONFIGURED",
							state: null,
						},
					}),
				),
			),
		).toContain("not recorded")
		expect(
			render(
				buildStory(
					input({ run: { kind: "error", code: "X", message: "down" } }),
				),
			),
		).toContain("could not be read")
	})

	it("shows a failed run's fixed label, never a stored reason", () => {
		const html = render(
			buildStory(
				input({
					run: {
						kind: "incomplete",
						reason: "RUN_FAILED",
						state: "failed",
						data: { ...RUN, state: "failed", failedLabel: FAILED_LABEL },
					},
				}),
			),
		)
		expect(html).toContain(FAILED_LABEL)
	})

	it("fills the lead and the hand-off from the reads", () => {
		const html = render(buildStory(input()))
		expect(html).toContain("In this recorded run, two pages disagree.")
		expect(html).toContain("the Support Lead agent&#x27;s page")
	})

	it("states the missing evidence and the missing proposal plainly", () => {
		const bare = claim("account-renewal", "The renewal is healthy.", {
			evidence: [],
		})
		expect(
			render(
				buildStory(
					input({
						contradiction: ready(
							contradiction([CLAIM_PAGE_A, { ...CLAIM_PAGE_B, claim: bare }]),
						),
					}),
				),
			),
		).toContain("No stored event source")
		const noProposal = render(
			buildStory(input({ run: withAgentRun({ pendingProposal: undefined }) })),
		)
		expect(noProposal).toContain("not recorded")
		expect(noProposal).not.toContain("awaiting review")
	})

	it("never says approved, verified, a readable source, a proposer or a competitor", () => {
		for (const story of [
			buildStory(input()),
			buildStory({ map: LOADING, contradiction: LOADING, run: LOADING }),
		]) {
			const html = render(story)
			expect(html).not.toMatch(/approved/i)
			expect(html).not.toMatch(/verified/i)
			expect(html).not.toMatch(/readable source/i)
			expect(html).not.toMatch(/proposer/i)
			for (const competitor of [
				"Glean",
				"Notion",
				"Confluence",
				"Mem0",
				"Zep",
				"Letta",
			]) {
				expect(html).not.toContain(competitor)
			}
		}
	})
})
