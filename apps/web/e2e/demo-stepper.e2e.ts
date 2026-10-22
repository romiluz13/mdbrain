// Chapter 5 as three beats: the first claim, the second claim, what mdbrain
// recorded. Stepped by button, by arrow key and by touch; the reveal moves only
// when the person does not ask for reduced motion.
import { expect, test, type Page } from "@playwright/test"
import type { MotionSeam } from "../app/demo/motion/motion"
import {
	expectNoSeriousAccessibilityViolations,
	goto,
	mapReady,
	openDemo,
	settleContradiction,
	settled,
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
	test("a beat eases in when motion is allowed, its sources sliding in from the side its claim sits on", async ({
		page,
	}) => {
		await openWalk(page)
		const midMove = await page.evaluate(async () => {
			const seam = Reflect.get(window, Symbol.for("mdbrain.demo.motion")) as {
				tweens: () => number
			}
			document
				.querySelector<HTMLButtonElement>(
					'[data-testid="beat-stepper"] button:last-of-type',
				)
				?.click()
			await new Promise((resolve) => requestAnimationFrame(resolve))
			const step = document.querySelector('[data-current="true"]')
			return {
				tweens: seam.tweens(),
				opacity: step ? Number(getComputedStyle(step).opacity) : -1,
				slipShift: [
					...(step?.querySelectorAll('[data-testid="claim-slip"]') ?? []),
				].map(
					(slip) => new DOMMatrixReadOnly(getComputedStyle(slip).transform).m41,
				),
			}
		})
		expect(midMove.tweens).toBeGreaterThan(0)
		expect(midMove.opacity).toBeLessThan(1)
		expect(midMove.slipShift.length).toBeGreaterThan(0)
		// The second claim sits on the right, so its sources come from the right.
		expect(midMove.slipShift.every((shift) => shift > 0)).toBe(true)
		await settled(page)
		const current = page.locator('[data-current="true"]')
		expect((await current.getAttribute("style")) ?? "").not.toContain("opacity")
		await expect(current).toHaveCSS("opacity", "1")
	})

	test("the recorded stamp lands: it arrives larger and turned, and rests at its own tilt", async ({
		page,
	}) => {
		await openWalk(page)
		await showBeat(page, 1)
		await settled(page)
		const stamp = page.getByTestId("contradiction-stamp")
		const rest = await stamp.evaluate((element) => {
			// hidden until the last beat, so read the tilt the stylesheet gives it
			element.removeAttribute("hidden")
			const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
			element.setAttribute("hidden", "")
			return matrix.a
		})
		// Read the stamp in the task that creates its move. On a loaded host the
		// first frame can arrive after the move has run past its start, and where
		// the move starts is what this asserts.
		const start = await page.evaluate(async () => {
			const seam = Reflect.get(
				window,
				Symbol.for("mdbrain.demo.motion"),
			) as MotionSeam
			document
				.querySelector<HTMLButtonElement>(
					'[data-testid="beat-stepper"] button:last-of-type',
				)
				?.click()
			for (let turn = 0; turn < 20 && seam.tweens() === 0; turn += 1) {
				await Promise.resolve()
			}
			const element = document.querySelector(
				'[data-testid="contradiction-stamp"]',
			)
			if (!element) {
				return null
			}
			const style = getComputedStyle(element)
			return {
				tweens: seam.tweens(),
				opacity: Number(style.opacity),
				scale: new DOMMatrixReadOnly(style.transform).a,
			}
		})
		expect(start?.tweens, "the stamp's move has started").toBeGreaterThan(0)
		expect(start?.opacity).toBeLessThan(1)
		expect(start?.scale).toBeGreaterThan(rest)
		await settled(page)
		await expect(stamp).toHaveCSS("opacity", "1")
		const landed = await stamp.evaluate(
			(element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
		)
		expect(landed).toBeCloseTo(rest, 4)
		expect((await stamp.getAttribute("style")) ?? "").toBe("")
	})

	test("stepping on while a move is under way ends that move where it was going: a click ahead skips it", async ({
		page,
	}) => {
		await openWalk(page)
		await settled(page)
		const next = page
			.getByTestId("beat-stepper")
			.getByRole("button", { name: NEXT })
		// Both clicks in one page task: no round trip to the browser sits between
		// seeing the move run and clicking ahead.
		const underWay = await next.evaluate(async (element) => {
			const button = element as HTMLButtonElement
			const seam = Reflect.get(
				window,
				Symbol.for("mdbrain.demo.motion"),
			) as MotionSeam
			button.click()
			const deadline = performance.now() + 5000
			while (seam.tweens() === 0 && performance.now() < deadline) {
				await new Promise((resolve) => requestAnimationFrame(resolve))
			}
			const running = seam.tweens() > 0
			button.click()
			return running
		})
		expect(
			underWay,
			"the first move is running when the second click lands",
		).toBe(true)
		const skipped = page
			.getByTestId("contradiction-claim")
			.nth(1)
			.locator("xpath=ancestor::li[1]")
		expect((await skipped.getAttribute("style")) ?? "").toBe("")
		await expect(skipped).toHaveCSS("opacity", "1")
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
		await settled(page)
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

test("the stepper sticks flush under the synthetic-company banner, with no gap for the page to show through", async ({
	page,
}) => {
	await openWalk(page)
	await showBeat(page, 2)
	// The chapter's enter motion moves the stepper a few pixels until it ends.
	await settled(page)
	await page.evaluate(() => {
		const stepper = document.querySelector('[data-testid="beat-stepper"]')
		const top = (stepper?.getBoundingClientRect().top ?? 0) + window.scrollY
		// Far enough for the stepper to be stuck, not so far that its chapter ends.
		window.scrollTo({ top, behavior: "instant" })
	})
	const edges = await page.evaluate(() => ({
		barBottom:
			document
				.querySelector('[data-testid="synthetic-label"]')
				?.getBoundingClientRect().bottom ?? Number.NaN,
		stepperTop:
			document
				.querySelector('[data-testid="beat-stepper"]')
				?.getBoundingClientRect().top ?? Number.NaN,
	}))
	expect(edges.stepperTop).toBeGreaterThan(0)
	expect(Math.abs(edges.stepperTop - edges.barBottom)).toBeLessThanOrEqual(0.5)
})

for (const width of [390, 360]) {
	test(`at ${width} px the stepper is one row, so its bar stays short`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 844 })
		await openWalk(page)
		for (const beat of [0, 1, 2]) {
			await showBeat(page, beat)
			const row = await page.evaluate(() => {
				const stepper = document.querySelector('[data-testid="beat-stepper"]')
				const centers = [...(stepper?.children ?? [])].map((child) => {
					const box = child.getBoundingClientRect()
					return box.top + box.height / 2
				})
				return {
					spread: Math.max(...centers) - Math.min(...centers),
					height: stepper?.getBoundingClientRect().height ?? 0,
				}
			})
			expect(
				row.spread,
				`beat ${beat + 1}: the controls share a row`,
			).toBeLessThan(2)
			expect(
				row.height,
				`beat ${beat + 1}: the bar is one control tall`,
			).toBeLessThan(70)
		}
	})
}

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
