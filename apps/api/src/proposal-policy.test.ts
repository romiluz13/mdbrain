// Proposal-only policy (ticket 06): a key with `propose` and without `write`
// may append memory events and propose new pages, and nothing else. The route
// table below is the inventory: createApp().routes must match it exactly, so a
// route added later fails here until someone decides what a proposer may do.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toolList } from "../../mcp/src/server.js"

const bridgeMocks = vi.hoisted(() => ({
	mdbrainBridgeCheckReadiness: vi.fn(),
	mdbrainBridgeAdd: vi.fn(),
	mdbrainBridgeBuildContextBundle: vi.fn(),
	mdbrainBridgeBuildDiscoveryProjection: vi.fn(),
	mdbrainBridgeDeleteLifecycleItem: vi.fn(),
	mdbrainBridgeApplyMemoryFeedback: vi.fn(),
	mdbrainBridgeGetState: vi.fn(),
	mdbrainBridgeExtractEvent: vi.fn(),
	mdbrainBridgeGetLifecycleHistory: vi.fn(),
	mdbrainBridgeGetLifecycleItem: vi.fn(),
	mdbrainBridgeHydrateActiveSlate: vi.fn(),
	mdbrainBridgeProfile: vi.fn(),
	mdbrainBridgeRecallConversation: vi.fn(),
	mdbrainBridgeSearch: vi.fn(),
	mdbrainBridgeSearchDetailed: vi.fn(),
	mdbrainBridgeSearchKB: vi.fn(),
	mdbrainBridgeUpdateLifecycleItem: vi.fn(),
	mdbrainBridgeReportProcedureOutcome: vi.fn(),
	mdbrainBridgeWriteConversationEvent: vi.fn(),
	mdbrainBridgeWriteProcedure: vi.fn(),
	mdbrainBridgeWriteStructuredMemory: vi.fn(),
}))
vi.mock("@mdbrain/memory-bridge", () => bridgeMocks)

const deliveryMocks = vi.hoisted(() => ({
	deliverMemoryWrite: vi.fn(),
	approvePendingWikiPromotion: vi.fn(),
	rejectPendingWikiPromotion: vi.fn(),
	listPendingWikiProposals: vi.fn(),
	redriveDeadLetteredMemoryDelivery: vi.fn(),
	MemoryDeliveryDispatchError: class MemoryDeliveryDispatchError extends Error {
		constructor(
			readonly operationId: string,
			readonly state: string,
			readonly code: string,
		) {
			super(`memory delivery ${operationId} entered ${state}`)
		}
	},
}))
vi.mock("./memory-delivery-runtime.js", () => ({
	...deliveryMocks,
	wikiPromotionApprovalRequired: () => false,
	buildMemoryDeliveryOperationId: (params: { operation: string }) =>
		`${params.operation}:${"a".repeat(64)}`,
	buildMemoryWikiPromotion: (params: {
		body: { promotionPolicy?: string }
		operationId: string
	}) =>
		params.body.promotionPolicy === "wiki"
			? {
					promotion: {
						key: `${params.operationId}:wiki:v1`,
						mutateWiki: vi.fn(),
					},
				}
			: {},
}))

vi.mock("./wiki-store-runtime.js", () => ({
	checkWikiStoreReadiness: vi.fn(),
	getWikiStoreHandle: vi.fn(),
	withWikiTransaction: vi.fn(),
	closeWikiStore: vi.fn(),
}))

import { createApp } from "./app.js"

const prevEnv = { ...process.env }
const SCOPE = { scope: "workspace", scopeRef: "demo-run-1" }
const DENIED = "capability is not allowed for this API key"

type Row = {
	method: "GET" | "POST" | "PATCH" | "DELETE"
	route: string
	sample: string
	// What a key holding only `read` and `propose` may do here.
	proposer: "allowed" | "refused"
	// What a key holding `read` and `write` may do: unchanged by this ticket.
	writer: "allowed" | "refused"
	// The capability the route asks of a writer, and of a proposer.
	needs: string
	proposerNeeds: string
}

const row = (
	method: Row["method"],
	route: string,
	sample: string,
	needs: string,
	options: { writer?: Row["writer"]; proposerNeeds?: string } = {},
): Row => {
	const proposerNeeds = options.proposerNeeds ?? needs
	return {
		method,
		route,
		sample,
		needs,
		proposerNeeds,
		writer:
			options.writer ??
			(needs === "read" || needs === "write" ? "allowed" : "refused"),
		proposer:
			proposerNeeds === "read" || proposerNeeds === "propose"
				? "allowed"
				: "refused",
	}
}

