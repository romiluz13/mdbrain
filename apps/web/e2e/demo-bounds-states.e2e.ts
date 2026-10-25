// The D15 bounds for the fallbacks and the layout: WebGL off, a lost context
// and reduced motion fall back to the flat map; no chapter scrolls sideways at
// 390 px; the scene fills its stage at 1920x1080. Run on demand, one worker, on
// a production build, as demo-bounds.e2e.ts is:
//   DEMO_BOUNDS=1 DEMO_BASE_URL=http://127.0.0.1:3041 DEMO_BOUNDS_OUT=<dir> \
//     [DEMO_CHROME=<chrome>] [DEMO_BOUNDS_GL=software] \
//     bunx playwright test e2e/demo-bounds-states.e2e.ts --project=desktop-chromium --workers=1
import { expect, type Page, test } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import {
	BOUNDS_LAUNCH,
	CHAPTERS_TOTAL,
	counts,
	errorsOf,
	FIRST_FRAME,
	GL,
	LINK,
	MOBILE_THROTTLE,
	rig,
	sample,
	save,
} from "./demo-bounds-kit"
import {
	goto,
	settleContradiction,
	showBeat,
	unexplainedBrowserErrors,
} from "./demo-helpers"

test.skip(!process.env.DEMO_BOUNDS, "set DEMO_BOUNDS=1 to measure")
test.setTimeout(900_000)
test.use({ launchOptions: BOUNDS_LAUNCH })

