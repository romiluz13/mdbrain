import { describe, expect, it } from "vitest"
import { eventKey, pageKey, slotAgentId, slotScopeRef } from "./ids.js"

describe("slot naming", () => {
	it("derives the scopeRef and agentId from the 1-based slot index", () => {
		expect(slotScopeRef(1)).toBe("demo-run-1")
		expect(slotScopeRef(12)).toBe("demo-run-12")
		expect(slotAgentId(1)).toBe("demo-run-1")
		expect(slotAgentId(12)).toBe("demo-run-12")
	})

	it("rejects non-positive slot indexes", () => {
		expect(() => slotScopeRef(0)).toThrow()
		expect(() => slotAgentId(-1)).toThrow()
	})
})

describe("idempotency keys", () => {
	it("are stable for the same slot and payload id", () => {
		expect(eventKey("demo-run-1", "src-pricing-01")).toBe(
			"seed:demo-run-1:event:src-pricing-01",
		)
		expect(eventKey("demo-run-1", "src-pricing-01")).toBe(
			eventKey("demo-run-1", "src-pricing-01"),
		)
		expect(pageKey("demo-run-2", "company/northstar-systems")).toBe(
			"seed:demo-run-2:page:company/northstar-systems",
		)
	})

	it("differ across slots and payload ids", () => {
		expect(eventKey("demo-run-1", "src-a")).not.toBe(
			eventKey("demo-run-2", "src-a"),
		)
		expect(eventKey("demo-run-1", "src-a")).not.toBe(
			eventKey("demo-run-1", "src-b"),
		)
	})
})
