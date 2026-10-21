import { describe, expect, it } from "vitest"
import { buildRolePlans, roleForStoryline } from "./story.js"
import {
	RISK_SLUG,
	makeDemoRecords,
	makeDemoWorld,
} from "./testing/demo-world.js"

const input = {
	world: makeDemoWorld(),
	records: makeDemoRecords(),
	runId: "run-1",
	scopeRef: "demo-run-1",
}

describe("roleForStoryline", () => {
	it("maps each storyline to its role and refuses unknown ones", () => {
		expect(roleForStoryline("renewal-risk")).toBe("support")
		expect(roleForStoryline("eta-drift")).toBe("support")
		expect(roleForStoryline("champion-leaving")).toBe("account")
		expect(roleForStoryline("pricing-change")).toBe("product")
		expect(() => roleForStoryline("unknown")).toThrow(/storyline/)
	})
})

describe("buildRolePlans", () => {
	it("splits the seven replay sources across the three roles", () => {
		const plans = buildRolePlans(input)
		expect(plans.support.events.map((e) => e.sourceId).sort()).toEqual([
			"src-drift-10",
			"src-drift-11",
			"src-renewal-05",
		])
		expect(
			plans.account.events
				.filter((e) => e.sourceId !== "account-note")
				.map((e) => e.sourceId)
				.sort(),
		).toEqual(["src-champion-02", "src-champion-03"])
		expect(plans.product.events.map((e) => e.sourceId).sort()).toEqual([
			"src-pricing-04",
			"src-pricing-05",
		])
	})

	it("pins each replay event to the seeded idempotency key and rendered body", () => {
		const plans = buildRolePlans(input)
		const event = plans.support.events.find(
			(e) => e.sourceId === "src-renewal-05",
		)
		expect(event).toMatchObject({
			role: "user",
			body: "body of src-renewal-05",
			idempotencyKey: "seed:demo-run-1:event:src-renewal-05",
		})
	})

	it("pins the incoming contradiction page for the support role only", () => {
		const plans = buildRolePlans(input)
		expect(plans.support.page).toMatchObject({
			slug: RISK_SLUG,
			scope: "workspace",
			scopeRef: "demo-run-1",
			trustTier: "standard",
			claims: [
				{
					id: "halvorsen-renewal-support-risk",
					text: expect.stringContaining("not on track"),
				},
			],
			relationships: [
				{
					targetPageSlug: "accounts/halvorsen-freight-group",
					kind: "assesses",
				},
			],
		})
		expect(plans.account.page).toBeUndefined()
		expect(plans.product.page).toBeUndefined()
		expect(plans.support.proposal).toBeUndefined()
	})

	it("adds one cross-role account note after the account role reads the risk page", () => {
		const plans = buildRolePlans(input)
		const note = plans.account.events.find((e) => e.sourceId === "account-note")
		expect(note).toMatchObject({
			role: "user",
			idempotencyKey: "agents:run-1:account-note",
		})
		expect(String(note?.body)).toContain(RISK_SLUG)
		expect(plans.account.prompt).toContain(RISK_SLUG)
		expect(plans.account.prompt).toContain("mdbrain_wiki_get")
	})

	it("pins the Silent ETA drift proposal for the product role only", () => {
		const plans = buildRolePlans(input)
		expect(plans.product.proposal).toMatchObject({
			promotionPolicy: "wiki",
			idempotencyKey: "agents:run-1:proposal:silent-eta-drift",
			wikiPromotion: {
				page: {
					title: "Silent ETA drift",
					slug: "syntheses/silent-eta-drift",
					scope: "workspace",
					scopeRef: "demo-run-1",
				},
			},
		})
		expect(plans.account.proposal).toBeUndefined()
		expect(plans.product.prompt).toContain("Silent ETA drift")
		expect(plans.product.prompt).toContain("mdbrain_add")
	})

	it("prompts pin the exact payloads the runner verifies", () => {
		const plans = buildRolePlans(input)
		expect(plans.support.prompt).toContain(
			plans.support.events[0]!.idempotencyKey,
		)
		expect(plans.support.prompt).toContain(plans.support.page!.slug)
		expect(plans.support.system).toContain("Support Lead")
		expect(plans.product.prompt).toContain(
			plans.product.proposal!.idempotencyKey,
		)
	})
})
