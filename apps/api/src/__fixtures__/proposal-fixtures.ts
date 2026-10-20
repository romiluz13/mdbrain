// Shared fixtures for the proposal runtime tests: one pending proposal as the
// ledger stores it, the principal that submitted it, and its rejected twin.

import {
	fingerprintMemoryDeliveryPayload,
	PROPOSAL_REJECTED_CODE,
	type MemoryDeliveryIntent,
} from "@mdbrain/wiki-engine"
import type { ApiPrincipal } from "../principal.js"

export const page = {
	kind: "concept",
	title: "Silent ETA drift",
	slug: "concepts/silent-eta-drift",
	summary: "ETAs drift silently.",
	body: "ETAs drift without a signal.",
	frontmatter: { type: "concept" },
	claims: [
		{ id: "c1", text: "ETAs drift silently.", confidence: 0.8 },
		{ id: "c2", text: "Nobody is told." },
	],
	scope: "workspace",
	scopeRef: "demo-run-1",
	trustTier: "standard",
}

export function payload(over: Record<string, unknown> = {}) {
	return {
		content: "ETA drift",
		scope: "workspace",
		scopeRef: "demo-run-1",
		promotionPolicy: "wiki",
		wikiPromotion: { page },
		...over,
	}
}

export function intent(
	over: Partial<MemoryDeliveryIntent> = {},
): MemoryDeliveryIntent {
	const body = payload()
	return {
		operationId: "add:op1",
		operation: "add",
		idempotencyKey: "key-1",
		payloadFingerprint: fingerprintMemoryDeliveryPayload(body),
		payload: body,
		principalSubjectId: "demo-proposer-1",
		agentId: "agent-1",
		scope: "workspace",
		scopeRef: "demo-run-1",
		promotionPolicy: "wiki",
		promotionApproval: "required",
		proposalOnly: true,
		state: "promotion-pending",
		attempts: 1,
		reconciliationAttempts: 0,
		promotionAttempts: 0,
		receipt: { eventId: "event-1", chunkCreated: true },
		createdAt: new Date("2026-10-20T10:00:00Z"),
		updatedAt: new Date("2026-10-20T10:00:00Z"),
		...over,
	}
}

export const proposer = (over: Partial<ApiPrincipal> = {}): ApiPrincipal => ({
	subjectId: "demo-proposer-1",
	displayName: "Demo proposer 1",
	groups: [],
	roles: [],
	departments: [],
	trustTier: "standard",
	allowedAgentIds: ["*"],
	allowedScopes: [{ scope: "workspace", scopeRef: "demo-run-1" }],
	capabilities: ["read", "propose"],
	identityState: "active",
	...over,
})

export const rejected = (over: Partial<MemoryDeliveryIntent> = {}) =>
	intent({
		state: "dead-letter",
		lastErrorCode: PROPOSAL_REJECTED_CODE,
		rejectedAt: new Date("2026-10-20T11:00:00Z"),
		rejectedBy: "api-key:admin",
		...over,
	})
