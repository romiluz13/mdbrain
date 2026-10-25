import { describe, expect, it } from "vitest"
import {
	LOADING,
	MAP,
	SUPPORT_SLUG,
	input,
	ready,
	withAgentRun,
	withRun,
} from "./story-fixtures.js"
import { DEADLINE_LABEL, INCOMPLETE_LABEL } from "./run-record.js"
import { buildStory } from "./story.js"

describe("hand-off: beat 5, property 4 and the hand-off clause", () => {
	it("fills the roles, duration, writer, reader and the page title from the map", () => {
		const story = buildStory(input())
		expect(story.beats[4]).toMatchObject({
			readiness: "shown",
			text: "Support Lead wrote “Halvorsen renewal: support view”; Account Manager read it.",
		})
		expect(story.summary.handoff).toEqual({
			readiness: "shown",
			text: "Then 3 agents worked in turn (Support Lead, Account Manager, Product Lead) for 242 seconds; the Support Lead agent's page “Halvorsen renewal: support view” was read by the Account Manager agent.",
		})
		expect(story.properties[3]).toMatchObject({
			readiness: "shown",
			text: "In this run the Support Lead agent wrote “Halvorsen renewal: support view” and the Account Manager agent read it.",
		})
	})

	it("falls back to the recorded slug when the page is absent from the map", () => {
		const story = buildStory(input({ map: ready({ ...MAP, pages: [] }) }))
		expect(story.beats[4].text).toBe(
			`Support Lead wrote “${SUPPORT_SLUG}”; Account Manager read it.`,
		)
	})

	it("falls back to the recorded slug while the map loads or fails, and stays shown", () => {
		for (const map of [
			LOADING,
			{ kind: "error", code: "X", message: "down" } as const,
		]) {
			const story = buildStory(input({ map }))
			expect(story.beats[4].readiness).toBe("shown")
			expect(story.beats[4].text).toContain(SUPPORT_SLUG)
		}
	})

	it("omits the roles and duration clause when steps or endedAt are absent", () => {
		const noSteps = buildStory(
			input({
				run: withAgentRun({ steps: undefined }),
			}),
		)
		expect(noSteps.summary.handoff.text).toBe(
			"The Support Lead agent's page “Halvorsen renewal: support view” was read by the Account Manager agent.",
		)

		const noEnd = buildStory(
			input({ run: withAgentRun({ endedAt: undefined }) }),
		)
		expect(noEnd.summary.handoff.text).toBe(
			"Then 3 agents worked in turn (Support Lead, Account Manager, Product Lead); the Support Lead agent's page “Halvorsen renewal: support view” was read by the Account Manager agent.",
		)
		expect(noEnd.summary.handoff.readiness).toBe("shown")
	})

	it("is not recorded without an agent run, while running, or when it stopped", () => {
		const none = buildStory(input({ run: withRun({ agentRun: undefined }) }))
		expect(none.beats[4]).toMatchObject({ readiness: "not-recorded" })
		expect(none.beats[4].text).toBeUndefined()

		const running = buildStory(
			input({ run: withAgentRun({ state: "running", endedAt: undefined }) }),
		)
		expect(running.beats[4].readiness).toBe("not-recorded")

		const stopped = buildStory(
			input({
				run: withAgentRun({
					state: "incomplete",
					incompleteLabel: INCOMPLETE_LABEL,
				}),
			}),
		)
		expect(stopped.beats[4]).toMatchObject({
			readiness: "not-recorded",
			note: INCOMPLETE_LABEL,
		})
		expect(stopped.summary.handoff.readiness).toBe("not-recorded")

		const deadline = buildStory(
			input({
				run: withAgentRun({
					state: "incomplete",
					incompleteLabel: DEADLINE_LABEL,
				}),
			}),
		)
		expect(deadline.beats[4].note).toBe(DEADLINE_LABEL)
	})

	it("is not recorded for a complete run that reused no page", () => {
		const story = buildStory(
			input({ run: withAgentRun({ reusedPage: undefined }) }),
		)
		expect(story.beats[4].readiness).toBe("not-recorded")
	})

	it("is still loading while the run is loading", () => {
		const story = buildStory(input({ run: LOADING }))
		expect(story.beats[4].readiness).toBe("loading")
		expect(story.properties[3].readiness).toBe("loading")
	})
})

describe("proposal: beat 6 and property 3", () => {
	it("fills the pending proposal's title, with no approval claimed", () => {
		const story = buildStory(input())
		expect(story.beats[5]).toMatchObject({
			readiness: "shown",
			text: "An agent left “Silent ETA drift” awaiting review when this run was recorded.",
		})
		expect(story.summary.proposal).toEqual({
			readiness: "shown",
			text: "An agent left “Silent ETA drift” awaiting review when this run was recorded; no approval is recorded in this run.",
		})
		expect(story.properties[2]).toMatchObject({
			readiness: "shown",
			text: "In this run an agent left “Silent ETA drift” awaiting review; no approval is recorded in this run. The other roles could already write within their permissions.",
		})
	})

	it("is not recorded when no proposal is recorded", () => {
		const story = buildStory(
			input({ run: withAgentRun({ pendingProposal: undefined }) }),
		)
		expect(story.beats[5].readiness).toBe("not-recorded")
		expect(story.properties[2].readiness).toBe("not-recorded")
	})

	it("could not be read when the run read failed, and is loading while it loads", () => {
		const failed = buildStory(
			input({ run: { kind: "error", code: "X", message: "down" } }),
		)
		expect(failed.beats[5].readiness).toBe("unreadable")
		const loading = buildStory(input({ run: LOADING }))
		expect(loading.beats[5].readiness).toBe("loading")
	})
})
