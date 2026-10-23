// Shared fixtures for the presenter API tests: services over memory control
// stores, a request helper and a sign-in.
import { vi } from "vitest"
import type { LeaseDoc, LeaseManifest } from "../lease.js"
import { createLeaseService } from "../lease.js"
import { createPinService, type PinDoc } from "../pin.js"
import {
	handlePresenterRequest,
	type PresenterServices,
} from "../presenter-api.js"
import { createProposalService, type ProposalsClient } from "../proposals.js"
import { createRunRequestService, type RunRequestDoc } from "../run-requests.js"
import { createSignInLimiter } from "../signin-limit.js"
import {
	CSRF_HEADER,
	SESSION_COOKIE,
	createSessionService,
	type SessionDoc,
} from "../session.js"
import { MemoryCollection } from "./memory-collection.js"

export const NOW = new Date("2026-10-23T12:00:00.000Z")
export const ORIGIN = "http://demo.test"
export const TOKEN = "presenter-token-0123456789abcdef"

export const seeded = (
	slot: number,
	over: Partial<LeaseManifest> = {},
): LeaseManifest => ({
	runId: `run-${slot}`,
	slotIndex: slot,
	scopeRef: `demo-run-${slot}`,
	agentId: `demo-run-${slot}`,
	state: "ready",
	eventsPlanned: 4,
	pagesPlanned: 2,
	eventsWritten: 4,
	pagesWritten: 2,
	hasAgentRun: false,
	agentRunState: "",
	...over,
})

export const pendingProposal = (operationId: string) => ({
	operationId,
	state: "pending" as const,
	proposer: {
		subjectId: "demo-proposer-13",
		displayName: "Demo proposer 13",
		agentId: "demo-run-13",
	},
	scope: "workspace",
	scopeRef: "demo-run-13",
	proposedAt: "2026-10-23T12:05:00.000Z",
	page: {
		slug: "syntheses/silent-eta-drift",
		title: "Silent ETA drift",
		kind: "synthesis",
		summary: "ETAs slip with no notice",
		body: "body",
		claims: [{ id: "c1", text: "one" }],
	},
})

export function rig(manifests: LeaseManifest[]) {
	let clock = NOW
	const now = () => clock
	const leaseStore = new MemoryCollection<LeaseDoc>(["presenterId"])
	const requestStore = new MemoryCollection<RunRequestDoc>()
	const pinStore = new MemoryCollection<PinDoc>()
	const reader = {
		get: async (runId: string) =>
			manifests.find((m) => m.runId === runId) ?? null,
	}
	const pins = createPinService({
		pins: pinStore,
		manifests: reader,
		readable: () => true,
		now,
	})
	const client = {
		listProposals: vi.fn(async (input: { scopeRef?: string }) => ({
			proposals:
				input.scopeRef === "demo-run-13" ? [pendingProposal("op-1")] : [],
		})),
		approveProposal: vi.fn(
			async ({ operationId }: { operationId: string }) => ({
				ok: true as const,
				operationId,
				state: "promoted" as const,
				pageSlug: "syntheses/silent-eta-drift",
			}),
		),
		rejectProposal: vi.fn(async ({ operationId }: { operationId: string }) => ({
			ok: true as const,
			operationId,
			state: "rejected" as const,
		})),
	} satisfies ProposalsClient
	const services: PresenterServices = {
		verifyToken: (provided) => provided === TOKEN,
		sessions: createSessionService({
			sessions: new MemoryCollection<SessionDoc>(),
			now,
		}),
		leases: createLeaseService({
			leases: leaseStore,
			manifests: { listReady: async () => manifests },
			pinnedRunId: async () => (await pins.get())?.runId,
			now,
		}),
		manifests: reader,
		runRequests: createRunRequestService({ requests: requestStore, now }),
		pins,
		proposals: createProposalService(client),
		signIns: createSignInLimiter({ now }),
		ready: async () => true,
		now,
	}
	return {
		services,
		client,
		leaseStore,
		requestStore,
		pinStore,
		tick: (ms: number) => {
			clock = new Date(clock.getTime() + ms)
		},
	}
}

export type Call = {
	method?: string
	path: string
	body?: unknown
	session?: { sessionId: string; csrf: string }
	origin?: string | null
	csrf?: string | null
	type?: string
	/** The client address header; the default is a documentation address. */
	address?: string | null
	body_text?: string
}

/** The fields the presenter tests read from a response; any other field is unknown. */
export type PresenterBody = {
	error: { code: string; message: string }
	lease: { name: string }
	[field: string]: unknown
}

export async function call(services: PresenterServices | null, input: Call) {
	const method = input.method ?? "POST"
	const headers: Record<string, string> = {}
	if (input.address !== null) {
		headers["x-forwarded-for"] = input.address ?? "203.0.113.9"
	}
	if (method !== "GET") {
		headers["content-type"] = input.type ?? "application/json"
		if (input.origin !== null) headers.origin = input.origin ?? ORIGIN
	}
	if (input.session) {
		headers.cookie = `${SESSION_COOKIE}=${input.session.sessionId}`
		if (input.csrf !== null && method !== "GET") {
			headers[CSRF_HEADER] = input.csrf ?? input.session.csrf
		}
	}
	const response = await handlePresenterRequest(
		new Request(`${ORIGIN}/api/demo/presenter/${input.path}`, {
			method,
			headers,
			...(method === "GET"
				? {}
				: { body: input.body_text ?? JSON.stringify(input.body ?? {}) }),
		}),
		input.path.split("/"),
		services,
	)
	return {
		response,
		status: response.status,
		body: (await response.json()) as PresenterBody,
	}
}

export async function signIn(services: PresenterServices) {
	const result = await call(services, {
		path: "session",
		body: { token: TOKEN },
	})
	const cookie = result.response.headers.get("set-cookie") ?? ""
	const sessionId =
		new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1] ?? ""
	return { sessionId, csrf: result.body.csrf as string }
}
