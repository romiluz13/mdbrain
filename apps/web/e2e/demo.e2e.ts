// The /demo journey: an enterprise buyer steps through the nine chapters and
// opens a citation down to the stored source, by keyboard alone on desktop and
// by touch on the phone project. The proxy is the fixture upstream behind the
// real proxy handler unless DEMO_E2E_LIVE=1 points the page at a live stack.
import { expect, test } from "@playwright/test"
import {
	chapterTitle,
	eventSourceIds,
	listPages,
	mapReady,
	openDemo,
	settleContradiction,
	type DemoProxy,
} from "./demo-helpers"
import { journey, withKeyboard, withTouch } from "./demo-journey"
import { GENERATED, installDemoProxy } from "./demo-proxy"

test.describe("journey", () => {
	// Each journey walks nine chapters and opens a citation: 17 to 28 s alone, which
	// a loaded machine pushes past the default 30 s.
	test.slow()

	test("completes with the keyboard alone, citations returning focus", async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, "the keyboard journey runs on the desktop project")
		const proxy = await installDemoProxy(page)
		await journey(page, proxy, withKeyboard(page), "escape")
		expect(listPages(proxy).length).toBeGreaterThan(0)
	})

	test("completes on a run with no contradiction recorded yet, with chapter 5 honest about it", async ({
		page,
		isMobile,
	}) => {
		test.skip(
			!GENERATED || isMobile,
			"the empty run is forced through the generated fixture",
		)
		const proxy = await installDemoProxy(page, { contradiction: "none" })
		await journey(page, proxy, withKeyboard(page), "escape")
	})

	test("completes by touch on the phone, citations returning focus", async ({
		page,
		isMobile,
	}) => {
		test.skip(!isMobile, "the touch journey runs on the mobile project")
		const proxy = await installDemoProxy(page)
		await journey(page, proxy, withTouch, "close")
	})
})

test("the browser never carries the read key or the principal", async ({
	page,
}) => {
	const proxy: DemoProxy = await installDemoProxy(page)
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
	await settleContradiction(page, proxy)
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
