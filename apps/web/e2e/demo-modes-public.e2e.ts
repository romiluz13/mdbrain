// Public mode: the default /demo. It plays a completed run back as a recording,
// derives every number at the cursor from the run's stored revisions, shows
// the recorded approval as a fact, and has no way to write or to decide.
import type { MdbrainWikiChange } from "@mdbrain/client"
import { expect, type Page, test } from "@playwright/test"
import { formatUtc } from "../lib/demo-data/views.js"
import { expectNoSeriousAccessibilityViolations } from "./demo-helpers"
import {
	createWorld,
	installWorld,
	openChapter,
	type World,
} from "./demo-modes-kit"

const changesOf = (world: World): MdbrainWikiChange[] => {
	const byRevision = new Map<string, MdbrainWikiChange>()
	for (const entry of world.responses) {
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
	return [...byRevision.values()].sort(
		(a, b) =>
			Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
			(a.pageSlug < b.pageSlug ? -1 : a.pageSlug > b.pageSlug ? 1 : 0) ||
			a.revision - b.revision,
	)
}

/** What the API's own stored revisions say the brain held after the first
 * `cursor` of them: pages that exist and the claims they hold. */
function storedAt(changes: MdbrainWikiChange[], cursor: number) {
	const pages = new Set<string>()
	let claims = 0
	for (const change of changes.slice(0, cursor)) {
		pages.add(change.pageSlug)
		claims +=
			(change.claims?.counts.added ?? 0) - (change.claims?.counts.removed ?? 0)
	}
	return { pages: pages.size, claims }
}

const plural = (n: number, noun: string) =>
	`${n} ${n === 1 ? noun : `${noun}s`}`

async function revisionOf(page: Page): Promise<number> {
	const slider = page.getByTestId("playback-slider")
	return Number(await slider.inputValue())
}

test.describe("public mode", () => {
	test("is the recording by default: labeled, with nothing a presenter could press and no write sent", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		const sent: string[] = []
		page.on("request", (request) => {
			const url = new URL(request.url())
			if (url.pathname.startsWith("/api/") && request.method() !== "GET") {
				sent.push(`${request.method()} ${url.pathname}`)
			}
		})

		await openChapter(page, "brain")
		await expect(page.getByTestId("recorded-label")).toContainText("Recorded")
		await expect(page.getByTestId("live-label")).toHaveCount(0)
		await expect(page.getByTestId("presenter-bar")).toHaveCount(0)

		for (const id of [
			"sources",
			"agents",
			"contradiction",
			"growth",
			"changes",
		]) {
			await openChapter(page, id)
			await expect(page.getByTestId("recorded-label")).toBeVisible()
			await expect(
				page.getByRole("heading", { name: "Watch how it was built" }),
			).toBeVisible()
		}

		await openChapter(page, "growth")
		await expect(page.getByTestId("review-queue-boundary")).toBeVisible()
		await expect(page.getByTestId("recorded-approval")).toContainText(
			'Recorded: the proposed page "Silent ETA drift" was still waiting for a reviewer',
		)
		await expect(page.getByTestId("proposal-review")).toHaveCount(0)
		await expect(
			page.getByRole("button", { name: /^(approve|reject)$/i }),
		).toHaveCount(0)
		await expect(
			page.getByRole("button", {
				name: /^(lease|run the agents|pin for public)/i,
			}),
		).toHaveCount(0)

		expect(sent).toEqual([])
		expect(world.decisions).toEqual([])
		expect(world.stores.leases.docs.size).toBe(0)
		expect(world.stores.runRequests.docs.size).toBe(0)
	})

	test("reads the pinned run the server resolves, never a run the page names", async ({
		page,
		context,
	}) => {
		const world = createWorld()
		await installWorld(context, world)
		const asked: string[] = []
		page.on("request", (request) => {
			const url = new URL(request.url())
			if (url.pathname.startsWith("/api/demo/v1/")) asked.push(url.search)
		})
		await openChapter(page, "agents")
		await expect(page.getByTestId("agent-run")).toBeVisible()
		expect(asked.length).toBeGreaterThan(0)
		expect(asked.join("&")).not.toMatch(/scope|runId|agentId|key/i)
		expect(world.resolutions.every((r) => r.mode === "public")).toBe(true)
	})

	test("derives pages and claims at the cursor from the stored revisions, and matches the API at the end", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await openChapter(page, "changes")
		const slider = page.getByTestId("playback-slider")
		await expect(slider).toBeVisible()
		const changes = changesOf(world)
		const total = changes.length
		expect(total).toBeGreaterThan(3)
		await expect(slider).toHaveAttribute("max", String(total))
		expect(await revisionOf(page)).toBe(total)

		const readout = page.getByTestId("playback-readout")
		for (const cursor of [
			1,
			Math.ceil(total / 3),
			Math.ceil((2 * total) / 3),
			total,
		]) {
			await slider.fill(String(cursor))
			const expected = storedAt(changes, cursor)
			await expect(readout).toContainText(`Revision ${cursor} of ${total}`)
			await expect(readout.locator('[data-readout="pages"]')).toHaveText(
				plural(expected.pages, "page"),
			)
			await expect(readout.locator('[data-readout="claims"]')).toHaveText(
				plural(expected.claims, "claim"),
			)
			await expect(page.locator('[data-stat="revisions"]')).toContainText(
				String(cursor),
			)
		}

		const listed = world.responses
			.filter((r) => r.url.pathname === "/api/demo/v1/wiki" && r.status === 200)
			.map((r) => r.body as { total: number })
		expect(listed.length).toBeGreaterThan(0)
		await expect(readout.locator('[data-readout="pages"]')).toHaveText(
			plural(listed[0]?.total ?? -1, "page"),
		)
	})

	test("scrubs by keyboard, steps with its buttons and plays on", async ({
		page,
		context,
		isMobile,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await openChapter(page, "changes")
		const slider = page.getByTestId("playback-slider")
		await expect(slider).toBeVisible()
		const total = Number(await slider.getAttribute("max"))

		if (!isMobile) {
			await slider.focus()
			await page.keyboard.press("Home")
			expect(await revisionOf(page)).toBe(1)
			await page.keyboard.press("ArrowRight")
			expect(await revisionOf(page)).toBe(2)
			await page.keyboard.press("End")
			expect(await revisionOf(page)).toBe(total)
			await page.keyboard.press("ArrowLeft")
			expect(await revisionOf(page)).toBe(total - 1)
		}

		const press = (name: string) =>
			isMobile ? page.getByTestId(name).tap() : page.getByTestId(name).click()
		await press("playback-back")
		expect(await revisionOf(page)).toBe(isMobile ? total - 1 : total - 2)
		await press("playback-forward")
		expect(await revisionOf(page)).toBe(isMobile ? total : total - 1)
		await press("playback-play")
		await expect(page.getByTestId("playback-play")).toHaveText("Pause")
		await expect
			.poll(() => revisionOf(page), { timeout: 8_000 })
			.toBeGreaterThan(1)
		await press("playback-play")
		await expect(page.getByTestId("playback-play")).toHaveText("Play")
	})

	test("scrubs by touch on the phone", async ({ page, context, isMobile }) => {
		test.skip(!isMobile, "the touch scrub runs on the phone project")
		const world = createWorld()
		await installWorld(context, world)
		await openChapter(page, "changes")
		const slider = page.getByTestId("playback-slider")
		await expect(slider).toBeVisible()
		const total = Number(await slider.getAttribute("max"))
		await slider.tap({ position: { x: 4, y: 20 } })
		const near = await revisionOf(page)
		expect(near).toBeLessThanOrEqual(Math.max(2, Math.ceil(total * 0.15)))
		const box = await slider.boundingBox()
		await slider.tap({ position: { x: (box?.width ?? 300) - 4, y: 20 } })
		expect(await revisionOf(page)).toBeGreaterThanOrEqual(total - 1)
	})

	test("moves the chapters with the cursor: the graph, the tiles and the feed show only what was stored", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await openChapter(page, "changes")
		const slider = page.getByTestId("playback-slider")
		await expect(slider).toBeVisible()
		const changes = changesOf(world)
		const cursor = Math.max(2, Math.floor(changes.length / 2))
		await slider.fill(String(cursor))
		await expect(page.getByTestId("change-row").first()).toBeVisible()
		const rows = await page.getByTestId("change-row").count()
		expect(rows).toBeLessThanOrEqual(Math.min(12, cursor))
		await expect(page.locator('[data-stat="revisions"]')).toContainText(
			String(cursor),
		)
		await expect(page.locator('[data-stat="pages-touched"]')).toContainText(
			String(storedAt(changes, cursor).pages),
		)
		await openChapter(page, "growth")
		await expect(slider).toBeVisible()
		await expect(page.locator('[data-stat="pages"]').first()).toContainText(
			String(storedAt(changes, await revisionOf(page)).pages),
		)
	})

	test("says so and shows the final state with a chronological feed when the history cannot be verified", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		world.tamper = (url, body) => {
			if (url.pathname !== "/api/demo/v1/wiki/changes") return body
			const feed = body as { changes: MdbrainWikiChange[] }
			// The feed forgets the newest revision of one page.
			const last = feed.changes.reduce((a, b) =>
				Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b,
			)
			return {
				...feed,
				changes: feed.changes.filter((c) => c !== last),
			}
		}
		await installWorld(context, world)
		await openChapter(page, "changes")
		const fallback = page.getByTestId("playback-fallback")
		await expect(fallback).toBeVisible()
		await expect(fallback).toContainText("cannot be stepped through")
		await expect(page.getByTestId("playback-slider")).toHaveCount(0)
		await expect(page.getByTestId("recorded-label")).toBeVisible()

		const changes = changesOf(world)
		const rows = fallback.getByRole("listitem")
		await expect(rows.first()).toContainText(
			`stored ${formatUtc(changes[0]?.createdAt ?? "")}`,
		)
		expect(await rows.count()).toBe(Math.min(30, changes.length))
		await expect(page.getByTestId("change-row").first()).toBeVisible()
	})

	test("has no serious accessibility violations with the recording on screen", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		for (const id of ["agents", "growth", "changes"]) {
			await openChapter(page, id)
			await expect(page.getByTestId("playback-bar")).toBeVisible()
			await expectNoSeriousAccessibilityViolations(page)
		}
	})

	test("holds when the presenter state cannot be read: still the recording", async ({
		page,
		context,
	}) => {
		const world = createWorld()
		await installWorld(context, world)
		await context.route("**/api/demo/presenter/state", (route) =>
			route.fulfill({ status: 500, body: "boom" }),
		)
		await openChapter(page, "growth")
		await expect(page.getByTestId("recorded-label")).toBeVisible()
		await expect(page.getByTestId("presenter-bar")).toHaveCount(0)
		await expect(page.getByTestId("proposal-review")).toHaveCount(0)
	})
})
