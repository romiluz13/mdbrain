import { afterEach, describe, expect, it, vi } from "vitest"
import { confirmEvent, subjectKey } from "./confirm-event.js"
import { createSourceReader } from "./source-reader.js"
import { json, stubUpstream } from "./test-upstream.js"

const proxy = {
	apiBaseUrl: "http://demo-proxy.local/api/demo",
	readKey: "loader-placeholder-key",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

function confirm(eventId: string) {
	return confirmEvent({ sources: createSourceReader(proxy) }, { eventId })
}

const citeAnswer = () =>
	json({
		status: "resolved",
		kind: "event",
		marker: "[[event:evt-1]]",
		event: {
			eventId: "evt-1",
			canonicalId: "event:evt-1",
			text: "Havnor renews the facility.",
			timestamp: "2026-11-16T08:00:00.000Z",
			scope: "workspace",
			scopeRef: "demo-run-2",
		},
	})

describe("confirmEvent", () => {
	it("cites the event by its id alone and carries what the API returned", async () => {
		const calls = stubUpstream({ "/api/demo/v1/cite": citeAnswer })
		expect(await confirm("evt-1")).toEqual({
			status: "confirmed",
			text: "Havnor renews the facility.",
			businessTime: "2026-11-16T08:00:00.000Z",
		})
		expect(calls).toHaveLength(1)
		expect(calls[0]?.searchParams.get("marker")).toBe("[[event:evt-1]]")
		expect(calls[0]?.searchParams.has("citedBy")).toBe(false)
	})

	it("says the API could not confirm it when the cite answers unresolved", async () => {
		stubUpstream({
			"/api/demo/v1/cite": () =>
				json({ error: { code: "CITATION_UNRESOLVED", message: "no" } }, 404),
		})
		expect(await confirm("evt-1")).toEqual({ status: "unconfirmed" })
	})

	it.each([
		["UPSTREAM_ERROR", 502],
		["CITATION_LOOKUP_FAILED", 502],
	])("says the read is unavailable, to try again, on %s", async (code, status) => {
		stubUpstream({
			"/api/demo/v1/cite": () =>
				json({ error: { code, message: "down" } }, status),
		})
		expect(await confirm("evt-1")).toEqual({ status: "unavailable" })
	})
})

describe("subjectKey", () => {
	it("is the event id, so one event is one subject wherever it is asked for", () => {
		expect(subjectKey({ eventId: "evt-1" })).toBe("evt-1")
		expect(subjectKey({ eventId: "evt-2" })).not.toBe(
			subjectKey({ eventId: "evt-1" }),
		)
	})
})