const TABLE: Row[] = [
	row("POST", "/v1/search", "/v1/search", "read"),
	row("POST", "/v1/search-kb", "/v1/search-kb", "read"),
	row("POST", "/v1/recall-conversation", "/v1/recall-conversation", "read"),
	row("POST", "/v1/lifecycle/get", "/v1/lifecycle/get", "read"),
	row("POST", "/v1/lifecycle/update", "/v1/lifecycle/update", "write"),
	row("POST", "/v1/lifecycle/delete", "/v1/lifecycle/delete", "hard-delete"),
	row("POST", "/v1/lifecycle/history", "/v1/lifecycle/history", "read"),
	row("POST", "/v1/procedures/outcome", "/v1/procedures/outcome", "write"),
	row("POST", "/v1/memory/feedback", "/v1/memory/feedback", "write"),
	row("POST", "/v1/search-detailed", "/v1/search-detailed", "read"),
	row("POST", "/v1/hydrate-active-slate", "/v1/hydrate-active-slate", "read"),
	row("POST", "/v1/discovery-projection", "/v1/discovery-projection", "read"),
	row("POST", "/v1/context-bundle", "/v1/context-bundle", "read"),
	row("POST", "/v1/add", "/v1/add", "write", { proposerNeeds: "propose" }),
	row("POST", "/v1/write-event", "/v1/write-event", "write", {
		proposerNeeds: "propose",
	}),
	row("POST", "/v1/extract", "/v1/extract", "write"),
	row("POST", "/v1/write-structured", "/v1/write-structured", "write"),
	row("POST", "/v1/write-procedure", "/v1/write-procedure", "write"),
	row("POST", "/v1/profile", "/v1/profile", "read"),
	row("GET", "/v1/state", "/v1/state", "read"),
	row("GET", "/v1/admin/deliveries", "/v1/admin/deliveries", "administer"),
	row(
		"GET",
		"/v1/admin/wiki-promotions",
		"/v1/admin/wiki-promotions",
		"administer",
	),
	row(
		"POST",
		"/v1/admin/wiki-promotions/:operationId/approve",
		"/v1/admin/wiki-promotions/op-1/approve",
		"administer",
	),
	row(
		"POST",
		"/v1/admin/wiki-promotions/:operationId/reject",
		"/v1/admin/wiki-promotions/op-1/reject",
		"administer",
	),
	row(
		"POST",
		"/v1/admin/deliveries/:operationId/redrive",
		"/v1/admin/deliveries/op-1/redrive",
		"administer",
	),
	row("POST", "/v1/wiki", "/v1/wiki", "write"),
	row("GET", "/v1/wiki", "/v1/wiki", "read"),
	row("GET", "/v1/wiki/lint", "/v1/wiki/lint", "read"),
	row("GET", "/v1/wiki/revisions", "/v1/wiki/revisions", "read"),
	row("GET", "/v1/wiki/revisions/:revision", "/v1/wiki/revisions/2", "read"),
	row(
		"GET",
		"/v1/wiki/overview/*",
		"/v1/wiki/overview/tables%2Faccounts",
		"read",
	),
	row("GET", "/v1/wiki/changes", "/v1/wiki/changes", "read"),
	row("GET", "/v1/wiki/*", "/v1/wiki/tables%2Faccounts", "read"),
	row("PATCH", "/v1/wiki/*", "/v1/wiki/tables%2Faccounts", "write"),
	row("DELETE", "/v1/wiki/*", "/v1/wiki/tables%2Faccounts", "write"),
	row("POST", "/v1/wiki/okf-import", "/v1/wiki/okf-import", "write"),
	row("POST", "/v1/wiki/okf-export", "/v1/wiki/okf-export", "export"),
	row("POST", "/v1/wiki/search", "/v1/wiki/search", "read"),
	row("GET", "/v1/cite", "/v1/cite", "read"),
]

const PROPOSER = {
	token: "proposer-secret",
	subjectId: "demo-proposer-1",
	grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
	capabilities: ["read", "propose"],
}
const WRITER = {
	token: "writer-secret",
	subjectId: "demo-writer-1",
	grants: [{ scope: "workspace", scopeRef: "demo-run-1" }],
	capabilities: ["read", "write"],
}

function send(
	app: ReturnType<typeof createApp>,
	r: Row,
	token: string,
	extra: Record<string, unknown> = {},
) {
	const query = `scope=${SCOPE.scope}&scopeRef=${SCOPE.scopeRef}`
	const url = `${r.sample}${r.sample.includes("?") ? "&" : "?"}${query}`
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"Idempotency-Key": "policy-key",
	}
	if (r.method === "GET" || r.method === "DELETE") {
		return app.request(url, { method: r.method, headers })
	}
	return app.request(url, {
		method: r.method,
		headers,
		body: JSON.stringify({
			...SCOPE,
			content: "a memory",
			role: "user",
			body: "an event",
			...extra,
		}),
	})
}

