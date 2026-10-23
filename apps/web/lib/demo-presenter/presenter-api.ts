// The presenter's HTTP surface, as one dispatcher over a fixed route table, so
// the whole surface is one allowlist the way the read proxy's is. The Route
// Handler in app/api/demo/presenter/[...action]/route.ts only builds the
// services and calls handlePresenterRequest.
//
// What the browser may send is small on purpose: no run id, scope, agent or
// key ever comes from it. Every action runs for the presenter's own lease; the
// slot comes from the lease, the scope from the slot's run record.

import {
	LeaseError,
	type LeaseDoc,
	type LeaseService,
	type ManifestReader,
} from "./lease.js"
import { PinError, type PinService } from "./pin.js"
import { ProposalError, type ProposalService } from "./proposals.js"
import {
	EXPIRED_REASON,
	RunRequestError,
	type RunRequestDoc,
	type RunRequestService,
} from "./run-requests.js"
import { clientAddress, type SignInLimiter } from "./signin-limit.js"
import {
	DEFAULT_SESSION_TTL_MS,
	authorizeMutation,
	authorizeSession,
	checkSameOriginJson,
	sessionCookie,
	sessionIdOf,
	type Authorized,
	type Refused,
	type SessionService,
} from "./session.js"

export type PresenterServices = {
	verifyToken(provided: string): boolean
	sessions: SessionService
	leases: LeaseService
	manifests: ManifestReader
	runRequests: RunRequestService
	pins: PinService
	proposals: ProposalService
	signIns: SignInLimiter
	/** Whether this server may act as the presenter's: its indexes exist and
	 * its review key is an administer-only key. False answers "not configured"
	 * to every action. */
	ready(): Promise<boolean>
	now: () => Date
	sessionTtlMs?: number
}

const BODY_MAX = 2_000

type Route = {
	method: "GET" | "POST"
	fields: readonly string[]
	auth: "none" | "session" | "mutation"
}

const ROUTES: Record<string, Route> = {
	state: { method: "GET", fields: [], auth: "none" },
	proposals: { method: "GET", fields: [], auth: "session" },
	session: { method: "POST", fields: ["token"], auth: "none" },
	"session/end": { method: "POST", fields: [], auth: "mutation" },
	lease: { method: "POST", fields: ["slotIndex", "name"], auth: "mutation" },
	"lease/release": { method: "POST", fields: [], auth: "mutation" },
	"lease/name": { method: "POST", fields: ["name"], auth: "mutation" },
	run: { method: "POST", fields: [], auth: "mutation" },
	pin: { method: "POST", fields: [], auth: "mutation" },
	"proposals/decide": {
		method: "POST",
		fields: ["operationId", "decision", "reason"],
		auth: "mutation",
	},
}

function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			...headers,
		},
	})
}

const failure = (status: number, code: string, message: string): Response =>
	json({ error: { code, message } }, status)

const REFUSAL_MESSAGES: Record<Refused["code"], string> = {
	NOT_PRESENTER: "Sign in as the presenter first.",
	CSRF_ORIGIN: "The request did not come from this page.",
	CSRF_TOKEN: "The request carried no valid presenter token for this session.",
	NOT_JSON: "Presenter actions take a JSON body.",
	METHOD_NOT_ALLOWED: "That method is not allowed here.",
}

const refusal = (refused: Refused): Response =>
	failure(refused.status, refused.code, REFUSAL_MESSAGES[refused.code])

type Fields = Record<string, unknown>

const tooLarge = () =>
	failure(413, "BODY_TOO_LARGE", "The request body is too large.")

/** The body as text, or null when it is over BODY_MAX bytes: a declared size
 * over the cap is refused before a byte is read, and an undeclared or
 * understated one is cut off as soon as it passes the cap. */
async function readBounded(request: Request): Promise<string | null> {
	const declared = request.headers.get("content-length")
	if (declared !== null && Number(declared) > BODY_MAX) return null
	const reader = request.body?.getReader()
	if (!reader) return ""
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (total > BODY_MAX) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	const bytes = new Uint8Array(total)
	let at = 0
	for (const chunk of chunks) {
		bytes.set(chunk, at)
		at += chunk.byteLength
	}
	return new TextDecoder().decode(bytes)
}

