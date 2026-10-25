// The story's proof intent: "See it" lands on the recorded end state with the
// heading focused and "Back to the story" shown, and the sequence story, proof,
// rewind, story, proof lands on the same end state again.
import { expect, test } from "@playwright/test"
import { openDemo, settleContradiction, tabTo } from "./demo-helpers"
import { GENERATED, installDemoProxy } from "./demo-proxy"

const CAUGHT = { level: 1, name: "Caught: a disagreement" } as const
const STORY = { level: 1, name: "The story" } as const
const BACK = { name: "Back to the story" } as const

/** The story reads the run and the map; its first beat is judged once both have answered. */
const storyReady = (page: import("@playwright/test").Page) =>
	expect(page.getByTestId("story-beat-1")).toHaveAttribute(
		"data-readiness",
		"shown",
		{ timeout: 30_000 },
	)

test.describe("story proof intent", () => {
	test.skip(!GENERATED, "the proof walk runs on the generated fixture")

	test("story, proof, rewind, story, proof lands on the end state each time", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await expect(page.getByRole("heading", STORY)).toBeVisible()
		await expect(page.getByText("Chapter 1 of 10")).toBeVisible()
		await storyReady(page)

		await page
			.getByTestId("story-beat-1")
			.getByRole("button", { name: "See it" })
			.click()
		await expect(page.getByRole("heading", CAUGHT)).toBeFocused()
		expect(await settleContradiction(page, proxy)).toBe("recorded")
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
		await expect(page.getByRole("button", BACK)).toBeVisible()

		const slider = page.getByTestId("playback-slider")
		const end = await slider.inputValue()
		await slider.focus()
		await page.keyboard.press("Home")
		await expect(slider).not.toHaveValue(end)

		await page.getByRole("button", BACK).click()
		await expect(page.getByRole("heading", STORY)).toBeFocused()
		await expect(page.getByRole("button", BACK)).toHaveCount(0)

		await page
			.getByTestId("story-beat-1")
			.getByRole("button", { name: "See it" })
			.click()
		await expect(page.getByRole("heading", CAUGHT)).toBeFocused()
		await expect(page.getByTestId("playback-slider")).toHaveValue(end)
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
	})

	test("the keyboard reaches See it and Back to the story", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page)
		await storyReady(page)
		const see = page
			.getByTestId("story-beat-1")
			.getByRole("button", { name: "See it" })
		await tabTo(page, see)
		await page.keyboard.press("Enter")
		await expect(page.getByRole("heading", CAUGHT)).toBeFocused()
		const back = page.getByRole("button", BACK)
		await tabTo(page, back)
		await page.keyboard.press("Enter")
		await expect(page.getByRole("heading", STORY)).toBeFocused()
	})

	test("an ordinary chapter link shows no Back to the story", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page)
		await storyReady(page)
		await page
			.getByRole("button", { name: "Caught: a disagreement", exact: true })
			.click()
		await expect(page.getByRole("heading", CAUGHT)).toBeFocused()
		await expect(page.getByRole("button", BACK)).toHaveCount(0)
	})
})
