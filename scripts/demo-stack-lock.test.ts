import { spawn } from "node:child_process"
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	StackBusyError,
	acquireStackLock,
	releaseStackLock,
	removeOwnedRecord,
	writeOwnedRecord,
} from "./demo-stack-lock.js"
import type { ProcessIdentity, StackRecord } from "./demo-stack-process.js"

const first: ProcessIdentity = {
	pid: 1001,
	startedAt: "Tue Oct 20 10:00:00 2026",
	command: "bun scripts/demo-stack.ts start",
}
const second: ProcessIdentity = { ...first, pid: 1002 }
const record = (label: string): StackRecord => ({
	memongo: { pid: 1, startedAt: label, command: label },
	api: { pid: 2, startedAt: label, command: label },
})

let dir: string
let running: Map<number, ProcessIdentity>
const identify = (pid: number) => running.get(pid)

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "demo-stack-lock-"))
	running = new Map([
		[first.pid, first],
		[second.pid, second],
	])
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

const lockFile = () => path.join(dir, "start.lock")
const recordFile = () => path.join(dir, "processes.json")

describe("acquireStackLock", () => {
	it("creates start.lock naming the holder", () => {
		const lock = acquireStackLock(dir, first, identify)
		const written = JSON.parse(readFileSync(lockFile(), "utf8"))
		expect(written.holder).toEqual(first)
		expect(written.token).toBe(lock.token)
	})

	it("refuses while the holder is still running and leaves its lock alone", () => {
		const held = acquireStackLock(dir, first, identify)
		expect(() => acquireStackLock(dir, second, identify)).toThrow(
			/another demo-stack command is running \(pid 1001\)/,
		)
		expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe(held.token)
	})

	it("refuses a stale lock and leaves it for the operator", () => {
		const old = acquireStackLock(dir, first, identify)
		running.delete(first.pid)
		expect(() => acquireStackLock(dir, second, identify)).toThrow(
			/no longer running; if no demo-stack command is running, delete it/,
		)
		expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe(old.token)
	})

	it("refuses a lock it cannot read and does not touch it", () => {
		writeFileSync(lockFile(), "{not json")
		expect(() => acquireStackLock(dir, first, identify)).toThrow(StackBusyError)
		expect(readFileSync(lockFile(), "utf8")).toBe("{not json")
	})

	it("lets a former holder release without removing the lock that replaced it", () => {
		const old = acquireStackLock(dir, first, identify)
		running.delete(first.pid)
		rmSync(lockFile())
		const current = acquireStackLock(dir, second, identify)
		releaseStackLock(old)
		expect(JSON.parse(readFileSync(lockFile(), "utf8")).token).toBe(
			current.token,
		)
		releaseStackLock(current)
		expect(existsSync(lockFile())).toBe(false)
	})
})

describe("owned process record", () => {
	it("is written and removed only through a lock that is still held", () => {
		const lock = acquireStackLock(dir, first, identify)
		writeOwnedRecord(lock, record("winner"))
		expect(JSON.parse(readFileSync(recordFile(), "utf8"))).toEqual(
			record("winner"),
		)
		removeOwnedRecord(lock)
		expect(existsSync(recordFile())).toBe(false)
	})

	it("cannot be written or removed through a lock that was taken over", () => {
		const old = acquireStackLock(dir, first, identify)
		running.delete(first.pid)
		rmSync(lockFile())
		const current = acquireStackLock(dir, second, identify)
		writeOwnedRecord(current, record("winner"))
		expect(() => writeOwnedRecord(old, record("loser"))).toThrow(StackBusyError)
		expect(() => removeOwnedRecord(old)).toThrow(StackBusyError)
		expect(JSON.parse(readFileSync(recordFile(), "utf8"))).toEqual(
			record("winner"),
		)
	})
})

const lockModule = fileURLToPath(
	new URL("./demo-stack-lock.ts", import.meta.url),
)
const repoRoot = path.resolve(path.dirname(lockModule), "..")

// Runs in its own OS process: takes the lock or reports busy; the busy side then
// tries to delete the record through a lock it does not hold.
const contender = `
import { pathToFileURL } from "node:url"
const [, modulePath, dir, label] = process.argv
const lockLib = await import(pathToFileURL(modulePath).href)
try {
	const lock = lockLib.acquireStackLock(dir, lockLib.identifyProcess(process.pid))
	lockLib.writeOwnedRecord(lock, {
		memongo: { pid: 1, startedAt: label, command: label },
		api: { pid: 2, startedAt: label, command: label },
	})
	console.log("ACQUIRED " + label)
	await new Promise((resolve) => process.stdin.on("end", resolve).resume())
	lockLib.releaseStackLock(lock)
} catch (error) {
	if (error.name !== "StackBusyError") throw error
	console.log("BUSY " + label)
	const notHeld = { dir, token: "not-held" }
	try {
		lockLib.removeOwnedRecord(notHeld)
		console.log("REMOVED " + label)
	} catch (blocked) {
		console.log("BLOCKED " + label + " " + blocked.name)
	}
}
`

function runContender(label: string) {
	const child = spawn(
		"node",
		[
			"--import",
			"tsx",
			"--input-type=module",
			"-e",
			contender,
			lockModule,
			dir,
			label,
		],
		{ cwd: repoRoot, stdio: ["pipe", "pipe", "inherit"] },
	)
	const lines: string[] = []
	let buffer = ""
	let firstLine: (line: string) => void = () => undefined
	const first = new Promise<string>((resolve) => {
		firstLine = resolve
	})
	child.stdout.on("data", (chunk) => {
		buffer += chunk
		const parts = buffer.split("\n")
		buffer = parts.pop() ?? ""
		for (const line of parts) {
			lines.push(line)
			if (lines.length === 1) firstLine(line)
		}
	})
	const exited = new Promise<void>((resolve) =>
		child.on("exit", () => resolve()),
	)
	return { child, lines, first, exited }
}

describe("two concurrent starts", () => {
	it("gives the lock to exactly one, and the loser cannot remove the winner's record", {
		timeout: 30_000,
	}, async () => {
		const a = runContender("a")
		const b = runContender("b")
		const [firstA, firstB] = await Promise.all([a.first, b.first])
		const winner = firstA.startsWith("ACQUIRED")
			? { run: a, label: "a" }
			: { run: b, label: "b" }
		const loser = winner.run === a ? b : a
		expect(
			[firstA, firstB].filter((l) => l.startsWith("ACQUIRED")),
		).toHaveLength(1)
		expect([firstA, firstB].filter((l) => l.startsWith("BUSY"))).toHaveLength(1)

		await loser.exited
		expect(loser.lines.at(-1)).toMatch(/^BLOCKED \w StackBusyError$/)
		expect(JSON.parse(readFileSync(recordFile(), "utf8"))).toEqual(
			record(winner.label),
		)

		winner.run.child.stdin.end()
		await winner.run.exited
		expect(existsSync(lockFile())).toBe(false)
		expect(JSON.parse(readFileSync(recordFile(), "utf8"))).toEqual(
			record(winner.label),
		)
	})
})
