// Presenter mode: a token, a CSRF-guarded session, a durable lease on a fully
// seeded slot, a run the runner worker drives, the review of its proposal and
// the explicit pin. The presenter dispatcher, the target resolver and the read
// proxy are the real ones over memory control stores; the runner worker is the
// test, so progress is deterministic.
import { expect, type Page, test } from "@playwright/test"
import { CSRF_HEADER } from "../lib/demo-presenter/session-names.js"
import { expectNoSeriousAccessibilityViolations } from "./demo-helpers"
import {
	createWorld,
	installWorld,
	openChapter,
	PRESENTER_TOKEN,
	RUN_DEADLINE_MS,
	type World,
} from "./demo-modes-kit"

const POLL = { timeout: 12_000 }

async function signIn(page: Page): Promise<void> {
	await page.goto("/demo/presenter")
	await page.getByTestId("presenter-token").fill(PRESENTER_TOKEN)
	await page.getByTestId("presenter-sign-in").click()
	await page.waitForURL("**/demo")
	await expect(page.getByTestId("presenter-bar")).toBeVisible()
}

async function lease(page: Page, name?: string): Promise<void> {
	if (name) await page.getByTestId("lease-name-input").fill(name)
	await page.getByTestId("lease-slot-button").click()
	await expect(page.getByTestId("lease-slot")).toBeVisible()
}

const stage = (page: Page) => page.getByTestId("run-progress")

/** The runner worker takes the request and finishes the run. */
async function driveToComplete(
	page: Page,
	world: World,
	slot: number,
): Promise<void> {
	const runId = world.runIdOf(slot)
	await page.getByTestId("run-agents").click()
	await expect(stage(page)).toHaveAttribute("data-stage", "queued")
	await world.runner.claim(runId)
	await world.runner.start(runId)
	await expect(stage(page)).toHaveAttribute("data-stage", "running", POLL)
	await world.runner.finish(runId)
	await expect(stage(page)).toHaveAttribute("data-stage", "complete", POLL)
}

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

