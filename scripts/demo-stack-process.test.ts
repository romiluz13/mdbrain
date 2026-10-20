import { describe, expect, it } from "vitest"
import {
	type ProcessIdentity,
	isSameProcess,
	planStart,
	planStop,
} from "./demo-stack-process.js"

const memongo: ProcessIdentity = {
	pid: 101,
	startedAt: "Tue Oct 20 02:34:41 2026",
	command: "node --import tsx src/server.ts",
}
const api: ProcessIdentity = {
	pid: 102,
	startedAt: "Tue Oct 20 02:36:58 2026",
	command: "node --import tsx src/server.ts",
}

describe("isSameProcess", () => {
	it("matches only the same pid, start time and command", () => {
		expect(isSameProcess(memongo, { ...memongo })).toBe(true)
		expect(
			isSameProcess(memongo, {
				...memongo,
				startedAt: "Wed Oct 21 09:00:00 2026",
			}),
		).toBe(false)
		expect(
			isSameProcess(memongo, {
				...memongo,
				command: "node other-project/src/server.ts",
			}),
		).toBe(false)
		expect(isSameProcess(memongo, undefined)).toBe(false)
	})
})

describe("planStop", () => {
	it("signals only processes that are still the recorded ones", () => {
		const reused = { ...api, startedAt: "Wed Oct 21 09:00:00 2026" }
		expect(planStop({ memongo, api }, { memongo, api: reused })).toEqual({
			signal: [memongo.pid],
			skipped: [
				{ name: "api", reason: "pid 102 now belongs to another process" },
			],
		})
	})

	it("skips processes that are gone", () => {
		expect(
			planStop({ memongo, api }, { memongo: undefined, api: undefined }),
		).toEqual({
			signal: [],
			skipped: [
				{ name: "memongo", reason: "pid 101 not running" },
				{ name: "api", reason: "pid 102 not running" },
			],
		})
	})
})

describe("planStart", () => {
	it("starts when there is no record and the ports are free", () => {
		expect(planStart(undefined, {}, { api: false, memongo: false })).toEqual({
			action: "start",
		})
	})

	it("refuses while a recorded process is still running", () => {
		expect(
			planStart(
				{ memongo, api },
				{ memongo, api: undefined },
				{ api: false, memongo: true },
			),
		).toEqual({
			action: "refuse",
			reason:
				"the demo stack is already running (memongo pid 101); stop it first",
		})
	})

	it("discards a stale record whose processes are gone or reused", () => {
		expect(
			planStart(
				{ memongo, api },
				{ memongo: undefined, api: { ...api, startedAt: "later" } },
				{ api: false, memongo: false },
			),
		).toEqual({ action: "start", discardStaleRecord: true })
	})

	it("refuses when another process already holds a demo port", () => {
		expect(planStart(undefined, {}, { api: true, memongo: false })).toEqual({
			action: "refuse",
			reason:
				"port for api is already in use by a process this stack did not start",
		})
	})
})
