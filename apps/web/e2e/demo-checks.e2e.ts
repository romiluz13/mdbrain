// /demo checks beyond the journey: every value on screen against the proxy's
// own response, every state, reduced motion before load, 44 px targets,
// accessibility, and the map's cached static layer with its layout Worker.
import { expect, test, type Page } from "@playwright/test"
import { formatUtc } from "../lib/demo-data/views"
import { CHAPTERS } from "../app/demo/chapters"
import {
	bodyOf,
	chapterTitle,
	claimsOf,
	eventSourceIds,
	expectNoSeriousAccessibilityViolations,
	listPages,
	listTotal,
	mapReady,
	openDemo,
	settled,
	squash,
} from "./demo-helpers"
import { installDemoProxy, LIVE } from "./demo-proxy"

const goto = (page: Page, index: number) =>
	page.getByRole("button", { name: chapterTitle(index), exact: true }).click()

const stat = (page: Page, name: string) => page.locator(`[data-stat="${name}"]`)

test.describe("values on screen equal the proxy's responses", () => {
	test("the brain, the sources and the run's own table", async ({ page }) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await proxy.flush()
		const pages = listPages(proxy)
		const lint = proxy.latest("wiki/lint")?.body as {
			unresolvedContradictions: unknown[]
		}
		await expect(stat(page, "pages")).toHaveText(String(listTotal(proxy)))
		await expect(stat(page, "claims")).toHaveText(
			String(claimsOf(pages).length),
		)
		await expect(stat(page, "sources")).toHaveText(
			String(eventSourceIds(pages).size),
		)
		await expect(stat(page, "contradictions")).toHaveText(
			String(lint.unresolvedContradictions.length),
		)

		await goto(page, 8)
		await expect(stat(page, "verify-pages")).toHaveText(
			String(listTotal(proxy)),
		)
		await expect(stat(page, "verify-claims")).toHaveText(
			String(claimsOf(pages).length),
		)
		await expect(stat(page, "verify-sources")).toHaveText(
			String(eventSourceIds(pages).size),
		)
		await expect(stat(page, "verify-contradictions")).toHaveText(
			String(lint.unresolvedContradictions.length),
		)
	})

	test("a pinned page shows its stored revision, tier, state and claim count", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await proxy.flush()
		const stored = listPages(proxy)[1]
		if (!stored) throw new Error("the list returned no second page")
		await page.getByLabel("Pick a page").selectOption({ label: stored.title })
		const inspector = page.getByRole("complementary", {
			name: "Page inspector",
		})
		await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(
			stored.title,
		)
		await expect(inspector).toContainText(`trust tier: ${stored.trustTier}`)
		await expect(inspector).toContainText(`state: ${stored.state}`)
		await expect(inspector).toContainText(`revision ${stored.revision}`)
		await expect(inspector).toContainText(`${stored.claims.length} claims`)
		await expect(inspector.locator("time").first()).toHaveText(
			formatUtc(stored.createdAt),
		)
	})

	test("business time is stated missing wherever only ingestion time exists, and shown apart from it", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await proxy.flush()
		const stored = listPages(proxy).find((candidate) =>
			candidate.claims.some((claim) =>
				claim.evidence.some((evidence) => evidence.kind === "event"),
			),
		)
		if (!stored) throw new Error("no stored page has a claim with a source")
		await page.getByLabel("Pick a page").selectOption({ label: stored.title })
		const inspector = page.getByRole("complementary", {
			name: "Page inspector",
		})
		await expect(
			inspector.locator('[data-time-kind="business"][data-missing]'),
		).toContainText("missing on a page")
		await expect(
			inspector.locator('[data-time-kind="ingestion"]').first(),
		).toContainText(formatUtc(stored.createdAt))

		const revisions = proxy.responses
			.filter((entry) => entry.url.pathname === "/api/demo/v1/wiki/changes")
			.flatMap(
				(entry) =>
					(
						entry.body as {
							changes?: Array<{
								pageSlug: string
								revision: number
								createdAt: string
							}>
						}
					).changes ?? [],
			)
		const own = revisions.find(
			(change) =>
				change.pageSlug === stored.slug && change.revision === stored.revision,
		)
		await inspector
			.getByRole("button", { name: /^Open citation for:/ })
			.first()
			.click()
		const dialog = page.getByRole("dialog")
		await expect(dialog.getByTestId("citation-claim")).toBeVisible()
		await expect(dialog.locator('[data-time-kind="ingestion"]')).toContainText(
			formatUtc(own?.createdAt ?? stored.updatedAt),
		)
		await expect(
			dialog.locator('[data-time-kind="business"][data-missing]').first(),
		).toContainText("missing on the claim")
		await expect(
			dialog.locator('article [data-time-kind="business"]').first(),
		).toBeVisible()
		await page.keyboard.press("Escape")

		await goto(page, 6)
		const row = page.getByTestId("change-row").first()
		await expect(row.locator('[data-time-kind="ingestion"]')).toBeVisible()
		await expect(
			row.locator('[data-time-kind="business"][data-missing]'),
		).toContainText("missing on a revision")
	})

	test("ask lists the search response's pages in its order, with their scores", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await goto(page, 1)
		const examples = page
			.getByRole("list", { name: "Example questions" })
			.getByRole("button")
		await expect(examples.first()).toBeVisible()
		await proxy.flush()
		const titles = new Set(listPages(proxy).map((stored) => stored.title))
		const questions = await examples.allTextContents()
		for (const question of questions) {
			const title = question
				.replace(/^What do we know about /, "")
				.replace(/\?$/, "")
			expect(titles.has(title), `${question} names no stored page`).toBe(true)
		}
		await examples.first().click()
		await expect(page.getByTestId("ask-hit").first()).toBeVisible()
		await proxy.flush()
		const search = proxy.latest("wiki/search", { query: questions[0] ?? "" })
		const results = bodyOf<{
			results: Array<{ page: { title: string }; score: number }>
		}>(search, "search").results
		await expect(page.getByTestId("ask-hit")).toHaveCount(results.length)
		for (const [position, result] of results.entries()) {
			const card = page.getByTestId("ask-hit").nth(position)
			await expect(card.getByRole("heading", { level: 3 })).toHaveText(
				result.page.title,
			)
			await expect(card).toContainText(`score ${result.score.toFixed(2)}`)
		}
		expect(search?.url.searchParams.get("maxResults")).toBe("6")
	})

	test("the contradiction shows both stored claims, both sources, and both clocks", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await goto(page, 4)
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
		await proxy.flush()
		const holder = bodyOf<{
			unresolvedContradictions: Array<{
				pageSlug: string
				contradiction: { detectedAt: string; id: string; resolution: string }
			}>
		}>(proxy.latest("wiki/lint"), "lint").unresolvedContradictions[0]
		if (!holder) throw new Error("the lint read lists no contradiction")
		const overview = proxy.latest(
			`wiki/overview/${encodeURIComponent(holder.pageSlug)}`,
		)?.body as {
			contradictions: {
				items: Array<{ claims: Array<{ claim: { text: string } }> }>
			}
		}
		const record = overview.contradictions.items[0]
		await expect(page.getByTestId("contradiction-claim")).toHaveText(
			record?.claims.map((entry) => entry.claim.text) ?? [],
		)
		const stamp = page.getByTestId("contradiction-stamp")
		await expect(stamp.locator("time")).toHaveText(
			formatUtc(holder.contradiction.detectedAt),
		)
		await expect(stamp).toContainText(holder.contradiction.id)
		await expect(stamp).toContainText(
			`Resolution: ${holder.contradiction.resolution}`,
		)
		const cites = proxy.responses.filter(
			(entry) => entry.url.pathname === "/api/demo/v1/cite",
		)
		expect(cites.length).toBeGreaterThanOrEqual(2)
		for (const cite of cites) {
			const event = (
				cite.body as {
					event: { eventId: string; text: string; timestamp?: string }
				}
			).event
			const slip = page
				.locator('[data-status="resolved"]')
				.filter({ hasText: event.eventId })
				.first()
			await expect(slip.locator("time")).toHaveText(formatUtc(event.timestamp))
			expect(squash(await slip.getByTestId("source-text").innerText())).toBe(
				squash(event.text),
			)
		}
	})

	test("governed growth and what changed repeat the stored mix and revisions", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await proxy.flush()
		const pages = listPages(proxy)
		await goto(page, 5)
		await expect(page.getByTestId("review-queue-boundary")).toBeVisible()
		if (!LIVE) {
			expect(new Set(pages.map((p) => p.trustTier)).size).toBeGreaterThan(1)
			expect(new Set(pages.map((p) => p.state)).size).toBeGreaterThan(1)
		}
		for (const tier of new Set(pages.map((p) => p.trustTier))) {
			await expect(page.locator(`[data-bar="${tier}"]`)).toContainText(
				String(pages.filter((p) => p.trustTier === tier).length),
			)
		}
		for (const state of new Set(pages.map((p) => p.state))) {
			await expect(page.locator(`[data-bar="${state}"]`)).toContainText(
				String(pages.filter((p) => p.state === state).length),
			)
		}
		await goto(page, 6)
		await expect(stat(page, "revisions")).not.toHaveText("—")
		await proxy.flush()
		const changes = bodyOf<{
			changes: Array<{
				pageSlug: string
				revision: number
				createdAt: string
				claims: {
					added: unknown[]
					changed: unknown[]
					removed: unknown[]
					counts: { added: number; changed: number; removed: number }
				} | null
			}>
		}>(proxy.latest("wiki/changes"), "changes").changes
		const sum = (pick: (c: (typeof changes)[number]) => number) =>
			String(changes.reduce((n, c) => n + pick(c), 0))
		await expect(stat(page, "revisions")).toHaveText(String(changes.length))
		await expect(stat(page, "pages-touched")).toHaveText(
			String(new Set(changes.map((c) => c.pageSlug)).size),
		)
		await expect(stat(page, "claims-added")).toHaveText(
			sum((c) => c.claims?.counts.added ?? 0),
		)
		await expect(stat(page, "claims-moved")).toHaveText(
			sum(
				(c) =>
					(c.claims?.counts.changed ?? 0) + (c.claims?.counts.removed ?? 0),
			),
		)
		const shown = [...changes]
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
			.slice(0, 12)
		const rows = page.getByTestId("change-row")
		await expect(rows).toHaveCount(shown.length)
		for (const [position, change] of shown.entries()) {
			const verb = change.claims?.added.length
				? "Added"
				: change.claims?.changed.length
					? "Changed"
					: change.claims?.removed.length
						? "Removed"
						: null
			await expect(rows.nth(position)).toContainText(
				`revision ${change.revision}`,
			)
			if (verb) {
				await expect(
					rows.nth(position).getByText(verb, { exact: true }),
				).toBeVisible()
			}
		}
	})

	test("under the hood shows the status the proxy answered", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		await openDemo(page)
		await mapReady(page)
		await goto(page, 7)
		const row = page.locator('[data-read="wiki-list"]')
		await row.getByRole("button", { name: "Run this read" }).click()
		await expect
			.poll(() => proxy.latest("wiki", { limit: "2" })?.status)
			.toBeDefined()
		const served = proxy.latest("wiki", { limit: "2" })
		await expect(row.getByTestId("read-status")).toContainText(
			`HTTP ${served?.status}`,
		)
		await expect(row.locator("pre")).toContainText('"pages"')
	})
})

