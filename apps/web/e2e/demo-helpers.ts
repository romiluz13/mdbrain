import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page } from "@playwright/test"
import type { MdbrainWikiClaim, MdbrainWikiPageView } from "@mdbrain/client"
import { CHAPTERS } from "../app/demo/chapters"
import { formatUtc } from "../lib/demo-data/views.js"
import type { installDemoProxy } from "./demo-proxy"

export type DemoProxy = Awaited<ReturnType<typeof installDemoProxy>>

/** The parsed body of a logged proxy response; fails loudly when none was seen. */
export function bodyOf<T>(
	entry: { body: unknown } | undefined,
	what: string,
): T {
	if (!entry) {
		throw new Error(`the proxy served no ${what} response`)
	}
	return entry.body as T
}

export async function openDemo(page: Page, hash = ""): Promise<void> {
	await page.goto(`/demo${hash}`)
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
}

/** The map has its data and both canvas layers have drawn. */
export async function mapReady(page: Page): Promise<void> {
	await expect(page.locator('[data-stat="pages"]')).not.toHaveText("—")
	await expect(page.locator('canvas[data-layer="static"]')).toHaveAttribute(
		"data-draws",
		/[1-9]/,
	)
}

/** Presses Tab until the target holds focus; fails with where focus is. */
export async function tabTo(
	page: Page,
	target: Locator,
	max = 120,
): Promise<void> {
	for (let step = 0; step < max; step++) {
		const focused = await target
			.evaluate((element) => element === document.activeElement)
			.catch(() => false)
		if (focused) {
			return
		}
		await page.keyboard.press("Tab")
	}
	const where = await page.evaluate(
		() => document.activeElement?.outerHTML.slice(0, 120) ?? "nothing",
	)
	throw new Error(`Tab never reached the target; focus is on ${where}`)
}

export const chapterTitle = (index: number): string =>
	CHAPTERS[index]?.title ?? ""

export function listPages(proxy: DemoProxy): MdbrainWikiPageView[] {
	const bySkip = new Map<string, MdbrainWikiPageView[]>()
	for (const entry of proxy.responses) {
		if (
			entry.url.pathname === "/api/demo/v1/wiki" &&
			entry.url.searchParams.get("limit") === "100" &&
			entry.status === 200
		) {
			bySkip.set(
				entry.url.searchParams.get("skip") ?? "0",
				(entry.body as { pages: MdbrainWikiPageView[] }).pages,
			)
		}
	}
	return [...bySkip.entries()]
		.sort((a, b) => Number(a[0]) - Number(b[0]))
		.flatMap((entry) => entry[1])
}

export function listTotal(proxy: DemoProxy): number {
	return bodyOf<{ total: number }>(
		proxy.latest("wiki", { limit: "100", skip: "0" }),
		"page list",
	).total
}

export function claimsOf(pages: MdbrainWikiPageView[]): MdbrainWikiClaim[] {
	return pages.flatMap((page) => page.claims)
}

export function eventSourceIds(pages: MdbrainWikiPageView[]): Set<string> {
	const ids = new Set<string>()
	for (const claim of claimsOf(pages)) {
		for (const evidence of claim.evidence) {
			if (evidence.kind === "event") {
				ids.add(evidence.sourceId)
			}
		}
	}
	return ids
}

export const squash = (text: string): string => text.replace(/\s+/g, " ").trim()

type CitedEvent = { eventId: string; text?: string; timestamp?: string }

/** An open citation shows what the proxy's `cite` answers said: one resolved
 * slip per resolved source, each with its full stored text and its own business
 * time (or the statement that it has none), and no source marked unavailable. */
export async function expectCitationMatchesCites(
	proxy: DemoProxy,
	dialog: Locator,
): Promise<void> {
	await expect(dialog.locator("article[data-status]").first()).toBeVisible()
	await proxy.flush()
	const marker = squash(
		(await dialog.getByTestId("citation-marker").textContent()) ?? "",
	)
	const byEvent = new Map<string, CitedEvent>()
	for (const entry of proxy.responses) {
		const { event } = (entry.body ?? {}) as { event?: CitedEvent }
		if (
			entry.url.pathname === "/api/demo/v1/cite" &&
			entry.url.searchParams.get("citedBy") === marker &&
			entry.status === 200 &&
			event
		) {
			byEvent.set(event.eventId, event)
		}
	}
	expect(byEvent.size, `no cite answer for ${marker}`).toBeGreaterThan(0)
	await expect(
		dialog.locator('article[data-status="unavailable"]'),
	).toHaveCount(0)
	await expect(dialog.locator('article[data-status="resolved"]')).toHaveCount(
		byEvent.size,
	)
	for (const event of byEvent.values()) {
		const slip = dialog.locator("article").filter({
			has: dialog.page().getByText(event.eventId, { exact: true }),
		})
		if (event.text) {
			expect(
				squash((await slip.getByTestId("source-text").textContent()) ?? ""),
			).toBe(squash(event.text))
		}
		await expect(slip.locator('[data-time-kind="business"]')).toContainText(
			event.timestamp ? formatUtc(event.timestamp) : "missing in this source",
		)
	}
}

/** Lets the finite CSS animations and transitions finish, so a contrast check
 * does not read a half-faded frame. */
export async function settled(page: Page): Promise<void> {
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !==
						Number.POSITIVE_INFINITY,
				)
				.map((animation) => animation.finished),
		),
	)
}

export async function expectNoSeriousAccessibilityViolations(
	page: Page,
): Promise<void> {
	await settled(page)
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze()
	const violations = results.violations.filter(
		(violation) =>
			violation.impact === "serious" || violation.impact === "critical",
	)
	expect(
		violations.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			nodes: violation.nodes.map((node) => node.target),
		})),
	).toEqual([])
}

/** Opens a chapter from the rail by its title. */
export const goto = (page: Page, index: number) =>
	page.getByRole("button", { name: chapterTitle(index), exact: true }).click()

/** A counter tile by its `data-stat` name. */
export const stat = (page: Page, name: string) =>
	page.locator(`[data-stat="${name}"]`)
