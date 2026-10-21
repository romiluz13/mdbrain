// /demo value checks: every number, title, time and citation on screen against
// the proxy's own response (the fixture's, or the live stack's with DEMO_E2E_LIVE=1).
import { expect, test } from "@playwright/test"
import { formatUtc } from "../lib/demo-data/views"
import {
	allChanges,
	bodyOf,
	claimsOf,
	eventSourceIds,
	goto,
	listPages,
	listTotal,
	mapReady,
	openDemo,
	settleContradiction,
	sourcesSettled,
	squash,
	stat,
} from "./demo-helpers"
import { GENERATED, installDemoProxy, SLOW_READ } from "./demo-proxy"

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
		const read = page.locator('[data-verify="pages"] code')
		await expect(read).toHaveText("GET /api/demo/v1/wiki?limit=100&skip=0")
		expect(
			await read.evaluate((element) => getComputedStyle(element).fontFamily),
		).toMatch(/mono|menlo|monospace/i)
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
		).toBeVisible(SLOW_READ)
		await page.keyboard.press("Escape")

		await goto(page, 6)
		const row = page.getByTestId("change-row").first()
		await expect(row.locator('[data-time-kind="ingestion"]')).toBeVisible(
			SLOW_READ,
		)
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
		await expect(page.getByTestId("ask-hit").first()).toBeVisible(SLOW_READ)
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
		if ((await settleContradiction(page, proxy)) === "none") {
			await expect(page.getByTestId("contradiction-claim")).toHaveCount(0)
			return
		}
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
		await sourcesSettled(page.getByTestId("screen"))
		await proxy.flush()
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
		if (GENERATED) {
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
		await expect(stat(page, "revisions")).not.toHaveText("—", SLOW_READ)
		await proxy.flush()
		const changes = allChanges(proxy)
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
