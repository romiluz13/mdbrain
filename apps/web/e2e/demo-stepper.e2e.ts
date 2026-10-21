// Chapter 5 as three beats: the first claim, the second claim, what mdbrain
// recorded. Stepped by button, by arrow key and by touch; the reveal moves only
// when the person does not ask for reduced motion.
import { expect, test, type Page } from "@playwright/test"
import {
	expectNoSeriousAccessibilityViolations,
	goto,
	mapReady,
	openDemo,
	settleContradiction,
	showBeat,
} from "./demo-helpers"
import { installDemoProxy } from "./demo-proxy"

const NEXT = /^Next beat/
const PREVIOUS = /Previous beat$/

// A run with no contradiction recorded has no walk to test; the states spec
// holds its honest state. Say skipped, not passed.
async function openWalk(page: Page): Promise<void> {
	const proxy = await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	await goto(page, 4)
	test.skip(
		(await settleContradiction(page, proxy)) !== "recorded",
		"this run records no contradiction yet, so chapter 5 has no walk-through",
	)
}

test("chapter 5 starts on its first claim and reveals the second claim, then the stamp", async ({
	page,
	isMobile,
}) => {
	await openWalk(page)
	const stepper = page.getByTestId("beat-stepper")
	const claims = page.getByTestId("contradiction-claim")
	const stamp = page.getByTestId("contradiction-stamp")
	await expect(stepper).toHaveAttribute("data-beat", "0")
	await expect(page.getByTestId("beat-status")).toHaveText(
		"Beat 1 of 3 · Claim one",
	)
	await expect(claims.nth(0)).toBeVisible()
	await expect(claims.nth(1)).toBeHidden()
	await expect(stamp).toBeHidden()

	await stepper.getByRole("button", { name: NEXT }).click()
	await expect(stepper).toHaveAttribute("data-beat", "1")
	await expect(page.getByTestId("beat-status")).toHaveText(
		"Beat 2 of 3 · Claim two",
	)
	await expect(claims.nth(1)).toBeVisible()
	await expect(stamp).toBeHidden()
	// Side by side, the first claim stays beside the second; on a phone each
	// beat is the one screen.
	if (isMobile) {
		await expect(claims.nth(0)).toBeHidden()
	} else {
		await expect(claims.nth(0)).toBeVisible()
	}

	await stepper.getByRole("button", { name: NEXT }).click()
	await expect(stepper).toHaveAttribute("data-beat", "2")
	await expect(page.getByTestId("beat-status")).toHaveText(
		"Beat 3 of 3 · Recorded",
	)
	await expect(stamp).toBeVisible()
	await expectNoSeriousAccessibilityViolations(page)

	await stepper.getByRole("button", { name: PREVIOUS }).click()
	await expect(stepper).toHaveAttribute("data-beat", "1")
	await expect(stamp).toBeHidden()
})

test("the end beats cannot be stepped past, and say so", async ({ page }) => {
	await openWalk(page)
	const stepper = page.getByTestId("beat-stepper")
	const previous = stepper.getByRole("button", { name: PREVIOUS })
	const next = stepper.getByRole("button", { name: NEXT })
	await expect(previous).toHaveAttribute("aria-disabled", "true")
	await expect(next).not.toHaveAttribute("aria-disabled", "true")
	// Playwright treats aria-disabled as not actionable; the press is the point.
	await previous.click({ force: true })
	await expect(stepper).toHaveAttribute("data-beat", "0")
	await showBeat(page, 2)
	await expect(next).toHaveAttribute("aria-disabled", "true")
	await expect(previous).not.toHaveAttribute("aria-disabled", "true")
	await next.click({ force: true })
	await expect(stepper).toHaveAttribute("data-beat", "2")
})

test("the arrow keys step the beats from the stepper while focus stays on it", async ({
	page,
}) => {
	await openWalk(page)
	const stepper = page.getByTestId("beat-stepper")
	const next = stepper.getByRole("button", { name: NEXT })
	await next.focus()
	await page.keyboard.press("ArrowRight")
	await expect(stepper).toHaveAttribute("data-beat", "1")
	await page.keyboard.press("ArrowRight")
	await expect(stepper).toHaveAttribute("data-beat", "2")
	await page.keyboard.press("ArrowRight")
	await expect(stepper).toHaveAttribute("data-beat", "2")
	await expect(next).toBeFocused()
	await page.keyboard.press("ArrowLeft")
	await expect(stepper).toHaveAttribute("data-beat", "1")
	await page.keyboard.press("Enter")
	await expect(stepper).toHaveAttribute("data-beat", "2")
	await expect(next).toBeFocused()
	// The chapter pager keeps its own arrow keys: stepping beats did not leave
	// the chapter.
	await expect(
		page.getByRole("heading", { level: 1, name: /contradiction/i }),
	).toBeVisible()
})

test("touch steps the beats", async ({ page, isMobile }) => {
	test.skip(!isMobile, "a tap is the phone's input")
	await openWalk(page)
	const stepper = page.getByTestId("beat-stepper")
	await stepper.getByRole("button", { name: NEXT }).tap()
	await expect(stepper).toHaveAttribute("data-beat", "1")
	await stepper.getByRole("button", { name: NEXT }).tap()
	await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
	await stepper.getByRole("button", { name: PREVIOUS }).tap()
	await expect(stepper).toHaveAttribute("data-beat", "1")
})

test.describe("motion", () => {
	test("a beat eases in when motion is allowed", async ({ page }) => {
		await openWalk(page)
		const started = await page.evaluate(async () => {
			document
				.querySelector<HTMLButtonElement>(
					'[data-testid="beat-stepper"] button:last-of-type',
				)
				?.click()
			await new Promise((resolve) => requestAnimationFrame(resolve))
			await new Promise((resolve) => requestAnimationFrame(resolve))
			return document
				.getAnimations()
				.flatMap((animation) =>
					animation instanceof CSSAnimation ? [animation.animationName] : [],
				)
		})
		expect(started.some((name) => name.includes("beat-in"))).toBe(true)
	})

	test.describe("with reduced motion", () => {
		test.use({ contextOptions: { reducedMotion: "reduce" } })

		test("a beat appears at once: nothing animates, and the stamp is not delayed", async ({
			page,
		}) => {
			await openWalk(page)
			await showBeat(page, 1)
			await showBeat(page, 2)
			await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
			expect(await page.evaluate(() => document.getAnimations().length)).toBe(0)
			expect(
				await page
					.getByTestId("contradiction-stamp")
					.evaluate((element) => getComputedStyle(element).animationName),
			).toBe("none")
		})
	})
})

test("the stepper's own controls are at least 44 px", async ({ page }) => {
	await openWalk(page)
	for (const beat of [0, 1, 2]) {
		await showBeat(page, beat)
		for (const name of [NEXT, PREVIOUS]) {
			const box = await page
				.getByTestId("beat-stepper")
				.getByRole("button", { name })
				.boundingBox()
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
			expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5)
		}
	}
})

test("on a phone the chapter is one screen per beat, not one long page", async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, "page length matters on the phone")
	await openWalk(page)
	const height = () =>
		page.evaluate(() => Math.round(document.documentElement.scrollHeight))
	const heights: number[] = []
	for (const beat of [0, 1, 2]) {
		await showBeat(page, beat)
		await page.waitForTimeout(100)
		heights.push(await height())
	}
	// The chapter was 4,200 CSS px tall with both full sources in the page.
	for (const px of heights) {
		expect(px).toBeLessThan(MAX_PHONE_BEAT_HEIGHT)
	}
})

const MAX_PHONE_BEAT_HEIGHT = 2400
