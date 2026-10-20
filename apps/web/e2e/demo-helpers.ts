import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page } from "@playwright/test"
import type { MdbrainWikiClaim, MdbrainWikiPageView } from "@mdbrain/client"
import { CHAPTERS } from "../app/demo/chapters"
import type { installDemoProxy } from "./demo-proxy"

export type Proxy = Awaited<ReturnType<typeof installDemoProxy>>

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

export function listPages(proxy: Proxy): MdbrainWikiPageView[] {
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

export function listTotal(proxy: Proxy): number {
	const entry = proxy.latest("wiki", { limit: "100", skip: "0" })
	return (entry?.body as { total: number }).total
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
