import { describe, expect, it } from "vitest"
import { dataOf, isReady, mapWithStatus, type DataState } from "./states.js"

describe("DataState", () => {
	it("loading, empty, error and incomplete are distinct kinds", () => {
		const loading: DataState<unknown> = { kind: "loading" }
		const empty: DataState<unknown> = { kind: "empty" }
		const error: DataState<unknown> = {
			kind: "error",
			code: "X",
			status: 500,
			message: "boom",
		}
		const incomplete: DataState<number> = {
			kind: "incomplete",
			reason: "RUN_NOT_READY",
			state: "seeding",
			data: 1,
		}
		expect(isReady(loading)).toBe(false)
		expect(isReady(empty)).toBe(false)
		expect(isReady(error)).toBe(false)
		expect(isReady(incomplete)).toBe(false)
		const ready: DataState<number> = { kind: "ready", data: 7 }
		expect(isReady(ready)).toBe(true)
		if (isReady(ready)) expect(ready.data).toBe(7)
	})

	it("error records the upstream code, status and a redacted message", () => {
		const error = mapWithStatus(
			{ status: 401, code: "UNAUTHORIZED", message: "bad key read-key-1" },
			"read-key-1",
		)
		expect(error).toEqual({
			kind: "error",
			code: "UNAUTHORIZED",
			status: 401,
			message: "bad key [redacted]",
		})
	})

	it("mapWithStatus builds a ready state from data", () => {
		expect(mapWithStatus({ data: [1, 2] }, "key")).toEqual({
			kind: "ready",
			data: [1, 2],
		})
	})

	it("mapWithStatus redacts the key anywhere it appears", () => {
		const error = mapWithStatus(
			{
				status: 500,
				code: "INTERNAL",
				message: "failed at read-key-1 boundary read-key-1",
			},
			"read-key-1",
		)
		if (error.kind !== "error") throw new Error("expected error")
		expect(error.message).not.toContain("read-key-1")
		expect(error.message).toBe("failed at [redacted] boundary [redacted]")
	})
})

describe("dataOf", () => {
	it("is the data of a ready or incomplete state, and nothing otherwise", () => {
		expect(dataOf({ kind: "ready", data: 1 })).toBe(1)
		expect(
			dataOf<number>({
				kind: "incomplete",
				reason: "AGENT_RUN_RUNNING",
				state: "running",
				data: 2,
			}),
		).toBe(2)
		expect(
			dataOf<number>({
				kind: "incomplete",
				reason: "RUN_NOT_READY",
				state: null,
			}),
		).toBeUndefined()
		expect(dataOf<number>({ kind: "loading" })).toBeUndefined()
		expect(dataOf<number>({ kind: "empty" })).toBeUndefined()
	})
})
