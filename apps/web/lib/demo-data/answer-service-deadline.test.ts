// The spec holds a visitor answer to one 30 s deadline (docs/platform/demo.md,
// ANSWER_DEADLINE_MS). The deadline covers the whole answer: the model loop,
// its tool reads, and the cite validation after it. Every read gets the
// answer's abort signal, and the lease is released only after the work the
// answer started has settled, so a deadline never frees the lane early.
import type { LanguageModelV2 } from "@ai-sdk/provider"
import { BudgetExhaustedError, type ModelBudget } from "@mdbrain/lib/budget"
import {
	formatCitationMarker,
	type MdbrainCitationResponse,
} from "@mdbrain/client"
import { describe, expect, it } from "vitest"
import { createAnswerService } from "./answer-service.js"
import type { AnswerLimits } from "./answer-types.js"
import type { DemoReads } from "./reads.js"

const EVENT_MARKER = formatCitationMarker({ kind: "event", eventId: "ev_42" })
const USAGE = { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
const SLOW_READ_MS = 400
const DEADLINE_MS = 50

type Turn = { text: string } | { search: string }

function scriptedModel(turns: Turn[], options: { slow?: boolean } = {}) {
	const calls: number[] = []
	let index = 0
	const model: LanguageModelV2 = {
		specificationVersion: "v2",
		provider: "fake",
		modelId: "scripted",
		supportedUrls: {},
		doGenerate: async (params) => {
			// Like the provider fetch: an aborted signal sends nothing.
			if (params.abortSignal?.aborted) throw new Error("aborted")
			calls.push(Date.now())
			// A provider call that keeps running past the abort.
			if (options.slow) await new Promise((r) => setTimeout(r, SLOW_READ_MS))
			const turn = turns[Math.min(index++, turns.length - 1)]
			if ("search" in turn) {
				return {
					content: [
						{
							type: "tool-call" as const,
							toolCallId: `c${index}`,
							toolName: "search_brain",
							input: JSON.stringify({ query: turn.search }),
						},
					],
					finishReason: "tool-calls" as const,
					usage: USAGE,
					warnings: [],
				}
			}
			return {
				content: [{ type: "text" as const, text: turn.text }],
				finishReason: "stop" as const,
				usage: USAGE,
				warnings: [],
			}
		},
		doStream: async () => {
			throw new Error("not used")
		},
	}
	return { model, calls }
}

/** A read that takes SLOW_READ_MS. It stops at the abort, as a fetch does,
 * unless `ignoresAbort`, like a read whose upstream keeps working. */
function slowRead<T>(
	value: T,
	signal: AbortSignal | undefined,
	ignoresAbort: boolean,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(value), SLOW_READ_MS)
		if (ignoresAbort || !signal) return
		const stop = () => {
			clearTimeout(timer)
			reject(new Error("read aborted"))
		}
		if (signal.aborted) stop()
		else signal.addEventListener("abort", stop, { once: true })
	})
}

function slowReads(options: { ignoresAbort?: boolean } = {}) {
	const ignoresAbort = options.ignoresAbort ?? false
	const state = { signals: [] as Array<AbortSignal | undefined>, settled: 0 }
	const settle = <T>(read: Promise<T>) =>
		read.finally(() => {
			state.settled++
		})
	const unused = async () => {
		throw new Error("not part of this test")
	}
	const event: MdbrainCitationResponse = {
		status: "resolved",
		kind: "event",
		marker: EVENT_MARKER,
		event: {
			eventId: "ev_42",
			canonicalId: "ev_42",
			text: "Memo: the renewal is signed.",
			timestamp: "2026-10-01T00:00:00.000Z",
			scope: "workspace",
			scopeRef: "slot-12",
		},
	}
	const reads: DemoReads = {
		wikiList: unused,
		wikiLint: unused,
		overview: unused,
		changes: unused,
		wikiGet: unused,
		run: unused,
		search: (_input, read) => {
			state.signals.push(read?.signal)
			return settle(
				slowRead(
					{ results: [] } as unknown as Awaited<
						ReturnType<DemoReads["search"]>
					>,
					read?.signal,
					ignoresAbort,
				),
			)
		},
		cite: (_input, read) => {
			state.signals.push(read?.signal)
			return settle(slowRead(event, read?.signal, ignoresAbort))
		},
	}
	return { reads, state }
}

function harness(
	turns: Turn[],
	options: {
		ignoresAbort?: boolean
		spent?: boolean
		slowModel?: boolean
	} = {},
) {
	const lease = { holder: null as string | null, releasedAt: [] as number[] }
	const limits: AnswerLimits = {
		acquireLease: async ({ visitorId }) => {
			if (lease.holder !== null) return false
			lease.holder = visitorId
			return true
		},
		releaseLease: async (visitorId) => {
			if (lease.holder === visitorId) lease.holder = null
			lease.releasedAt.push(Date.now())
		},
		countQuestion: async () => 1,
	}
	const charges = { reserved: 0, settled: 0, uncertain: 0 }
	const budget: ModelBudget = {
		reserve: async () => {
			charges.reserved++
			if (options.spent) {
				throw new BudgetExhaustedError("spent")
			}
			return "r1"
		},
		settle: async () => {
			charges.settled++
		},
		markUncertain: async () => {
			charges.uncertain++
		},
		read: async () => null,
	}
	const scripted = scriptedModel(turns, { slow: options.slowModel })
	const given = slowReads({ ignoresAbort: options.ignoresAbort })
	const service = createAnswerService({
		reads: given.reads,
		limits,
		budget,
		model: scripted.model,
		ceiling: 500_000,
		agentId: "agent-slot-12",
		deadlineMs: DEADLINE_MS,
	})
	return { service, lease, reads: given.state, model: scripted, charges }
}

