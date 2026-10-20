// A pid alone is not an identity: the OS reuses pids, so the stack records
// each child's start time and command and only ever signals an exact match.

export type ProcessIdentity = {
	pid: number
	startedAt: string
	command: string
}

export type StackName = "memongo" | "api"

export type StackRecord = Record<StackName, ProcessIdentity>

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
