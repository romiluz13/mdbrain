import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

async function expectNoSeriousAccessibilityViolations(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze()
	const violations = results.violations.filter(
		(violation) =>
			violation.impact === "serious" || violation.impact === "critical",
	)

	expect(
		violations.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			nodes: violation.nodes.map((node) => node.target),
		})),
	).toEqual([])
}

test("showcase tells the architecture story and interactions work", async ({
	page,
}) => {
	const consoleErrors: string[] = []
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text())
		}
	})

	await page.goto("/")

	await expect(
		page.getByRole("heading", {
			level: 1,
			name: /Your AI can retrieve a fact/,
		}),
	).toBeVisible()
	await expect(page.getByText("Five ways to prove it.")).toBeVisible()

	const firstScenario = page.getByRole("tab", { name: /Change over time/ })
	await firstScenario.focus()
	await page.keyboard.press("ArrowRight")
	await expect(
		page.getByRole("tab", { name: /Conflicting truth/ }),
	).toHaveAttribute("aria-selected", "true")
	await expect(
		page.getByRole("tabpanel").getByRole("heading", {
			name: "Disagreement remains visible.",
		}),
	).toBeVisible()

	await page.getByRole("button", { name: /Sources/ }).click()
	await expect(
		page.getByRole("heading", {
			level: 2,
			name: "Source material arrives with identity.",
		}),
	).toBeVisible()

	await page.getByRole("tab", { name: /Permission boundary/ }).click()
	await expect(
		page.getByRole("tabpanel").getByRole("heading", {
			name: "Relevant does not mean authorized.",
		}),
	).toBeVisible()

	const viewportHasNoOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth <= window.innerWidth + 1,
	)
	expect(viewportHasNoOverflow).toBe(true)
	expect(consoleErrors).toEqual([])
	await expectNoSeriousAccessibilityViolations(page)
})

test("field guide renders sourced, dated comparisons", async ({ page }) => {
	await page.goto("/compare")

	await expect(
		page.getByRole("heading", {
			level: 1,
			name: /A field guide, not a fight card/,
		}),
	).toBeVisible()
	await expect(page.getByRole("heading", { name: "Modus" })).toBeVisible()
	await expect(
		page.getByRole("heading", { name: "Microsoft GraphRAG" }),
	).toBeVisible()
	await expect(page.getByText("Verified 2026-08-22")).toHaveCount(9)

	const viewportHasNoOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth <= window.innerWidth + 1,
	)
	expect(viewportHasNoOverflow).toBe(true)
	await expectNoSeriousAccessibilityViolations(page)
})
