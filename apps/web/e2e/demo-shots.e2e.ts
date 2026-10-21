// A screenshot of every /demo chapter for the project it runs on, for review.
//   DEMO_SHOTS_DIR=/some/dir bunx playwright test e2e/demo-shots.e2e.ts
// Set DEMO_E2E_LIVE=1 to shoot a live stack instead of the fixture.
import { expect, type Page, test } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import { proxyError } from "../lib/demo-data/proxy-errors"
import {
	goto,
	mapReady,
	openDemo,
	settleContradiction,
	settled,
	showBeat,
} from "./demo-helpers"
import { installDemoProxy, LIVE, type ProxyOptions } from "./demo-proxy"

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
		// A click above can leave the page scrolled, and the sticky banner would
		// be captured mid-page over the lede.
		await page.evaluate(() => window.scrollTo(0, 0))
		await page.screenshot({
			path: `${DIR}/${testInfo.project.name}-${String(index + 1).padStart(2, "0")}-${chapter.id}.png`,
			fullPage: true,
		})
	})
}

// The states a live slot shows that the plain fixture does not: a run before its
// agent run, a claim stored with no evidence, sources the API cannot confirm,
// and chapters 3 and 4 in every state of the run.
const openSteps = async (page: Page) => {
	for (const summary of await page
		.getByTestId("agent-role")
		.locator("summary")
		.all()) {
		await summary.click()
	}
	await expect(
		page.locator('[data-testid="agent-step"][data-status="loading"]'),
	).toHaveCount(0)
}
const showMoreSources = async (page: Page) => {
	const more = page.getByRole("button", { name: "Show ten more" })
	for (let asked = 0; asked < 3; asked += 1) {
		await more.click()
	}
}
const STATES: Array<{
	name: string
	chapter: string
	options: ProxyOptions
	beat?: number
	act?: (page: Page) => Promise<void>
}> = [
	{
		name: "ch5-none",
		chapter: "contradiction",
		options: { contradiction: "none" },
	},
	{
		name: "ch5-unsourced",
		chapter: "contradiction",
		options: { contradiction: "unsourced" },
		beat: 1,
	},
	{
		name: "ch3-unconfirmed",
		chapter: "sources",
		options: {
			override: (url) =>
				url.pathname === "/api/demo/v1/cite"
					? proxyError(
							404,
							"CITATION_UNRESOLVED",
							"The source could not be confirmed in this run.",
						)
					: undefined,
		},
	},
	{ name: "ch3-more", chapter: "sources", options: {}, act: showMoreSources },
	{ name: "ch4-steps-open", chapter: "agents", options: {}, act: openSteps },
	{
		name: "ch4-step-missed",
		chapter: "agents",
		options: { run: { missedSteps: [2] } },
		act: openSteps,
	},
	{
		name: "ch4-no-steps",
		chapter: "agents",
		options: { run: { variant: "no-steps" } },
	},
	{
		name: "ch4-running",
		chapter: "agents",
		options: { run: { variant: "running" } },
	},
	{
		name: "ch4-incomplete",
		chapter: "agents",
		options: { run: { variant: "incomplete" } },
	},
	{
		name: "ch4-none",
		chapter: "agents",
		options: { run: { variant: "none" } },
	},
]

for (const state of STATES) {
	test(`state shot ${state.name}`, async ({ page }, testInfo) => {
		test.skip(LIVE, "the states are forced through the generated fixture")
		const proxy = await installDemoProxy(page, state.options)
		await openDemo(page)
		await mapReady(page)
		await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
		await goto(
			page,
			CHAPTERS.findIndex((entry) => entry.id === state.chapter),
		)
		if (state.chapter === "contradiction") {
			await settleContradiction(page, proxy)
			if (state.beat !== undefined) {
				await showBeat(page, state.beat)
			}
		}
		await state.act?.(page)
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
		await expect(
			page.locator('[data-testid="source-row"][data-status="loading"]'),
		).toHaveCount(0)
		await settled(page)
		await page.screenshot({
			path: `${DIR}/${testInfo.project.name}-state-${state.name}.png`,
			fullPage: true,
		})
	})
}