test.describe("presenter mode: the run", () => {
	test("runs the agents with progress, reviews the proposal, pins the run, and the public then plays that run back", async ({
		page,
		context,
		browser,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page, "Live")
		await expect(page.getByTestId("playback-bar")).toHaveCount(0)

		await openChapter(page, "agents")
		await expect(page.getByTestId("agent-run")).toHaveCount(0)
		await expect(stage(page)).toHaveAttribute("data-stage", "idle")
		await expect(page.getByTestId("pin-run")).toHaveCount(0)

		await page.getByTestId("run-agents").click()
		await expect(stage(page)).toHaveText(
			"Waiting for the runner to pick the run up.",
		)
		expect(world.stores.runRequests.docs.get("e2e-slot-13")?.state).toBe(
			"queued",
		)
		await expect(page.getByTestId("run-agents")).toBeDisabled()

		await world.runner.claim("e2e-slot-13")
		await expect(stage(page)).toHaveText(
			"The runner has the run and is starting it.",
			POLL,
		)
		await world.runner.start("e2e-slot-13")
		await expect(stage(page)).toHaveText("The agents are at work.", POLL)
		await expect(page.getByTestId("agent-run")).toHaveAttribute(
			"data-run-state",
			"running",
			POLL,
		)

		await world.runner.finish("e2e-slot-13")
		await expect(stage(page)).toHaveText("The agents finished.", POLL)
		await expect(page.getByTestId("agent-run")).toHaveAttribute(
			"data-run-state",
			"complete",
			POLL,
		)

		await openChapter(page, "growth")
		const review = page.getByTestId("proposal-review")
		await expect(review).toBeVisible()
		await expect(review.getByTestId("proposal-row")).toContainText(
			"Silent ETA drift",
		)
		await expectNoSeriousAccessibilityViolations(page)
		await review.getByTestId("proposal-approve").click()
		await expect(review.getByTestId("proposal-empty")).toBeVisible()
		expect(world.decisions).toEqual([
			{ operationId: "e2e-op-1", decision: "approve" },
		])

		await page.getByTestId("pin-run").click()
		await expect(page.getByTestId("pin-confirm")).toBeVisible()
		expect(world.stores.publicRun.docs.size).toBe(0)
		await page.getByTestId("pin-confirm").click()
		await expect(page.getByTestId("presenter-message")).toContainText("Pinned.")
		expect(world.stores.publicRun.docs.get("public")?.runId).toBe("e2e-slot-13")

		world.skip(6_000)
		const visitor = await browser.newContext({
			baseURL: test.info().project.use.baseURL,
		})
		await installWorld(visitor, world)
		const visitorPage = await visitor.newPage()
		await visitorPage.goto("/demo#growth")
		await expect(visitorPage.getByTestId("recorded-label")).toBeVisible()
		await expect(visitorPage.getByTestId("presenter-bar")).toHaveCount(0)
		await expect(visitorPage.getByTestId("proposal-review")).toHaveCount(0)
		await expect(visitorPage.getByTestId("recorded-approval")).toContainText(
			'Recorded: a reviewer approved the proposed page "Silent ETA drift"',
		)
		await expect(
			visitorPage.getByRole("button", { name: /^(approve|reject)$/i }),
		).toHaveCount(0)
		await expect(visitorPage.getByTestId("playback-bar")).toBeVisible()
		expect(world.resolutions.at(-1)).toMatchObject({
			mode: "public",
			runId: "e2e-slot-13",
		})
		await visitor.close()
	})

	test("rejects the proposal with a reason", async ({ page, context }) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		await driveToComplete(page, world, 13)
		await openChapter(page, "growth")
		await page.getByTestId("reject-reason").fill("not enough sources")
		await page.getByTestId("proposal-reject").click()
		await expect(page.getByTestId("proposal-empty")).toBeVisible()
		expect(world.decisions).toEqual([
			{ operationId: "e2e-op-1", decision: "reject" },
		])
		expect(world.proposal).toBe("rejected")
	})

	test("ends a run that passed its time limit as incomplete and offers no pin", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		await openChapter(page, "agents")
		await page.getByTestId("run-agents").click()
		await world.runner.claim("e2e-slot-13")
		await world.runner.start("e2e-slot-13")
		await expect(page.getByTestId("agent-run")).toHaveAttribute(
			"data-run-state",
			"running",
			POLL,
		)

		world.skip(RUN_DEADLINE_MS + 1_000)
		await expect(page.getByTestId("agent-run")).toHaveAttribute(
			"data-run-state",
			"incomplete",
			POLL,
		)
		await expect(page.getByTestId("agent-run-label")).toContainText(
			"passed its time limit",
		)
		await expect(stage(page)).toHaveAttribute("data-stage", "incomplete")
		await expect(page.getByTestId("pin-run")).toHaveCount(0)
		await expect(page.getByTestId("run-agents")).toBeDisabled()
	})

	test("says no runner picked the run up, shows no stored failure text, and runs again on request", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		await page.getByTestId("run-agents").click()
		await world.runner.expire("e2e-slot-13")
		await expect(stage(page)).toHaveAttribute("data-stage", "no-runner", POLL)
		await expect(stage(page)).toContainText("Start the runner worker")
		await page.getByTestId("run-agents").click()
		await expect(stage(page)).toHaveAttribute("data-stage", "queued", POLL)
		expect(world.stores.runRequests.docs.get("e2e-slot-13")?.state).toBe(
			"queued",
		)

		await world.runner.claim("e2e-slot-13")
		await world.runner.fail("e2e-slot-13")
		await expect(stage(page)).toHaveAttribute("data-stage", "incomplete", POLL)
		expect(await page.content()).not.toContain("mongodb+srv")
	})

	test("says the runner went quiet when it claimed the run and never started it, and runs again on request", async ({
		page,
		context,
	}) => {
		test.slow()
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		const runId = world.runIdOf(13)
		await page.getByTestId("run-agents").click()
		await world.runner.claim(runId)
		await expect(stage(page)).toHaveAttribute("data-stage", "queued", POLL)
		await expect(stage(page)).toContainText("starting")

		const claimed = world.stores.runRequests.docs.get(runId)
		expect(claimed?.state).toBe("claimed")
		world.stores.runRequests.docs.set(runId, {
			...claimed!,
			claimedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
		})
		await expect(stage(page)).toHaveAttribute("data-stage", "no-runner", POLL)
		await expect(stage(page)).toContainText("went quiet")
		await page.getByTestId("run-agents").click()
		await expect(stage(page)).toHaveAttribute("data-stage", "queued", POLL)
		expect(world.stores.runRequests.docs.get(runId)).toMatchObject({
			state: "queued",
		})
		expect(world.stores.runRequests.docs.get(runId)?.claimedAt).toBeUndefined()
	})

	test("refuses a pin for a run that has not finished, even if the page is made to ask", async ({
		page,
		context,
	}) => {
		const world = createWorld()
		await installWorld(context, world)
		await signIn(page)
		await lease(page)
		const outcome = await page.evaluate(async (header) => {
			const state = (await (
				await fetch("/api/demo/presenter/state")
			).json()) as {
				csrf: string
			}
			const response = await fetch("/api/demo/presenter/pin", {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json", [header]: state.csrf },
				body: "{}",
			})
			return {
				status: response.status,
				code: ((await response.json()) as { error?: { code?: string } }).error
					?.code,
			}
		}, CSRF_HEADER)
		expect(outcome).toEqual({ status: 409, code: "RUN_NOT_COMPLETE" })
		expect(world.stores.publicRun.docs.size).toBe(0)
	})
})