test.describe(`D15 bounds on the production build (${GL} GL)`, () => {
	for (const profile of ["desktop", "mobile"] as const) {
		test(`WebGL off, context lost and reduced motion each fall back to the flat map: ${profile}`, async ({
			browser,
		}) => {
			const outcome: Record<string, unknown> = { profile, gl: GL }
			const link = profile === "mobile" ? LINK : undefined
			const flat = (page: Page) =>
				page.waitForFunction(
					() =>
						document.querySelector("[data-view]")?.getAttribute("data-view") ===
							"2d" &&
						document.querySelector('[data-testid="scene-layer"]') === null,
					undefined,
					{ timeout: 20_000 },
				)
			const status = async (page: Page) => {
				const note = page.getByTestId("graph-view-status").first()
				await expect(note).toContainText(/Flat map(, because|\. Your choice)/, {
					timeout: 20_000,
				})
				return note.innerText()
			}
			const rest = async (page: Page) => {
				const read = () =>
					page.evaluate(() =>
						(window as unknown as { __rafCalls: () => number }).__rafCalls(),
					)
				// GSAP's ticker asks for frames for 120 more ticks after its last tween
				// (`autoSleep`): about 2 s at 60 fps, longer on a slow phone. Rest begins
				// when it has gone to sleep; a loop that never ends still fails here.
				await expect
					.poll(
						async () => {
							const first = await read()
							await page.waitForTimeout(1000)
							return (await read()) - first
						},
						{ timeout: 30_000, intervals: [0] },
					)
					.toBe(0)
				await page.waitForTimeout(1500)
				const before = await read()
				await page.waitForTimeout(1500)
				return Math.round((((await read()) - before) / 1.5) * 10) / 10
			}

			// WebGL is not there at all.
			{
				const { context, page, proxy } = await rig(browser, profile, { link })
				const errors = errorsOf(page)
				await page.addInitScript(() => {
					const original = HTMLCanvasElement.prototype.getContext
					HTMLCanvasElement.prototype.getContext = function (
						this: HTMLCanvasElement,
						type: string,
						...rest: unknown[]
					) {
						return /webgl/.test(type)
							? null
							: (original as (...a: unknown[]) => unknown).call(
									this,
									type,
									...rest,
								)
					} as typeof original
				})
				const started = Date.now()
				await page.goto("/demo#brain")
				await flat(page)
				const reason = await status(page)
				outcome.webglOff = {
					flatAndReasonAfterMs: Date.now() - started,
					status: reason,
					glCreated: (await counts(page)).gl.created,
					unexplainedErrors: unexplainedBrowserErrors(proxy, errors),
				}
				await context.close()
			}

			// The context is lost while the scene is running.
			{
				const { context, page, proxy } = await rig(browser, profile, { link })
				const errors = errorsOf(page)
				await page.goto("/demo#brain")
				await page.waitForFunction(FIRST_FRAME, undefined, { timeout: 90_000 })
				const lost = Date.now()
				await page.evaluate(() => {
					const canvas = document.querySelector(
						'[data-testid="scene-layer"] canvas',
					) as HTMLCanvasElement
					const gl = (canvas.getContext("webgl2") ??
						canvas.getContext("webgl")) as WebGLRenderingContext
					gl.getExtension("WEBGL_lose_context")?.loseContext()
				})
				await flat(page)
				outcome.contextLost = {
					flatAfterMs: Date.now() - lost,
					status: await status(page),
					unexplainedErrors: unexplainedBrowserErrors(proxy, errors),
				}
				await context.close()
			}

			// Reduced motion is set before the page loads.
			{
				const { context, page, proxy } = await rig(browser, profile, {
					link,
					reducedMotion: "reduce",
				})
				const errors = errorsOf(page)
				await page.goto("/demo#brain")
				await flat(page)
				await page.waitForFunction(
					() =>
						(window as unknown as { __tweens: () => number }).__tweens() === 0,
				)
				const requests = await rest(page)
				outcome.reducedBeforeLoad = {
					motion: await page
						.locator("[data-motion]")
						.first()
						.getAttribute("data-motion"),
					status: await status(page),
					tweens: (await counts(page)).tweens,
					frameRequestsInOneSecond: requests,
					sceneFramesDrawn: await page.evaluate(
						() => performance.getEntriesByName("demo-scene-first-frame").length,
					),
					glCreated: (await counts(page)).gl.created,
					unexplainedErrors: unexplainedBrowserErrors(proxy, errors),
				}
				await context.close()
			}

			// Reduced motion is switched on while the scene is drifting.
			{
				const { context, page, proxy } = await rig(browser, profile, { link })
				const errors = errorsOf(page)
				await page.goto("/demo#brain")
				await page.waitForFunction(FIRST_FRAME, undefined, { timeout: 90_000 })
				const drifting = await sample(page, 800)
				const changed = Date.now()
				await page.emulateMedia({ reducedMotion: "reduce" })
				await flat(page)
				const stoppedAfterMs = Date.now() - changed
				await page.waitForFunction(
					() =>
						(window as unknown as { __tweens: () => number }).__tweens() === 0,
				)
				const requests = await rest(page)
				outcome.reducedAtRuntime = {
					driftingFpsBefore: drifting.drawnFps,
					flatAfterMs: stoppedAfterMs,
					status: await status(page),
					tweens: (await counts(page)).tweens,
					frameRequestsInOneSecond: requests,
					glLive: (await counts(page)).gl.live,
					unexplainedErrors: unexplainedBrowserErrors(proxy, errors),
				}
				await context.close()
			}

			save(`fallbacks-${profile}`, outcome)
			console.log(JSON.stringify(outcome))
			const all = outcome as Record<string, Record<string, unknown>>
			for (const key of [
				"webglOff",
				"contextLost",
				"reducedBeforeLoad",
				"reducedAtRuntime",
			]) {
				expect(all[key]?.unexplainedErrors, key).toEqual([])
			}
			expect(all.reducedBeforeLoad?.tweens).toBe(0)
			expect(all.reducedBeforeLoad?.frameRequestsInOneSecond).toBe(0)
			expect(all.reducedBeforeLoad?.sceneFramesDrawn).toBe(0)
			expect(all.reducedAtRuntime?.tweens).toBe(0)
			expect(all.reducedAtRuntime?.frameRequestsInOneSecond).toBe(0)
			expect(all.reducedAtRuntime?.glLive).toBe(0)
		})
	}

	test("390 px: no chapter scrolls sideways, and a swipe on the map scrolls the page", async ({
		browser,
	}) => {
		const { context, page, cdp, proxy } = await rig(browser, "mobile", {
			link: LINK,
		})
		const errors = errorsOf(page)
		await page.goto("/demo#brain")
		await page.waitForFunction(FIRST_FRAME, undefined, { timeout: 90_000 })
		const chapters: Array<Record<string, unknown>> = []
		for (let at = 0; at < CHAPTERS_TOTAL; at++) {
			if (at > 0) {
				await goto(page, at)
			}
			await page.waitForTimeout(900)
			chapters.push({
				chapter: at + 1,
				...(await page.evaluate(() => ({
					scrollWidth: document.documentElement.scrollWidth,
					innerWidth: window.innerWidth,
				}))),
			})
		}
		await goto(page, chapterIndex("brain"))
		await page.waitForFunction(
			() =>
				document.querySelector('[data-view="3d"][data-drawn="true"]') !== null,
			undefined,
			{ timeout: 60_000 },
		)
		const swipe = async (label: string) => {
			await page.getByTestId("scene-layer").scrollIntoViewIfNeeded()
			await page.evaluate(() => window.scrollBy(0, 0))
			const box = await page.getByTestId("scene-layer").boundingBox()
			if (!box) {
				throw new Error("the map has no box")
			}
			const before = await page.evaluate(() => window.scrollY)
			await cdp.send("Input.synthesizeScrollGesture", {
				x: Math.round(box.x + box.width / 2),
				y: Math.round(box.y + box.height / 2),
				yDistance: -220,
				gestureSourceType: "touch",
				speed: 700,
			})
			await page.waitForTimeout(400)
			return {
				label,
				scrolledPx: (await page.evaluate(() => window.scrollY)) - before,
			}
		}
		const swipes = [await swipe("swipe on the 3D map")]
		await page.getByRole("button", { name: "Turn the map" }).click()
		swipes.push(await swipe("swipe while turning the map (opt-in)"))
		await page.getByRole("button", { name: "Done turning" }).click()
		swipes.push(await swipe("swipe after Done turning"))
		const result = {
			throttle: MOBILE_THROTTLE,
			chapters,
			swipes,
			unexplainedErrors: unexplainedBrowserErrors(proxy, errors),
		}
		save("layout390", result)
		console.log(JSON.stringify(result))
		for (const chapter of chapters) {
			expect(
				chapter.scrollWidth,
				`chapter ${chapter.chapter}`,
			).toBeLessThanOrEqual(390)
		}
		expect(swipes[0]?.scrolledPx).toBeGreaterThan(150)
		expect(Math.abs(swipes[1]?.scrolledPx ?? 99)).toBeLessThan(20)
		expect(swipes[2]?.scrolledPx).toBeGreaterThan(150)
		expect(result.unexplainedErrors).toEqual([])
		await context.close()
	})

	test("1920x1080: the scene fills its stage and the take shifts no layout", async ({
		browser,
	}) => {
		const { context, page, proxy } = await rig(browser, "trailer")
		const errors = errorsOf(page)
		await page.goto("/demo#brain")
		await page.waitForFunction(
			() =>
				document.querySelector('[data-view="3d"][data-drawn="true"]') !== null,
			undefined,
			{ timeout: 60_000 },
		)
		await page.waitForFunction(
			() => (window as unknown as { __tweens: () => number }).__tweens() === 0,
		)
		const fill = async () =>
			page.evaluate(() => {
				const layer = document.querySelector(
					'[data-testid="scene-layer"]',
				) as HTMLElement
				const stage = layer.parentElement as HTMLElement
				const canvas = layer.querySelector("canvas") as HTMLCanvasElement
				const l = layer.getBoundingClientRect()
				const s = stage.getBoundingClientRect()
				const c = canvas.getBoundingClientRect()
				return {
					stage: [Math.round(s.width), Math.round(s.height)],
					scene: [Math.round(l.width), Math.round(l.height)],
					canvasCss: [Math.round(c.width), Math.round(c.height)],
					canvasPixels: [canvas.width, canvas.height],
					pixelRatio: Math.round((canvas.width / c.width) * 100) / 100,
					fillShare:
						Math.round(((c.width * c.height) / (s.width * s.height)) * 1000) /
						1000,
					scrollWidth: document.documentElement.scrollWidth,
					scrollHeight: document.documentElement.scrollHeight,
					viewport: [innerWidth, innerHeight],
					textTransforms: [...document.querySelectorAll("h1, h2, p, button")]
						.map((el) => getComputedStyle(el).transform)
						.filter((value) => value !== "none").length,
				}
			})
		const hero = await fill()
		const shiftsAfterHero = await page.evaluate(() =>
			(window as unknown as { __shifts: () => Array<{ value: number }> })
				.__shifts()
				.reduce((sum, shift) => sum + shift.value, 0),
		)
		await goto(page, chapterIndex("contradiction"))
		const recorded = await settleContradiction(page, proxy)
		let chapter5: Record<string, unknown> | null = null
		if (recorded === "recorded") {
			await showBeat(page, 1)
			await page.waitForFunction(
				() =>
					document.querySelector('[data-view="3d"][data-drawn="true"]') !==
					null,
				undefined,
				{ timeout: 60_000 },
			)
			await showBeat(page, 2)
			await page.waitForTimeout(1500)
			chapter5 = await fill()
		}
		const shifts = await page.evaluate(() =>
			(
				window as unknown as {
					__shifts: () => Array<{
						value: number
						recentInput: boolean
						at: number
						nodes: string[]
						rects: number[][]
					}>
				}
			).__shifts(),
		)
		const result = {
			viewport: "1920x1080, DPR 1, no throttle",
			hero,
			chapter5,
			shifts: shifts.map((shift) => ({
				...shift,
				value: Math.round(shift.value * 10000) / 10000,
			})),
			layoutShift: {
				afterHeroLoad: Math.round(shiftsAfterHero * 10000) / 10000,
				wholeTake:
					Math.round(
						shifts.reduce((sum, shift) => sum + shift.value, 0) * 10000,
					) / 10000,
				withoutRecentInput:
					Math.round(
						shifts
							.filter((shift) => !shift.recentInput)
							.reduce((sum, shift) => sum + shift.value, 0) * 10000,
					) / 10000,
				entries: shifts.length,
			},
			unexplainedErrors: unexplainedBrowserErrors(proxy, errors),
		}
		save("trailer1080", result)
		console.log(JSON.stringify(result))
		expect(hero.fillShare).toBeGreaterThanOrEqual(0.99)
		expect(hero.pixelRatio).toBeGreaterThanOrEqual(1)
		expect(hero.scrollWidth).toBeLessThanOrEqual(1920)
		expect(result.layoutShift.afterHeroLoad).toBeLessThan(0.05)
		expect(result.layoutShift.withoutRecentInput).toBeLessThan(0.1)
		expect(result.unexplainedErrors).toEqual([])
		await context.close()
	})
})
