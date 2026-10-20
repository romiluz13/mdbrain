// Ready time for /demo on the throttled phone profile (run on demand: it needs a
// production server and takes a while):
//   DEMO_PERF=1 bunx playwright test e2e/demo-perf.e2e.ts --project=mobile-chromium
// Throttle, as in the 304 prototype measurement: CPU 4x, 9 Mbit/s down,
// 1.5 Mbit/s up, 150 ms RTT, cache disabled; four runs, median reported.
// "Ready" is the first frame of the map drawn and the page count rendered.
import { expect, test } from "@playwright/test"
import { installDemoProxy } from "./demo-proxy"

const RUNS = 4
const VARIANTS = [
	{ name: "corpus (110 pages), fixture answers at once", padTo: 0, readMs: 0 },
	{ name: "corpus (110 pages), 150 ms per proxy read", padTo: 0, readMs: 150 },
	{
		name: "stress (250 pages), 150 ms per proxy read",
		padTo: 250,
		readMs: 150,
	},
]

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number

test.skip(!process.env.DEMO_PERF, "set DEMO_PERF=1 to measure")
test.setTimeout(300_000)

for (const variant of VARIANTS) {
	test(`ready time: ${variant.name}`, async ({
		browser,
		isMobile,
	}, testInfo) => {
		test.skip(!isMobile, "the throttled profile is the phone")
		const ready: number[] = []
		const paint: number[] = []
		const draw: number[] = []
		const transferred: number[] = []
		const nodes: number[] = []
		let byType = new Map<string, number>()
		let lastTypes = ""
		for (let run = 0; run < RUNS; run++) {
			byType = new Map()
			const context = await browser.newContext(testInfo.project.use)
			const page = await context.newPage()
			await installDemoProxy(page, {
				padTo: variant.padTo,
				override: async () => {
					if (variant.readMs > 0) {
						await new Promise((resolve) => setTimeout(resolve, variant.readMs))
					}
					return undefined
				},
			})
			await page.addInitScript(() => {
				const check = () => {
					const w = window as unknown as { __readyAt?: number }
					if (w.__readyAt !== undefined) return
					const tile = document.querySelector('[data-stat="pages"]')
					if (
						tile &&
						tile.textContent !== "—" &&
						performance.getEntriesByName("demo-graph-drawn").length > 0
					) {
						w.__readyAt = performance.now()
					}
				}
				new MutationObserver(check).observe(document, {
					subtree: true,
					childList: true,
					characterData: true,
					attributes: true,
				})
			})
			const client = await context.newCDPSession(page)
			let bytes = 0
			const types = new Map<string, string>()
			client.on("Network.responseReceived", (event) => {
				types.set(event.requestId, event.type)
			})
			client.on("Network.loadingFinished", (event) => {
				bytes += event.encodedDataLength
				const type = types.get(event.requestId) ?? "Other"
				byType.set(type, (byType.get(type) ?? 0) + event.encodedDataLength)
			})
			await client.send("Network.enable")
			await client.send("Network.setCacheDisabled", { cacheDisabled: true })
			await client.send("Network.emulateNetworkConditions", {
				offline: false,
				downloadThroughput: (9 * 1024 * 1024) / 8,
				uploadThroughput: (1.5 * 1024 * 1024) / 8,
				latency: 150,
			})
			await client.send("Emulation.setCPUThrottlingRate", { rate: 4 })
			await page.goto("/demo", { waitUntil: "commit" })
			await page.waitForFunction(
				() =>
					(window as unknown as { __readyAt?: number }).__readyAt !== undefined,
				undefined,
				{ timeout: 120_000 },
			)
			ready.push(
				await page.evaluate(
					() => (window as unknown as { __readyAt: number }).__readyAt,
				),
			)
			paint.push(
				await page.evaluate(
					() =>
						performance.getEntriesByName("first-contentful-paint")[0]
							?.startTime ?? -1,
				),
			)
			draw.push(
				Number(
					await page
						.locator('canvas[data-layer="static"]')
						.first()
						.getAttribute("data-draw-ms"),
				),
			)
			nodes.push(
				Number(
					(
						await page
							.getByText(/links between \d+ pages/)
							.first()
							.innerText()
					).match(/between (\d+) pages/)?.[1],
				),
			)
			transferred.push(Math.round(bytes / 1024))
			lastTypes = [...byType.entries()]
				.map(([type, size]) => `${type} ${Math.round(size / 1024)} KB`)
				.join(", ")
			await context.close()
		}
		const line = `${variant.name}: ready median ${Math.round(median(ready))} ms (min ${Math.round(Math.min(...ready))}, max ${Math.round(Math.max(...ready))}); FCP median ${Math.round(median(paint))} ms; static-layer draw median ${median(draw)} ms at CPU 4x; transferred median ${median(transferred)} KB (last run: ${lastTypes}); pages drawn ${median(nodes)}`
		console.log(line)
		testInfo.annotations.push({ type: "perf", description: line })
		expect(median(ready)).toBeGreaterThan(0)
	})
}
