// Presenter mode: a token, a CSRF-guarded session, a durable lease on a fully
// seeded slot, a run the runner worker drives, the review of its proposal and
// the explicit pin. The presenter dispatcher, the target resolver and the read
// proxy are the real ones over memory control stores; the runner worker is the
// test, so progress is deterministic.
import { expect, type Page, test } from "@playwright/test"
import { CSRF_HEADER } from "../lib/demo-presenter/session-names.js"
import { expectNoSeriousAccessibilityViolations } from "./demo-helpers"
import { createWorld, installWorld, PRESENTER_TOKEN } from "./demo-modes-kit"
import { lease, POLL, signIn } from "./demo-modes-presenter-steps"

test.describe("presenter mode: the door", () => {
	test("refuses a wrong token with an alert and opens on the right one", async ({
		page,
		context,
	}) => {
		const world = createWorld()
		await installWorld(context, world)
		await page.goto("/demo/presenter")
		await page.getByTestId("presenter-token").fill("not-the-token")
		await page.getByTestId("presenter-sign-in").click()
		await expect(page.getByTestId("presenter-sign-in-error")).toHaveText(
			"That is not the presenter token.",
		)
		expect(await context.cookies()).toEqual([])
		expect(world.stores.sessions.docs.size).toBe(0)

		await page.getByTestId("presenter-token").fill(PRESENTER_TOKEN)
		await page.getByTestId("presenter-sign-in").click()
		await page.waitForURL("**/demo")
		await expect(page.getByTestId("presenter-bar")).toBeVisible()
		await expect(page.getByTestId("recorded-label")).toBeVisible()
		const [cookie] = await context.cookies()
		expect(cookie).toMatchObject({
			httpOnly: true,
			sameSite: "Strict",
			path: "/api/demo",
		})
		expect(world.stores.sessions.docs.size).toBe(1)
		// The cookie is a handle: the store keeps only its digest.
		expect([...world.stores.sessions.docs.keys()]).not.toContain(cookie?.value)
	})

	test("refuses a visitor, a missing CSRF token and a wrong one, and changes nothing", async ({
		page,
		context,
		browser,
	}) => {
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		const post = (target: Page, path: string, csrf?: string) =>
			target.evaluate(
				async ([where, token, header]) => {
					const response = await fetch(`/api/demo/presenter/${where}`, {
						method: "POST",
						credentials: "same-origin",
						headers: {
							"content-type": "application/json",
							...(token ? { [header as string]: token } : {}),
						},
						body: "{}",
					})
					return {
						status: response.status,
						code: ((await response.json()) as { error?: { code?: string } })
							.error?.code,
					}
				},
				[path, csrf, CSRF_HEADER] as const,
			)

		expect(await post(page, "lease")).toEqual({
			status: 403,
			code: "CSRF_TOKEN",
		})
		expect(await post(page, "run", "forged-token")).toEqual({
			status: 403,
			code: "CSRF_TOKEN",
		})

		const visitor = await browser.newContext({
			baseURL: test.info().project.use.baseURL,
		})
		await installWorld(visitor, world)
		const visitorPage = await visitor.newPage()
		await visitorPage.goto("/demo")
		expect(await post(visitorPage, "lease", "anything")).toEqual({
			status: 401,
			code: "NOT_PRESENTER",
		})
		await expect(visitorPage.getByTestId("presenter-bar")).toHaveCount(0)
		await visitor.close()

		expect(world.stores.leases.docs.size).toBe(0)
		expect(world.stores.runRequests.docs.size).toBe(0)
	})
})

