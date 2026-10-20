// The /demo journey: an enterprise buyer steps through the nine chapters and
// opens a citation down to the stored source, by keyboard alone on desktop and
// by touch on the phone project. The proxy is the fixture upstream behind the
// real proxy handler unless DEMO_E2E_LIVE=1 points the page at a live stack.
import { expect, test, type Locator, type Page } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import {
	chapterTitle,
	eventSourceIds,
	listPages,
	mapReady,
	openDemo,
	tabTo,
	type Proxy,
} from "./demo-helpers"
import { installDemoProxy } from "./demo-proxy"

type Act = (target: Locator) => Promise<void>

const withKeyboard =
	(page: Page): Act =>
	async (target) => {
		await tabTo(page, target)
		await page.keyboard.press("Enter")
	}

const withTouch: Act = async (target) => {
	await target.tap()
}

/** Opens a citation from `opener`, reads it, closes it, and checks that focus
 * is back on the opener. `how` is the closing gesture the input mode has. */
async function citeAndReturn(
	page: Page,
	act: Act,
	opener: Locator,
	how: "escape" | "close",
): Promise<void> {
	await act(opener)
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()
	await expect(dialog.getByTestId("citation-claim")).toBeVisible()
	await expect(
		dialog.locator("[data-status]").or(dialog.locator('[data-state="empty"]')),
	).not.toHaveCount(0)
	await expect(dialog.locator(":focus")).toHaveCount(1)
	if (how === "escape") {
		await page.keyboard.press("Escape")
	} else {
		await dialog.getByRole("button", { name: "Close citation" }).tap()
	}
	await expect(dialog).toBeHidden()
	await expect(opener).toBeFocused()
}

async function nextChapter(page: Page, act: Act, from: number): Promise<void> {
	await act(
		page.getByRole("button", {
			name: new RegExp(`^${chapterTitle(from + 1)} →`),
		}),
	)
	await expect(
		page.getByRole("heading", { level: 1, name: chapterTitle(from + 1) }),
	).toBeFocused()
	await expect(page.getByTestId("synthetic-label")).toBeVisible()
}

async function journey(
	page: Page,
	act: Act,
	how: "escape" | "close",
): Promise<void> {
	await openDemo(page)
	await mapReady(page)
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		chapterTitle(0),
	)

	// 1 The brain: pick a page, open one of its claims down to the source.
	const inspector = page.getByRole("complementary", { name: "Page inspector" })
	await act(inspector.locator("ul button").first())
	await expect(inspector.getByRole("heading", { level: 3 })).toBeVisible()
	await citeAndReturn(
		page,
		act,
		inspector.getByRole("button", { name: /^Open citation for:/ }).first(),
		how,
	)

	// 2 Ask: a read-only question, then a hit's citation.
	await nextChapter(page, act, 0)
	await act(
		page.getByRole("button", { name: "Is the Halvorsen renewal healthy?" }),
	)
	await expect(page.getByTestId("ask-hit").first()).toBeVisible()
	await citeAndReturn(
		page,
		act,
		page
			.getByTestId("ask-hit")
			.first()
			.getByRole("button", { name: /^Open citation for:/ })
			.first(),
		how,
	)

	// 3 Sources arrive: an honest not-yet state, plus the sources that are stored.
	await nextChapter(page, act, 1)
	await expect(
		page.locator(
			'[data-state="incomplete"][data-reason="RUN_MANIFEST_NOT_EXPOSED"]',
		),
	).toBeVisible()
	await citeAndReturn(
		page,
		act,
		page.getByRole("button", { name: /^Open source / }).first(),
		how,
	)

	// 4 Agents at work: not yet in this run, and not an error.
	await nextChapter(page, act, 2)
	await expect(
		page.locator(
			'[data-state="incomplete"][data-reason="AGENT_ACTIVITY_NOT_EXPOSED"]',
		),
	).toBeVisible()
	await expect(page.locator('[data-state="error"]')).toHaveCount(0)

	// 5 A contradiction caught: both claims, both sources, the recorded stamp.
	await nextChapter(page, act, 3)
	await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
	await expect(page.getByTestId("contradiction-claim")).toHaveCount(2)
	await citeAndReturn(
		page,
		act,
		page.getByRole("button", { name: "Open citation for claim one" }),
		how,
	)

	// 6 Governed growth.
	await nextChapter(page, act, 4)
	await expect(page.getByTestId("review-queue-boundary")).toBeVisible()

	// 7 What changed.
	await nextChapter(page, act, 5)
	await expect(page.getByTestId("change-row").first()).toBeVisible()
	await citeAndReturn(
		page,
		act,
		page
			.getByTestId("change-row")
			.first()
			.getByRole("button", { name: /^Open citation for:/ }),
		how,
	)

	// 8 Under the hood: run one read.
	await nextChapter(page, act, 6)
	await act(page.getByRole("button", { name: "Run this read" }).first())
	await expect(page.getByTestId("read-status")).toContainText("HTTP 200")

	// 9 Reading the pinned run: read every number again.
	await nextChapter(page, act, 7)
	await act(page.getByRole("button", { name: "Read everything again" }))
	await expect(page.locator('[data-reread="pages"]')).toContainText("(matches)")
	await expect(page.getByRole("button", { name: /→$/ })).toHaveCount(0)
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: chapterTitle(CHAPTERS.length - 1),
		}),
	).toBeVisible()
}

test.describe("journey", () => {
	test("completes with the keyboard alone, citations returning focus", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the keyboard journey runs on the desktop project")
		const proxy = await installDemoProxy(page)
		await journey(page, withKeyboard(page), "escape")
		expect(listPages(proxy).length).toBeGreaterThan(0)
	})

	test("completes by touch on the phone, citations returning focus", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the touch journey runs on the mobile project")
		await installDemoProxy(page)
		await journey(page, withTouch, "close")
	})
})

test("the browser never carries the read key or the principal", async ({
	page,
}) => {
	const proxy: Proxy = await installDemoProxy(page)
	const consoleErrors: string[] = []
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text())
		}
	})
	page.on("pageerror", (error) => consoleErrors.push(String(error)))
	await openDemo(page)
	await mapReady(page)
	await page.getByRole("button", { name: chapterTitle(4) }).click()
	await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
	expect(proxy.responses.length).toBeGreaterThan(3)
	for (const entry of proxy.responses) {
		expect(entry.requestHeaders.authorization).toBeUndefined()
		for (const forbidden of ["scope", "scopeRef", "agentId", "containerTag"]) {
			expect(entry.url.searchParams.has(forbidden)).toBe(false)
		}
	}
	expect(consoleErrors).toEqual([])
	expect(eventSourceIds(listPages(proxy)).size).toBeGreaterThan(0)
})
