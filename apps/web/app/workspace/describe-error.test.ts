import { MdbrainClientError } from "@mdbrain/client"
import { describe, expect, it } from "vitest"
import {
	describeError,
	isStale,
	StaleConnectionError,
} from "./describe-error.js"

function apiError(status: number, code: string, message = "m") {
	return new MdbrainClientError(
		status,
		JSON.stringify({ error: { code, message } }),
	)
}

describe("describeError", () => {
	it("classifies by API code, not by message text", () => {
		expect(describeError(apiError(409, "REVISION_CONFLICT")).kind).toBe(
			"conflict",
		)
		expect(describeError(apiError(409, "DUPLICATE_SLUG")).kind).toBe(
			"duplicate",
		)
		expect(describeError(apiError(503, "SEARCH_UNAVAILABLE")).kind).toBe(
			"unavailable",
		)
		expect(describeError(apiError(401, "UNAUTHORIZED")).kind).toBe(
			"unauthorized",
		)
		expect(describeError(apiError(403, "FORBIDDEN")).kind).toBe("forbidden")
		expect(describeError(apiError(500, "X")).headline).toContain("500")
	})

	it("keeps the server message as detail and the code for display", () => {
		const described = describeError(apiError(400, "VALIDATION_ERROR", "bad"))
		expect(described).toMatchObject({
			kind: "validation",
			code: "VALIDATION_ERROR",
			detail: "bad",
		})
	})

	it("treats transport failures as network and deadlines as timeouts", () => {
		expect(describeError(new TypeError("Failed to fetch")).kind).toBe("network")
		const deadline = new MdbrainClientError(0, "", "slow", "DEADLINE_EXCEEDED")
		expect(describeError(deadline).kind).toBe("timeout")
	})

	it("marks aborted and stale work so it is never shown", () => {
		expect(isStale(new StaleConnectionError())).toBe(true)
		expect(isStale(new MdbrainClientError(0, "", "x", "REQUEST_ABORTED"))).toBe(
			true,
		)
		expect(isStale(apiError(500, "X"))).toBe(false)
	})
})
