import { createHash } from "node:crypto"
import type { ClientSession } from "mongodb"
import { wikiMutationIntentsCollection } from "./wiki-schema.js"
import type { WikiDbHandle } from "./wiki-bridge.js"

export type WikiMutationKind =
	| "create"
	| "update"
	| "soft-delete"
	| "hard-delete"
	| "okf-import"

export type WikiMutationIntent = {
	operationId: string
	kind: WikiMutationKind
	pageSlug: string
	scope: string
	scopeRef: string
	principalSubjectId: string
	payloadFingerprint: string
	state: "recorded"
	createdAt: Date
	updatedAt: Date
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`
	}
	const object = value as Record<string, unknown>
	return `{${Object.keys(object)
		.filter((key) => object[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
		.join(",")}}`
}

export function fingerprintWikiMutationPayload(payload: unknown): string {
	return createHash("sha256").update(canonicalJson(payload)).digest("hex")
}

export async function recordWikiMutationIntent(
	handle: WikiDbHandle,
	params: {
		operationId: string
		kind: WikiMutationKind
		pageSlug: string
		scope: string
		scopeRef: string
		principalSubjectId: string
		payload: unknown
	},
	session?: ClientSession,
): Promise<WikiMutationIntent> {
	const now = new Date()
	const intent: WikiMutationIntent = {
		operationId: params.operationId,
		kind: params.kind,
		pageSlug: params.pageSlug,
		scope: params.scope,
		scopeRef: params.scopeRef,
		principalSubjectId: params.principalSubjectId,
		payloadFingerprint: fingerprintWikiMutationPayload(params.payload),
		state: "recorded",
		createdAt: now,
		updatedAt: now,
	}
	await wikiMutationIntentsCollection(handle.db, handle.prefix).insertOne(
		intent,
		session ? { session } : undefined,
	)
	return intent
}
