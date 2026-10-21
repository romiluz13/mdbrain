// /demo checks beyond values and states: arrow-key stepping, reduced motion from
// the first frame, 44 px targets, overflow, the synthetic label, accessibility,
// and the map's cached static layer with its layout Worker.
import { expect, test, type Page } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import {
	chapterTitle,
	expectNoSeriousAccessibilityViolations,
	goto,
	mapReady,
	openAnyCitation,
	openDemo,
	settleContradiction,
	settled,
	showBeat,
	sourcesSettled,
} from "./demo-helpers"
import { GENERATED, installDemoProxy, SLOW_READ } from "./demo-proxy"

test("the arrow keys step the chapters from the pager, and walk the rail without selecting", async ({
	page,
}) => {
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	const heading = (index: number) =>
		page.getByRole("heading", { level: 1, name: chapterTitle(index) })
	const next = page.getByRole("button", { name: /^Ask →/ })
	await next.focus()
	await page.keyboard.press("ArrowRight")
	await expect(heading(1)).toBeFocused()
	await page.getByRole("button", { name: /^Sources arrive →/ }).focus()
	await page.keyboard.press("ArrowLeft")
	await expect(heading(0)).toBeFocused()

	const rail = page.getByRole("navigation", { name: "Chapters" })
	await rail.getByRole("button", { name: chapterTitle(0), exact: true }).focus()
	await page.keyboard.press("ArrowDown")
	await expect(
		rail.getByRole("button", { name: chapterTitle(1), exact: true }),
	).toBeFocused()
	await expect(heading(0)).toBeVisible()
	await page.keyboard.press("ArrowUp")
	await expect(
		rail.getByRole("button", { name: chapterTitle(0), exact: true }),
	).toBeFocused()
	await page.keyboard.press("End")
	await expect(
		rail.getByRole("button", {
			name: chapterTitle(CHAPTERS.length - 1),
			exact: true,
		}),
	).toBeFocused()
})

type MotionLog = { started: string[]; peak: number }

/** From before any page script, records every animation or transition that
 * starts and the most that ever ran at once, so a test can see the first
 * frames and not only where the page settles. */