async function readFields(
	request: Request,
	allowed: readonly string[],
): Promise<Fields | Response> {
	const text = await readBounded(request)
	if (text === null) return tooLarge()
	if (text.trim() === "") return {}
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return failure(400, "INVALID_BODY", "The request body is not JSON.")
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return failure(400, "INVALID_BODY", "The request body is not an object.")
	}
	const unknown = Object.keys(parsed).find((key) => !allowed.includes(key))
	if (unknown !== undefined) {
		return failure(400, "UNKNOWN_FIELD", `${unknown} is not accepted here.`)
	}
	return parsed as Fields
}

const leaseView = (lease: LeaseDoc) => ({
	slotIndex: lease.slotIndex,
	name: lease.name,
	expiresAt: lease.expiresAt.toISOString(),
})

const requestView = (request: RunRequestDoc) => ({
	state: request.state,
	requestedAt: request.requestedAt,
	...(request.claimedAt ? { claimedAt: request.claimedAt } : {}),
	...(request.failureReason === EXPIRED_REASON
		? { failureReason: EXPIRED_REASON }
		: {}),
})

function mapError(error: unknown): Response {
	if (error instanceof LeaseError) {
		return failure(
			error.code === "INVALID_NAME" ? 400 : 409,
			error.code,
			error.message,
		)
	}
	if (error instanceof RunRequestError) {
		return failure(409, error.code, error.message)
	}
	if (error instanceof PinError) {
		return failure(
			error.code === "RUN_NOT_FOUND" ? 404 : 409,
			error.code,
			error.message,
		)
	}
	if (error instanceof ProposalError) {
		const status =
			error.code === "PROPOSAL_NOT_PENDING"
				? 409
				: error.code === "INVALID_REASON"
					? 400
					: 502
		return failure(status, error.code, error.message)
	}
	return failure(500, "PRESENTER_FAILED", "The presenter action failed.")
}

export async function handlePresenterRequest(
	request: Request,
	path: string[],
	services: PresenterServices | null,
): Promise<Response> {
	const key = path.join("/")
	const route = Object.hasOwn(ROUTES, key) ? ROUTES[key] : undefined
	if (!route) {
		return failure(
			404,
			"UNKNOWN_OPERATION",
			"There is no such presenter operation.",
		)
	}
	if (request.method.toUpperCase() !== route.method) {
		return failure(
			405,
			"METHOD_NOT_ALLOWED",
			"That method is not allowed here.",
		)
	}
	if (services === null || !(await services.ready())) {
		return key === "state"
			? json({ mode: "public" })
			: failure(
					503,
					"PRESENTER_NOT_CONFIGURED",
					"Presenter mode is not configured on this server.",
				)
	}
	if (route.method === "GET") {
		const [unknown] = new URL(request.url).searchParams.keys()
		if (unknown !== undefined) {
			return failure(
				400,
				"UNKNOWN_PARAMETER",
				`${unknown} is not accepted here.`,
			)
		}
	}
	try {
		if (key === "session") return await signIn(request, services)
		if (key === "state") {
			const auth = await authorizeSession(request, services.sessions)
			return auth.ok ? await state(services, auth) : json({ mode: "public" })
		}
		const auth =
			route.auth === "session"
				? await authorizeSession(request, services.sessions)
				: await authorizeMutation(request, services.sessions)
		if (!auth.ok) return refusal(auth)
		const fields =
			route.method === "POST" ? await readFields(request, route.fields) : {}
		if (fields instanceof Response) return fields
		return await act(key, request, services, auth, fields)
	} catch (error) {
		return mapError(error)
	}
}

async function signIn(request: Request, services: PresenterServices) {
	const refused = checkSameOriginJson(request)
	if (refused) return refusal(refused)
	const address = clientAddress(request.headers)
	const allowed = services.signIns.begin(address)
	if (allowed === "no-address" || address === undefined) {
		return failure(
			403,
			"NO_CLIENT_ADDRESS",
			"Sign-in is not available from here.",
		)
	}
	if (allowed === "limited") {
		return json(
			{
				error: {
					code: "TOO_MANY_ATTEMPTS",
					message: "Too many failed sign-ins. Wait a minute.",
				},
			},
			429,
			{ "retry-after": String(services.signIns.retryAfterSeconds(address)) },
		)
	}
	const fields = await readFields(request, ["token"])
	if (fields instanceof Response) return fields
	const token = typeof fields.token === "string" ? fields.token : ""
	if (!services.verifyToken(token)) {
		return failure(401, "INVALID_TOKEN", "That is not the presenter token.")
	}
	services.signIns.succeed(address)
	const opened = await services.sessions.open()
	const secure =
		new URL(request.url).protocol === "https:" ||
		request.headers.get("x-forwarded-proto") === "https"
	return json({ csrf: opened.csrf }, 200, {
		"set-cookie": sessionCookie(
			opened.sessionId,
			services.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
			secure,
		),
	})
}

