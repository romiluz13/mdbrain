// Chapter 1 and chapter 5 in 3D: the brain drawn from the same pages and links
// the flat map reads, with the flat map as the way back. WebGL runs in headless
// Chromium through its software renderer, so a test never needs a GPU.
import { expect, type Page, test } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import { VIEW_PREFERENCE_KEY } from "../lib/demo-data/view-preference"
import {
	goto,
	listPages,
	mapReady,
	openDemo,
	settleContradiction,
	showBeat,
} from "./demo-helpers"
import { installDemoProxy } from "./demo-proxy"

type Seam = {
	screenOf: (slug: string) => { x: number; y: number } | null
	state: () => {
		nodes: number
		edges: number
		frames: number
		link: boolean | null
		pose: { gx: number; gy: number; gz: number; yaw: number; d: number }
		drift: number
		lit: number
		held: boolean
		listeners: number
	}
}

const SEAM = "mdbrain.demo.scene"
const THREE_D = '[data-view="3d"][data-drawn="true"]'
const FLAT = '[data-view="2d"]'

const sceneState = (page: Page) =>
	page.evaluate((key) => {
		const seam = (window as unknown as Record<symbol, Seam>)[Symbol.for(key)]
		return seam ? seam.state() : null
	}, SEAM)

const spotsOf = (page: Page, slugs: string[]) =>
	page.evaluate(
		([key, wanted]) => {
			const seam = (window as unknown as Record<symbol, Seam>)[
				Symbol.for(key as string)
			]
			return (wanted as string[]).map((slug) => [slug, seam?.screenOf(slug)])
		},
		[SEAM, slugs] as const,
	) as Promise<Array<[string, { x: number; y: number } | null]>>

/** The scene falls back to the flat map when its frame monitor sees a slow
 * run, and a host busy with other work trips it. The monitor skips frames
 * while the page is hidden and is the only reader of `document.hidden` in the
 * app, so a spec about the map, not about that fallback, reports the page
 * hidden to it. */
const silenceSlowFrameMonitor = (page: Page) =>
	page.addInitScript(() => {
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => true,
		})
	})

async function openHero(page: Page) {
	await silenceSlowFrameMonitor(page)
	const proxy = await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	return proxy
}

async function threeReady(page: Page) {
	await expect(page.locator(THREE_D)).toHaveCount(1, { timeout: 20_000 })
}

/** A page whose dot sits well clear of every other, so a pointer on it can only
 * mean it. */
async function isolatedPage(page: Page, titles: Map<string, string>) {
	const layer = page.getByTestId("scene-layer")
	await layer.scrollIntoViewIfNeeded()
	const spots = (await spotsOf(page, [...titles.keys()])).flatMap(
		([slug, spot]) => (spot ? [{ slug, ...spot }] : []),
	)
	const box = await layer.boundingBox()
	const view = page.viewportSize()
	if (!box || !view) throw new Error("the scene has no box")
	const inside = spots.filter(
		(a) =>
			a.x > Math.max(box.x, 0) + 40 &&
			a.x < Math.min(box.x + box.width, view.width) - 40 &&
			a.y > Math.max(box.y, 0) + 40 &&
			a.y < Math.min(box.y + box.height, view.height) - 40,
	)
	const gap = (a: { x: number; y: number }) =>
		Math.min(
			...spots
				.filter((b) => b !== a && (b.x !== a.x || b.y !== a.y))
				.map((b) => Math.hypot(a.x - b.x, a.y - b.y)),
		)
	const best = inside.sort((a, b) => gap(b) - gap(a))[0]
	if (!best) throw new Error("no page sits clear of the others")
	return { ...best, title: titles.get(best.slug) as string, gap: gap(best) }
}

