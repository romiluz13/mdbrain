// Exclusive ownership of the demo stack directory. A command (start or stop)
// takes start.lock before it looks at the stack, and only the holder may write
// or delete processes.json, so a losing concurrent start can never remove the
// winner's record.
//
// The lock file is created with the `wx` flag (O_CREAT | O_EXCL), which the OS
// grants to exactly one caller. Any existing lock is refused, including a stale
// one whose holder is gone: the message tells the operator to delete it. Taking
// a stale lock over automatically cannot be made atomic with files alone.

import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
	type LockRecord,
	type ProcessIdentity,
	type StackRecord,
	planLock,
} from "./demo-stack-process.js"

export class StackBusyError extends Error {
	name = "StackBusyError"
}

export type StackLock = { readonly dir: string; readonly token: string }

const lockPath = (dir: string) => path.join(dir, "start.lock")
const recordPath = (dir: string) => path.join(dir, "processes.json")

export function identifyProcess(pid: number): ProcessIdentity | undefined {
	try {
		const read = (field: string) =>
			execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
				encoding: "utf8",
			}).trim()
		return { pid, startedAt: read("lstart"), command: read("command") }
	} catch {
		return undefined
	}
}

function readLock(dir: string): LockRecord | "unreadable" | undefined {
	let text: string
	try {
		text = readFileSync(lockPath(dir), "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
		return "unreadable"
	}
	try {
		const parsed = JSON.parse(text) as LockRecord
		return typeof parsed?.token === "string" &&
			typeof parsed.holder?.pid === "number"
			? parsed
			: "unreadable"
	} catch {
		return "unreadable"
	}
}

export function acquireStackLock(
	dir: string,
	self: ProcessIdentity,
	identify: (pid: number) => ProcessIdentity | undefined = identifyProcess,
): StackLock {
	const mine: LockRecord = { holder: self, token: randomUUID() }
	try {
		writeFileSync(lockPath(dir), JSON.stringify(mine), {
			flag: "wx",
			mode: 0o600,
		})
		return { dir, token: mine.token }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
	}
	const existing = readLock(dir)
	const plan = planLock(
		existing,
		existing && existing !== "unreadable"
			? identify(existing.holder.pid)
			: undefined,
	)
	throw new StackBusyError(
		plan.action === "refuse"
			? plan.reason
			: "start.lock disappeared while it was being read; try again",
	)
}

function assertHolds(lock: StackLock): void {
	const current = readLock(lock.dir)
	if (
		current === undefined ||
		current === "unreadable" ||
		current.token !== lock.token
	) {
		throw new StackBusyError(
			"this command no longer holds the demo stack lock; leaving processes.json alone",
		)
	}
}

export function releaseStackLock(lock: StackLock): void {
	const current = readLock(lock.dir)
	if (current && current !== "unreadable" && current.token === lock.token) {
		rmSync(lockPath(lock.dir), { force: true })
	}
}

export function writeOwnedRecord(lock: StackLock, record: StackRecord): void {
	assertHolds(lock)
	writeFileSync(recordPath(lock.dir), JSON.stringify(record), { mode: 0o600 })
}

export function removeOwnedRecord(lock: StackLock): void {
	assertHolds(lock)
	rmSync(recordPath(lock.dir), { force: true })
}