async function watchMotion(page: Page): Promise<() => Promise<MotionLog>> {
	await page.addInitScript(() => {
		const log: MotionLog = { started: [], peak: 0 }
		;(window as unknown as { __motion: MotionLog }).__motion = log
		for (const type of ["animationstart", "transitionrun"]) {
			window.addEventListener(
				type,
				(event) =>
					log.started.push(`${type}:${(event.target as Element).nodeName}`),
				true,
			)
		}
		const sample = () => {
			log.peak = Math.max(log.peak, document.getAnimations().length)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	return () =>
		page.evaluate(() => (window as unknown as { __motion: MotionLog }).__motion)
}

test.describe("reduced motion", () => {
	test.use({ contextOptions: { reducedMotion: "reduce" } })

	test("is honored from the first frame: no animation or transition runs", async ({
		page,
	}) => {
		const motion = await watchMotion(page)
		const proxy = await installDemoProxy(page)
		await page.goto("/demo#contradiction")
		const outcome = await settleContradiction(page, proxy)
		await expect(page.locator("[data-motion]").first()).toHaveAttribute(
			"data-motion",
			"reduced",
		)
		expect(
			await page.evaluate(
				() => matchMedia("(prefers-reduced-motion: reduce)").matches,
			),
		).toBe(true)
		for (const id of outcome === "recorded"
			? ["screen", "contradiction-stamp"]
			: ["screen"]) {
			expect(
				await page
					.getByTestId(id)
					.evaluate((element) => getComputedStyle(element).animationName),
			).toBe("none")
		}
		await expect
			.poll(() => page.evaluate(() => document.getAnimations().length))
			.toBe(0)
		await goto(page, 5)
		await goto(page, 0)
		await mapReady(page)
		expect(await motion()).toEqual({ started: [], peak: 0 })
	})
})

test("without the preference the chapter eases in", async ({ page }) => {
	const motion = await watchMotion(page)
	await installDemoProxy(page)
	await page.goto("/demo")
	await expect(page.locator("[data-motion]").first()).toHaveAttribute(
		"data-motion",
		"full",
	)
	expect(
		await page
			.getByTestId("screen")
			.evaluate((element) => getComputedStyle(element).animationName),
	).not.toBe("none")
	await expect
		.poll(async () => (await motion()).started.length)
		.toBeGreaterThan(0)
})

test("the run's number table names each value on the phone, where the header row is hidden", async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, "the table stacks only below 720 px")
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	await goto(page, 8)
	const columns = await page
		.locator('[data-verify="pages"] td')
		.evaluateAll((cells) =>
			cells.map((cell) => getComputedStyle(cell, "::before").content),
		)
	expect(columns).toEqual([
		'"On screen: "',
		'"Read again: "',
		'"Where it comes from: "',
	])
})

test("the map stays in view beside a long list on a wide screen", async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, "the map sits under the list on a phone")
	const proxy = await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	const stays = async (name: string) => {
		const stage = page.getByRole("region", { name })
		await expect(stage).toBeVisible()
		const before = await stage.boundingBox()
		expect(before?.y ?? Number.NaN).toBeGreaterThan(0)
		// A list shows before its rows have all filled in, and a wheel on a page
		// that is still short scrolls only to its end.
		await expect
			.poll(
				() =>
					page.evaluate(
						() => document.documentElement.scrollHeight - window.innerHeight,
					),
				{ timeout: 5_000 },
			)
			.toBeGreaterThan(800)
		await page.mouse.wheel(0, 700)
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
			.toBeGreaterThan(500)
		const after = await stage.boundingBox()
		const height = page.viewportSize()?.height ?? 0
		expect(
			after?.y ?? Number.NaN,
			`${name} stays below the label`,
		).toBeGreaterThan(40)
		expect(after?.y ?? Number.NaN, `${name} stays near the top`).toBeLessThan(
			120,
		)
		expect((after?.y ?? 0) + (after?.height ?? 0), `${name} fits`).toBeLessThan(
			height,
		)
	}
	await goto(page, 1)
	await page
		.getByRole("list", { name: "Example questions" })
		.getByRole("button")
		.first()
		.click()
	await expect(page.getByRole("list", { name: "Search results" })).toBeVisible(
		SLOW_READ,
	)
	await stays("Where the answers live")
	await proxy.flush()
	await page.evaluate(() => window.scrollTo(0, 0))
	await goto(page, 6)
	await expect(page.getByTestId("change-row").first()).toBeVisible(SLOW_READ)
	await stays("Where it changed")
})

test("chapter 5's claim cards are as tall as their own content, not stretched to the taller one", async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, "the cards sit side by side only on a wide screen")
	const proxy = await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	await goto(page, 4)
	test.skip(
		(await settleContradiction(page, proxy)) === "none",
		"this run records no contradiction yet, so chapter 5 has no claim cards",
	)
	await showBeat(page, 2)
	await sourcesSettled(page.getByTestId("screen"))
	const stretched = await page.evaluate(() => {
		const cards = [
			...document.querySelectorAll(
				'li:has([data-testid="contradiction-claim"])',
			),
		] as HTMLElement[]
		return cards.map((card) => {
			const height = card.getBoundingClientRect().height
			const others = cards.filter((other) => other !== card)
			for (const other of others) {
				other.style.display = "none"
			}
			const alone = card.getBoundingClientRect().height
			for (const other of others) {
				other.style.display = ""
			}
			return Math.round(height - alone)
		})
	})
	expect(stretched.length).toBe(2)
	expect(stretched).toEqual([0, 0])
})

test("every interactive control on every chapter is at least 44 px", async ({
	page,
}) => {
	const proxy = await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	const small = async () =>
		page.evaluate(() =>
			[
				...document.querySelectorAll(
					"button, a[href], select, input, summary, [role=button]",
				),
			]
				.filter((element) => !element.closest("nextjs-portal"))
				.map((element) => {
					const box = element.getBoundingClientRect()
					return {
						label: (
							element.getAttribute("aria-label") ??
							element.textContent ??
							""
						)
							.trim()
							.slice(0, 40),
						width: Math.round(box.width * 10) / 10,
						height: Math.round(box.height * 10) / 10,
						bottom: box.bottom,
					}
				})
				.filter(
					(entry) =>
						entry.bottom > 0 &&
						entry.width > 0 &&
						(entry.width < 43.5 || entry.height < 43.5),
				),
		)
	for (const [index, chapter] of CHAPTERS.entries()) {
		await goto(page, index)
		await expect(
			page.getByRole("heading", { level: 1, name: chapter.title }),
		).toBeVisible()
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
		expect(await small(), `chapter ${chapter.title}`).toEqual([])
	}
	await openAnyCitation(page, proxy)
	await expect(page.getByRole("dialog")).toBeVisible()
	await sourcesSettled(page.getByRole("dialog"))
	expect(await small(), "the citation dialog").toEqual([])
})

