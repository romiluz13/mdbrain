// The /demo journey, shared by the journey spec and the recorder: an enterprise
// buyer steps through the nine chapters and opens a citation down to the stored
// source. The input mode (keyboard or touch) is passed in.
import { expect, type Locator, type Page } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import type { AnswerOutcome } from "../lib/demo-data/answer-types.js"
import {
	chapterTitle,
	expectCitationMatchesCites,
	listPages,
	mapReady,
	openDemo,
	refusedReads,
	settleContradiction,
	settled,
	tabTo,
	type DemoProxy,
	unexplainedBrowserErrors,
} from "./demo-helpers"
import {
	GENERATED,
	installAnswerRoute,
	SLOW_LIST,
	SLOW_READ,
} from "./demo-proxy"
import { PENDING_PROPOSAL } from "./demo-run"

export type Act = (target: Locator) => Promise<void>

export const withKeyboard =
	(page: Page): Act =>
	async (target) => {
		await tabTo(page, target)
		await page.keyboard.press("Enter")
	}

// A tap that lands while a chapter's tweens still move misses: the beat's source
// slips slide over the claim's opener. And the page scrolls smoothly
// (`html { scroll-behavior: smooth }`), so a tap's own scroll-into-view is still
// moving while it hit-tests and the sticky banner and stepper cover the target.
// Wait for the motion to end and centre the target first.
export const withTouch: Act = async (target) => {
	await settled(target.page())
	await target.evaluate((element) =>
		element.scrollIntoView({ block: "center", behavior: "instant" }),
	)
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

/** Shows rows until one has a stored claim behind it: a live run's first
 * arrivals may be sources no claim cites, which have no source to open. */
async function showAnOpenableSource(page: Page): Promise<void> {
	const open = page.getByRole("button", { name: /^Open source / })
	const more = page.getByRole("button", { name: "Show ten more" })
	for (let asked = 0; asked < 8; asked += 1) {
		if ((await open.count()) > 0 || !(await more.isVisible())) {
			break
		}
		await more.click()
	}
	await expect(open.first()).toBeVisible(SLOW_READ)
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

/** The answer lane step is opt-in: the live recorder never stubs the answers
 * route, whose server side needs the control store and an Anthropic key. */
export async function journey(
	page: Page,
	proxy: DemoProxy,
	act: Act,
	how: "escape" | "close",
	walksTheAnswerLane = false,
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

	// 2b The answer lane: a written answer from the stubbed route, its citation
	// opening like any other. The journey walks the lane wherever the route can
	// be stubbed; the live recorder does not, because the real route needs the
	// control store and an Anthropic key no test may call.
	if (walksTheAnswerLane) {
		const firstPage = listPages(proxy).find(
			(candidate) => candidate.claims.length > 0,
		)
		const claim = firstPage?.claims[0]
		const marker = claim?.marker ?? ""
		if (!firstPage || !claim || !marker) {
			throw new Error("the fixture has no claim to cite")
		}
		const answered: AnswerOutcome = {
			state: "answered",
			text: `The stored record answers it: ${marker} and the answer lane cites only what the brain holds.`,
			citations: [
				{
					marker,
					response: {
						status: "resolved",
						kind: "claim",
						marker,
						page: {
							slug: firstPage.slug,
							title: firstPage.title,
							revision: firstPage.revision,
							revisionCreatedAt: firstPage.updatedAt,
						},
						claim,
					},
				},
			],
		}
		const answers = await installAnswerRoute(page, () => ({
			kind: "outcome",
			body: answered,
		}))
		await act(page.getByTestId("answer-submit"))
		await expect(page.getByTestId("answer-text")).toBeVisible()
		await citeAndReturn(
			page,
			proxy,
			act,
			page
				.getByTestId("answer-text")
				.getByRole("button", { name: /^Open citation for:/ })
				.first(),
			how,
		)
		expect(answers.served[0]?.question ?? "").not.toBe("")
	}
	// 3 Sources arrive: the run's record in arrival order, or an honest note that
	// this server has no run record, and a source opened down to its text.
	await nextChapter(page, act, 1)
	await expect(
		page.locator(
			'[data-testid="arrivals-summary"], [data-state="incomplete"][data-reason="RUN_NOT_CONFIGURED"]',
		),
	).toBeVisible(SLOW_READ)
	await showAnOpenableSource(page)
	await citeAndReturn(
		page,
		proxy,
		act,
		page.getByRole("button", { name: /^Open source / }).first(),
		how,
	)

	// 4 Agents at work: the run's agents with their steps confirmed, or an honest
	// not-yet state, and never an error.
	await nextChapter(page, act, 2)
	await expect(
		page
			.locator(
				'[data-testid="agent-run"], [data-state="incomplete"], [data-state="empty"]',
			)
			.first(),
	).toBeVisible(SLOW_READ)
	for (const summary of await page
		.getByTestId("agent-role")
		.locator("summary")
		.all()) {
		await act(summary)
	}
	await expect(
		page.locator('[data-testid="agent-step"][data-status="loading"]'),
	).toHaveCount(0, SLOW_LIST)
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
		const stepper = page.getByTestId("beat-stepper")
		await act(stepper.getByRole("button", { name: /^Next beat/ }))
		await expect(page.getByTestId("contradiction-claim").nth(1)).toBeVisible()
		await act(stepper.getByRole("button", { name: /^Next beat/ }))
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
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
	await proxy.flush()
	// A pending proposal is not a page until a person approves it, so chapter 4
	// reads its absence and 404 is the answer it expects.
	const proposalAbsent = `404 WIKI_NOT_FOUND /api/demo/v1/wiki/${encodeURIComponent(PENDING_PROPOSAL.slug)}`
	const refused = refusedReads(proxy).filter((read) => read !== proposalAbsent)
	if (refused.length > 0) {
		console.log(`[demo-e2e] reads the proxy refused:\n${refused.join("\n")}`)
	}
	if (GENERATED) {
		expect(refused, "the fixture refused a read").toEqual([])
	}
	expect(
		unexplainedBrowserErrors(proxy, browserErrors),
		"console and page errors across the journey",
	).toEqual([])
}
