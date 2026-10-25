// The story in motion (GSAP): headline numbers that count up to the API's value,
// the source stream of chapter 3, the hand-off arrows and token meter of chapter
// 4, and the chapter enter. Each move is read frame by frame in the page, so the
// specs hold the path as well as the end. Reduced motion shows only the end.
import { expect, test, type Page } from "@playwright/test"
import {
	goto,
	listTotal,
	mapReady,
	openDemo,
	readsSettled,
	settled,
	stat,
} from "./demo-helpers"
import { GENERATED, installDemoProxy } from "./demo-proxy"
import { chapterIndex } from "../app/demo/chapters"

type Win = Window & {
	__frames?: unknown[]
	__stopFrames?: () => void
}

/** Records what `read` returns on every animation frame in the page. */
const FRAMES_SCRIPT = (source: string) => {
	const reader = new Function(`return (${source})`)() as () => unknown
	const frames: unknown[] = []
	let live = true
	const win = window as Win
	win.__frames = frames
	win.__stopFrames = () => {
		live = false
	}
	const loop = () => {
		frames.push(reader())
		if (live) {
			requestAnimationFrame(loop)
		}
	}
	requestAnimationFrame(loop)
}

async function recordFrames(page: Page, read: () => unknown): Promise<void> {
	await page.evaluate(FRAMES_SCRIPT, read.toString())
}

async function recordFromStart(page: Page, read: () => unknown) {
	await page.addInitScript(
		([script, source]) => {
			const run = new Function(`return (${script})`)() as (s: string) => void
			addEventListener("DOMContentLoaded", () => run(source), { once: true })
		},
		[FRAMES_SCRIPT.toString(), read.toString()],
	)
}

async function stopFrames<T>(page: Page): Promise<T[]> {
	return page.evaluate(() => {
		const win = window as Win
		win.__stopFrames?.()
		return win.__frames ?? []
	}) as Promise<T[]>
}

const tweensRunning = (page: Page) =>
	page.evaluate(() =>
		(
			Reflect.get(window, Symbol.for("mdbrain.demo.motion")) as {
				tweens: () => number
			}
		).tweens(),
	)

const numberOf = (text: string | null): number | null => {
	if (text === null) {
		return null
	}
	const digits = text.replace(/,/g, "")
	return /^\d+$/.test(digits) ? Number(digits) : null
}

const readPages = () => ({
	text: document.querySelector('[data-stat="pages"]')?.textContent ?? null,
})

test.describe("headline numbers count up", () => {
	test("from 0 to the API's value, never backwards, and end on that value", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await recordFromStart(page, readPages)
		await openDemo(page)
		await mapReady(page)
		await proxy.flush()
		const total = listTotal(proxy)
		const shown = (await stopFrames<{ text: string | null }>(page))
			.map((frame) => numberOf(frame.text))
			.filter((value): value is number => value !== null)
		expect(shown.length).toBeGreaterThan(3)
		expect(shown[0]).toBeLessThan(total)
		for (let at = 1; at < shown.length; at++) {
			expect(shown[at], `frame ${at}`).toBeGreaterThanOrEqual(
				shown[at - 1] as number,
			)
		}
		expect(shown.some((value) => value > 0 && value < total)).toBe(true)
		expect(shown.at(-1)).toBe(total)
		await expect(stat(page, "pages")).toHaveText(String(total))
		expect(await tweensRunning(page)).toBe(0)
	})

	test("a click on the next chapter is answered at once, mid-count", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page)
		await expect(stat(page, "pages")).not.toHaveText("—")
		const answered = await page.evaluate(async () => {
			const next = [...document.querySelectorAll("button")].find((button) =>
				button.textContent?.trim().endsWith("→"),
			)
			const before = document.querySelector("h1")?.textContent
			const started = performance.now()
			next?.click()
			await new Promise((resolve) => requestAnimationFrame(resolve))
			await new Promise((resolve) => requestAnimationFrame(resolve))
			return {
				changed: document.querySelector("h1")?.textContent !== before,
				ms: performance.now() - started,
			}
		})
		expect(answered.changed).toBe(true)
		expect(answered.ms).toBeLessThan(400)
		await settled(page)
	})

	test.describe("with reduced motion", () => {
		test.use({ contextOptions: { reducedMotion: "reduce" } })

		test("the final numbers are there from the first frame, with nothing under way", async ({
			page,
		}) => {
			const proxy = await installDemoProxy(page)
			await recordFromStart(page, readPages)
			await openDemo(page)
			await mapReady(page)
			await proxy.flush()
			const total = listTotal(proxy)
			const shown = (await stopFrames<{ text: string | null }>(page))
				.map((frame) => numberOf(frame.text))
				.filter((value): value is number => value !== null)
			expect(shown.length).toBeGreaterThan(0)
			expect(new Set(shown)).toEqual(new Set([total]))
			expect(await tweensRunning(page)).toBe(0)
		})
	})
})