async function state(services: PresenterServices, auth: Authorized) {
	const renewed = await services.leases.renew(auth.presenterId)
	const lease = renewed ?? (await services.leases.current(auth.presenterId))
	const queued = lease ? await services.runRequests.get(lease.runId) : null
	return json({
		mode: "presenter",
		csrf: auth.csrf,
		lease: lease ? leaseView(lease) : null,
		request: queued ? requestView(queued) : null,
	})
}

const NO_LEASE = () => failure(409, "NO_LEASE", "Lease a slot first.")

async function act(
	key: string,
	request: Request,
	services: PresenterServices,
	auth: Authorized,
	fields: Fields,
): Promise<Response> {
	if (key === "session/end") {
		await services.sessions.close(sessionIdOf(request))
		return json({ ok: true }, 200, {
			"set-cookie": sessionCookie("", 0, false),
		})
	}
	if (key === "lease") {
		const { slotIndex, name } = fields
		if (
			slotIndex !== undefined &&
			(!Number.isInteger(slotIndex) ||
				(slotIndex as number) < 1 ||
				(slotIndex as number) > 999)
		) {
			return failure(400, "INVALID_SLOT", "slotIndex is a whole slot number.")
		}
		if (name !== undefined && typeof name !== "string") {
			return failure(400, "INVALID_NAME", "A slot name is text.")
		}
		const lease = await services.leases.acquire({
			presenterId: auth.presenterId,
			...(slotIndex !== undefined ? { slotIndex: slotIndex as number } : {}),
			...(name !== undefined ? { name: name as string } : {}),
		})
		return json({ lease: leaseView(lease) })
	}
	if (key === "lease/release") {
		await services.leases.release(auth.presenterId)
		return json({ ok: true })
	}
	const lease = await services.leases.current(auth.presenterId)
	if (!lease) return NO_LEASE()
	if (key === "lease/name") {
		if (typeof fields.name !== "string") {
			return failure(400, "INVALID_NAME", "A slot name is text.")
		}
		const renamed = await services.leases.rename(auth.presenterId, fields.name)
		return renamed ? json({ lease: leaseView(renamed) }) : NO_LEASE()
	}
	const manifest = await services.manifests.get(lease.runId)
	if (key === "run") {
		const queued = await services.runRequests.enqueue(
			lease,
			manifest,
			auth.presenterId,
		)
		return json({ request: requestView(queued) })
	}
	if (key === "pin") {
		await services.pins.pin(lease.runId, auth.presenterId)
		return json({ ok: true })
	}
	const scopeRef = manifest?.scopeRef
	if (!scopeRef) return NO_LEASE()
	if (key === "proposals") {
		return json({ proposals: await services.proposals.list(scopeRef) })
	}
	// proposals/decide
	const { operationId, decision, reason } = fields
	if (typeof operationId !== "string" || operationId === "") {
		return failure(400, "INVALID_BODY", "operationId is required.")
	}
	if (decision !== "approve" && decision !== "reject") {
		return failure(400, "INVALID_BODY", "decision is approve or reject.")
	}
	if (reason !== undefined && typeof reason !== "string") {
		return failure(400, "INVALID_REASON", "A reason is text.")
	}
	if ((await services.pins.get())?.runId === lease.runId) {
		return failure(
			409,
			"RUN_PINNED",
			"Public mode plays this run back, so its proposal can no longer be decided.",
		)
	}
	return json(
		await services.proposals.decide(
			scopeRef,
			operationId,
			decision === "approve"
				? { kind: "approve" }
				: { kind: "reject", ...(reason !== undefined ? { reason } : {}) },
		),
	)
}
