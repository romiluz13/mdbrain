import { afterEach, describe, expect, it, vi } from "vitest"
import { loadRunRecord } from "./loaders-run.js"
import { json, runRecord, stubUpstream } from "./test-upstream.js"

const proxy = {
	apiBaseUrl: "http://demo-proxy.local/api/demo",
	readKey: "loader-placeholder-key",
}

const RUN = "/api/demo/v1/run"

const refusal = (status: number, code: string) =>
	json({ error: { code, message: `fixed message for ${code}` } }, status)

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("loadRunRecord", () => {
	it.each([
		["an empty object", {}],
		["no arrivals list", { ...runRecord(), arrivals: undefined }],
		["a state it does not know", { ...runRecord(), state: "exploded" }],
		["no plan count", { ...runRecord(), eventsPlanned: undefined }],
	])("shows an error, not a crash, when the answer is %s", async (_, body) => {
		stubUpstream({ [RUN]: () => json(body) })
		const result = await loadRunRecord(proxy)
		expect(result).toMatchObject({
			kind: "error",
			code: "RUN_RECORD_MALFORMED",
		})
	})

	it("reads the run through the proxy's one fixed path, with no parameters", async () => {
		const calls = stubUpstream({ [RUN]: () => json(runRecord()) })
		const result = await loadRunRecord(proxy)
		expect(result).toEqual({ kind: "ready", data: runRecord() })
		expect(calls.map((url) => url.pathname + url.search)).toEqual([RUN])
	})

	it("shows a run still being seeded as incomplete, with what has arrived", async () => {
		stubUpstream({
			[RUN]: () => json(runRecord({ state: "seeding", readyAt: undefined })),
		})
		const result = await loadRunRecord(proxy)
		expect(result).toMatchObject({
			kind: "incomplete",
			reason: "RUN_NOT_READY",
			state: "seeding",
		})
		if (result.kind === "incomplete") {
			expect(result.data?.arrivals).toHaveLength(3)
		}
	})

	it("shows a failed seeding as incomplete, with the fixed label from the record", async () => {
		stubUpstream({
			[RUN]: () =>
				json(
					runRecord({
						state: "failed",
						failedLabel: "Seeding stopped before the run was ready.",
					}),
				),
		})
		expect(await loadRunRecord(proxy)).toMatchObject({
			kind: "incomplete",
			reason: "RUN_FAILED",
			state: "failed",
		})
	})

	it("reports a server with no run configured as a state of its own, not an error", async () => {
		stubUpstream({ [RUN]: () => refusal(503, "RUN_NOT_CONFIGURED") })
		expect(await loadRunRecord(proxy)).toEqual({
			kind: "incomplete",
			reason: "RUN_NOT_CONFIGURED",
			state: null,
		})
	})

	it.each([
		[404, "RUN_NOT_FOUND"],
		[502, "RUN_RECORD_MISMATCH"],
		[502, "RUN_RECORD_MALFORMED"],
		[502, "RUN_UNREACHABLE"],
	])("keeps %i %s as an error with its code", async (status, code) => {
		stubUpstream({ [RUN]: () => refusal(status, code) })
		expect(await loadRunRecord(proxy)).toMatchObject({
			kind: "error",
			code,
			status,
		})
	})

	it("reports a direct API upstream, which has no run route, as an error", async () => {
		const result = await loadRunRecord({
			apiBaseUrl: "http://upstream.test",
			readKey: "test-read-key-123",
			scope: "workspace",
			scopeRef: "demo-run-2",
		})
		expect(result).toMatchObject({ kind: "error" })
	})
})