const QUESTION = "Is the renewal signed?"

describe("the answer deadline covers the whole answer", () => {
	it("refuses at the deadline when the cite validation after the model is slow", async () => {
		const given = harness([{ text: `The renewal is signed. ${EVENT_MARKER}` }])
		const started = Date.now()
		const outcome = await given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
		})
		expect(outcome).toEqual({ state: "refused", reason: "deadline" })
		expect(Date.now() - started).toBeLessThan(SLOW_READ_MS / 2)
		expect(given.reads.signals).toHaveLength(1)
		expect(given.reads.signals[0]?.aborted).toBe(true)
		expect(given.lease.holder).toBeNull()
	})

	it("refuses at the deadline when a tool read inside the model loop is slow, and sends no further model call", async () => {
		const given = harness([{ search: "renewal" }, { text: "Done." }])
		const started = Date.now()
		const outcome = await given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
		})
		expect(outcome).toEqual({ state: "refused", reason: "deadline" })
		expect(Date.now() - started).toBeLessThan(SLOW_READ_MS / 2)
		expect(given.reads.signals[0]?.aborted).toBe(true)
		expect(given.model.calls).toHaveLength(1)
		// No step starts after the abort, so none is reserved and charged.
		expect(given.charges).toEqual({ reserved: 1, settled: 1, uncertain: 0 })
		expect(given.lease.holder).toBeNull()
	})

	it("cancels, not answers, when the visitor leaves during the cite validation", async () => {
		const given = harness([{ text: `The renewal is signed. ${EVENT_MARKER}` }])
		const visitor = new AbortController()
		const pending = given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
			signal: visitor.signal,
		})
		await new Promise((resolve) => setTimeout(resolve, 20))
		visitor.abort()
		expect(await pending).toEqual({ state: "canceled" })
		expect(given.lease.holder).toBeNull()
	})

	it("cancels before any model call when the visitor left while the lease was taken", async () => {
		const given = harness([{ text: `The renewal is signed. ${EVENT_MARKER}` }])
		const visitor = new AbortController()
		visitor.abort()
		const outcome = await given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
			signal: visitor.signal,
		})
		expect(outcome).toEqual({ state: "canceled" })
		expect(given.model.calls).toHaveLength(0)
		expect(given.charges.reserved).toBe(0)
		expect(given.lease.holder).toBeNull()
	})

	it.each([
		{
			read: "the cite validation",
			turns: [{ text: `The renewal is signed. ${EVENT_MARKER}` }],
			spent: false,
			charges: { reserved: 1, settled: 1, uncertain: 0 },
		},
		{
			read: "a tool read",
			turns: [{ search: "renewal" }, { text: "Done." }],
			spent: false,
			charges: { reserved: 1, settled: 1, uncertain: 0 },
		},
		{
			read: "the spent-budget fallback",
			turns: [{ text: "unused" }],
			spent: true,
			charges: { reserved: 1, settled: 0, uncertain: 0 },
		},
	])("holds the lease until $read, ignoring the abort, has settled", async ({
		turns,
		spent,
		charges,
	}) => {
		const given = harness(turns, { ignoresAbort: true, spent })
		const pending = given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
		})
		await new Promise((resolve) => setTimeout(resolve, SLOW_READ_MS / 2))
		// Past the deadline, the read is still running: the lane stays held.
		expect(given.lease.holder).toBe("visitor-1")
		expect(given.reads.settled).toBe(0)
		expect(await pending).toEqual({ state: "refused", reason: "deadline" })
		expect(given.reads.settled).toBe(1)
		expect(given.lease.holder).toBeNull()
		// A completed model call stays charged at its reported usage.
		expect(given.charges).toEqual(charges)
	})

	it("holds the lease and the model's reservation while a model call that ignores the abort runs", async () => {
		const given = harness([{ text: "The renewal is signed." }], {
			slowModel: true,
		})
		const pending = given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
		})
		await new Promise((resolve) => setTimeout(resolve, SLOW_READ_MS / 2))
		// Past the deadline the call still runs: the lane and the reservation
		// stay held, and nothing is released at zero.
		expect(given.lease.holder).toBe("visitor-1")
		expect(given.charges).toEqual({ reserved: 1, settled: 0, uncertain: 0 })
		expect(await pending).toEqual({ state: "refused", reason: "deadline" })
		expect(given.charges).toEqual({ reserved: 1, settled: 1, uncertain: 0 })
		expect(given.lease.holder).toBeNull()
	})

	it("bounds the spent-budget fallback read by the same deadline", async () => {
		const given = harness([{ text: "unused" }], { spent: true })
		const started = Date.now()
		const outcome = await given.service.answer({
			question: QUESTION,
			visitorId: "visitor-1",
		})
		expect(outcome).toEqual({ state: "refused", reason: "deadline" })
		expect(Date.now() - started).toBeLessThan(SLOW_READ_MS / 2)
		expect(given.reads.signals[0]?.aborted).toBe(true)
		expect(given.model.calls).toHaveLength(0)
		expect(given.lease.holder).toBeNull()
	})
})