test.describe("presenter mode: the slot", () => {
	test("leases a fully seeded slot, never a partial one, and one presenter holds it at a time", async ({
		page,
		context,
		browser,
		isMobile,
	}) => {
		test.skip(isMobile, "two presenters run on the desktop project")
		test.slow()
		const world = createWorld({ seeded: [13], partial: [5, 1] })
		await installWorld(context, world)
		await signIn(page)
		await lease(page, "Rehearsal")
		await expect(page.getByTestId("lease-slot")).toHaveText(
			"Slot 13, Rehearsal",
		)
		await expect(page.getByTestId("live-label")).toContainText(
			"Slot 13, Rehearsal",
		)
		await expect(page.getByTestId("recorded-label")).toHaveCount(0)
		expect([...world.stores.leases.docs.keys()]).toEqual(["slot:13"])

		const second = await browser.newContext({
			baseURL: test.info().project.use.baseURL,
		})
		await installWorld(second, world)
		const other = await second.newPage()
		await signIn(other)
		await other.getByTestId("lease-slot-button").click()
		await expect(other.getByTestId("presenter-message")).toBeVisible()
		await expect(other.getByTestId("lease-slot")).toHaveCount(0)
		expect(world.stores.leases.docs.size).toBe(1)

		await page.getByTestId("slot-release").click()
		await expect(page.getByTestId("recorded-label")).toBeVisible()
		expect(world.stores.leases.docs.size).toBe(0)
		await other
			.getByTestId("presenter-message")
			.getByRole("button", { name: "Dismiss" })
			.click()
		await lease(other)
		await expect(other.getByTestId("lease-slot")).toHaveText("Slot 13")
		await second.close()
	})

	test("has nothing to lease when no slot is fully seeded", async ({
		page,
		context,
	}) => {
		const world = createWorld({ seeded: [], partial: [1, 2, 5, 6, 8] })
		await installWorld(context, world)
		await signIn(page)
		await page.getByTestId("lease-slot-button").click()
		await expect(page.getByTestId("presenter-message")).toBeVisible()
		await expect(page.getByTestId("lease-slot")).toHaveCount(0)
		expect(world.stores.leases.docs.size).toBe(0)
	})

	test("renames and releases the slot, and keeps it across a server restart", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		await page.getByTestId("slot-rename-input").fill("Board demo")
		await page.getByTestId("slot-rename").click()
		await expect(page.getByTestId("lease-slot")).toHaveText(
			"Slot 13, Board demo",
		)

		world.restart()
		await page.reload()
		await expect(page.getByTestId("lease-slot")).toHaveText(
			"Slot 13, Board demo",
		)
		await expect(page.getByTestId("live-label")).toBeVisible()

		await page.getByTestId("slot-release").click()
		await expect(page.getByTestId("lease-slot-button")).toBeVisible()
		await expect(page.getByTestId("recorded-label")).toBeVisible()
		expect(world.stores.leases.docs.size).toBe(0)
	})
})

test.describe("presenter mode: keyboard and accessibility", () => {
	test("leases a slot from the keyboard, with no serious accessibility violations before or after", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await expectNoSeriousAccessibilityViolations(page)

		await page.getByTestId("lease-name-input").focus()
		await page.keyboard.type("Board demo")
		await page.keyboard.press("Tab")
		await expect(page.getByTestId("lease-slot-button")).toBeFocused()
		await page.keyboard.press("Enter")
		await expect(page.getByTestId("lease-slot")).toHaveText(
			"Slot 13, Board demo",
			POLL,
		)
		await expect(page.getByTestId("run-agents")).toBeVisible()
		await expectNoSeriousAccessibilityViolations(page)
	})
})

test.describe("presenter mode: a flaky connection", () => {
	test("keeps the presenter's controls while the state read fails, says so, and recovers when it answers again", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		let failing = false
		await context.route("**/api/demo/presenter/state", (route) =>
			failing ? route.fulfill({ status: 500, body: "boom" }) : route.fallback(),
		)
		failing = true
		await page.getByTestId("slot-rename-input").fill("Board demo")
		await page.getByTestId("slot-rename").click()
		await expect(page.getByTestId("presenter-message")).toContainText(
			"did not answer",
			POLL,
		)
		await expect(page.getByTestId("presenter-bar")).toBeVisible()
		await expect(page.getByTestId("lease-slot")).toBeVisible()
		await expect(page.getByTestId("live-label")).toBeVisible()

		failing = false
		await page.getByTestId("slot-rename-input").fill("Board demo 2")
		await page.getByTestId("slot-rename").click()
		await expect(page.getByTestId("lease-slot")).toHaveText(
			"Slot 13, Board demo 2",
			POLL,
		)
		await expect(page.getByTestId("presenter-message")).toHaveCount(0, POLL)
	})
})
