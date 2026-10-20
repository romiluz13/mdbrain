// A pid alone is not an identity: the OS reuses pids, so the stack records
// each child's start time and command and signals only a process whose
// identity still matches when it is checked. The check narrows the pid-reuse
// window, it does not close it: see "Residual race" in demo-stack.ts.

export type ProcessIdentity = {
	pid: number
	startedAt: string
	command: string
}

export type StackName = "memongo" | "api"

export type StackRecord = Record<StackName, ProcessIdentity>

export type LockRecord = { holder: ProcessIdentity; token: string }

export type Observed = Partial<Record<StackName, ProcessIdentity | undefined>>

const NAMES: StackName[] = ["memongo", "api"]

export function isSameProcess(
	recorded: ProcessIdentity,
	current: ProcessIdentity | undefined,
): boolean {
	return (
		current !== undefined &&
		current.pid === recorded.pid &&
		current.startedAt === recorded.startedAt &&
		current.command === recorded.command
	)
}

export function planStop(
	record: StackRecord,
	observed: Observed,
): { signal: number[]; skipped: { name: StackName; reason: string }[] } {
	const signal: number[] = []
	const skipped: { name: StackName; reason: string }[] = []
	for (const name of NAMES) {
		const recorded = record[name]
		const current = observed[name]
		if (isSameProcess(recorded, current)) signal.push(recorded.pid)
		else if (current === undefined)
			skipped.push({ name, reason: `pid ${recorded.pid} not running` })
		else
			skipped.push({
				name,
				reason: `pid ${recorded.pid} now belongs to another process`,
			})
	}
	return { signal, skipped }
}

export function planStart(
	record: StackRecord | undefined,
	observed: Observed,
	portsInUse: Record<StackName, boolean>,
):
	| { action: "start"; discardStaleRecord?: true }
	| { action: "refuse"; reason: string } {
	if (record) {
		for (const name of NAMES) {
			if (isSameProcess(record[name], observed[name])) {
				return {
					action: "refuse",
					reason: `the demo stack is already running (${name} pid ${record[name].pid}); stop it first`,
				}
			}
		}
	}
	for (const name of NAMES) {
		if (portsInUse[name]) {
			return {
				action: "refuse",
				reason: `port for ${name} is already in use by a process this stack did not start`,
			}
		}
	}
	return record
		? { action: "start", discardStaleRecord: true }
		: { action: "start" }
}

export function terminateIfStillSame(
	recorded: ProcessIdentity,
	identify: (pid: number) => ProcessIdentity | undefined,
	kill: (pid: number) => void,
): "signalled" | "gone" | "reused" {
	const current = identify(recorded.pid)
	if (current === undefined) return "gone"
	if (!isSameProcess(recorded, current)) return "reused"
	kill(recorded.pid)
	return "signalled"
}

export function planLock(
	existing: LockRecord | "unreadable" | undefined,
	holderNow: ProcessIdentity | undefined,
): { action: "create" } | { action: "refuse"; reason: string } {
	if (existing === undefined) return { action: "create" }
	if (existing === "unreadable") {
		return {
			action: "refuse",
			reason:
				"start.lock exists but cannot be read; if no demo-stack command is running, delete it",
		}
	}
	if (isSameProcess(existing.holder, holderNow)) {
		return {
			action: "refuse",
			reason: `another demo-stack command is running (pid ${existing.holder.pid}); wait for it to finish`,
		}
	}
	// A holder that is gone leaves a stale lock. Clearing it is left to the
	// operator: an automatic takeover (read, re-read, unlink) can delete a lock
	// another command created in between (review 312, A2).
	return {
		action: "refuse",
		reason: `start.lock was left by pid ${existing.holder.pid}, which is no longer running; if no demo-stack command is running, delete it and retry`,
	}
}