test.describe("chapter 1 in 3D", () => {
	test("draws the same pages and links as the flat map, lazily, after the flat map has drawn", async ({
		page,
	}) => {
		const proxy = await openHero(page)
		await threeReady(page)
		const pages = listPages(proxy)
		const scene = await sceneState(page)
		expect(scene?.nodes).toBe(pages.length)
		const header = await page
			.getByText(/links between \d+ pages/)
			.first()
			.innerText()
		expect(header).toContain(
			`${scene?.edges} links between ${scene?.nodes} pages`,
		)
		const order = await page.evaluate(() => {
			const mark = (name: string) =>
				performance.getEntriesByName(name)[0]?.startTime ?? -1
			return {
				flatDrawn: mark("demo-graph-drawn"),
				sceneFirstFrame: mark("demo-scene-first-frame"),
			}
		})
		expect(order.flatDrawn).toBeGreaterThan(0)
		expect(order.sceneFirstFrame).toBeGreaterThan(order.flatDrawn)
	})

	test("never loads the 3D code on a chapter that has no 3D map", async ({
		page,
	}) => {
		// A production build names its chunks by hash, and `next dev` preloads the
		// scene's thin wrapper chunk on every chapter; the 3D code is told by its
		// content, three's renderer.
		const scripts: Promise<string>[] = []
		page.on("response", (response) => {
			if (response.request().resourceType() === "script") {
				scripts.push(response.text().catch(() => ""))
			}
		})
		const threeLoaded = async () =>
			(await Promise.all(scripts)).some((body) =>
				body.includes("WebGLRenderer"),
			)
		await installDemoProxy(page)
		await openDemo(page, "#ask")
		await expect(
			page.getByRole("heading", { level: 1, name: "Ask" }),
		).toBeVisible()
		await page.waitForTimeout(3000)
		await expect(page.locator('[data-view="3d"]')).toHaveCount(0)
		expect(await threeLoaded()).toBe(false)
		await goto(page, chapterIndex("brain"))
		await expect(page.locator(THREE_D)).toBeVisible({ timeout: 60_000 })
		expect(
			await threeLoaded(),
			"the detector sees three once a 3D map shows",
		).toBe(true)
	})

	test("names a page on hover and opens the same inspector on a click, as the flat map does", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			isMobile,
			"hover is a mouse affordance; the tap test covers touch",
		)
		const proxy = await openHero(page)
		await threeReady(page)
		const titles = new Map(listPages(proxy).map((p) => [p.slug, p.title]))
		const target = await isolatedPage(page, titles)
		await page.mouse.move(target.x, target.y)
		await expect(page.locator("[data-side]")).toHaveText(target.title)
		await page.mouse.click(target.x, target.y)
		const inspector = page.getByRole("complementary", {
			name: "Page inspector",
		})
		await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(
			target.title,
		)
	})

	test("opens the inspector on a tap", async ({ page, isMobile }) => {
		test.skip(!isMobile, "this is the touch path")
		const proxy = await openHero(page)
		await threeReady(page)
		const titles = new Map(listPages(proxy).map((p) => [p.slug, p.title]))
		const target = await isolatedPage(page, titles)
		await page.touchscreen.tap(target.x, target.y)
		const inspector = page.getByRole("complementary", {
			name: "Page inspector",
		})
		await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(
			target.title,
		)
	})

	test("keeps the keyboard path: the page picker opens the same inspector and rings the page", async ({
		page,
	}) => {
		const proxy = await openHero(page)
		await threeReady(page)
		const first = listPages(proxy)[1]
		if (!first) throw new Error("no page to pick")
		await page.getByLabel("Pick a page").selectOption(first.slug)
		const inspector = page.getByRole("complementary", {
			name: "Page inspector",
		})
		await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(
			first.title,
		)
		await expect(page.locator("[data-side]")).toHaveText(first.title)
	})

	test("drifts slowly and calmly, then rests", async ({ page }) => {
		await openHero(page)
		await threeReady(page)
		const before = await sceneState(page)
		await page.waitForTimeout(1500)
		const during = await sceneState(page)
		expect(before && during).toBeTruthy()
		const perSecond = ((during?.drift ?? 0) - (before?.drift ?? 0)) / 1.5
		expect(perSecond).toBeGreaterThan(0.02)
		expect(perSecond).toBeLessThan(0.12)
		let last = -1
		await expect
			.poll(
				async () => {
					const frames = (await sceneState(page))?.frames ?? -2
					const unchanged = frames === last
					last = frames
					return unchanged
				},
				{ timeout: 25_000, intervals: [1500] },
			)
			.toBe(true)
		const resting = await sceneState(page)
		await page.waitForTimeout(1200)
		expect((await sceneState(page))?.frames).toBe(resting?.frames)
	})
})

