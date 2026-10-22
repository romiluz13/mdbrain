// The D15 bounds for the brain in 3D and the story in motion, measured on a
// production build (`next build` then `next start`). Run on demand, one worker:
//   DEMO_BOUNDS=1 DEMO_BASE_URL=http://127.0.0.1:3041 DEMO_BOUNDS_OUT=<dir> \
//     [DEMO_CHROME=<chrome>] [DEMO_BOUNDS_GL=software] \
//     bunx playwright test e2e/demo-bounds.e2e.ts --project=desktop-chromium --workers=1
// DEMO_CHROME is a Chrome for Testing whose GL goes to the GPU; without it the
// browser is Playwright's, drawing with SwiftShader (the software bracket).
import { expect, test } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import {
	BOUNDS_LAUNCH,
	CHAPTERS_TOTAL,
	counts,
	errorsOf,
	FIRST_FRAME,
	flightSample,
	GL,
	LINK,
	MOBILE_THROTTLE,
	median,
	rig,
	sample,
	sceneNow,
	save,
	viewOf,
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
	test("primary content is interactive within 3 s on the throttled phone", async ({
		browser,
	}) => {
		const RUNS = 5
		const runs: Array<Record<string, number | null>> = []
		for (let run = 0; run < RUNS; run++) {
			const { context, page, cdp, proxy } = await rig(browser, "mobile", {
				link: LINK,
			})
			const errors = errorsOf(page)
			let bytes = 0
			const types = new Map<string, string>()
			const byType = new Map<string, number>()
			cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type))
			cdp.on("Network.loadingFinished", (e) => {
				bytes += e.encodedDataLength
				const type = types.get(e.requestId) ?? "Other"
				byType.set(type, (byType.get(type) ?? 0) + e.encodedDataLength)
			})
			await page.goto("/demo", { waitUntil: "commit" })
			await page.waitForFunction(
				() =>
					(window as unknown as { __settledAt?: number }).__settledAt !==
					undefined,
				undefined,
				{ timeout: 120_000 },
			)
			const times = await page.evaluate(() => {
				const w = window as unknown as {
					__readyAt: number
					__settledAt: number
				}
				return {
					ready: w.__readyAt,
					settled: w.__settledAt,
					fcp:
						performance.getEntriesByName("first-contentful-paint")[0]
							?.startTime ?? null,
				}
			})
			// The click lands while the 3D island is loading: the page must answer it.
			const answered = await page.evaluate(async () => {
				const next = [...document.querySelectorAll("button")].find((b) =>
					b.textContent?.trim().endsWith("→"),
				)
				const started = performance.now()
				next?.click()
				await new Promise((resolve) => requestAnimationFrame(resolve))
				await new Promise((resolve) => requestAnimationFrame(resolve))
				return performance.now() - started
			})
			await page.goBack().catch(() => undefined)
			await context.close()
			runs.push({
				ready: Math.round(times.ready),
				settled: Math.round(times.settled),
				fcp: times.fcp === null ? null : Math.round(times.fcp),
				answerMs: Math.round(answered),
				kb: Math.round(bytes / 1024),
				scriptKb: Math.round((byType.get("Script") ?? 0) / 1024),
				errors: unexplainedBrowserErrors(proxy, errors).length,
			})
		}
		// The island is lazy, so its first frame comes after the page is ready; a
		// run of its own, left alone, shows when.
		const island = await rig(browser, "mobile", { link: LINK })
		await island.page.goto("/demo", { waitUntil: "commit" })
		await island.page.waitForFunction(FIRST_FRAME, undefined, {
			timeout: 120_000,
		})
		const firstFrameMs = await island.page.evaluate(() =>
			Math.round(
				performance.getEntriesByName("demo-scene-first-frame")[0]?.startTime ??
					-1,
			),
		)
		await island.context.close()
		const warm = runs.slice(1)
		const readyList = warm.map((r) => r.ready as number)
		const result = {
			throttle: MOBILE_THROTTLE,
			link: "reads modeled in the browser: 150 ms each, gzipped bodies on a shared 9 Mbit/s downlink",
			note: "run 1 warms the server and is dropped; the other four are reported",
			readyMs: {
				median: median(readyList),
				min: Math.min(...readyList),
				max: Math.max(...readyList),
			},
			settledMs: { median: median(warm.map((r) => r.settled as number)) },
			sceneFirstFrameMs: firstFrameMs,
			fcpMs: { median: median(warm.map((r) => (r.fcp ?? 0) as number)) },
			answerMs: { median: median(warm.map((r) => r.answerMs as number)) },
			transferredKb: median(warm.map((r) => r.kb as number)),
			scriptKb: median(warm.map((r) => r.scriptKb as number)),
			runs,
		}
		save("ready", result)
		console.log(JSON.stringify(result))
		expect(result.readyMs.max).toBeLessThan(3000)
		expect(result.settledMs.median).toBeLessThan(3000)
		expect(runs.every((r) => r.errors === 0)).toBe(true)
	})

	for (const profile of ["desktop", "mobile"] as const) {
		test(`the brain runs at 30 fps or better: ${profile}`, async ({
			browser,
		}) => {
			const { context, page, proxy } = await rig(browser, profile, {
				link: profile === "mobile" ? LINK : undefined,
			})
			const errors = errorsOf(page)
			await page.goto("/demo")
			await page.waitForFunction(FIRST_FRAME, undefined, { timeout: 90_000 })
			const drift = await sample(page, 5000)
			const result: Record<string, unknown> = {
				profile,
				throttle:
					profile === "mobile"
						? MOBILE_THROTTLE
						: "desktop 1440x900, no throttle",
				gl: GL,
				heroDrift: { ...drift, view: await viewOf(page) },
			}

			if (profile === "desktop") {
				const box = await page.getByTestId("scene-layer").boundingBox()
				if (box) {
					const sampling = sample(page, 2200)
					await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
					await page.mouse.down()
					await page.mouse.move(box.x + box.width / 2 + 220, box.y + 40, {
						steps: 40,
					})
					await page.mouse.up()
					result.heroOrbit = await sampling
				}
			}

			await goto(page, chapterIndex("contradiction"))
			if ((await settleContradiction(page, proxy)) === "recorded") {
				await showBeat(page, 1)
				await page.waitForFunction(
					() =>
						document.querySelector('[data-view="3d"][data-drawn="true"]') !==
						null,
					undefined,
					{ timeout: 60_000 },
				)
				const sampling = flightSample(page)
				await showBeat(page, 2)
				result.chapter5Flight = {
					...(await sampling),
					view: await viewOf(page),
					link: (await sceneNow(page))?.link ?? null,
				}
			}
			const unexplained = unexplainedBrowserErrors(proxy, errors)
			result.errors = unexplained
			save(`fps-${profile}`, result)
			console.log(JSON.stringify(result))
			expect(unexplained).toEqual([])
			if (GL === "gpu") {
				expect(drift.drawnFps ?? 0).toBeGreaterThanOrEqual(30)
				expect(drift.rafFps).toBeGreaterThanOrEqual(30)
				const flight = result.chapter5Flight as
					| { drawnFps: number | null }
					| undefined
				if (flight) {
					expect(flight.drawnFps ?? 0).toBeGreaterThanOrEqual(30)
				}
			}
			await context.close()
		})
	}

	for (const profile of ["desktop", "mobile"] as const) {
		test(`nothing grows over chapter 1 to 9 to 1, five times: ${profile}`, async ({
			browser,
		}) => {
			const { context, page, proxy } = await rig(browser, profile, {
				link: profile === "mobile" ? LINK : undefined,
			})
			const errors = errorsOf(page)
			await page.goto("/demo")
			await page.waitForFunction(FIRST_FRAME, undefined, { timeout: 90_000 })
			const quiet = async (ms: number) => {
				await page.waitForFunction(
					() =>
						(window as unknown as { __tweens: () => number }).__tweens() === 0,
					undefined,
					{ timeout: 10_000 },
				)
				// R3F disposes the context about 500 ms after the canvas leaves.
				await page.waitForTimeout(ms)
			}
			const atRest = async (label: string, wait: number) => {
				await quiet(wait)
				const before = await page.evaluate(() =>
					(window as unknown as { __rafCalls: () => number }).__rafCalls(),
				)
				await page.waitForTimeout(1500)
				const after = await page.evaluate(() =>
					(window as unknown as { __rafCalls: () => number }).__rafCalls(),
				)
				return {
					label,
					...(await counts(page)),
					frameRequestsInOneSecond:
						Math.round(((after - before) / 1.5) * 10) / 10,
				}
			}
			const last = CHAPTERS_TOTAL - 1
			const baseline = await atRest("ch1 after load, drift rest", 11_000)
			const ninth: Awaited<ReturnType<typeof atRest>>[] = []
			const first: Awaited<ReturnType<typeof atRest>>[] = []
			for (let cycle = 1; cycle <= 5; cycle++) {
				for (let at = 1; at <= last; at++) {
					await goto(page, at)
					await page.waitForTimeout(300)
				}
				ninth.push(await atRest(`cycle ${cycle}: ch9`, 1200))
				await goto(page, 0)
				if (cycle === 1 || cycle === 5) {
					first.push(
						await atRest(`cycle ${cycle}: back on ch1, drift rest`, 11_000),
					)
				} else {
					await page.waitForTimeout(400)
				}
			}
			const result = {
				profile,
				gl: GL,
				walk: "chapter 1, then each of 2 to 9 in turn 300 ms apart, then back to 1; five times",
				baseline,
				ch9: ninth,
				ch1: first,
				errors: unexplainedBrowserErrors(proxy, errors),
				explainedErrors:
					errors.length - unexplainedBrowserErrors(proxy, errors).length,
			}
			save(`cycles-${profile}`, result)
			console.log(JSON.stringify(result))
			expect(result.errors).toEqual([])
			const [warm, last5] = [ninth[0], ninth[4]]
			expect(last5?.gl.live).toBe(0)
			expect(last5?.raf).toBeLessThanOrEqual(warm?.raf ?? 0)
			expect(last5?.tweens).toBe(0)
			expect(last5?.listeners).toBeLessThanOrEqual(warm?.listeners ?? 0)
			expect(last5?.frameRequestsInOneSecond).toBe(0)
			const [hero1, hero5] = first
			expect(hero5?.gl.live).toBeLessThanOrEqual(hero1?.gl.live ?? 0)
			expect(hero5?.raf).toBeLessThanOrEqual(hero1?.raf ?? 0)
			expect(hero5?.tweens).toBeLessThanOrEqual(hero1?.tweens ?? 0)
			expect(hero5?.listeners).toBeLessThanOrEqual(hero1?.listeners ?? 0)
			await context.close()
		})
	}
})
