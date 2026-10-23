// The presenter's review queue for the leased slot: list what its product
// agent proposed, approve it or reject it. The administer-capable key stays on
// this server and the scope comes from the lease, never from the browser. An
// operation id is decided only if it is pending in the leased scope, so a
// presenter cannot decide a proposal that belongs to another slot, which the
// shared admin key could otherwise reach.

import type { MdbrainClient } from "@mdbrain/client"

export type ProposalsClient = Pick<
	MdbrainClient,
	"listProposals" | "approveProposal" | "rejectProposal"
>

export type ProposalView = {
	operationId: string
	title: string
	slug: string
	summary: string
	claimCount: number
	proposedAt: string
	proposedBy: string
}

export class ProposalError extends Error {
	name = "ProposalError"
	constructor(
		readonly code:
			| "PROPOSAL_NOT_PENDING"
			| "INVALID_REASON"
			| "QUEUE_UNREACHABLE"
			| "DECISION_REFUSED",
		message: string,
	) {
		super(message)
	}
}

export type Decision = { kind: "approve" } | { kind: "reject"; reason?: string }

export const REASON_MAX = 200
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function createProposalService(client: ProposalsClient) {
	async function list(scopeRef: string): Promise<ProposalView[]> {
		try {
			const { proposals } = await client.listProposals({
				scope: "workspace",
				scopeRef,
			})
			return proposals.map((proposal) => ({
				operationId: proposal.operationId,
				title: proposal.page.title,
				slug: proposal.page.slug,
				summary: proposal.page.summary,
				claimCount: proposal.page.claims.length,
				proposedAt: proposal.proposedAt,
				proposedBy:
					proposal.proposer.displayName ?? proposal.proposer.subjectId,
			}))
		} catch {
			throw new ProposalError(
				"QUEUE_UNREACHABLE",
				"The review queue could not be read.",
			)
		}
	}

	return {
		list,
		async decide(
			scopeRef: string,
			operationId: string,
			decision: Decision,
		): Promise<
			{ state: "promoted"; pageSlug: string } | { state: "rejected" }
		> {
			const reason =
				decision.kind === "reject" ? decision.reason?.trim() : undefined
			if (
				reason !== undefined &&
				(reason.length > REASON_MAX || CONTROL_CHARACTERS.test(reason))
			) {
				throw new ProposalError(
					"INVALID_REASON",
					`a reason is up to ${REASON_MAX} characters with no control characters`,
				)
			}
			const queue = await list(scopeRef)
			if (!queue.some((proposal) => proposal.operationId === operationId)) {
				throw new ProposalError(
					"PROPOSAL_NOT_PENDING",
					"that proposal is not pending in your slot",
				)
			}
			try {
				if (decision.kind === "approve") {
					const done = await client.approveProposal({ operationId })
					return { state: "promoted", pageSlug: done.pageSlug }
				}
				await client.rejectProposal({
					operationId,
					...(reason ? { reason } : {}),
				})
				return { state: "rejected" }
			} catch {
				throw new ProposalError(
					"DECISION_REFUSED",
					"The API did not accept the decision.",
				)
			}
		},
	}
}

export type ProposalService = ReturnType<typeof createProposalService>