test.describe("the way back to the flat map", () => {
	test("switches to 2D and back, and remembers the choice for this viewer", async ({
		page,
	}) => {
		await openHero(page)
		await threeReady(page)
		const status = page.getByTestId("graph-view-status")
		await expect(status).toContainText("3D map")
		await page.getByRole("button", { name: "Switch to 2D" }).click()
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
		await expect(status).toContainText("Flat map. Your choice is kept")
		expect(
			await page.evaluate(
				(key) => localStorage.getItem(key),
				VIEW_PREFERENCE_KEY,
			),
		).toBe("2d")
		await page.reload()
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
		await mapReady(page)
		await expect(
			page.getByRole("button", { name: "Switch to 3D" }),
		).toBeVisible()
		await page.waitForTimeout(1500)
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
		await page.getByRole("button", { name: "Switch to 3D" }).click()
		await threeReady(page)
	})

	test("still works when storage is blocked: the choice just is not remembered", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, "localStorage", {
				get() {
					throw new Error("blocked")
				},
			})
		})
		await openHero(page)
		await threeReady(page)
		await page.getByRole("button", { name: "Switch to 2D" }).click()
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(page.getByTestId("graph-view-status")).toContainText(
			"Flat map",
		)
	})
})

test.describe("falling back to the flat map", () => {
	test("with WebGL disabled the flat map stays, says why, and the chapter works", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const original = HTMLCanvasElement.prototype.getContext
			HTMLCanvasElement.prototype.getContext = function (
				this: HTMLCanvasElement,
				kind: string,
				...rest: unknown[]
			) {
				return /webgl/.test(kind)
					? null
					: (original as (...args: unknown[]) => unknown).call(
							this,
							kind,
							...rest,
						)
			} as typeof original
		})
		await openHero(page)
		await expect(page.getByTestId("graph-view-status")).toContainText(
			"this browser cannot draw 3D",
			{ timeout: 20_000 },
		)
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
		await expect(page.getByRole("button", { name: /^Switch to/ })).toHaveCount(
			0,
		)
		const hub = page.getByRole("img", { name: /^Map of \d+ stored pages/ })
		const box = await hub.boundingBox()
		if (!box) throw new Error("no map")
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
		await expect(
			page
				.getByRole("complementary", { name: "Page inspector" })
				.getByRole("heading", { level: 3 }),
		).toBeVisible()
	})

	test("a lost WebGL context leaves the flat map showing", async ({ page }) => {
		await openHero(page)
		await threeReady(page)
		await page.evaluate(() => {
			const canvas = document.querySelector(
				'[data-testid="scene-layer"] canvas',
			) as HTMLCanvasElement
			const gl = (canvas.getContext("webgl2") ??
				canvas.getContext("webgl")) as WebGLRenderingContext
			gl.getExtension("WEBGL_lose_context")?.loseContext()
		})
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(page.getByTestId("graph-view-status")).toContainText(
			"graphics context was lost",
		)
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
		await expect(
			page.locator('canvas[data-layer="static"]').first(),
		).toBeVisible()
	})

	test("reduced motion set before the page loads shows the flat map and never starts 3D", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" })
		await openHero(page)
		await expect(page.getByTestId("graph-view-status")).toContainText(
			"asks for less motion",
			{ timeout: 20_000 },
		)
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
		await expect(page.getByRole("button", { name: /^Switch to/ })).toHaveCount(
			0,
		)
	})

	test("reduced motion turned on while 3D is showing stops it at once and shows the flat map", async ({
		page,
	}) => {
		await openHero(page)
		await threeReady(page)
		await page.emulateMedia({ reducedMotion: "reduce" })
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
		expect(await sceneState(page)).toBeNull()
		await expect(page.getByTestId("graph-view-status")).toContainText(
			"asks for less motion",
		)
		await page.emulateMedia({ reducedMotion: "no-preference" })
		await threeReady(page)
	})
})

