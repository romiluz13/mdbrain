// A chapter that is left and opened again leaves one scene behind, not two.
// `next dev` runs every effect twice on mount (setup, cleanup, setup), so a
// missing cleanup shows here at once; a production build shows it as growth
// over the visits. The counters come from the bounds kit's page instrumentation.
import { expect, test } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import { INSTRUMENT, counts } from "./demo-bounds-kit"
import { goto, mapReady, openDemo, readsSettled, settled } from "./demo-helpers"
import { installDemoProxy } from "./demo-proxy"

const THREE_D = '[data-view="3d"][data-drawn="true"]'
// R3F frees a canvas's GL context about 500 ms after it leaves the page.
const CONTEXT_FREED = 1200
const VISITS = 3

test("leaving the 3D brain and coming back leaves no second context, tween or listener", async ({
	page,
}) => {
	test.slow()
	const pageErrors: string[] = []
	page.on("pageerror", (error) => pageErrors.push(String(error)))
	await installDemoProxy(page)
	await page.addInitScript(INSTRUMENT)
	await openDemo(page)
	await mapReady(page)
	await expect(page.locator(THREE_D)).toBeVisible({ timeout: 60_000 })
	await readsSettled(page)
	await settled(page)

	const first = await counts(page)
	expect(first.gl.live).toBeLessThanOrEqual(1)
	expect(first.tweens).toBe(0)

	const away = []
	const back = []
	for (let visit = 0; visit < VISITS; visit += 1) {
		await goto(page, chapterIndex("sources"))
		await page.waitForTimeout(CONTEXT_FREED)
		await settled(page)
		away.push(await counts(page))
		await goto(page, chapterIndex("brain"))
		await expect(page.locator(THREE_D)).toBeVisible({ timeout: 60_000 })
		await readsSettled(page)
		await settled(page)
		back.push(await counts(page))
	}

	for (const left of away) {
		expect(left.gl.live).toBe(0)
		expect(left.tweens).toBe(0)
	}
	for (const [visit, returned] of back.entries()) {
		expect(returned.gl.live).toBeLessThanOrEqual(1)
		expect(returned.tweens).toBe(0)
		expect(returned.listeners).toBeLessThanOrEqual(back[0]?.listeners ?? 0)
		expect(away[visit]?.listeners).toBeLessThanOrEqual(away[0]?.listeners ?? 0)
	}
	expect(pageErrors).toEqual([])
})
