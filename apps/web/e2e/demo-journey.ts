// The /demo journey, shared by the journey spec and the recorder: an enterprise
// buyer steps through the nine chapters and opens a citation down to the stored
// source. The input mode (keyboard or touch) is passed in.
import { expect, type Locator, type Page } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import {
	chapterTitle,
	expectCitationMatchesCites,
	mapReady,
	openDemo,
	settleContradiction,
	tabTo,
	type DemoProxy,
} from "./demo-helpers"
import { SLOW_READ } from "./demo-proxy"

export type Act = (target: Locator) => Promise<void>

export const withKeyboard =
	(page: Page): Act =>
	async (target) => {
		await tabTo(page, target)
		await page.keyboard.press("Enter")
	}

export const withTouch: Act = async (target) => {
	await target.tap()
}

/** Opens a citation from `opener`, reads it, closes it, and checks that focus
 * is back on the opener. `how` is the closing gesture the input mode has. */
async function citeAndReturn(
	page: Page,
	proxy: DemoProxy,
	act: Act,
	opener: Locator,
	how: "escape" | "close",
): Promise<void> {
	await act(opener)
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()
	await expect(dialog.getByTestId("citation-claim")).toBeVisible()
	await expectCitationMatchesCites(proxy, dialog)
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

export async function journey(
	page: Page,
	proxy: DemoProxy,
	act: Act,
	how: "escape" | "close",
): Promise<void> {
	const browserErrors: string[] = []
	page.on("console", (message) => {
		if (message.type() === "error") {
			browserErrors.push(message.text())
		}
	})
	page.on("pageerror", (error) => browserErrors.push(String(error)))
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
		proxy,
		act,
		inspector.getByRole("button", { name: /^Open citation for:/ }).first(),
		how,
	)

	// 2 Ask: a read-only question, then a hit's citation.
	await nextChapter(page, act, 0)
	await act(
		page
			.getByRole("list", { name: "Example questions" })
			.getByRole("button")
			.first(),
	)
	await expect(page.getByTestId("ask-hit").first()).toBeVisible(SLOW_READ)
	await citeAndReturn(
		page,
		proxy,
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
		proxy,
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
	// A run before its agent run records none, and says so honestly instead.
	await nextChapter(page, act, 3)
	if ((await settleContradiction(page, proxy)) === "recorded") {
		await expect(page.getByTestId("contradiction-claim")).toHaveCount(2)
		await citeAndReturn(
			page,
			proxy,
			act,
			page.getByRole("button", { name: "Open citation for claim one" }),
			how,
		)
	}

	// 6 Governed growth.
	await nextChapter(page, act, 4)
	await expect(page.getByTestId("review-queue-boundary")).toBeVisible()

	// 7 What changed.
	await nextChapter(page, act, 5)
	await expect(page.getByTestId("change-row").first()).toBeVisible(SLOW_READ)
	await citeAndReturn(
		page,
		proxy,
		act,
		page
			.getByTestId("change-row")
			.getByRole("button", { name: /^Open citation for:/ })
			.first(),
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
	expect(browserErrors, "console and page errors across the journey").toEqual(
		[],
	)
}
