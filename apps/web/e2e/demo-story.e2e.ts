// The story chapter on the fixture lane: its first screen, the readiness rows
// of its table forced one at a time, the honest copy on the rendered page, and
// the old link to the caught chapter.
import { expect, test } from "@playwright/test"
import { settleContradiction } from "./demo-helpers"
import { GENERATED, installDemoProxy } from "./demo-proxy"
import { openDemo } from "./demo-helpers"

const HEADLINES = [
	"Check the evidence behind a claim.",
	"See a disagreement without losing either account.",
	"A proposal can wait for a reviewer.",
	"Many agents work on one brain.",
	"Explore the recorded brain without editing it.",
]
const SECTION_LINE =
	"These are design properties you can check on this page, not benchmark results."
const FAILED = "Seeding stopped before the run was ready."

const beat = (page: import("@playwright/test").Page, n: number) =>
	page.getByTestId(`story-beat-${n}`)

test.describe("story", () => {
	test.skip(
		!GENERATED,
		"the story states are forced through the generated fixture",
	)

	test("the first screen states the definition, the lead and the five properties", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page, "")
		await expect(page.getByText("Chapter 1 of 10")).toBeVisible()
		await expect(
			page.getByText(
				"mdbrain is shared, source-linked memory for a company's people and AI agents.",
			),
		).toBeVisible()
		await expect(page.getByText(SECTION_LINE)).toBeVisible()
		await expect(
			page.getByText("In this recorded run, two pages disagree."),
		).toBeVisible()
		for (const headline of HEADLINES) {
			await expect(page.getByText(headline)).toBeVisible()
		}
		for (const n of [1, 2, 3, 4, 5, 6]) {
			await expect(beat(page, n)).toHaveAttribute("data-readiness", "shown")
		}
		await expect(page.getByRole("button", { name: "See it" })).toHaveCount(11)
	})

	test("the rendered story makes no approval, verification, proposer or competitor claim", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page, "")
		await expect(beat(page, 6)).toHaveAttribute("data-readiness", "shown")
		const text = await page.getByTestId("story").innerText()
		expect(text).not.toMatch(/approved/i)
		expect(text).not.toMatch(/verified/i)
		expect(text).not.toMatch(/readable source/i)
		expect(text).not.toMatch(/proposer/i)
		for (const competitor of [
			"Glean",
			"Notion",
			"Confluence",
			"Mem0",
			"Zep",
			"Letta",
		]) {
			expect(text).not.toContain(competitor)
		}
		expect(text).toContain("no approval is recorded in this run")
	})

	test("the old link to the caught chapter still opens its walk-through", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await page.goto("/demo#contradiction")
		await expect(
			page.getByRole("heading", { level: 1, name: "Caught: a disagreement" }),
		).toBeVisible()
		expect(await settleContradiction(page, proxy)).toBe("recorded")
	})

	test("a run that stopped shows its fixed label and leaves the lead alone", async ({
		page,
	}) => {
		await installDemoProxy(page, {
			rewrite: (url, body) => {
				if (url.pathname !== "/api/demo/v1/run") return body
				return {
					...(body as object),
					state: "failed",
					failedAt: "2026-10-20T09:00:00.000Z",
				}
			},
		})
		await openDemo(page, "")
		await expect(beat(page, 4)).toHaveAttribute("data-readiness", "unreadable")
		await expect(page.getByText(FAILED)).toBeVisible()
		await expect(beat(page, 5)).toHaveAttribute("data-readiness", "unreadable")
		await expect(beat(page, 1)).toHaveAttribute("data-readiness", "shown")
		await expect(
			page.getByText("In this recorded run, two pages disagree."),
		).toBeVisible()
	})

	test("a run with no agent run says so, and the other beats stay", async ({
		page,
	}) => {
		await installDemoProxy(page, { run: { variant: "none" } })
		await openDemo(page, "")
		await expect(beat(page, 5)).toHaveAttribute(
			"data-readiness",
			"not-recorded",
		)
		await expect(beat(page, 6)).toHaveAttribute(
			"data-readiness",
			"not-recorded",
		)
		await expect(beat(page, 4)).toHaveAttribute("data-readiness", "shown")
		await expect(beat(page, 2)).toHaveAttribute("data-readiness", "shown")
	})

	test("a run with no contradiction recorded says so, and the counts stay", async ({
		page,
	}) => {
		await installDemoProxy(page, { contradiction: "none" })
		await openDemo(page, "")
		await expect(beat(page, 1)).toHaveAttribute(
			"data-readiness",
			"not-recorded",
		)
		await expect(beat(page, 3)).toHaveAttribute(
			"data-readiness",
			"not-recorded",
		)
		await expect(
			page.getByText("In this recorded run, two pages disagree."),
		).toHaveCount(0)
		await expect(beat(page, 4)).toHaveAttribute("data-readiness", "shown")
	})

	test("one readable claim is not a disagreement, but its citation still shows", async ({
		page,
	}) => {
		await installDemoProxy(page, {
			rewrite: (url, body) => {
				if (!url.pathname.startsWith("/api/demo/v1/wiki/overview/")) return body
				const overview = body as {
					contradictions?: { items?: Array<{ claims: unknown[] }> }
				}
				const items = overview.contradictions?.items
				if (!items) return body
				return {
					...overview,
					contradictions: {
						...overview.contradictions,
						items: items.map((item) => ({
							...item,
							claims: item.claims.slice(0, 1),
						})),
					},
				}
			},
		})
		await openDemo(page, "")
		await expect(beat(page, 1)).toHaveAttribute(
			"data-readiness",
			"not-recorded",
		)
		await expect(beat(page, 3)).toHaveAttribute("data-readiness", "shown")
	})

	test("a claim without evidence says so by name", async ({ page }) => {
		await installDemoProxy(page, { contradiction: "unsourced" })
		await openDemo(page, "")
		await expect(page.getByText("No stored event source")).toBeVisible()
		await expect(beat(page, 3)).toHaveAttribute("data-readiness", "shown")
	})

	test("with every read down, the definition and the five properties still render", async ({
		page,
	}) => {
		await installDemoProxy(page, {
			override: () =>
				new Response(
					JSON.stringify({
						error: { code: "UPSTREAM_ERROR", message: "the API is down" },
					}),
					{ status: 502 },
				),
		})
		await openDemo(page, "")
		await expect(
			page.getByText(
				"mdbrain is shared, source-linked memory for a company's people and AI agents.",
			),
		).toBeVisible()
		await expect(page.getByText(SECTION_LINE)).toBeVisible()
		for (const headline of HEADLINES) {
			await expect(page.getByText(headline)).toBeVisible()
		}
		await expect(beat(page, 1)).toHaveAttribute("data-readiness", "unreadable")
	})
})
