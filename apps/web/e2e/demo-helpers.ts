import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page } from "@playwright/test"
import type {
	MdbrainWikiChange,
	MdbrainWikiClaim,
	MdbrainWikiPageView,
} from "@mdbrain/client"
import { CHAPTERS, chapterIndex } from "../app/demo/chapters"
import { formatUtc } from "../lib/demo-data/views.js"
import { SLOW_READ, type installDemoProxy } from "./demo-proxy"

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
	await expect(page.locator('[data-stat="pages"]')).not.toHaveText(
		"—",
		SLOW_READ,
	)
	await expect(page.locator('canvas[data-layer="static"]')).toHaveAttribute(
		"data-draws",
		/[1-9]/,
		SLOW_READ,
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

/** Every revision the changes feed served, across all of its pages. The feed
 * is paginated (100 a page live), so the latest response alone is only its
 * last page. */
export function allChanges(proxy: DemoProxy): MdbrainWikiChange[] {
	const byRevision = new Map<string, MdbrainWikiChange>()
	for (const entry of proxy.responses) {
		if (
			entry.url.pathname === "/api/demo/v1/wiki/changes" &&
			entry.status === 200
		) {
			for (const change of (entry.body as { changes: MdbrainWikiChange[] })
				.changes) {
				byRevision.set(`${change.pageSlug}@${change.revision}`, change)
			}
		}
	}
	return [...byRevision.values()]
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

/** Every source slip under `scope` has been read: each is its own cite, and a
 * cite is slow live, so the slips fill in one by one. At least one slip must
 * exist, so an absent list is not mistaken for a finished one. */
export async function sourcesSettled(scope: Locator): Promise<void> {
	await expect(scope.locator("article[data-status]").first()).toBeVisible(
		SLOW_READ,
	)
	await expect(scope.locator('[data-state="loading"]')).toHaveCount(
		0,
		SLOW_READ,
	)
	await expect(scope.locator('article[data-status="loading"]')).toHaveCount(
		0,
		SLOW_READ,
	)
}

/** An open citation shows what the proxy's `cite` answers said: one resolved
 * slip per resolved source, each with its full stored text and its own business
 * time (or the statement that it has none), and no source marked unavailable. */
export async function expectCitationMatchesCites(
	proxy: DemoProxy,
	dialog: Locator,
): Promise<void> {
	await sourcesSettled(dialog)
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

const NONE_YET = /none is recorded in this run yet/i

/** Waits for chapter 5 to settle and says which case the run is. The proxy's
 * own lint answer decides: a run with no unresolved contradiction (a seeded
 * slot before its agent run) must show the honest not-yet state and nothing
 * that reads as an error; one with a record must show the stamp. Anything
 * else, an error panel included, fails here rather than skipping. */
export async function settleContradiction(
	page: Page,
	proxy: DemoProxy,
): Promise<"recorded" | "none"> {
	const screen = page.getByTestId("screen")
	const stamp = screen.getByTestId("contradiction-stamp")
	const honest = screen.getByText(NONE_YET)
	await expect(stamp.or(honest)).toBeVisible(SLOW_READ)
	await proxy.flush()
	const lint = bodyOf<{ unresolvedContradictions: unknown[] }>(
		proxy.latest("wiki/lint"),
		"lint",
	)
	if (lint.unresolvedContradictions.length > 0) {
		await expect(stamp).toBeVisible()
		return "recorded"
	}
	await expect(honest).toBeVisible()
	await expect(stamp).toHaveCount(0)
	await expect(screen.locator('[data-state="error"]')).toHaveCount(0)
	await expect(screen.getByRole("alert")).toHaveCount(0)
	return "none"
}

/** Opens a citation dialog from where this run has one: chapter 5's first
 * claim when a contradiction is recorded, else the first revision on chapter 7. */
export async function openAnyCitation(
	page: Page,
	proxy: DemoProxy,
): Promise<void> {
	await goto(page, chapterIndex("contradiction"))
	if ((await settleContradiction(page, proxy)) === "recorded") {
		await page
			.getByRole("button", { name: "Open citation for claim one" })
			.click()
		return
	}
	await goto(page, chapterIndex("changes"))
	await page
		.getByTestId("change-row")
		.getByRole("button", { name: /^Open citation for:/ })
		.first()
		.click()
}

/** Opens a chapter from the rail by its title. */
export const goto = (page: Page, index: number) =>
	page.getByRole("button", { name: chapterTitle(index), exact: true }).click()

/** A counter tile by its `data-stat` name. */
export const stat = (page: Page, name: string) =>
	page.locator(`[data-stat="${name}"]`)