describe("proposal-only policy", () => {
	beforeEach(() => {
		process.env = { ...prevEnv }
		process.env.MDBRAIN_API_KEY = "admin-secret"
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([PROPOSER, WRITER])
		for (const mock of Object.values(bridgeMocks)) mock.mockReset()
		deliveryMocks.deliverMemoryWrite.mockReset()
		deliveryMocks.deliverMemoryWrite.mockResolvedValue({
			eventId: "e1",
			chunkCreated: true,
		})
	})
	afterEach(() => {
		process.env = { ...prevEnv }
	})

	it("inventories every registered /v1 route", () => {
		const registered = createApp()
			.routes.filter((r) => r.method !== "ALL" && r.path.startsWith("/v1/"))
			.map((r) => `${r.method} ${r.path}`)
			.sort()
		const inventoried = TABLE.map((r) => `${r.method} ${r.route}`).sort()
		expect(registered).toEqual(inventoried)
	})

	it.each(TABLE)("proposer $method $route is $proposer", async (r) => {
		const res = await send(createApp(), r, PROPOSER.token)
		if (r.proposer === "refused") {
			expect(res.status).toBe(403)
			await expect(res.json()).resolves.toEqual({
				error: { code: "FORBIDDEN", message: DENIED },
			})
		} else {
			expect(res.status).not.toBe(403)
		}
	})

	it.each(TABLE)("writer $method $route is $writer, unchanged", async (r) => {
		const res = await send(createApp(), r, WRITER.token)
		if (r.writer === "refused") {
			expect(res.status).toBe(403)
			await expect(res.json()).resolves.toEqual({
				error: { code: "FORBIDDEN", message: DENIED },
			})
		} else {
			expect(res.status).not.toBe(403)
		}
	})

	it("refuses a hard delete and an unlisted POST for a proposer", async () => {
		const app = createApp()
		const hard = await app.request(
			`/v1/wiki/tables%2Faccounts?hard=true&scope=${SCOPE.scope}&scopeRef=${SCOPE.scopeRef}`,
			{
				method: "DELETE",
				headers: { Authorization: `Bearer ${PROPOSER.token}` },
			},
		)
		expect(hard.status).toBe(403)
		const unlisted = await app.request("/v1/not-a-route", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${PROPOSER.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(SCOPE),
		})
		expect(unlisted.status).toBe(403)
	})

	it("does not let a proposer hold write by also holding propose", async () => {
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([
			{ ...PROPOSER, capabilities: ["read", "write", "propose"] },
		])
		const wiki = TABLE.find(
			(r) => r.route === "/v1/wiki" && r.method === "POST",
		) as Row
		const res = await send(createApp(), wiki, PROPOSER.token)
		expect(res.status).not.toBe(403)
	})
})

describe("a proposal-only submission always waits for approval", () => {
	const page = {
		kind: "concept",
		title: "Silent ETA drift",
		slug: "concepts/silent-eta-drift",
		summary: "ETAs drift silently.",
		body: "ETAs drift without a signal.",
		frontmatter: { type: "concept" },
		claims: [{ id: "c1", text: "ETAs drift silently." }],
		trustTier: "standard",
		...SCOPE,
	}
	const submit = (
		path: string,
		token: string,
		extra: Record<string, unknown> = {},
	) =>
		createApp().request(path, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"Idempotency-Key": "proposal-1",
			},
			body: JSON.stringify({
				...SCOPE,
				content: "ETA drift",
				role: "user",
				body: "ETA drift",
				promotionPolicy: "wiki",
				wikiPromotion: { page },
				...extra,
			}),
		})

	beforeEach(() => {
		process.env = { ...prevEnv }
		process.env.MDBRAIN_API_KEY = "admin-secret"
		process.env.MDBRAIN_API_SCOPED_KEYS = JSON.stringify([PROPOSER, WRITER])
		deliveryMocks.deliverMemoryWrite.mockReset()
		deliveryMocks.deliverMemoryWrite.mockResolvedValue({
			eventId: "e1",
			chunkCreated: true,
		})
	})

	it.each([
		"/v1/add",
		"/v1/write-event",
	])("%s holds the promotion for approval", async (path) => {
		const res = await submit(path, PROPOSER.token)
		expect(res.status).toBe(200)
		expect(deliveryMocks.deliverMemoryWrite).toHaveBeenCalledWith(
			expect.objectContaining({
				promotionApproval: "required",
				proposalOnly: true,
			}),
		)
	})

	it.each([
		"/v1/add",
		"/v1/write-event",
	])("%s ignores approval fields in the payload", async (path) => {
		const res = await submit(path, PROPOSER.token, {
			promotionApproval: "approved",
			autoApprove: true,
			requireApproval: false,
			wikiPromotion: { page, promotionApproval: "approved", approved: true },
		})
		expect(res.status).toBe(200)
		const call = deliveryMocks.deliverMemoryWrite.mock.calls[0]?.[0]
		expect(call.promotionApproval).toBe("required")
		expect(call.proposalOnly).toBe(true)
	})

	it("leaves a write key's promotion exactly as before when the env flag is off", async () => {
		const res = await submit("/v1/add", WRITER.token)
		expect(res.status).toBe(200)
		const call = deliveryMocks.deliverMemoryWrite.mock.calls[0]?.[0]
		expect(call.promotionApproval).toBeUndefined()
		expect(call.proposalOnly).toBeUndefined()
	})

	it("lets a proposer append a plain event without a promotion", async () => {
		const res = await submit("/v1/write-event", PROPOSER.token, {
			promotionPolicy: "none",
		})
		expect(res.status).toBe(200)
		const call = deliveryMocks.deliverMemoryWrite.mock.calls[0]?.[0]
		expect(call.promotion).toBeUndefined()
		expect(call.promotionApproval).toBeUndefined()
	})
})

