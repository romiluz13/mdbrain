// Presenter mode, the run: the agents' progress, the proposal's review, the
// pin, and the runner's failure states. The runner worker is the test.
import { expect, test } from "@playwright/test"
import { CSRF_HEADER } from "../lib/demo-presenter/session-names.js"
import { expectNoSeriousAccessibilityViolations } from "./demo-helpers"
import {
	createWorld,
	installWorld,
	openChapter,
	RUN_DEADLINE_MS,
} from "./demo-modes-kit"
import {
	driveToComplete,
	lease,
	POLL,
	signIn,
	stage,
} from "./demo-modes-presenter-steps"

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
		if (!claimed) throw new Error("the runner did not claim the run")
		expect(claimed.state).toBe("claimed")
		world.stores.runRequests.docs.set(runId, {
			...claimed,
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