test.describe("chapter enter", () => {
	test("the title and lede settle in, then rest with no styling left over", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await recordFrames(page, () => {
			const heading = document.querySelector("h1")
			return {
				title: heading?.textContent ?? null,
				opacity: heading ? Number(getComputedStyle(heading).opacity) : null,
			}
		})
		await goto(page, chapterIndex("ask"))
		await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
		await settled(page)
		const frames = await stopFrames<{ title: string | null; opacity: number }>(
			page,
		)
		const incoming = frames.filter(
			(frame) => frame.title !== frames[0]?.title && frame.opacity !== null,
		)
		expect(incoming.length).toBeGreaterThan(0)
		expect(incoming.some((frame) => frame.opacity < 1)).toBe(true)
		expect(incoming.at(-1)?.opacity).toBe(1)
		const heading = page.getByRole("heading", { level: 1 })
		expect((await heading.getAttribute("style")) ?? "").toBe("")
		await expect(page.getByTestId("screen")).toHaveCSS("opacity", "1")
	})
})

test.describe("chapter 3 streams its sources in", () => {
	test.skip(!GENERATED, "the planted run is in the generated fixture")

	const readRows = () => ({
		rows: [...document.querySelectorAll('[data-testid="source-row"]')].map(
			(row) => ({
				opacity: Number(getComputedStyle(row).opacity),
				status: row.getAttribute("data-status"),
				label: Number(
					getComputedStyle(
						row.querySelector('[data-testid="source-label"]') as Element,
					).opacity,
				),
			}),
		),
	})
	type Row = { opacity: number; status: string | null; label: number }

	test("rows arrive in record order and each label settles as its confirmation lands", async ({
		page,
	}) => {
		await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await recordFrames(page, readRows)
		await goto(page, chapterIndex("sources"))
		await expect(page.getByTestId("source-row").first()).toBeVisible()
		await readsSettled(page)
		await settled(page)
		const frames = (await stopFrames<{ rows: Row[] }>(page)).filter(
			(frame) => frame.rows.length > 1,
		)
		expect(frames.length).toBeGreaterThan(3)
		for (const [at, frame] of frames.entries()) {
			for (let row = 1; row < frame.rows.length; row++) {
				expect(
					(frame.rows[row] as Row).opacity,
					`frame ${at}, row ${row + 1} should not lead row ${row}`,
				).toBeLessThanOrEqual((frame.rows[row - 1] as Row).opacity + 0.001)
			}
		}
		expect(
			frames.some((frame) =>
				frame.rows.some((row) => row.opacity > 0 && row.opacity < 1),
			),
		).toBe(true)
		expect(
			frames.some((frame) =>
				frame.rows.some((row) => row.status === "confirmed" && row.label < 1),
			),
		).toBe(true)
		expect(frames.at(-1)?.rows.every((row) => row.opacity === 1)).toBe(true)
		expect(frames.at(-1)?.rows.every((row) => row.label === 1)).toBe(true)
		const first = page.getByTestId("source-row").first()
		expect((await first.getAttribute("style")) ?? "").toBe("")
	})

	test.describe("with reduced motion", () => {
		test.use({ contextOptions: { reducedMotion: "reduce" } })

		test("every row is there at once, whole", async ({ page }) => {
			await installDemoProxy(page)
			await openDemo(page)
			await mapReady(page)
			await recordFrames(page, readRows)
			await goto(page, chapterIndex("sources"))
			await expect(page.getByTestId("source-row").first()).toBeVisible()
			await readsSettled(page)
			const frames = (await stopFrames<{ rows: Row[] }>(page)).filter(
				(frame) => frame.rows.length > 0,
			)
			expect(frames.length).toBeGreaterThan(0)
			for (const frame of frames) {
				for (const row of frame.rows) {
					expect(row.opacity).toBe(1)
					expect(row.label).toBe(1)
				}
			}
			expect(await tweensRunning(page)).toBe(0)
		})
	})
})

