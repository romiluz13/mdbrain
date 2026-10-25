// Chapters 3 and 4 read the pinned run's own record: the sources in the order
// they arrived, and what the agents did. These specs hold what the page claims
// to what the proxy served, and each chapter 4 state to its honest copy. They
// run on the generated fixture, which plants a run for every state.
import { expect, test, type Page } from "@playwright/test"
import {
	chapterTitle,
	goto,
	listPages,
	mapReady,
	openDemo,
	stat,
} from "./demo-helpers"
import { GENERATED, installDemoProxy, type ProxyOptions } from "./demo-proxy"
import { chapterIndex } from "../app/demo/chapters"

test.skip(!GENERATED, "the states are planted in the generated fixture")

type Run = {
	arrivals: Array<{ sourceId: string; eventId: string }>
	eventsPlanned: number
	agentRun?: {
		reusedPage?: { slug: string }
		pendingProposal?: { slug: string }
		steps?: Array<{ n: number; role: string; eventId: string }>
	}
}

async function open(page: Page, options: ProxyOptions, chapter: number) {
	const proxy = await installDemoProxy(page, options)
	await openDemo(page)
	await mapReady(page)
	await goto(page, chapter)
	await proxy.flush()
	return proxy
}

test.describe("chapter 3: sources in arrival order", () => {
	test("shows the record's counts, and the first ten rows in the record's order, each confirmed by its id", async ({
		page,
	}) => {
		const proxy = await open(page, {}, chapterIndex("sources"))
		await expect(page.getByTestId("source-row")).toHaveCount(10)
		await proxy.flush()
		const run = proxy.latest("run")?.body as Run
		await expect(stat(page, "arrived")).toHaveText(String(run.arrivals.length))
		await expect(stat(page, "planned")).toHaveText(String(run.eventsPlanned))
		await expect(page.getByTestId("arrivals-summary")).toContainText(
			`${run.arrivals.length} of ${run.eventsPlanned} planned source files, in the order they arrived`,
		)
		await expect(page.getByTestId("source-event-id")).toHaveText(
			run.arrivals.slice(0, 10).map((arrival) => arrival.eventId),
		)
		await expect(
			page.locator('[data-testid="source-row"][data-status="confirmed"]'),
		).toHaveCount(10)
		// A source no stored claim cites is confirmed all the same.
		const uncited = page
			.getByTestId("source-row")
			.filter({ hasText: "No stored claim cites it" })
		expect(await uncited.count()).toBeGreaterThan(0)
		await expect(uncited.first()).toHaveAttribute("data-status", "confirmed")
		await expect(
			uncited.first().getByRole("button", { name: /^Open source / }),
		).toHaveCount(0)
	})

	test("says an agent wrote an event the record does not list when the record shows it, and leaves the rest unexplained", async ({
		page,
	}) => {
		const proxy = await open(
			page,
			{ run: { arrivals: 6 } },
			chapterIndex("sources"),
		)
		await expect(page.getByTestId("source-row")).toHaveCount(6)
		await proxy.flush()
		const run = proxy.latest("run")?.body as Run
		const listed = new Set(run.arrivals.map((arrival) => arrival.eventId))
		const wrote = run.agentRun?.reusedPage?.slug
		const seen = new Set<string>()
		const outside: string[] = []
		for (const stored of listPages(proxy)) {
			for (const claim of stored.claims) {
				for (const evidence of claim.evidence) {
					if (evidence.kind === "event" && !seen.has(evidence.sourceId)) {
						seen.add(evidence.sourceId)
						if (!listed.has(evidence.sourceId)) {
							outside.push(stored.slug)
						}
					}
				}
			}
		}
		const byAgent = outside.filter((slug) => slug === wrote).length
		expect(
			byAgent,
			"the fixture plants one for an agent to have written",
		).toBeGreaterThan(0)
		const summary = page.getByTestId("arrivals-summary")
		await expect(summary).toContainText(
			`${outside.length} stored source event${outside.length === 1 ? "" : "s"} cited by claims ${outside.length === 1 ? "is" : "are"} not in this record.`,
		)
		await expect(summary).toContainText(
			byAgent === outside.length
				? `${outside.length === 1 ? "It was" : "They were"} written by an agent during the run.`
				: `${byAgent} of them ${byAgent === 1 ? "was" : "were"} written by an agent during the run.`,
		)
	})

	test("never says an agent wrote it when the run's steps were not indexed", async ({
		page,
	}) => {
		const proxy = await open(
			page,
			{ run: { arrivals: 6, variant: "no-steps" } },
			chapterIndex("sources"),
		)
		await expect(page.getByTestId("source-row")).toHaveCount(6)
		await proxy.flush()
		await expect(page.getByTestId("arrivals-summary")).toContainText(
			"not in this record.",
		)
		await expect(page.getByTestId("arrivals-summary")).not.toContainText(
			"written by an agent",
		)
	})

	test("tallies the rows it has confirmed", async ({ page }) => {
		await open(page, {}, chapterIndex("sources"))
		const tally = page.getByTestId("arrivals-tally")
		await expect(
			page.locator('[data-testid="source-row"][data-status="loading"]'),
		).toHaveCount(0)
		await expect(tally).toContainText("Showing 10 of")
		await expect(tally).toContainText("10 confirmed.")
		await expect(tally).not.toContainText("not confirmed")
	})

	test("cites only the rows it shows, and shows ten more on request with focus on the first new row", async ({
		page,
	}) => {
		const proxy = await open(page, {}, chapterIndex("sources"))
		await expect(
			page.locator('[data-testid="source-row"][data-status="loading"]'),
		).toHaveCount(0)
		await proxy.flush()
		const run = proxy.latest("run")?.body as Run
		// A cite by id names no citing claim; the warm-up of chapter 5's sources
		// does.
		const cites = () =>
			proxy.responses.filter(
				(entry) =>
					entry.url.pathname === "/api/demo/v1/cite" &&
					!entry.url.searchParams.has("citedBy"),
			)
		expect(cites()).toHaveLength(10)
		expect(cites().length).toBeLessThan(run.arrivals.length)
		await page.getByRole("button", { name: "Show ten more" }).click()
		await expect(page.getByTestId("source-row")).toHaveCount(20)
		await expect(page.locator('[data-position="11"]')).toBeFocused()
		await expect(
			page.locator('[data-testid="source-row"][data-status="loading"]'),
		).toHaveCount(0)
		await proxy.flush()
		expect(cites()).toHaveLength(20)
		while (
			await page.getByRole("button", { name: "Show ten more" }).isVisible()
		) {
			await page.getByRole("button", { name: "Show ten more" }).click()
		}
		await expect(page.getByTestId("source-row")).toHaveCount(
			run.arrivals.length,
		)
	})

	test("opens a confirmed row's source from the arrival list", async ({
		page,
	}) => {
		await open(page, {}, chapterIndex("sources"))
		await page
			.getByRole("button", { name: /^Open source / })
			.first()
			.click()
		await expect(page.getByRole("dialog")).toBeVisible()
	})

	test("says so when the server has no run record, shows the stored sources instead, and the other chapters keep working", async ({
		page,
	}) => {
		await open(
			page,
			{ run: { variant: "unconfigured" } },
			chapterIndex("sources"),
		)
		await expect(
			page.locator(
				'[data-state="incomplete"][data-reason="RUN_NOT_CONFIGURED"]',
			),
		).toBeVisible()
		await expect(page.getByTestId("arrivals-summary")).toHaveCount(0)
		await expect(page.getByTestId("source-row").first()).toBeVisible()
		await expect(page.locator('[data-state="error"]')).toHaveCount(0)
		await expect(stat(page, "pages")).not.toHaveText("—")
		await goto(page, chapterIndex("agents"))
		await expect(
			page.locator(
				'[data-state="incomplete"][data-reason="RUN_NOT_CONFIGURED"]',
			),
		).toBeVisible()
	})
})

