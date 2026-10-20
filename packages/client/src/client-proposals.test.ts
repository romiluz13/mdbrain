// The review surface for proposals: list what waits, approve it, reject it.

import { afterEach, describe, expect, it, vi } from "vitest"
import { MdbrainClient } from "./index.js"

const proposal = {
	operationId: "add:op1",
	state: "pending",
	proposer: { subjectId: "demo-proposer-1", agentId: "agent-1" },
	scope: "workspace",
	scopeRef: "demo-run-1",
	proposedAt: "2026-10-20T10:00:00.000Z",
	page: {
		slug: "concepts/silent-eta-drift",
		title: "Silent ETA drift",
		kind: "concept",
		summary: "ETAs drift silently.",
		body: "ETAs drift without a signal.",
		claims: [{ id: "c1", text: "ETAs drift silently." }],
	},
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("listProposals", () => {
	it("reads the review queue, narrowed by scope and limit when given", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ proposals: [proposal] }))
		vi.stubGlobal("fetch", fetchMock)

		const out = await new MdbrainClient().listProposals({
			scope: "workspace",
			scopeRef: "demo-run-1",
			limit: 5,
		})

		expect(out).toEqual({ proposals: [proposal] })
		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(url.pathname).toBe("/v1/admin/wiki-promotions")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			scope: "workspace",
			scopeRef: "demo-run-1",
			limit: "5",
		})
		expect(fetchMock.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET")
	})

	it("sends no query when asked for everything", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ proposals: [] }))
		vi.stubGlobal("fetch", fetchMock)

		await new MdbrainClient().listProposals()

		const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
		expect(url.search).toBe("")
	})

	it("surfaces a key that may not review as a client error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "FORBIDDEN",
							message: "capability is not allowed for this API key",
						},
					},
					{ status: 403 },
				),
			),
		)

		await expect(new MdbrainClient().listProposals()).rejects.toMatchObject({
			status: 403,
			envelope: { code: "FORBIDDEN" },
		})
	})
})

describe("approveProposal", () => {
	it("posts to the approve route with the operation id encoded", async () => {
		const result = {
			ok: true,
			operationId: "add:op1",
			state: "promoted",
			pageSlug: "concepts/x",
		}
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(result))
		vi.stubGlobal("fetch", fetchMock)

		const out = await new MdbrainClient().approveProposal({
			operationId: "add:op1",
		})

		expect(out).toEqual(result)
		const [href, init] = fetchMock.mock.calls[0] ?? []
		expect(new URL(String(href)).pathname).toBe(
			"/v1/admin/wiki-promotions/add%3Aop1/approve",
		)
		expect(init?.method).toBe("POST")
	})

	it("surfaces a revoked proposer with its code", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValueOnce(
				Response.json(
					{
						error: {
							code: "PROPOSER_REVOKED",
							message: "principal no longer resolves",
						},
					},
					{ status: 409 },
				),
			),
		)

		await expect(
			new MdbrainClient().approveProposal({ operationId: "add:op1" }),
		).rejects.toMatchObject({
			status: 409,
			envelope: { code: "PROPOSER_REVOKED" },
		})
	})
})

describe("rejectProposal", () => {
	it("posts the reason to the reject route", async () => {
		const result = { ok: true, operationId: "add:op1", state: "rejected" }
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(result))
		vi.stubGlobal("fetch", fetchMock)

		const out = await new MdbrainClient().rejectProposal({
			operationId: "add:op1",
			reason: "duplicates an existing page",
		})

		expect(out).toEqual(result)
		const [href, init] = fetchMock.mock.calls[0] ?? []
		expect(new URL(String(href)).pathname).toBe(
			"/v1/admin/wiki-promotions/add%3Aop1/reject",
		)
		expect(init?.method).toBe("POST")
		expect(JSON.parse(String(init?.body))).toEqual({
			reason: "duplicates an existing page",
		})
	})

	it("sends an empty JSON body when no reason is given", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({ ok: true, operationId: "add:op1", state: "rejected" }),
			)
		vi.stubGlobal("fetch", fetchMock)

		await new MdbrainClient().rejectProposal({ operationId: "add:op1" })

		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({})
	})
})