test.describe("chapter 4 hands off, in turn", () => {
	test.skip(!GENERATED, "the planted run is in the generated fixture")

	const readHandoff = () => ({
		arrows: [
			...document.querySelectorAll('[data-testid="handoff-arrow"] path'),
		].map((path) => Number.parseFloat(getComputedStyle(path).strokeDashoffset)),
		tokens:
			document.querySelector('[data-stat="agent-tokens"]')?.firstChild
				?.nodeValue ?? null,
		meter: document.querySelector("meter")?.value ?? null,
	})
	type Hand = { arrows: number[]; tokens: string | null; meter: number | null }

	async function openHandoff(page: Page): Promise<Hand[]> {
		await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await recordFrames(page, readHandoff)
		await goto(page, chapterIndex("agents"))
		await expect(page.getByTestId("handoff-arrow").first()).toBeVisible()
		await readsSettled(page)
		await settled(page)
		return (await stopFrames<Hand>(page)).filter(
			(frame) => frame.arrows.length > 0,
		)
	}

	test("Support to Account, then Account to Product; the meter fills with the token count", async ({
		page,
	}) => {
		const frames = await openHandoff(page)
		expect(frames.length).toBeGreaterThan(3)
		expect(frames[0]?.arrows).toHaveLength(2)
		// The first arrow is whole before the second one starts to draw.
		const secondStarts = frames.findIndex(
			(frame) => (frame.arrows[1] as number) < 0.98,
		)
		expect(secondStarts).toBeGreaterThan(0)
		expect((frames[secondStarts]?.arrows[0] as number) <= 0.05).toBe(true)
		for (let at = 1; at < frames.length; at++) {
			for (const arrow of [0, 1]) {
				expect(
					(frames[at]?.arrows[arrow] as number) <=
						(frames[at - 1]?.arrows[arrow] as number) + 0.001,
				).toBe(true)
			}
		}
		expect(frames.at(-1)?.arrows).toEqual([0, 0])

		const final = numberOf(frames.at(-1)?.tokens ?? null) as number
		const tokens = frames
			.map((frame) => numberOf(frame.tokens))
			.filter((value): value is number => value !== null)
		const meter = frames
			.map((frame) => frame.meter)
			.filter((value): value is number => value !== null)
		expect(final).toBeGreaterThan(0)
		expect(tokens.some((value) => value < final)).toBe(true)
		expect(meter.some((value) => value < final)).toBe(true)
		for (let at = 1; at < tokens.length; at++) {
			expect(tokens[at] as number).toBeGreaterThanOrEqual(
				tokens[at - 1] as number,
			)
		}
		expect(meter.at(-1)).toBe(final)
		await expect(page.locator("meter")).toHaveJSProperty("value", final)
	})

	test.describe("with reduced motion", () => {
		test.use({ contextOptions: { reducedMotion: "reduce" } })

		test("the arrows are whole and the meter full at the first frame", async ({
			page,
		}) => {
			const frames = await openHandoff(page)
			expect(frames.length).toBeGreaterThan(0)
			for (const frame of frames) {
				expect(frame.arrows).toEqual([0, 0])
			}
			const final = numberOf(frames.at(-1)?.tokens ?? null)
			expect(new Set(frames.map((frame) => numberOf(frame.tokens)))).toEqual(
				new Set([final]),
			)
			expect(new Set(frames.map((frame) => frame.meter))).toEqual(
				new Set([final]),
			)
			expect(await tweensRunning(page)).toBe(0)
		})
	})
})