// Every MCP tool calls the HTTP API with the caller's own key, so the API
// table above is what binds an MCP caller. This list only makes sure a tool
// added later is looked at.
const MCP_TOOLS: Record<string, string> = {
	mdbrain_search: "POST /v1/search",
	mdbrain_search_kb: "POST /v1/search-kb",
	mdbrain_add: "POST /v1/add",
	mdbrain_write_event: "POST /v1/write-event",
	mdbrain_profile: "POST /v1/profile",
	mdbrain_build_context_bundle: "POST /v1/context-bundle",
	mdbrain_recall_conversation: "POST /v1/recall-conversation",
	mdbrain_recall_messages: "POST /v1/recall-conversation",
	mdbrain_lifecycle_get: "POST /v1/lifecycle/get",
	mdbrain_memory_get: "POST /v1/lifecycle/get",
	mdbrain_lifecycle_update: "POST /v1/lifecycle/update",
	mdbrain_memory_update: "POST /v1/lifecycle/update",
	mdbrain_lifecycle_delete: "POST /v1/lifecycle/delete",
	mdbrain_memory_delete: "POST /v1/lifecycle/delete",
	mdbrain_lifecycle_history: "POST /v1/lifecycle/history",
	mdbrain_memory_history: "POST /v1/lifecycle/history",
	mdbrain_procedure_outcome: "POST /v1/procedures/outcome",
	mdbrain_memory_feedback: "POST /v1/memory/feedback",
	mdbrain_state_unified: "GET /v1/state",
	mdbrain_search_detailed: "POST /v1/search-detailed",
	mdbrain_hydrate_active_slate: "POST /v1/hydrate-active-slate",
	mdbrain_discovery_projection: "POST /v1/discovery-projection",
	mdbrain_write_structured: "POST /v1/write-structured",
	mdbrain_write_procedure: "POST /v1/write-procedure",
	mdbrain_wiki_search: "POST /v1/wiki/search",
	mdbrain_wiki_get: "GET /v1/wiki/*",
	mdbrain_wiki_apply: "POST /v1/wiki, PATCH /v1/wiki/*",
	mdbrain_wiki_export_okf: "POST /v1/wiki/okf-export",
	mdbrain_wiki_import_okf: "POST /v1/wiki/okf-import",
	mdbrain_wiki_lint: "GET /v1/wiki/lint",
	mdbrain_wiki_overview: "GET /v1/wiki/overview/*",
	mdbrain_wiki_changes: "GET /v1/wiki/changes",
	mdbrain_cite: "GET /v1/cite",
}

describe("MCP tools", () => {
	it("are all inventoried against an HTTP route that the table covers", () => {
		expect(toolList.map((t) => t.name).sort()).toEqual(
			Object.keys(MCP_TOOLS).sort(),
		)
		const routes = new Set(TABLE.map((r) => `${r.method} ${r.route}`))
		for (const target of Object.values(MCP_TOOLS)) {
			for (const part of target.split(", ")) expect(routes).toContain(part)
		}
	})

	it("offers no tool that approves or rejects a proposal", () => {
		expect(
			toolList
				.map((t) => t.name)
				.filter((n) => /approve|reject|propos/i.test(n)),
		).toEqual([])
	})
})