test("the desktop rail runs the full height of the page and keeps its chapters in reach", async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, "on a phone the rail is a bar across the top")
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	await goto(page, 2)
	const more = page.getByRole("button", { name: "Show ten more" })
	await expect(more).toBeVisible(SLOW_READ)
	for (let asked = 0; asked < 3 && (await more.isVisible()); asked += 1) {
		await more.click()
	}
	const rail = page.getByTestId("rail")
	const heights = await rail.evaluate((element) => ({
		rail: element.getBoundingClientRect().height,
		page: document.documentElement.scrollHeight,
		view: window.innerHeight,
	}))
	expect(heights.page, "the page is taller than the window").toBeGreaterThan(
		heights.view,
	)
	expect(heights.rail).toBeGreaterThanOrEqual(heights.page - 1)
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
	const nav = await page
		.getByRole("navigation", { name: "Chapters" })
		.boundingBox()
	expect(nav?.y, "the chapter list stays in view").toBeGreaterThanOrEqual(0)
	expect((nav?.y ?? 0) + (nav?.height ?? 0)).toBeLessThanOrEqual(heights.view)
})

test("no chapter scrolls sideways, keeps the synthetic label in view, and passes axe", async ({
	page,
}) => {
	const proxy = await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	for (const [index, chapter] of CHAPTERS.entries()) {
		await goto(page, index)
		await expect(
			page.getByRole("heading", { level: 1, name: chapter.title }),
		).toBeVisible()
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
		await settled(page)
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
			`${chapter.title} fits the width`,
		).toBe(true)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		const label = await page.getByTestId("synthetic-label").boundingBox()
		expect(label?.y, `${chapter.title} label in view`).toBeGreaterThanOrEqual(
			-1,
		)
		await page.evaluate(() => window.scrollTo(0, 0))
		await expectNoSeriousAccessibilityViolations(page)
	}
	await openAnyCitation(page, proxy)
	await sourcesSettled(page.getByRole("dialog"))
	await expectNoSeriousAccessibilityViolations(page)
})

test("the layout runs in a Worker and interaction redraws only the live layer", async ({
	page,
	isMobile,
}) => {
	const workers: string[] = []
	page.on("worker", (worker) => workers.push(worker.url()))
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	await expect
		.poll(() => workers.some((url) => /graph-layout/.test(url)))
		.toBe(true)

	const staticLayer = page.locator('canvas[data-layer="static"]')
	const liveLayer = page.locator('canvas[data-layer="live"]')
	const draws = async (layer: typeof staticLayer) =>
		Number(await layer.getAttribute("data-draws"))
	let settled = -1
	await expect
		.poll(async () => {
			const now = await draws(staticLayer)
			const stable = now === settled
			settled = now
			return stable
		})
		.toBe(true)
	const staticBefore = await draws(staticLayer)
	const liveBefore = await draws(liveLayer)
	const pixelsBefore = await staticLayer.evaluate((canvas) =>
		(canvas as HTMLCanvasElement).toDataURL(),
	)

	const wrap = page.getByRole("img", { name: /^Map of \d+ stored pages/ })
	const box = await wrap.boundingBox()
	if (!box) throw new Error("the map has no box")
	const center = { x: box.width / 2, y: box.height / 2 }
	if (isMobile) await wrap.tap({ position: center })
	else await wrap.click({ position: center })
	const inspector = page.getByRole("complementary", { name: "Page inspector" })
	await expect(inspector.getByRole("heading", { level: 3 })).toBeVisible()
	if (GENERATED) {
		await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(
			"Northstar Track",
		)
	}
	await expect.poll(() => draws(liveLayer)).toBeGreaterThan(liveBefore)
	expect(await draws(staticLayer)).toBe(staticBefore)
	expect(
		await staticLayer.evaluate((canvas) =>
			(canvas as HTMLCanvasElement).toDataURL(),
		),
	).toBe(pixelsBefore)
})
