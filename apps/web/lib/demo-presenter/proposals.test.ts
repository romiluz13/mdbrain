import { describe, expect, it, vi } from "vitest"
import { MdbrainClientError } from "@mdbrain/client"
import { createProposalService, type ProposalsClient } from "./proposals.js"

const pending = (operationId: string, slug = "syntheses/silent-eta-drift") => ({
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
		slug,
		title: "Silent ETA drift",
		kind: "synthesis",
		summary: "ETAs slip with no notice",
		body: "body text",
		claims: [
			{ id: "c1", text: "one" },
			{ id: "c2", text: "two" },
		],
	},
})

function rig(queue: Record<string, ReturnType<typeof pending>[]>) {
	const client = {
		listProposals: vi.fn(
			async (input: { scope?: string; scopeRef?: string }) => ({
				proposals: queue[input.scopeRef ?? ""] ?? [],
			}),
		),
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
	return { client, service: createProposalService(client) }
}

describe("proposals", () => {
	it("lists the leased scope's pending proposals as a small view", async () => {
		const { service, client } = rig({ "demo-run-13": [pending("op-1")] })
		expect(await service.list("demo-run-13")).toEqual([
			{
				operationId: "op-1",
				title: "Silent ETA drift",
				slug: "syntheses/silent-eta-drift",
				summary: "ETAs slip with no notice",
				claimCount: 2,
				proposedAt: "2026-10-23T12:05:00.000Z",
				proposedBy: "Demo proposer 13",
			},
		])
		expect(client.listProposals).toHaveBeenCalledWith({
			scope: "workspace",
			scopeRef: "demo-run-13",
		})
	})

	it("approves a proposal that is pending in the leased scope", async () => {
		const { service, client } = rig({ "demo-run-13": [pending("op-1")] })
		expect(
			await service.decide("demo-run-13", "op-1", { kind: "approve" }),
		).toEqual({
			state: "promoted",
			pageSlug: "syntheses/silent-eta-drift",
		})
		expect(client.approveProposal).toHaveBeenCalledWith({ operationId: "op-1" })
	})

	it("rejects a pending proposal with a trimmed reason", async () => {
		const { service, client } = rig({ "demo-run-13": [pending("op-1")] })
		expect(
			await service.decide("demo-run-13", "op-1", {
				kind: "reject",
				reason: "  not this quarter  ",
			}),
		).toEqual({ state: "rejected" })
		expect(client.rejectProposal).toHaveBeenCalledWith({
			operationId: "op-1",
			reason: "not this quarter",
		})
	})

	it("never decides a proposal that is not pending in the leased scope, even one that exists in another", async () => {
		const { service, client } = rig({
			"demo-run-13": [pending("op-1")],
			"demo-run-14": [pending("op-other")],
		})
		for (const kind of ["approve", "reject"] as const) {
			await expect(
				service.decide("demo-run-13", "op-other", { kind }),
			).rejects.toMatchObject({ code: "PROPOSAL_NOT_PENDING" })
		}
		expect(client.approveProposal).not.toHaveBeenCalled()
		expect(client.rejectProposal).not.toHaveBeenCalled()
	})

	it("refuses an overlong or control-character reason before asking the API", async () => {
		const { service, client } = rig({ "demo-run-13": [pending("op-1")] })
		for (const reason of ["x".repeat(201), "a\u0000b"]) {
			await expect(
				service.decide("demo-run-13", "op-1", { kind: "reject", reason }),
			).rejects.toMatchObject({ code: "INVALID_REASON" })
		}
		expect(client.rejectProposal).not.toHaveBeenCalled()
	})

	it("reports an unreachable review queue without the transport text", async () => {
		const { service, client } = rig({})
		client.listProposals.mockRejectedValueOnce(
			new Error("connect ECONNREFUSED 127.0.0.1:3857 with key sk-secret"),
		)
		const error = await service.list("demo-run-13").catch((e: unknown) => e)
		expect(error).toMatchObject({ code: "QUEUE_UNREACHABLE" })
		expect(JSON.stringify(error)).not.toContain("sk-secret")
		expect(String((error as Error).message)).not.toContain("sk-secret")
	})

	it("reports a refusal from the API as a fixed message", async () => {
		const { service, client } = rig({ "demo-run-13": [pending("op-1")] })
		client.approveProposal.mockRejectedValueOnce(
			new MdbrainClientError(
				409,
				JSON.stringify({
					error: {
						code: "PROPOSER_REVOKED",
						message: "the proposer was revoked",
					},
				}),
			),
		)
		await expect(
			service.decide("demo-run-13", "op-1", { kind: "approve" }),
		).rejects.toMatchObject({ code: "DECISION_REFUSED" })
	})
})
