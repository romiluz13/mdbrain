// The answer lane's states (ticket 15): refused over a limit, the budget-spent
// fallback with its stored-search handover, off, canceled by leaving the
// chapter mid-answer, an event citation listed as its record, and a network
// failure that fails closed. The answered state and its citation walk in the
// journey (demo.e2e.ts). The route is stubbed at the browser boundary: the
// real one needs the control store, the read principal and an Anthropic key,
// none of which a test may touch.
import { expect, test } from "@playwright/test"
import {
	chapterTitle,
	eventSourceIds,
	goto,
	listPages,
	mapReady,
	openDemo,
} from "./demo-helpers"
import {
	installAnswerRoute,
	installDemoProxy,
	type AnswerReplyer,
} from "./demo-proxy"
import { chapterIndex } from "../app/demo/chapters"

test.describe("answer lane", () => {
	test("refuses over the hourly rate, keeps the question, and keeps the stored search reachable", async ({
		page,
	}) => {
		await installDemoProxy(page)
		const answers = await installAnswerRoute(page, () => ({
			kind: "outcome",
			body: { state: "refused", reason: "rate" },
		}))
		await openDemo(page)
		await mapReady(page)
		await goto(page, chapterIndex("ask"))
		const input = page.getByLabel("Your question")
		await input.fill("renewal")
		await page.getByTestId("answer-submit").click()
		const refused = page.getByTestId("answer-refused")
		await expect(refused).toBeVisible()
		await expect(refused).toContainText("all the questions for this hour")
		// The question is preserved and the stored search lane still answers.
		await expect(input).toHaveValue("renewal")
		await page
			.getByTestId("screen")
			.getByRole("button", { name: "Ask", exact: true })
			.click()
		await expect(page.getByTestId("ask-hit").first()).toBeVisible()
		expect(answers.served).toHaveLength(1)
		expect(answers.served[0]?.question).toBe("renewal")
	})

	test("budget spent answers with the pages it found and hands the question to the stored search", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		const reply: AnswerReplyer = () => {
			const first = listPages(proxy)[0]
			return {
				kind: "outcome",
				body: {
					state: "spent",
					message: "The answer service's token budget is spent for today.",
					hits: first
						? [
								{
									slug: first.slug,
									title: first.title,
									claims: first.claims.map((claim) => ({
										id: claim.id,
										text: claim.text,
									})),
								},
							]
						: [],
				},
			}
		}
		await installAnswerRoute(page, reply)
		await openDemo(page)
		await mapReady(page)
		await goto(page, chapterIndex("ask"))
		await page.getByLabel("Your question").fill("renewal")
		await page.getByTestId("answer-submit").click()
		const spent = page.getByTestId("answer-spent")
		await expect(spent).toBeVisible()
		await expect(spent.getByTestId("answer-hit").first()).toBeVisible()
		// The handover: the stored search reads the same question.
		await spent.getByRole("button", { name: "Search the stored pages" }).click()
		await expect(page.getByTestId("ask-hit").first()).toBeVisible()
	})

	test("off is a plain state, not an error", async ({ page }) => {
		await installDemoProxy(page)
		await installAnswerRoute(page, () => ({
			kind: "outcome",
			body: { state: "off" },
		}))
		await openDemo(page)
		await mapReady(page)
		await goto(page, chapterIndex("ask"))
		await page.getByLabel("Your question").fill("renewal")
		await page.getByTestId("answer-submit").click()
		await expect(page.getByTestId("answer-off")).toContainText(
			"switched off today",
		)
	})

	test("leaving the chapter mid-answer cancels it, and the lane says so on return", async ({
		page,
	}) => {
		await installDemoProxy(page)
		const answers = await installAnswerRoute(page, () => ({ kind: "hold" }))
		await openDemo(page)
		await mapReady(page)
		await goto(page, chapterIndex("ask"))
		await page.getByLabel("Your question").fill("renewal")
		await page.getByTestId("answer-submit").click()
		await expect(page.getByTestId("answer-answering")).toBeVisible()
		// The disconnect: the chapter unmounts and aborts its request.
		await page
			.getByRole("button", {
				name: new RegExp(`^${chapterTitle(chapterIndex("sources"))} →`),
			})
			.click()
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: chapterTitle(chapterIndex("sources")),
			}),
		).toBeVisible()
		await page.getByRole("button", { name: /^← Ask/ }).click()
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: chapterTitle(chapterIndex("ask")),
			}),
		).toBeVisible()
		await expect(page.getByTestId("answer-canceled")).toBeVisible()
		expect(answers.served).toHaveLength(1)
	})

	test("an event citation in an answer is listed as its record", async ({
		page,
	}) => {
		const proxy = await installDemoProxy(page)
		const reply: AnswerReplyer = () => {
			const id = [...eventSourceIds(listPages(proxy))][0] ?? ""
			const marker = `[[event:${id}]]`
			return {
				kind: "outcome",
				body: {
					state: "answered",
					text: `The run recorded it: ${marker} and the answer lane cites only what the brain holds.`,
					citations: [
						{
							marker,
							response: {
								status: "resolved",
								kind: "event",
								marker,
								event: {
									eventId: id,
									canonicalId: id,
									text: "the fixture's recorded event",
									scope: "fixture",
									scopeRef: "fixture",
								},
							},
						},
					],
				},
			}
		}
		await installAnswerRoute(page, reply)
		await openDemo(page)
		await mapReady(page)
		await goto(page, chapterIndex("ask"))
		await page.getByLabel("Your question").fill("renewal")
		await page.getByTestId("answer-submit").click()
		await expect(page.getByTestId("answer-text")).toBeVisible()
		await expect(
			page.getByRole("list", { name: "Event citations" }),
		).toContainText("the fixture's recorded event")
	})

	test("a network failure fails closed and offers a retry", async ({
		page,
	}) => {
		await installDemoProxy(page)
		const answers = await installAnswerRoute(page, () => ({ kind: "down" }))
		await openDemo(page)
		await mapReady(page)
		await goto(page, chapterIndex("ask"))
		await page.getByLabel("Your question").fill("renewal")
		await page.getByTestId("answer-submit").click()
		const unavailable = page.getByTestId("answer-unavailable")
		await expect(unavailable).toBeVisible()
		await unavailable.getByRole("button", { name: "Try again" }).click()
		await expect(page.getByTestId("answer-unavailable")).toBeVisible()
		expect(answers.served).toHaveLength(2)
	})
})
