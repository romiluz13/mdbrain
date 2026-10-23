// Ticket 15: the answer-lane contract. The service owns the outcomes; the
// store (answer-store.ts) owns the limits seam; the route (app/api/demo/
// answers/route.ts) owns env and principal wiring.

import type { MdbrainCitationResponse } from "@mdbrain/client"

/** One citation the service validated through the cite read. */
export type AnswerCitation = {
	marker: string
	response: MdbrainCitationResponse
}

/** One stored page from the cited-retrieval fallback: search only, no model. */
export type AnswerHit = {
	slug: string
	title: string
	claims: Array<{ id: string; text: string }>
}

/** Why a question was refused: busy (another visitor holds the lease), rate
 * (the visitor's hourly question count is spent), input (blank or over the
 * character cap), limits (the call's context cannot be bounded), deadline
 * (the 30 s answer window closed). */
export type AnswerRefusalReason =
	| "busy"
	| "rate"
	| "input"
	| "limits"
	| "deadline"

/** The states the chapter 2 answer lane renders: answered with validated
 * citations, refused over a limit, budget spent (cited retrieval fallback),
 * canceled (visitor disconnected), off (no daily ceiling), unavailable (a
 * control-store or provider failure fails closed). */
export type AnswerOutcome =
	| { state: "answered"; text: string; citations: AnswerCitation[] }
	| { state: "refused"; reason: AnswerRefusalReason }
	| { state: "spent"; message: string; hits: AnswerHit[] }
	| { state: "canceled" }
	| { state: "off" }
	| { state: "unavailable" }

/** One visitor's question. `signal` is the request's disconnect signal. */
export type AnswerInput = {
	question: string
	visitorId: string
	signal?: AbortSignal
}

/** D20 limits the answer store enforces: one active answer at a time (a
 * durable lease), and the per-visitor hourly question count. */
export interface AnswerLimits {
	acquireLease(input: { visitorId: string }): Promise<boolean>
	releaseLease(visitorId: string): Promise<void>
	countQuestion(input: { visitorId: string }): Promise<number>
}

/** D20: at most 5 questions per visitor per hour. */
export const VISITOR_QUESTIONS_PER_HOUR = 5
/** D20: at most 2,000 characters of question. */
export const ANSWER_MAX_INPUT_CHARS = 2000
/** D20: at most 4 tool steps. */
export const ANSWER_MAX_TOOL_STEPS = 4
/** D20: at most 1,000 output tokens. */
export const ANSWER_MAX_OUTPUT_TOKENS = 1000
/** D20: at most 8,000 tokens of context. */
export const ANSWER_MAX_INPUT_TOKENS = 8000
/** D20: 30 seconds from question to answer. */
export const ANSWER_DEADLINE_MS = 30_000
/** The daily budget key, counted in mdbrain_demo_control. */
export const ANSWER_BUDGET_KEY_PREFIX = "answers:"
/** The fixed sentence for a question the stored sources do not answer: the
 * one the prompt asks the model for, and the one the service substitutes
 * when the steps end without text or every marker is dropped. */
export const ANSWER_NO_EVIDENCE_TEXT =
	"Not enough evidence in the stored sources to answer this."
