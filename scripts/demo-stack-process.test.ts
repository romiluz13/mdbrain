import { describe, expect, it } from "vitest"
import {
	type LockRecord,
	type ProcessIdentity,
	isSameProcess,
	planLock,
	planStart,
	planStop,
	terminateIfStillSame,
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

describe("terminateIfStillSame", () => {
	it("checks the identity again right before it signals", () => {
		const order: string[] = []
		const outcome = terminateIfStillSame(
			memongo,
			(pid) => {
				order.push(`identify ${pid}`)
				return { ...memongo }
			},
			(pid) => order.push(`kill ${pid}`),
		)
		expect(outcome).toBe("signalled")
		expect(order).toEqual(["identify 101", "kill 101"])
	})

	it("does not signal a pid that was reused after the plan was made", () => {
		const kills: number[] = []
		const outcome = terminateIfStillSame(
			memongo,
			() => ({ ...memongo, startedAt: "Wed Oct 21 09:00:00 2026" }),
			(pid) => kills.push(pid),
		)
		expect(outcome).toBe("reused")
		expect(kills).toEqual([])
	})

	it("does not signal a process that already exited", () => {
		const kills: number[] = []
		const outcome = terminateIfStillSame(
			memongo,
			() => undefined,
			(pid) => kills.push(pid),
		)
		expect(outcome).toBe("gone")
		expect(kills).toEqual([])
	})
})

describe("planLock", () => {
	const holder: LockRecord = { holder: memongo, token: "t1" }

	it("creates the lock when none exists", () => {
		expect(planLock(undefined, undefined)).toEqual({ action: "create" })
	})

	it("refuses while the recorded holder is still running", () => {
		expect(planLock(holder, { ...memongo })).toEqual({
			action: "refuse",
			reason:
				"another demo-stack command is running (pid 101); wait for it to finish",
		})
	})

	it("takes over a lock whose holder is gone", () => {
		expect(planLock(holder, undefined)).toEqual({ action: "take-over" })
	})

	it("takes over a lock whose holder pid now belongs to another process", () => {
		expect(
			planLock(holder, { ...memongo, startedAt: "Wed Oct 21 09:00:00 2026" }),
		).toEqual({ action: "take-over" })
		expect(planLock(holder, { ...memongo, command: "node other.js" })).toEqual({
			action: "take-over",
		})
	})

	it("refuses a lock it cannot read, since it cannot prove the holder is gone", () => {
		expect(planLock("unreadable", undefined)).toEqual({
			action: "refuse",
			reason:
				"start.lock exists but cannot be read; if no demo-stack command is running, delete it",
		})
	})
})
