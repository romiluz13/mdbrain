import { describe, expect, it } from "vitest"
import { getMemongoOperationPolicy } from "./memongo-operation-policy.js"

describe("Memongo operation policy", () => {
	it("allows same-key retry only for event writes proven idempotent", () => {
		expect(getMemongoOperationPolicy("writeEvent")).toMatchObject({
			idempotency: "header",
			retry: "same-key",
		})
		expect(getMemongoOperationPolicy("add")).toMatchObject({
			idempotency: "header",
			retry: "same-key",
		})
	})

	it("models batch event idempotency as per-item custom ids", () => {
		expect(getMemongoOperationPolicy("writeEvents")).toMatchObject({
			idempotency: "per-item",
			retry: "same-key",
		})
	})

	it("never retries counters or unproven mutations automatically", () => {
		for (const operation of [
			"procedureOutcome",
			"memoryFeedback",
			"extract",
			"writeStructured",
			"writeProcedure",
			"lifecycleUpdate",
			"lifecycleDelete",
		] as const) {
			expect(getMemongoOperationPolicy(operation).retry).toBe("never")
		}
	})

	it("classifies tenant retrieval and lifecycle reads as bounded reads", () => {
		for (const operation of [
			"search",
			"searchDetailed",
			"searchKb",
			"recallConversation",
			"profile",
			"lifecycleGet",
			"lifecycleHistory",
		] as const) {
			expect(getMemongoOperationPolicy(operation)).toMatchObject({
				kind: "read",
				retry: "transient",
			})
		}
	})
})
