// The presenter journey's shared steps: sign in, lease a slot, and the runner
// worker's part of a run.
import { expect, type Page } from "@playwright/test"
import { PRESENTER_TOKEN, type World } from "./demo-modes-kit"

export const POLL = { timeout: 12_000 }

export async function signIn(page: Page): Promise<void> {
	await page.goto("/demo/presenter")
	await page.getByTestId("presenter-token").fill(PRESENTER_TOKEN)
	await page.getByTestId("presenter-sign-in").click()
	await page.waitForURL("**/demo")
	await expect(page.getByTestId("presenter-bar")).toBeVisible()
}

export async function lease(page: Page, name?: string): Promise<void> {
	if (name) await page.getByTestId("lease-name-input").fill(name)
	await page.getByTestId("lease-slot-button").click()
	await expect(page.getByTestId("lease-slot")).toBeVisible()
}

export const stage = (page: Page) => page.getByTestId("run-progress")

/** The runner worker takes the request and finishes the run. */
export async function driveToComplete(
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