test.describe("chapter 4: agents at work", () => {
	test("tells the run from its record: three agents in hand-off order, wall time and tokens against the ceiling", async ({
		page,
	}) => {
		await open(page, {}, chapterIndex("agents"))
		const run = page.getByTestId("agent-run")
		await expect(run).toHaveAttribute("data-run-state", "complete")
		await expect(run.locator('[data-stat="agent-wall-time"]')).toHaveText(
			"4 min 12 s",
		)
		await expect(run.locator('[data-stat="agent-tokens"]')).toHaveText(
			"81,700 of 150,000",
		)
		await expect(run.getByRole("meter", { name: /Tokens used/ })).toBeVisible()
		const roles = await page
			.getByTestId("agent-role")
			.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute("data-role")),
			)
		expect(roles).toEqual(["support", "account", "product"])
	})

	test("verifies the page Support wrote and its revision through a wiki read, and that the proposal is pending", async ({
		page,
	}) => {
		const proxy = await open(page, {}, chapterIndex("agents"))
		await expect(page.getByTestId("agent-check")).toHaveCount(3)
		await expect(
			page.getByTestId("agent-check").filter({ hasText: "Checking" }),
		).toHaveCount(0)
		await proxy.flush()
		const run = proxy.latest("run")?.body as Run
		const reused = run.agentRun?.reusedPage?.slug ?? ""
		const stored = proxy.latest(`wiki/${encodeURIComponent(reused)}`)?.body as {
			revision: number
			title: string
		}
		const support = page.locator(
			'[data-testid="agent-role"][data-role="support"]',
		)
		await expect(support.getByTestId("agent-check")).toContainText(
			"Verified in the wiki",
		)
		await expect(support.getByTestId("agent-check")).toContainText(
			`revision ${stored.revision}`,
		)
		// The card names the page by the wiki read's title; the slug is only a
		// fallback for a page the wiki cannot name.
		await expect(support.getByText(/^Wrote the page/)).toHaveText(
			`Wrote the page “${stored.title}”.`,
		)
		const proposal = run.agentRun?.pendingProposal?.slug ?? ""
		expect(proxy.latest(`wiki/${encodeURIComponent(proposal)}`)?.status).toBe(
			404,
		)
		const product = page.locator(
			'[data-testid="agent-role"][data-role="product"]',
		)
		await expect(product.getByTestId("agent-check")).toContainText(
			"Pending, as expected",
		)
	})

	test("confirms a role's steps by their event ids only when its steps are opened", async ({
		page,
	}) => {
		const proxy = await open(page, {}, chapterIndex("agents"))
		await proxy.flush()
		const run = proxy.latest("run")?.body as Run
		const stepEvents = new Map(
			(run.agentRun?.steps ?? []).map((step) => [
				`[[event:${step.eventId}]]`,
				step,
			]),
		)
		const stepCites = () =>
			proxy.responses.filter(
				(entry) =>
					entry.url.pathname === "/api/demo/v1/cite" &&
					stepEvents.has(entry.url.searchParams.get("marker") ?? ""),
			)
		expect(stepCites()).toHaveLength(0)
		const support = page.locator(
			'[data-testid="agent-role"][data-role="support"]',
		)
		await support.locator("summary").click()
		await expect(
			support.locator('[data-testid="agent-step"][data-status="confirmed"]'),
		).toHaveCount(3)
		await proxy.flush()
		const supportMarkers = [...stepEvents]
			.filter(([, step]) => step.role === "support")
			.map(([marker]) => marker)
		expect(
			stepCites().map((entry) => entry.url.searchParams.get("marker")),
		).toEqual(expect.arrayContaining(supportMarkers))
		expect(stepCites()).toHaveLength(supportMarkers.length)
		expect(
			stepCites().every((entry) => !entry.url.searchParams.has("citedBy")),
		).toBe(true)
	})

	test("says a step it could not confirm was not confirmed in this run", async ({
		page,
	}) => {
		await open(page, { run: { missedSteps: [2] } }, chapterIndex("agents"))
		const support = page.locator(
			'[data-testid="agent-role"][data-role="support"]',
		)
		await support.locator("summary").click()
		await expect(
			support.locator('[data-testid="agent-step"][data-status="unconfirmed"]'),
		).toHaveText(/Could not be confirmed in this run/)
		await expect(
			support.locator('[data-testid="agent-step"][data-status="confirmed"]'),
		).toHaveCount(2)
	})

	test("leads on to the contradiction when the contradiction involves the page Support wrote", async ({
		page,
	}) => {
		await open(page, {}, chapterIndex("agents"))
		await page.getByTestId("agent-bridge").getByRole("button").click()
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: chapterTitle(chapterIndex("contradiction")),
			}),
		).toBeVisible()
	})

	test("says not yet in this run before the agents start", async ({ page }) => {
		await open(page, { run: { variant: "none" } }, chapterIndex("agents"))
		await expect(
			page.locator(
				'[data-state="incomplete"][data-reason="AGENT_RUN_NOT_STARTED"]',
			),
		).toContainText("Not yet in this run")
		await expect(page.getByTestId("agent-run")).toHaveCount(0)
		await expect(page.locator('[data-state="error"]')).toHaveCount(0)
	})

	test("says the agents are at work while the run is running", async ({
		page,
	}) => {
		await open(page, { run: { variant: "running" } }, chapterIndex("agents"))
		await expect(
			page.locator(
				'[data-state="incomplete"][data-reason="AGENT_RUN_RUNNING"]',
			),
		).toBeVisible()
		await expect(page.getByTestId("agent-run")).toHaveAttribute(
			"data-run-state",
			"running",
		)
		await expect(page.locator('[data-stat="agent-wall-time"]')).toHaveText("—")
	})

	test("says the run stopped early with a fixed label, and none of its stored reason", async ({
		page,
	}) => {
		await open(page, { run: { variant: "incomplete" } }, chapterIndex("agents"))
		await expect(
			page.locator(
				'[data-state="incomplete"][data-reason="AGENT_RUN_INCOMPLETE"]',
			),
		).toBeVisible()
		await expect(page.getByTestId("agent-run-label")).toHaveText(
			"The agent run stopped before it finished.",
		)
		const text = (await page.locator("body").textContent()) ?? ""
		for (const private_ of ["deadline", "mongodb", "secret"]) {
			expect(text).not.toContain(private_)
		}
	})

	test("shows a finished run's summary and says its steps were not indexed", async ({
		page,
	}) => {
		await open(page, { run: { variant: "no-steps" } }, chapterIndex("agents"))
		await expect(page.getByTestId("agent-run")).toHaveAttribute(
			"data-run-state",
			"complete",
		)
		await expect(page.getByTestId("agent-steps-unindexed")).toContainText(
			"steps were not indexed",
		)
		await expect(page.getByTestId("agent-role")).toHaveCount(3)
		await expect(page.locator("details")).toHaveCount(0)
		await expect(page.getByTestId("agent-check").first()).toContainText(
			"Verified in the wiki",
		)
	})
})
