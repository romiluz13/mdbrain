// A screenshot of every /demo chapter for the project it runs on, for review.
//   DEMO_SHOTS_DIR=/some/dir bunx playwright test e2e/demo-shots.e2e.ts
// Set DEMO_E2E_LIVE=1 to shoot a live stack instead of the fixture.
import { expect, test } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import {
	goto,
	mapReady,
	openDemo,
	settleContradiction,
	settled,
	showBeat,
} from "./demo-helpers"
import { installDemoProxy } from "./demo-proxy"

const DIR = process.env.DEMO_SHOTS_DIR

test.skip(!DIR, "set DEMO_SHOTS_DIR to take the screenshots")

for (const [index, chapter] of CHAPTERS.entries()) {
	test(`shot ${index + 1} ${chapter.id}`, async ({ page }, testInfo) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
		if (index > 0) {
			await goto(page, index)
		}
		await expect(
			page.getByRole("heading", { level: 1, name: chapter.title }),
		).toBeVisible()
		if (chapter.id === "ask") {
			await page
				.getByRole("list", { name: "Example questions" })
				.getByRole("button")
				.first()
				.click()
			await expect(page.getByTestId("ask-hit").first()).toBeVisible()
		} else if (chapter.id === "hood") {
			await page.getByRole("button", { name: "Run this read" }).first().click()
			await expect(page.getByTestId("read-status")).toBeVisible()
		} else if (chapter.id === "run") {
			await page.getByRole("button", { name: "Read everything again" }).click()
			await expect(page.locator('[data-reread="pages"]')).toContainText(
				"matches",
			)
		} else if (chapter.id === "contradiction") {
			if ((await settleContradiction(page, proxy)) === "recorded") {
				// The walk-through is the chapter: one shot per beat before the
				// final one every chapter gets.
				for (const beat of [0, 1]) {
					await showBeat(page, beat)
					await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
					await settled(page)
					await page.screenshot({
						path: `${DIR}/${testInfo.project.name}-${String(index + 1).padStart(2, "0")}-${chapter.id}-beat${beat + 1}.png`,
						fullPage: true,
					})
				}
				await showBeat(page, 2)
			}
		}
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
		const canvas = page.locator('canvas[data-layer="static"]').first()
		if ((await canvas.count()) > 0) {
			await expect(canvas).toHaveAttribute("data-draws", /[1-9]/)
		}
		await settled(page)
		await page.screenshot({
			path: `${DIR}/${testInfo.project.name}-${String(index + 1).padStart(2, "0")}-${chapter.id}.png`,
			fullPage: true,
		})
	})
}
