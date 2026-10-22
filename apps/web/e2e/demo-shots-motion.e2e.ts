// The brain in 3D and the story in motion, as pictures: chapter 1 in 3D and in
// 2D, chapter 5 on its last beat, and chapters 3 and 4 caught mid-motion and at
// rest, on a laptop, a phone and a 1920x1080 stage.
//   DEMO_SHOTS_DIR=/some/dir [T334_CHROME=<chrome>] \
//     bunx playwright test e2e/demo-shots-motion.e2e.ts --project=desktop-chromium
// The mid-motion frames stop Playwright's fake clock part-way through the
// tween: GSAP's ticker runs on the page's requestAnimationFrame.
import { expect, type Page, test } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import { VIEW_PREFERENCE_KEY } from "../lib/demo-data/view-preference"
import { BOUNDS_LAUNCH } from "./demo-bounds-kit"
import {
	goto,
	mapReady,
	openDemo,
	readsSettled,
	settleContradiction,
	settled,
	showBeat,
} from "./demo-helpers"
import { installDemoProxy } from "./demo-proxy"

const DIR = process.env.DEMO_SHOTS_DIR

test.skip(!DIR, "set DEMO_SHOTS_DIR to take the screenshots")
test.use({ launchOptions: BOUNDS_LAUNCH })

const SCREENS = {
	desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
	mobile: {
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
	},
	trailer: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
} as const

const THREE_D = '[data-view="3d"][data-drawn="true"]'

const tweens = (page: Page) =>
	page.evaluate(() => {
		const seam = Reflect.get(window, Symbol.for("mdbrain.demo.motion")) as {
			tweens: () => number
		}
		return seam.tweens()
	})

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for a move to be under way, then stops the page's clock there. */
async function freeze(page: Page, ready: string) {
	for (let tries = 0; tries < 150; tries += 1) {
		if ((await tweens(page)) > 0 && (await page.locator(ready).count()) > 0) {
			break
		}
		await pause(20)
	}
	// The clock keeps running until it is paused, so the time to pause at must be
	// a little ahead of the page's now.
	for (const ahead of [150, 400, 1000]) {
		const now = await page.evaluate(() => Date.now())
		try {
			await page.clock.pauseAt(now + ahead)
			break
		} catch {
			// The clock moved past it; try further ahead.
		}
	}
}

async function brought(page: Page, locator: string) {
	await page.locator(locator).first().scrollIntoViewIfNeeded()
	await page.evaluate(() => window.scrollBy(0, -80))
}

/** Centers the stage in the viewport at once: the page's smooth scrolling
 * would still be under way when the picture is taken. */
async function stageAtCenter(page: Page) {
	await page
		.locator("[data-view]")
		.first()
		.evaluate((el) =>
			el.scrollIntoView({ block: "center", behavior: "instant" }),
		)
}

for (const [name, screen] of Object.entries(SCREENS)) {
	test(`${name}: chapter 1 in 3D and 2D, chapter 5 on its last beat`, async ({
		browser,
	}) => {
		const flat = await browser.newContext({ ...screen })
		await flat.addInitScript(
			([key]) => localStorage.setItem(key as string, "2d"),
			[VIEW_PREFERENCE_KEY],
		)
		const flatPage = await flat.newPage()
		await installDemoProxy(flatPage)
		await openDemo(flatPage)
		await mapReady(flatPage)
		await readsSettled(flatPage)
		await expect(flatPage.locator('[data-view="2d"]')).toBeVisible()
		if (name === "mobile") {
			await stageAtCenter(flatPage)
		}
		await flatPage.screenshot({ path: `${DIR}/${name}-02-hero-2d.png` })
		await flat.close()

		const context = await browser.newContext({ ...screen })
		const page = await context.newPage()
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await expect(page.locator(THREE_D)).toBeVisible({ timeout: 60_000 })
		await readsSettled(page)
		await page.waitForTimeout(1200)
		if (name === "mobile") {
			await stageAtCenter(page)
		}
		await page.screenshot({ path: `${DIR}/${name}-01-hero-3d.png` })

		await goto(page, chapterIndex("contradiction"))
		if ((await settleContradiction(page, proxy)) !== "recorded") {
			throw new Error("the fixture run records no contradiction")
		}
		await showBeat(page, 1)
		await expect(page.locator(THREE_D)).toBeVisible({ timeout: 60_000 })
		await showBeat(page, 2)
		await settled(page)
		await page.waitForTimeout(1500)
		await brought(page, '[data-testid="scene-layer"]')
		await page.screenshot({ path: `${DIR}/${name}-03-conflict-beat3.png` })
		await context.close()
	})

	test(`${name}: chapters 3 and 4 mid-motion and at rest`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ ...screen })
		const page = await context.newPage()
		await page.clock.install()
		await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)

		await goto(page, chapterIndex("sources"))
		await freeze(page, '[data-testid="source-row"]')
		await page.clock.runFor(220)
		await page.screenshot({
			path: `${DIR}/${name}-04-sources-mid.png`,
			fullPage: true,
		})
		await page.clock.resume()
		await readsSettled(page)
		await settled(page)
		await page.evaluate(() => window.scrollTo(0, 0))
		await page.screenshot({
			path: `${DIR}/${name}-05-sources-final.png`,
			fullPage: true,
		})

		await goto(page, chapterIndex("agents"))
		await freeze(page, '[data-testid="handoff-arrow"]')
		await page.clock.runFor(150)
		await page.screenshot({
			path: `${DIR}/${name}-06-agents-mid-meter.png`,
			fullPage: true,
		})
		await page.clock.runFor(330)
		await page.screenshot({
			path: `${DIR}/${name}-06-agents-mid-arrow.png`,
			fullPage: true,
		})
		await page.clock.resume()
		await readsSettled(page)
		await settled(page)
		await page.evaluate(() => window.scrollTo(0, 0))
		await page.screenshot({
			path: `${DIR}/${name}-07-agents-final.png`,
			fullPage: true,
		})
		await context.close()
	})
}
