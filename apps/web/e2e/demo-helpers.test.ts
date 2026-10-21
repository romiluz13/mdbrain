import { describe, expect, it } from "vitest"
import { refusedReads, unexplainedBrowserErrors } from "./demo-helpers"

const answer = (status: number, code?: string) => ({
	url: new URL(`http://127.0.0.1:3040/api/demo/v1/cite?marker=m${status}`),
	status,
	body: code ? { error: { code } } : {},
	requestHeaders: {},
})
const proxy = (...responses: ReturnType<typeof answer>[]) =>
	({ responses }) as unknown as Parameters<typeof refusedReads>[0]
const lost = (status: number) =>
	`Failed to load resource: the server responded with a status of ${status} (Not Found)`

describe("unexplainedBrowserErrors", () => {
	it("lets each refused read account for one console line of its status", () => {
		const served = proxy(answer(200), answer(404, "CITATION_UNRESOLVED"))
		expect(unexplainedBrowserErrors(served, [lost(404)])).toEqual([])
	})

	it("keeps a second line when only one read was refused", () => {
		const served = proxy(answer(404, "CITATION_UNRESOLVED"))
		expect(unexplainedBrowserErrors(served, [lost(404), lost(404)])).toEqual([
			lost(404),
		])
	})

	it("keeps a line whose status the proxy never answered", () => {
		const served = proxy(answer(404, "CITATION_UNRESOLVED"))
		expect(unexplainedBrowserErrors(served, [lost(503)])).toEqual([lost(503)])
	})

	it("keeps every error that is not a failed load", () => {
		const served = proxy(answer(404, "CITATION_UNRESOLVED"))
		expect(
			unexplainedBrowserErrors(served, ["TypeError: x is undefined"]),
		).toEqual(["TypeError: x is undefined"])
	})
})

describe("refusedReads", () => {
	it("names each refused read by status, code and path", () => {
		expect(
			refusedReads(proxy(answer(200), answer(404, "CITATION_UNRESOLVED"))),
		).toEqual(["404 CITATION_UNRESOLVED /api/demo/v1/cite?marker=m404"])
	})
})