test.describe("states", () => {
	test.skip(LIVE, "the states are forced through the fixture route")

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
				const want = index === agents ? "incomplete" : expected
				await expect(
					screen.locator(`[data-state="${want}"]`).first(),
					`${chapter.id} under ${stateMode}`,
				).toBeVisible()
				await expect(
					screen.locator('[data-state="loading"]'),
					`${chapter.id} is still loading under ${stateMode}`,
				).toHaveCount(0)
			}
		}
	})

	test("a source with no business time says it is missing, and keeps ingestion time", async ({
		page,
	}) => {
		await installDemoProxy(page, {
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

test("the arrow keys step the chapters from the pager, and walk the rail without selecting", async ({
	page,
}) => {
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	const heading = (index: number) =>
		page.getByRole("heading", { level: 1, name: chapterTitle(index) })
	const next = page.getByRole("button", { name: /^Ask →/ })
	await next.focus()
	await page.keyboard.press("ArrowRight")
	await expect(heading(1)).toBeFocused()
	await page.getByRole("button", { name: /^Sources arrive →/ }).focus()
	await page.keyboard.press("ArrowLeft")
	await expect(heading(0)).toBeFocused()

	const rail = page.getByRole("navigation", { name: "Chapters" })
	await rail.getByRole("button", { name: chapterTitle(0), exact: true }).focus()
	await page.keyboard.press("ArrowDown")
	await expect(
		rail.getByRole("button", { name: chapterTitle(1), exact: true }),
	).toBeFocused()
	await expect(heading(0)).toBeVisible()
	await page.keyboard.press("ArrowUp")
	await expect(
		rail.getByRole("button", { name: chapterTitle(0), exact: true }),
	).toBeFocused()
	await page.keyboard.press("End")
	await expect(
		rail.getByRole("button", {
			name: chapterTitle(CHAPTERS.length - 1),
			exact: true,
		}),
	).toBeFocused()
})

type MotionLog = { started: string[]; peak: number }

/** From before any page script, records every animation or transition that
 * starts and the most that ever ran at once, so a test can see the first
 * frames and not only where the page settles. */
async function watchMotion(page: Page): Promise<() => Promise<MotionLog>> {
	await page.addInitScript(() => {
		const log: MotionLog = { started: [], peak: 0 }
		;(window as unknown as { __motion: MotionLog }).__motion = log
		for (const type of ["animationstart", "transitionrun"]) {
			window.addEventListener(
				type,
				(event) =>
					log.started.push(`${type}:${(event.target as Element).nodeName}`),
				true,
			)
		}
		const sample = () => {
			log.peak = Math.max(log.peak, document.getAnimations().length)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	return () =>
		page.evaluate(() => (window as unknown as { __motion: MotionLog }).__motion)
}

test.describe("reduced motion", () => {
	test.use({ contextOptions: { reducedMotion: "reduce" } })

	test("is honored from the first frame: no animation or transition runs", async ({
		page,
	}) => {
		const motion = await watchMotion(page)
		await installDemoProxy(page)
		await page.goto("/demo#contradiction")
		await expect(page.getByTestId("contradiction-stamp")).toBeVisible()
		await expect(page.locator("[data-motion]").first()).toHaveAttribute(
			"data-motion",
			"reduced",
		)
		expect(
			await page.evaluate(
				() => matchMedia("(prefers-reduced-motion: reduce)").matches,
			),
		).toBe(true)
		for (const id of ["screen", "contradiction-stamp"]) {
			expect(
				await page
					.getByTestId(id)
					.evaluate((element) => getComputedStyle(element).animationName),
			).toBe("none")
		}
		await expect
			.poll(() => page.evaluate(() => document.getAnimations().length))
			.toBe(0)
		await goto(page, 5)
		await goto(page, 0)
		await mapReady(page)
		expect(await motion()).toEqual({ started: [], peak: 0 })
	})
})

test("without the preference the chapter eases in", async ({ page }) => {
	const motion = await watchMotion(page)
	await installDemoProxy(page)
	await page.goto("/demo")
	await expect(page.locator("[data-motion]").first()).toHaveAttribute(
		"data-motion",
		"full",
	)
	expect(
		await page
			.getByTestId("screen")
			.evaluate((element) => getComputedStyle(element).animationName),
	).not.toBe("none")
	await expect
		.poll(async () => (await motion()).started.length)
		.toBeGreaterThan(0)
})

test("every interactive control on every chapter is at least 44 px", async ({
	page,
}) => {
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	const small = async () =>
		page.evaluate(() =>
			[
				...document.querySelectorAll(
					"button, a[href], select, input, summary, [role=button]",
				),
			]
				.filter((element) => !element.closest("nextjs-portal"))
				.map((element) => {
					const box = element.getBoundingClientRect()
					return {
						label: (
							element.getAttribute("aria-label") ??
							element.textContent ??
							""
						)
							.trim()
							.slice(0, 40),
						width: Math.round(box.width * 10) / 10,
						height: Math.round(box.height * 10) / 10,
						bottom: box.bottom,
					}
				})
				.filter(
					(entry) =>
						entry.bottom > 0 &&
						entry.width > 0 &&
						(entry.width < 43.5 || entry.height < 43.5),
				),
		)
	for (const [index, chapter] of CHAPTERS.entries()) {
		await goto(page, index)
		await expect(
			page.getByRole("heading", { level: 1, name: chapter.title }),
		).toBeVisible()
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
		expect(await small(), `chapter ${chapter.title}`).toEqual([])
	}
	await goto(page, 4)
	await page
		.getByRole("button", { name: "Open citation for claim one" })
		.click()
	await expect(page.getByRole("dialog")).toBeVisible()
	await expect(
		page.getByRole("dialog").locator('[data-state="loading"]'),
	).toHaveCount(0)
	expect(await small(), "the citation dialog").toEqual([])
})

test("no chapter scrolls sideways, keeps the synthetic label in view, and passes axe", async ({
	page,
}) => {
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	for (const [index, chapter] of CHAPTERS.entries()) {
		await goto(page, index)
		await expect(
			page.getByRole("heading", { level: 1, name: chapter.title }),
		).toBeVisible()
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
		await settled(page)
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
			`${chapter.title} fits the width`,
		).toBe(true)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		const label = await page.getByTestId("synthetic-label").boundingBox()
		expect(label?.y, `${chapter.title} label in view`).toBeGreaterThanOrEqual(
			-1,
		)
		await page.evaluate(() => window.scrollTo(0, 0))
		await expectNoSeriousAccessibilityViolations(page)
	}
	await goto(page, 4)
	await page
		.getByRole("button", { name: "Open citation for claim one" })
		.click()
	await expect(
		page.getByRole("dialog").getByTestId("source-text").first(),
	).toBeVisible()
	await expectNoSeriousAccessibilityViolations(page)
})

test("the layout runs in a Worker and interaction redraws only the live layer", async ({
	page,
	isMobile,
}) => {
	const workers: string[] = []
	page.on("worker", (worker) => workers.push(worker.url()))
	await installDemoProxy(page)
	await openDemo(page)
	await mapReady(page)
	await expect
		.poll(() => workers.some((url) => /graph-layout/.test(url)))
		.toBe(true)

	const staticLayer = page.locator('canvas[data-layer="static"]')
	const liveLayer = page.locator('canvas[data-layer="live"]')
	const draws = async (layer: typeof staticLayer) =>
		Number(await layer.getAttribute("data-draws"))
	let settled = -1
	await expect
		.poll(async () => {
			const now = await draws(staticLayer)
			const stable = now === settled
			settled = now
			return stable
		})
		.toBe(true)
	const staticBefore = await draws(staticLayer)
	const liveBefore = await draws(liveLayer)
	const pixelsBefore = await staticLayer.evaluate((canvas) =>
		(canvas as HTMLCanvasElement).toDataURL(),
	)

	const wrap = page.getByRole("img", { name: /^Map of \d+ stored pages/ })
	const box = await wrap.boundingBox()
	if (!box) throw new Error("the map has no box")
	const center = { x: box.width / 2, y: box.height / 2 }
	if (isMobile) await wrap.tap({ position: center })
	else await wrap.click({ position: center })
	const inspector = page.getByRole("complementary", { name: "Page inspector" })
	await expect(inspector.getByRole("heading", { level: 3 })).toBeVisible()
	if (!LIVE) {
		await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(
			"Northstar Track",
		)
	}
	await expect.poll(() => draws(liveLayer)).toBeGreaterThan(liveBefore)
	expect(await draws(staticLayer)).toBe(staticBefore)
	expect(
		await staticLayer.evaluate((canvas) =>
			(canvas as HTMLCanvasElement).toDataURL(),
		),
	).toBe(pixelsBefore)
})