test.describe("the touch path", () => {
	test("keeps the page scrollable until the viewer asks to turn the map", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "touch only")
		await openHero(page)
		await threeReady(page)
		const touchAction = () =>
			page
				.getByTestId("scene-layer")
				.locator("> div")
				.first()
				.evaluate((outer) => getComputedStyle(outer).touchAction)
		await expect.poll(touchAction).toBe("pan-y")
		await page.getByRole("button", { name: "Turn the map" }).click()
		await expect.poll(touchAction).toBe("none")
		await page.getByRole("button", { name: "Done turning" }).click()
		await expect.poll(touchAction).toBe("pan-y")
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		)
		expect(overflow).toBeLessThanOrEqual(0)
	})
})

test.describe("chapter 5 in 3D", () => {
	test("flies to frame the two pages on the last beat and reverses on a step back", async ({
		page,
	}) => {
		const proxy = await openHero(page)
		await goto(page, chapterIndex("contradiction"))
		if ((await settleContradiction(page, proxy)) !== "recorded") {
			test.skip(true, "this run records no contradiction")
		}
		await threeReady(page)
		await showBeat(page, 0)
		const home = await sceneState(page)
		expect(home?.lit).toBe(0)
		await showBeat(page, 2)
		await expect
			.poll(async () => (await sceneState(page))?.held, { timeout: 5000 })
			.toBe(true)
		await expect
			.poll(async () => (await sceneState(page))?.pose.d ?? 99, {
				timeout: 5000,
			})
			.toBeLessThan((home?.pose.d ?? 0) - 0.2)
		const framed = await sceneState(page)
		expect(framed?.link, "the fixture stores a link between the pair").toBe(
			true,
		)
		expect(
			Object.keys(framed?.pose ?? {}).sort(),
			"the seam's pose carries no GSAP bookkeeping",
		).toEqual(["d", "gx", "gy", "gz", "yaw"])
		await expect.poll(async () => (await sceneState(page))?.lit).toBe(1)
		await showBeat(page, 1)
		await expect
			.poll(async () => (await sceneState(page))?.pose.d ?? 0, {
				timeout: 5000,
			})
			.toBeCloseTo(home?.pose.d ?? 0, 3)
		const back = await sceneState(page)
		expect(back?.lit).toBe(0)
		expect(back?.pose.gx).toBeCloseTo(0, 3)
		expect(back?.pose.yaw).toBeCloseTo(home?.pose.yaw ?? 0, 3)
	})

	test("keeps today's highlight in the flat map", async ({ page }) => {
		await page.addInitScript(
			([key]) => localStorage.setItem(key as string, "2d"),
			[VIEW_PREFERENCE_KEY],
		)
		const proxy = await openHero(page)
		await goto(page, chapterIndex("contradiction"))
		if ((await settleContradiction(page, proxy)) !== "recorded") {
			test.skip(true, "this run records no contradiction")
		}
		await showBeat(page, 2)
		await expect(page.locator(FLAT)).toHaveCount(1)
		await expect(
			page.locator('canvas[data-layer="live"]').first(),
		).toBeVisible()
		await expect(page.getByTestId("scene-layer")).toHaveCount(0)
	})
})
