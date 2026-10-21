// /demo state checks: loading, error, empty and incomplete on every chapter, a
// source with no business time, and a search lane that is down. They force
// states through the fixture route, so they do not run against a live stack.
import { expect, test } from "@playwright/test"
import { CHAPTERS } from "../app/demo/chapters"
import { proxyError } from "../lib/demo-data/proxy-errors"
import {
	expectCitationMatchesCites,
	goto,
	listPages,
	mapReady,
	openAnyCitation,
	openDemo,
	settleContradiction,
	showBeat,
	sourcesSettled,
	stat,
} from "./demo-helpers"
import { GENERATED, installDemoProxy } from "./demo-proxy"

test.describe("states", () => {
	test.skip(!GENERATED, "the states are forced through the generated fixture")

	test("loading, then ready", async ({ page }) => {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		await installDemoProxy(page, {
			override: async (url) => {
				if (url.pathname === "/api/demo/v1/wiki") await gate
				return undefined
			},
		})
		await page.goto("/demo")
		await expect(page.locator('[data-state="loading"]').first()).toBeVisible()
		await expect(stat(page, "pages")).toHaveText("—")
		release()
		await mapReady(page)
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
	})

	test("error names the failure, offers a retry, and recovers", async ({
		page,
	}) => {
		let broken = true
		await installDemoProxy(page, {
			override: (url) =>
				broken && url.pathname === "/api/demo/v1/wiki"
					? new Response(
							JSON.stringify({
								error: { code: "UPSTREAM_ERROR", message: "the API is down" },
							}),
							{ status: 502 },
						)
					: undefined,
		})
		await openDemo(page)
		const error = page.locator('[data-state="error"]').first()
		await expect(error).toBeVisible()
		await expect(error).toContainText("UPSTREAM_ERROR")
		await expect(error).toContainText("502")
		await goto(page, 6)
		await expect(page.locator('[data-state="error"]')).toContainText(
			"NO_WINDOW_START",
		)
		await goto(page, 0)
		broken = false
		await page.getByRole("button", { name: "Try again" }).first().click()
		await mapReady(page)
		await expect(page.locator('[data-state="error"]')).toHaveCount(0)
	})

	test("empty is stated as empty, on every chapter that reads pages", async ({
		page,
	}) => {
		await installDemoProxy(page, {
			override: (url) =>
				url.pathname === "/api/demo/v1/wiki"
					? new Response(JSON.stringify({ pages: [], total: 0 }), {
							status: 200,
						})
					: undefined,
		})
		await openDemo(page)
		await expect(page.locator('[data-state="empty"]').first()).toContainText(
			"Nothing stored yet",
		)
		for (const index of [5, 6]) {
			await goto(page, index)
			await expect(page.locator('[data-state="empty"]').first()).toBeVisible()
		}
	})

	test("every chapter states what it could not read, and what is not stored", async ({
		page,
	}) => {
		const down = new Response(
			JSON.stringify({
				error: { code: "UPSTREAM_ERROR", message: "the API is down" },
			}),
			{ status: 502 },
		)
		const emptyBody: Record<string, unknown> = {
			"/api/demo/v1/wiki": { pages: [], total: 0 },
			"/api/demo/v1/wiki/lint": {
				pages: 0,
				total: 0,
				unresolvedContradictions: [],
			},
			// A seeded run whose agents have not started and which wrote nothing.
			"/api/demo/v1/run": {
				state: "ready",
				createdAt: "2026-10-20T08:55:00.000Z",
				eventsPlanned: 0,
				pagesPlanned: 0,
				arrivals: [],
				pagesWritten: [],
			},
		}
		let mode: "down" | "empty" = "down"
		await installDemoProxy(page, {
			override: (url) =>
				mode === "down"
					? down.clone()
					: new Response(JSON.stringify(emptyBody[url.pathname] ?? {}), {
							status: 200,
						}),
		})
		const agents = CHAPTERS.findIndex((chapter) => chapter.id === "agents")
		await openDemo(page)
		for (const [stateMode, expected] of [
			["down", "error"],
			["empty", "empty"],
		] as const) {
			mode = stateMode
			await page.reload()
			for (const [index, chapter] of CHAPTERS.entries()) {
				await goto(page, index)
				const screen = page.getByTestId("screen")
				// With the run's record unreadable the agents are an error like any
				// other; with it empty they are not yet in the run.
				const want =
					index === agents && stateMode === "empty" ? "incomplete" : expected
				await expect(
					screen.locator(`[data-state="${want}"]`).first(),
					`${chapter.id} under ${stateMode}`,
				).toBeVisible()
				await expect(
					screen.locator('[data-state="loading"]'),
					`${chapter.id} is still loading under ${stateMode}`,
				).toHaveCount(0)
				if (chapter.id === "ask") {
					await expect(
						screen.getByText(
							"Example questions appear once the pages are read.",
						),
						`ask says why it has no examples under ${stateMode}`,
					).toBeVisible()
					await expect(
						screen.getByRole("list", { name: "Example questions" }),
						`ask offers no invented examples under ${stateMode}`,
					).toHaveCount(0)
				}
			}
		}
	})

	test("a run with no contradiction recorded yet says so on chapter 5, and does not read as an error", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page, { contradiction: "none" })
		await openDemo(page)
		await mapReady(page)
		await expect(stat(page, "contradictions")).toHaveText("0")
		const chapter = CHAPTERS.findIndex((entry) => entry.id === "contradiction")
		await goto(page, chapter)
		const screen = page.getByTestId("screen")
		const honest = screen.locator('[data-state="empty"]')
		await expect(honest).toBeVisible()
		await expect(honest).toContainText("Not recorded in this run yet")
		await expect(honest).toContainText(/none is recorded in this run yet/i)
		await expect(honest).toContainText(/agents write/i)
		await expect(screen.locator('[data-state="error"]')).toHaveCount(0)
		await expect(screen.getByRole("alert")).toHaveCount(0)
		await expect(screen.getByTestId("contradiction-stamp")).toHaveCount(0)
		await expect(screen.getByTestId("contradiction-claim")).toHaveCount(0)
		await expect(screen.getByTestId("beat-stepper")).toHaveCount(0)
		// What the chapter says before the state says there is none must not
		// assert the thing the state denies.
		const chapterText = (await page.locator("main#chapter").textContent()) ?? ""
		expect(chapterText).not.toMatch(/two pages disagree\./i)
		expect(chapterText).not.toContain("Where the two pages sit")
		expect(await settleContradiction(page, proxy)).toBe("none")
		await openAnyCitation(page, proxy)
		await expect(
			page
				.getByRole("dialog")
				.locator('article[data-status="resolved"]')
				.first(),
		).toBeVisible()
	})

	test("a claim stored with no evidence says so plainly in chapter 5 and in its citation, and nothing keeps loading", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page, { contradiction: "unsourced" })
		await openDemo(page)
		await mapReady(page)
		await goto(page, 4)
		expect(await settleContradiction(page, proxy)).toBe("recorded")
		const cards = page.locator('li:has([data-testid="contradiction-claim"])')
		await expect(cards).toHaveCount(2)
		await expect(cards.nth(0).locator("article[data-status]")).not.toHaveCount(
			0,
		)
		await showBeat(page, 1)
		const bare = cards.nth(1)
		await expect(bare.locator('[data-state="empty"]')).toContainText(
			"stored with no evidence",
		)
		await expect(bare.locator("article[data-status]")).toHaveCount(0)
		await expect(bare.locator('[data-state="loading"]')).toHaveCount(0)

		await page
			.getByRole("button", { name: "Open citation for claim two" })
			.click()
		const dialog = page.getByRole("dialog")
		await expect(dialog.getByTestId("citation-claim")).toBeVisible()
		await expectCitationMatchesCites(proxy, dialog)
		await expect(dialog.locator('[data-state="empty"]')).toContainText(
			"stored with no evidence",
		)
		await expect(dialog.locator("article")).toHaveCount(0)
		await expect(dialog.locator('[data-state="loading"]')).toHaveCount(0)
	})

	test("a citation shows its claim at once and each source as its own read resolves", async ({
		page,
	}) => {
		let slowMarker: string | null = null
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const proxy = await installDemoProxy(page, {
			override: async (url) => {
				if (
					url.pathname === "/api/demo/v1/cite" &&
					url.searchParams.get("marker") === slowMarker
				) {
					await gate
				}
				return undefined
			},
		})
		await openDemo(page)
		await mapReady(page)
		await proxy.flush()
		const stored = listPages(proxy).find((candidate) =>
			candidate.claims.some(
				(claim) =>
					claim.evidence.filter((evidence) => evidence.kind === "event")
						.length >= 3,
			),
		)
		const claim = stored?.claims.find(
			(candidate) =>
				candidate.evidence.filter((evidence) => evidence.kind === "event")
					.length >= 3,
		)
		if (!stored || !claim) throw new Error("no claim rests on three sources")
		const events = claim.evidence
			.filter((evidence) => evidence.kind === "event")
			.slice(0, 6)
		slowMarker = events[0]?.marker ?? null
		await page.getByLabel("Pick a page").selectOption({ label: stored.title })
		await page
			.getByRole("complementary", { name: "Page inspector" })
			.getByRole("button", { name: /^Open citation for:/ })
			.nth(stored.claims.indexOf(claim))
			.click()
		const dialog = page.getByRole("dialog")
		await expect(dialog.getByTestId("citation-claim")).toHaveText(claim.text)
		const slips = dialog.locator("article[data-status]")
		await expect(slips).toHaveCount(events.length)
		await expect(dialog.locator('article[data-status="loading"]')).toHaveCount(
			1,
		)
		await expect(dialog.locator('article[data-status="resolved"]')).toHaveCount(
			events.length - 1,
		)
		await expect(
			dialog.locator('article[data-status="loading"]'),
		).toContainText(events[0]?.sourceId ?? "")
		release()
		await expect(dialog.locator('article[data-status="resolved"]')).toHaveCount(
			events.length,
		)
		await expect(dialog.locator('article[data-status="loading"]')).toHaveCount(
			0,
		)
	})

	test("a source the API cannot confirm says so on chapter 3 and in its citation, and a failed read says to try again", async ({
		page,
	}) => {
		let refuse: "unconfirmed" | "failed" = "unconfirmed"
		const proxy = await installDemoProxy(page, {
			override: (url) =>
				url.pathname === "/api/demo/v1/cite"
					? refuse === "unconfirmed"
						? proxyError(
								404,
								"CITATION_UNRESOLVED",
								"The source could not be confirmed in this run.",
							)
						: proxyError(
								502,
								"UPSTREAM_ERROR",
								"The upstream could not answer this read.",
							)
					: undefined,
		})
		await openDemo(page)
		await mapReady(page)
		await goto(page, 2)
		const rows = page.getByTestId("source-row")
		await expect(rows.first()).toBeVisible()
		await expect(
			page.locator('[data-testid="source-row"][data-status="loading"]'),
		).toHaveCount(0)
		const unconfirmed = page.locator(
			'[data-testid="source-row"][data-status="unconfirmed"]',
		)
		// Every shown row was asked about by its id, so every one is refused.
		await expect(unconfirmed).toHaveCount(await rows.count())
		await expect(unconfirmed.getByTestId("source-label")).toHaveText(
			Array(await rows.count()).fill("This source could not be confirmed"),
		)
		await expect(page.getByTestId("source-id")).toHaveCount(await rows.count())
		await page
			.getByRole("button", { name: /^Open source / })
			.first()
			.click()
		const dialog = page.getByRole("dialog")
		const slips = dialog.locator("article[data-status]")
		await expect(slips.first()).toBeVisible()
		await expect(dialog.locator('article[data-status="loading"]')).toHaveCount(
			0,
		)
		await expect(dialog.locator('article[data-status="resolved"]')).toHaveCount(
			0,
		)
		await expect(
			slips.filter({
				hasText:
					"The API could not confirm this source, so its text is not shown.",
			}),
		).toHaveCount(await slips.count())
		await expect(dialog).not.toContainText("could not be read right now")
		await proxy.flush()
		expect(
			proxy.responses
				.filter((entry) => entry.url.pathname === "/api/demo/v1/cite")
				.every((entry) => entry.status === 404),
		).toBe(true)

		await page.keyboard.press("Escape")
		refuse = "failed"
		await goto(page, 0)
		await goto(page, 2)
		await page
			.getByRole("button", { name: /^Open source / })
			.first()
			.click()
		await expect(page.getByRole("dialog")).toContainText(
			"This source could not be read right now.",
		)
		await expect(page.getByRole("dialog")).not.toContainText(
			"could not confirm this source",
		)
	})

	test("chapter 5 steps to the stamp while the sources are still being read", async ({
		page,
	}) => {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		await installDemoProxy(page, {
			override: async (url) => {
				if (url.pathname === "/api/demo/v1/cite") await gate
				return undefined
			},
		})
		await openDemo(page)
		await mapReady(page)
		await goto(
			page,
			CHAPTERS.findIndex((entry) => entry.id === "contradiction"),
		)
		const screen = page.getByTestId("screen")
		await expect(screen.getByTestId("beat-stepper")).toBeVisible()
		await expect(screen.getByTestId("contradiction-claim")).toHaveCount(2)
		await expect(screen.locator('article[data-status="loading"]')).toHaveCount(
			2,
		)
		await showBeat(page, 2)
		await expect(screen.getByTestId("contradiction-stamp")).toBeVisible()
		release()
		await expect(screen.locator('article[data-status="resolved"]')).toHaveCount(
			2,
		)
		await expect(screen.locator('article[data-status="loading"]')).toHaveCount(
			0,
		)
	})

	test("a source reads as markdown, shows its role apart, and opens to its full text", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await goto(
			page,
			CHAPTERS.findIndex((entry) => entry.id === "contradiction"),
		)
		await settleContradiction(page, proxy)
		const screen = page.getByTestId("screen")
		await sourcesSettled(screen)
		const slip = screen.locator('article[data-status="resolved"]').first()
		await expect(slip.getByTestId("source-role")).toContainText("User")
		const full = slip.getByTestId("source-text")
		const text = (await full.textContent()) ?? ""
		expect(text).not.toMatch(/\*\*/)
		expect(text.trimStart()).not.toMatch(/^User:/)
		expect(await full.locator("strong, li, td").count()).toBeGreaterThan(0)
		const excerpt = slip.getByTestId("source-excerpt")
		await expect(excerpt).toBeVisible()
		await expect(excerpt.locator("mark")).toBeVisible()
		await expect(full).toBeHidden()
		const summary = slip.locator("summary")
		await expect(summary).toHaveText("Show full source")
		await summary.focus()
		await page.keyboard.press("Enter")
		await expect(full).toBeVisible()
		await expect(full.locator("mark")).toBeVisible()
		await expect(summary).toHaveText("Hide full source")
		await page.keyboard.press("Enter")
		await expect(full).toBeHidden()
	})

	test("source text is shown as text: markup and links in it do nothing", async ({
		page,
	}) => {
		const hostile =
			'User: # Notes\n\n**Bold** <img src=x onerror="window.__pwned=1"> [click](javascript:window.__pwned=2)\n\n<script>window.__pwned=3</script>'
		const proxy = await installDemoProxy(page, {
			rewrite: (url, body) => {
				if (url.pathname !== "/api/demo/v1/cite") return body
				const cite = body as { event: Record<string, unknown> }
				return { ...cite, event: { ...cite.event, text: hostile } }
			},
		})
		await openDemo(page)
		await mapReady(page)
		await goto(
			page,
			CHAPTERS.findIndex((entry) => entry.id === "contradiction"),
		)
		await settleContradiction(page, proxy)
		const screen = page.getByTestId("screen")
		await sourcesSettled(screen)
		const slip = screen.locator('article[data-status="resolved"]').first()
		await expect(slip.getByTestId("source-text")).toContainText(
			'<img src=x onerror="window.__pwned=1">',
		)
		await expect(slip.locator("img, script, a, iframe")).toHaveCount(0)
		await expect(slip.locator("strong")).toHaveText("Bold")
		expect(
			await page.evaluate(
				() => (window as unknown as { __pwned?: number }).__pwned,
			),
		).toBeUndefined()
	})

	test("a source with no business time says it is missing, and keeps ingestion time", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page, {
			rewrite: (url, body) => {
				if (url.pathname !== "/api/demo/v1/cite") return body
				const cite = body as { event: Record<string, unknown> }
				const { timestamp: _dropped, ...event } = cite.event
				return { ...cite, event }
			},
		})
		await openDemo(page)
		await mapReady(page)
		await goto(page, 4)
		await settleContradiction(page, proxy)
		await showBeat(page, 2)
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
		const missing = page.locator(
			'article[data-status="resolved"] [data-time-kind="business"][data-missing="true"]',
		)
		await expect(missing.first()).toContainText("missing in this source")
		await expect(
			page
				.getByTestId("contradiction-stamp")
				.locator('[data-time-kind="ingestion"] time'),
		).toBeVisible()
	})

	test("a lane that is down is an error, and a blank question is empty", async ({
		page,
	}) => {
		await installDemoProxy(page, {
			override: (url) =>
				url.pathname === "/api/demo/v1/wiki/search"
					? new Response(
							JSON.stringify({
								error: {
									code: "SEARCH_UNAVAILABLE",
									message: "wiki search is currently unavailable",
								},
							}),
							{ status: 503 },
						)
					: undefined,
		})
		await openDemo(page)
		await mapReady(page)
		await goto(page, 1)
		await page
			.getByTestId("screen")
			.getByRole("button", { name: "Ask", exact: true })
			.click()
		await expect(page.locator('[data-state="empty"]')).toBeVisible()
		await page.getByLabel("Your question").fill("renewal")
		await page
			.getByTestId("screen")
			.getByRole("button", { name: "Ask", exact: true })
			.click()
		await expect(page.locator('[data-state="error"]')).toContainText(
			"SEARCH_UNAVAILABLE",
		)
	})
})
