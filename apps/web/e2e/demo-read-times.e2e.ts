// How long chapter 7's stored-revisions read takes, as a visitor's page sees it.
// With DEMO_E2E_LIVE=1 the numbers are the live stack's; otherwise the fixture's.
//   DEMO_READ_TIMES=/some/file.json [DEMO_E2E_LIVE=1 ...] \
//     bunx playwright test e2e/demo-read-times.e2e.ts --project=desktop-chromium
// On the fixture, DEMO_READ_LATENCY_MS=<ms> makes every read wait that long, to
// show how the reads are ordered when each one takes time.
import { writeFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { chapterIndex } from "../app/demo/chapters"
import { goto, openDemo } from "./demo-helpers"
import { installDemoProxy, LIVE } from "./demo-proxy"

const OUT = process.env.DEMO_READ_TIMES
const LATENCY_MS = Number(process.env.DEMO_READ_LATENCY_MS ?? 0)
const SAMPLES = 5
const WAIT = { timeout: 120_000 }

test.skip(!OUT, "set DEMO_READ_TIMES to the file the numbers are written to")

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

test("the stored-revisions read, from the page's first request to chapter 7 settled", async ({
	browser,
}, testInfo) => {
	test.setTimeout(LIVE ? 600_000 : 60_000)
	const samples: {
		readStartedAfterNavMs: number
		readMs: number
		calls: number
		chainMs: number
		rowsAfterEntryMs: number
		settledAfterEntryMs: number
	}[] = []
	for (let sample = 0; sample < SAMPLES; sample += 1) {
		const context = await browser.newContext()
		const page = await context.newPage()
		await installDemoProxy(
			page,
			LATENCY_MS > 0
				? { link: { latencyMs: LATENCY_MS, bytesPerSecond: 12_500_000 } }
				: {},
		)
		const reads: { startedAt: number; ms: number }[] = []
		page.on("requestfinished", (request) => {
			if (new URL(request.url()).pathname.includes("/wiki/changes")) {
				const timing = request.timing()
				reads.push({ startedAt: timing.startTime, ms: timing.responseEnd })
			}
		})
		const navigated = Date.now()
		await openDemo(page)
		await goto(page, chapterIndex("changes"))
		const entered = Date.now()
		await expect(page.getByTestId("change-row").first()).toBeVisible(WAIT)
		const rows = Date.now()
		await expect(page.locator('[data-state="loading"]')).toHaveCount(0, WAIT)
		const settled = Date.now()
		expect(reads.length, "the page asked for the changes").toBeGreaterThan(0)
		const [read] = reads
		const ends = reads.map((each) => each.startedAt + each.ms)
		samples.push({
			readStartedAfterNavMs: Math.round((read?.startedAt ?? 0) - navigated),
			readMs: Math.round(read?.ms ?? 0),
			calls: reads.length,
			chainMs: Math.round(
				Math.max(...ends) - Math.min(...reads.map((each) => each.startedAt)),
			),
			rowsAfterEntryMs: rows - entered,
			settledAfterEntryMs: settled - entered,
		})
		await context.close()
	}
	writeFileSync(
		OUT as string,
		`${JSON.stringify(
			{
				source: LIVE ? "live" : "fixture",
				latencyMs: LIVE ? undefined : LATENCY_MS,
				project: testInfo.project.name,
				samples,
				medianReadMs: median(samples.map((sample) => sample.readMs)),
				maxReadMs: Math.max(...samples.map((sample) => sample.readMs)),
				medianChainMs: median(samples.map((sample) => sample.chainMs)),
				maxSettledAfterEntryMs: Math.max(
					...samples.map((sample) => sample.settledAfterEntryMs),
				),
			},
			null,
			2,
		)}\n`,
	)
})
