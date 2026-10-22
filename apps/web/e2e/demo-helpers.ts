import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page } from "@playwright/test"
import type {
	MdbrainWikiChange,
	MdbrainWikiClaim,
	MdbrainWikiPageView,
} from "@mdbrain/client"
import { CHAPTERS, chapterIndex } from "../app/demo/chapters"
import { SOURCE_LIMIT } from "../lib/demo-data/loaders-chapters.js"
import { formatUtc } from "../lib/demo-data/views.js"
import {
	GENERATED,
	SLOW_LIST,
	SLOW_READ,
	type installDemoProxy,
} from "./demo-proxy"

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

/** The map has its data, both canvas layers have drawn, and the headline
 * numbers have finished counting up to the API's values. */
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
	await settled(page)
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

/** The words of a text in order, with every mark that is not a letter or a digit
 * dropped, so a source rendered as markdown can be held against what the cite
 * answered without the test reading markdown the way the page does. */
export const wordsOf = (text: string): string =>
	(text.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ")

/** The text of a rendered source with its blocks kept apart. The page draws each
 * paragraph, list item and table cell as its own element and each line of a
 * paragraph after a line break, and `textContent` would run the last word of
 * one into the first of the next. */
export function blockText(source: Locator): Promise<string> {
	return source.evaluate((root) => {
		const selector = "p, li, td, th, pre"
		const blocks = [...root.querySelectorAll(selector)].filter(
			(block) => block.querySelector(selector) === null,
		)
		return blocks
			.map((block) => {
				const copy = block.cloneNode(true) as Element
				for (const lineBreak of copy.querySelectorAll("br")) {
					lineBreak.replaceWith(" ")
				}
				return copy.textContent ?? ""
			})
			.join(" ")
	})
}

const ROLE = /^(User|Assistant|System|Tool): /

/** What Memongo stored in front of an event is its role; the page shows it
 * apart from the text. */
export const storedRole = (text: string): string | undefined =>
	ROLE.exec(text)?.[1]
export const storedBody = (text: string): string => text.replace(ROLE, "")

type CitedEvent = { eventId: string; text?: string; timestamp?: string }

/** A stored claim as the proxy served it: the part the page's sources read. */
export type StoredClaim = {
	text: string
	marker?: string
	evidence: Array<{ kind: string; sourceId: string; marker?: string }>
}

/** The claim a marker names, found in what the proxy served, not on the page. */
export function findClaim(
	proxy: DemoProxy,
	marker: string,
): StoredClaim | undefined {
	const walk = (value: unknown): StoredClaim | undefined => {
		if (Array.isArray(value)) {
			for (const item of value) {
				const found = walk(item)
				if (found) return found
			}
			return undefined
		}
		if (typeof value !== "object" || value === null) {
			return undefined
		}
		const record = value as Record<string, unknown>
		if (
			record.marker === marker &&
			typeof record.text === "string" &&
			Array.isArray(record.evidence)
		) {
			return record as unknown as StoredClaim
		}
		for (const child of Object.values(record)) {
			const found = walk(child)
			if (found) return found
		}
		return undefined
	}
	for (const entry of proxy.responses) {
		const found = walk(entry.body)
		if (found) return found
	}
	return undefined
}

/** What `scope` shows of a claim's sources is what the claim stores: a slip for
 * each source event it cites (to the page's limit), or, when it cites none, the
 * plain statement of that, with nothing left loading. */
export async function expectSourcesMatchEvidence(
	scope: Locator,
	claim: StoredClaim,
): Promise<void> {
	const events = claim.evidence.filter(
		(entry, at, all) =>
			entry.kind === "event" &&
			all.findIndex(
				(other) => other.kind === "event" && other.sourceId === entry.sourceId,
			) === at,
	)
	if (events.length === 0) {
		const honest = scope.locator('[data-state="empty"]')
		await expect(honest).toBeVisible(SLOW_READ)
		await expect(honest).toContainText(
			claim.evidence.length === 0
				? /stored with no evidence/i
				: /not (a source event|source events)/i,
		)
		await expect(scope.locator("article[data-status]")).toHaveCount(0)
		await expect(scope.locator('[data-state="loading"]')).toHaveCount(0)
		return
	}
	await sourcesSettled(scope)
	const shown = events.slice(0, SOURCE_LIMIT)
	await expect(scope.locator("article[data-status]")).toHaveCount(shown.length)
	for (const entry of shown) {
		await expect(
			scope.locator("article").filter({ hasText: entry.sourceId }),
		).toHaveCount(1)
	}
}

/** Every source slip under `scope` has been read: each is its own cite, and a
 * cite is slow live, so the slips fill in one by one. At least one slip, or the
 * statement that a claim has no source, must exist, so an absent list is not
 * mistaken for a finished one. */
export async function sourcesSettled(scope: Locator): Promise<void> {
	await expect(
		scope.locator('article[data-status], [data-state="empty"]').first(),
	).toBeVisible(SLOW_READ)
	await expect(scope.locator('[data-state="loading"]')).toHaveCount(
		0,
		SLOW_READ,
	)
	await expect(scope.locator('article[data-status="loading"]')).toHaveCount(
		0,
		SLOW_LIST,
	)
}

/** The cite reads the proxy refused for a claim, each as the stored event it
 * asked about. A source the API cannot confirm, or a read that fails, is an
 * answer the page shows as an unavailable slip; the fixture never refuses one. */
function refusedCites(
	proxy: DemoProxy,
	claim: StoredClaim,
	marker: string,
	resolved: ReadonlyMap<string, CitedEvent>,
): string[] {
	const refused = new Set<string>()
	for (const entry of proxy.responses) {
		if (
			entry.url.pathname !== "/api/demo/v1/cite" ||
			entry.url.searchParams.get("citedBy") !== marker ||
			entry.status < 400
		) {
			continue
		}
		const asked = entry.url.searchParams.get("marker")
		const evidence = claim.evidence.find(
			(candidate) =>
				candidate.kind === "event" &&
				(candidate.marker ?? `[[event:${candidate.sourceId}]]`) === asked,
		)
		if (evidence && !resolved.has(evidence.sourceId)) {
			refused.add(evidence.sourceId)
		}
	}
	return [...refused]
}

/** An open citation shows what the proxy's `cite` answers said: one resolved
 * slip per resolved source, each with its full stored text and its own business
 * time (or the statement that it has none), and one unavailable slip for each
 * source the proxy refused to read. */
export async function expectCitationMatchesCites(
	proxy: DemoProxy,
	dialog: Locator,
): Promise<void> {
	await sourcesSettled(dialog)
	await proxy.flush()
	const marker = squash(
		(await dialog.getByTestId("citation-marker").textContent()) ?? "",
	)
	const claim = findClaim(proxy, marker)
	expect(claim, `no stored claim for ${marker}`).toBeDefined()
	await expectSourcesMatchEvidence(dialog, claim as StoredClaim)
	if (!claim?.evidence.some((entry) => entry.kind === "event")) {
		return
	}
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
	const refused = refusedCites(proxy, claim, marker, byEvent)
	if (GENERATED) {
		expect(refused, `the fixture refused a cite for ${marker}`).toEqual([])
	}
	expect(
		byEvent.size + refused.length,
		`no cite answer for ${marker}`,
	).toBeGreaterThan(0)
	await expect(
		dialog.locator('article[data-status="unavailable"]'),
	).toHaveCount(refused.length)
	for (const sourceId of refused) {
		await expect(
			dialog
				.locator('article[data-status="unavailable"]')
				.filter({ hasText: sourceId }),
		).toHaveCount(1)
	}
	await expect(dialog.locator('article[data-status="resolved"]')).toHaveCount(
		byEvent.size,
	)
	for (const event of byEvent.values()) {
		const slip = dialog.locator("article").filter({
			has: dialog.page().getByText(event.eventId, { exact: true }),
		})
		if (event.text) {
			expect(wordsOf(await blockText(slip.getByTestId("source-text")))).toBe(
				wordsOf(storedBody(event.text)),
			)
			const role = storedRole(event.text)
			if (role) {
				await expect(slip.getByTestId("source-role")).toContainText(role)
			}
		}
		await expect(slip.locator('[data-time-kind="business"]')).toContainText(
			event.timestamp ? formatUtc(event.timestamp) : "missing in this source",
		)
	}
}

/** The reads the proxy refused, as `status code path`, for a run's log. */
export function refusedReads(proxy: DemoProxy): string[] {
	return proxy.responses
		.filter(({ status }) => status >= 400)
		.map(({ status, url, body }) => {
			const code = (body as { error?: { code?: string } } | null)?.error?.code
			return `${status} ${code ?? "-"} ${url.pathname}${url.search}`
		})
}

/** The console and page errors that no refused read accounts for. The browser
 * logs one "Failed to load resource" line for each non-2xx answer; a source
 * the API cannot confirm is such an answer, and the page shows it as an
 * unavailable slip. Every other error, and any such line the proxy did not
 * serve, stays an error. */
export function unexplainedBrowserErrors(
	proxy: DemoProxy,
	errors: readonly string[],
): string[] {
	const refused = proxy.responses
		.filter(({ status }) => status >= 400)
		.map(({ status }) => status)
	return errors.filter((text) => {
		const status =
			/^Failed to load resource: the server responded with a status of (\d{3})\b/.exec(
				text,
			)?.[1]
		const at = status === undefined ? -1 : refused.indexOf(Number(status))
		if (at === -1) {
			return true
		}
		refused.splice(at, 1)
		return false
	})
}

/** Every read the open chapter makes has come back: no map, row, step or page
 * check still says it is loading. A role's steps are read only once opened, so
 * a closed list is not waiting on anything. A screenshot taken before this shows
 * a placeholder where the answer will be. */
export async function readsSettled(page: Page): Promise<void> {
	for (const pending of [
		'[data-state="loading"]',
		'[data-testid="source-row"][data-status="loading"]',
		'details[open] [data-testid="agent-step"][data-status="loading"]',
		'[data-testid="agent-check"][data-check="checking"]',
	]) {
		await expect(page.locator(pending)).toHaveCount(0, SLOW_READ)
	}
}

/** Lets the finite CSS animations and transitions and every GSAP move finish,
 * so a contrast check or a one-shot read does not meet a half-faded frame or a
 * number still counting. */
export async function settled(page: Page): Promise<void> {
	await page.waitForFunction(() => {
		const seam = Reflect.get(window, Symbol.for("mdbrain.demo.motion")) as
			| { tweens: () => number }
			| undefined
		return seam === undefined || seam.tweens() === 0
	}, undefined)
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

/** Steps chapter 5's walk-through with its own buttons to a beat: 0 is the first
 * claim, 1 the second, 2 what mdbrain recorded. */
export async function showBeat(page: Page, index: number): Promise<void> {
	const stepper = page.getByTestId("beat-stepper")
	await expect(stepper).toBeVisible()
	for (let press = 0; press < 3; press += 1) {
		const at = Number(await stepper.getAttribute("data-beat"))
		if (at === index) {
			return
		}
		await stepper
			.getByRole("button", {
				name: at < index ? /^Next beat/ : /Previous beat$/,
			})
			.click()
	}
	await expect(stepper).toHaveAttribute("data-beat", String(index))
}

/** Waits for chapter 5 to settle and says which case the run is. The proxy's
 * own lint answer decides: a run with no unresolved contradiction (a seeded
 * slot before its agent run) must show the honest not-yet state and nothing
 * that reads as an error; one with a record must show its walk-through, on the
 * first claim, with the stamp held for the last beat. Anything else, an error
 * panel included, fails here rather than skipping. */
export async function settleContradiction(
	page: Page,
	proxy: DemoProxy,
): Promise<"recorded" | "none"> {
	const screen = page.getByTestId("screen")
	const stamp = screen.getByTestId("contradiction-stamp")
	const honest = screen.getByText(NONE_YET)
	const stepper = screen.getByTestId("beat-stepper")
	await expect(stepper.or(honest)).toBeVisible(SLOW_READ)
	await proxy.flush()
	const lint = bodyOf<{ unresolvedContradictions: unknown[] }>(
		proxy.latest("wiki/lint"),
		"lint",
	)
	if (lint.unresolvedContradictions.length > 0) {
		await expect(stepper).toBeVisible()
		await expect(stamp).toHaveCount(1)
		return "recorded"
	}
	await expect(honest).toBeVisible()
	await expect(stepper).toHaveCount(0)
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
		await showBeat(page, 0)
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
