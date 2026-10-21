import type { MdbrainClient } from "@mdbrain/client"
import { ROLE_LABELS, type AgentRole } from "./config.js"

/** The only client surface a step event needs: one memory write. */
export type StepEventClient = Pick<MdbrainClient, "writeEvent">

export type StepEventOutcome = {
	confirmed: number
	failed: Array<{ name: string; error: string }>
}

type PendingWrite = {
	name: string
	settled: Promise<{ ok: true } | { ok: false; error: string }>
}

/** Non-blocking memory-event recorder for agent steps (decision 4: each
 * step is recorded as a memory event). record() only fires the write and
 * returns; confirm() waits for every write to land before the run's
 * manifest flips, so a slow memongo queue delays completion, never the
 * model's next step. All writes share the run's agentId (D10), so memongo
 * serializes them per agent; firing them early lets that queue drain
 * while later tasks run. */
export function createStepEventRecorder(input: {
	clients: Record<AgentRole, StepEventClient>
	runId: string
	agentId: string
	scopeRef: string
}) {
	const pending: PendingWrite[] = []
	let step = 0

	function record(event: {
		role: AgentRole
		name: string
		detail?: string
	}): void {
		const n = ++step
		const body =
			`[${input.runId}] ${ROLE_LABELS[event.role]} — ${event.name}` +
			(event.detail ? ` (${event.detail})` : "")
		const settled = input.clients[event.role]
			.writeEvent({
				role: "assistant",
				body,
				idempotencyKey: `agents:${input.runId}:step:${n}`,
				agentId: input.agentId,
				scope: "workspace",
				scopeRef: input.scopeRef,
			})
			.then(
				() => ({ ok: true as const }),
				(error: unknown) => ({
					ok: false as const,
					error: error instanceof Error ? error.message : String(error),
				}),
			)
		pending.push({ name: event.name, settled })
	}

	async function confirm(deadlineMs: number): Promise<StepEventOutcome> {
		if (pending.length === 0) return { confirmed: 0, failed: [] }
		let timer: ReturnType<typeof setTimeout> | undefined
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`timeout after ${deadlineMs}ms`)),
				deadlineMs,
			)
		})
		try {
			const outcomes = await Promise.all(
				pending.splice(0).map(async (write) => {
					try {
						const result = await Promise.race([write.settled, deadline])
						return result.ok
							? { confirmed: 1, failed: [] as StepEventOutcome["failed"] }
							: {
									confirmed: 0,
									failed: [{ name: write.name, error: result.error }],
								}
					} catch (error) {
						return {
							confirmed: 0,
							failed: [
								{
									name: write.name,
									error: error instanceof Error ? error.message : String(error),
								},
							],
						}
					}
				}),
			)
			return {
				confirmed: outcomes.reduce(
					(sum, outcome) => sum + outcome.confirmed,
					0,
				),
				failed: outcomes.flatMap((outcome) => outcome.failed),
			}
		} finally {
			if (timer) clearTimeout(timer)
		}
	}

	function pendingCount(): number {
		return pending.length
	}

	return { record, confirm, pendingCount }
}
