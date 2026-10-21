import { afterEach, describe, expect, it, vi } from "vitest"
import { confirmEvent, subjectKey, type EventSubject } from "./confirm-event.js"
import { eventRef } from "./loaders-chapters.js"
import { createSourceReader } from "./source-reader.js"
import { claimView, json, stubUpstream } from "./test-upstream.js"

const proxy = {
	apiBaseUrl: "http://demo-proxy.local/api/demo",
	readKey: "loader-placeholder-key",
}

afterEach(() => {
	vi.unstubAllGlobals()
})

const claim = {
	...claimView(),
	marker: "[[wiki:accounts/halvorsen#claim-1@2]]",
}
const ref = eventRef(claim, "evt-1")

function arrival(withClaim: boolean): EventSubject {
	if (!withClaim || ref === undefined) {
		return { kind: "arrival", eventId: "evt-1" }
	}
	return { kind: "arrival", eventId: "evt-1", via: { claim, ref } }
}

function confirm(subject: EventSubject) {
	return confirmEvent(
		{ upstream: proxy, sources: createSourceReader(proxy) },
		subject,
	)
}

const citeAnswer = () =>
	json({
		status: "resolved",
		kind: "event",
		marker: "[[event:evt-1]]",
		citedBy: claim.marker,
		event: {
			eventId: "evt-1",
			canonicalId: "event:evt-1",
			text: "Havnor renews the facility.",
			timestamp: "2026-11-16T08:00:00.000Z",
			scope: "workspace",
			scopeRef: "demo-run-2",
		},
	})

describe("confirmEvent: an arrival", () => {
	it("cites it through the stored claim that cites it", async () => {
		const calls = stubUpstream({ "/api/demo/v1/cite": citeAnswer })
		expect(await confirm(arrival(true))).toEqual({
			status: "confirmed",
			text: "Havnor renews the facility.",
			businessTime: "2026-11-16T08:00:00.000Z",
		})
		expect(calls).toHaveLength(1)
		expect(calls[0]?.searchParams.get("citedBy")).toBe(claim.marker)
	})

	it("says it is not confirmable, without asking, when no stored claim cites it", async () => {
		const calls = stubUpstream({})
		expect(await confirm(arrival(false))).toEqual({ status: "not-confirmable" })
		expect(calls).toHaveLength(0)
	})

	it("says recall could not confirm it when the cite answers unresolved", async () => {
		stubUpstream({
			"/api/demo/v1/cite": () =>
				json({ error: { code: "CITATION_UNRESOLVED", message: "no" } }, 404),
		})
		expect(await confirm(arrival(true))).toEqual({ status: "unconfirmed" })
	})

	it("says the read is unavailable, to try again, when the cite fails otherwise", async () => {
		stubUpstream({
			"/api/demo/v1/cite": () =>
				json({ error: { code: "UPSTREAM_ERROR", message: "down" } }, 502),
		})
		expect(await confirm(arrival(true))).toEqual({ status: "unavailable" })
	})
})

describe("confirmEvent: a step", () => {
	const step: EventSubject = { kind: "step", n: 3 }

	it("asks the proxy's step read by number alone and carries what recall found", async () => {
		const calls = stubUpstream({
			"/api/demo/v1/run/step": () =>
				json({
					n: 3,
					confirmed: true,
					text: "Support Lead — write page",
					businessTime: "2026-10-20T09:56:00.000Z",
				}),
		})
		expect(await confirm(step)).toEqual({
			status: "confirmed",
			text: "Support Lead — write page",
			businessTime: "2026-10-20T09:56:00.000Z",
		})
		expect(calls.map((url) => url.pathname + url.search)).toEqual([
			"/api/demo/v1/run/step?n=3",
		])
	})

	it("says recall could not confirm it on a miss", async () => {
		stubUpstream({
			"/api/demo/v1/run/step": () => json({ n: 3, confirmed: false }),
		})
		expect(await confirm(step)).toEqual({ status: "unconfirmed" })
	})

	it("says the read is unavailable, to try again, when recall is busy", async () => {
		stubUpstream({
			"/api/demo/v1/run/step": () =>
				json(
					{
						error: {
							code: "CITATION_RECALL_DEGRADED",
							message: "Recall is busy",
						},
					},
					503,
				),
		})
		expect(await confirm(step)).toEqual({ status: "unavailable" })
	})
})

describe("subjectKey", () => {
	it("tells an arrival from a step and one step from another", () => {
		const keys = [
			subjectKey({ kind: "arrival", eventId: "evt-1" }),
			subjectKey({ kind: "step", n: 1 }),
			subjectKey({ kind: "step", n: 2 }),
		]
		expect(new Set(keys).size).toBe(3)
	})

	it("does not depend on the claim an arrival is asked through", () => {
		expect(subjectKey(arrival(true))).toBe(subjectKey(arrival(false)))
	})
})
