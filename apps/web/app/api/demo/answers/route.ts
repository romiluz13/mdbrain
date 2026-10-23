// Ticket 15: the visitor answer route. One POST, one question: the Anthropic
// key, the read-only principal, and the control store all stay on the
// server; the browser only ever sees the answer outcome. Same-origin keeps
// the whole answer path server-side under D18; force-dynamic keeps Next
// from caching it.

import { createAnthropic } from "@ai-sdk/anthropic"
import { operatorCeiling } from "@mdbrain/lib/budget"
import { randomUUID } from "node:crypto"
import { answerRequestDenied } from "@/lib/demo-data/answer-guards.js"
import { createAnswerService } from "@/lib/demo-data/answer-service.js"
import { createAnswerStore } from "@/lib/demo-data/answer-store.js"
import { tokenCappedFetch } from "@/lib/demo-data/answer-token-cap.js"
import { ANSWER_MAX_INPUT_TOKENS } from "@/lib/demo-data/answer-types.js"
import { createReadKeyCheck } from "@/lib/demo-data/proxy-principal.js"
import { readsFor } from "@/lib/demo-data/reads.js"
import { presenterRuntime } from "@/lib/demo-presenter/server.js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** D1: Haiku is the only model this route may call. */
const ANSWER_MODEL = "claude-haiku-5-5"
/** D20/D24: the daily counted-token ceiling, read from the operator's env.
 * Unset, zero, or malformed means the lane is off. */
const ANSWER_CEILING_ENV = "MDBRAIN_DEMO_ANSWER_TOKENS"

const VISITOR_COOKIE = "mdbrain_demo_visitor"
const VISITOR_COOKIE_MAX_AGE_S = 60 * 60 * 24
const VISITOR_COOKIE_PATTERN = /[A-Za-z0-9_-]{1,64}/

const jsonHeaders = { "content-type": "application/json" } as const

const checkReadKey = createReadKeyCheck()

const notConfigured = (): Response =>
	new Response(
		JSON.stringify({
			error: {
				code: "ANSWERS_NOT_CONFIGURED",
				message: "the demo answer service is missing its server configuration",
			},
		}),
		{ status: 503, headers: jsonHeaders },
	)

const badRequest = (message: string): Response =>
	new Response(
		JSON.stringify({ error: { code: "ANSWER_INVALID_BODY", message } }),
		{ status: 400, headers: jsonHeaders },
	)

/** One visitor per cookie: the id is opaque, set by this route only, and
 * carries nothing about the visitor beyond the count it keys. */
function readVisitorId(request: Request): {
	visitorId: string
	setCookie: boolean
} {
	const header = request.headers.get("cookie") ?? ""
	const found = new RegExp(
		`(?:^|;\\s*)${VISITOR_COOKIE}=(${VISITOR_COOKIE_PATTERN.source})`,
	).exec(header)
	if (found?.[1]) {
		return { visitorId: found[1], setCookie: false }
	}
	return { visitorId: randomUUID(), setCookie: true }
}

const cookieFor = (visitorId: string): string =>
	`${VISITOR_COOKIE}=${visitorId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VISITOR_COOKIE_MAX_AGE_S}`

export async function POST(request: Request): Promise<Response> {
	// R4: a cross-site text/plain form post needs no preflight, so the
	// route refuses it here, before any env, store or key is touched.
	const denied = answerRequestDenied(request)
	if (denied) {
		return new Response(
			JSON.stringify({ error: { code: denied.code, message: denied.message } }),
			{ status: denied.status, headers: jsonHeaders },
		)
	}
	// The answer is about the run the page shows: the pinned run for a visitor,
	// the leased slot for a presenter. The same resolver the read proxy uses
	// decides it, so a citation in an answer resolves against the same run.
	const resolved = await presenterRuntime().resolver.resolve(request)
	if (!resolved.ok) {
		return notConfigured()
	}
	const { env, run } = resolved.target
	const ceiling = operatorCeiling(process.env, ANSWER_CEILING_ENV)
	if (ceiling <= 0) {
		// Off is a public state, not an error: the lane says so.
		return new Response(JSON.stringify({ state: "off" }), {
			status: 200,
			headers: jsonHeaders,
		})
	}
	// The same gate as the read proxy: only an exact read-only reader of the
	// target's scope may answer anonymous visitors.
	if (!(await checkReadKey(env, fetch))) {
		return notConfigured()
	}
	const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? ""
	if (!run || !apiKey) {
		return notConfigured()
	}
	let body: unknown
	try {
		body = await request.json()
	} catch {
		return badRequest("the body must be JSON with a question")
	}
	const question = (body as { question?: unknown }).question
	if (typeof question !== "string") {
		return badRequest("the body must carry the question as text")
	}

	const { visitorId, setCookie } = readVisitorId(request)
	const store = createAnswerStore(run.controlUri)
	// The same read-only exact-scope principal the proxy uses, spoken
	// server-side: the browser never sees the key or the scope.
	const reads = readsFor({
		apiBaseUrl: env.apiBaseUrl,
		readKey: env.readKey,
		scope: env.scope,
		scopeRef: env.scopeRef,
	})
	const service = createAnswerService({
		reads,
		limits: store.limits,
		budget: store.budget,
		// The spec's 8,000-token context is held in tokens: the transport counts
		// each request before sending it, and the middleware leaves it the cap.
		model: createAnthropic({
			apiKey,
			fetch: tokenCappedFetch({ maxInputTokens: ANSWER_MAX_INPUT_TOKENS }),
		})(ANSWER_MODEL),
		inputCap: "transport",
		ceiling,
		agentId: env.agentId,
	})
	const outcome = await service.answer({
		question,
		visitorId,
		signal: request.signal,
	})
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (setCookie) {
		headers["set-cookie"] = cookieFor(visitorId)
	}
	return new Response(JSON.stringify(outcome), { status: 200, headers })
}
