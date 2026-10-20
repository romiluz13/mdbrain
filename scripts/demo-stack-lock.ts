// Exclusive ownership of the demo stack directory. A command (start or stop)
// takes start.lock before it looks at the stack, and only the holder may write
// or delete processes.json, so a losing concurrent start can never remove the
// winner's record.
//
// The lock file is created with the `wx` flag (O_CREAT | O_EXCL), which the OS
// grants to exactly one caller. A lock whose recorded holder is provably gone
// (not running, or its pid now belongs to a process with another start time or
// command) is taken over; anything else is refused. Taking over is a read, a
// re-read and an unlink, not one atomic step: two commands that find the same
// stale lock in the same instant can both clear it, and the later unlink can
// then land on a lock the other just created. The re-read before the unlink
// narrows that window to microseconds; it cannot close it.

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
	for (let attempt = 0; attempt < 3; attempt++) {
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
		if (plan.action === "refuse") throw new StackBusyError(plan.reason)
		if (plan.action === "take-over" && existing && existing !== "unreadable") {
			const again = readLock(dir)
			if (again && again !== "unreadable" && again.token === existing.token) {
				rmSync(lockPath(dir), { force: true })
			}
		}
	}
	throw new StackBusyError(
		"could not take start.lock: it kept changing; try again",
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
