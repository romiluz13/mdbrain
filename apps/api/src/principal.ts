import { createHash, timingSafeEqual } from "node:crypto"
import type { MemoryScope } from "@mdbrain/lib"

export const ALL_PRINCIPAL_CAPABILITIES = [
	"read",
	"write",
	"administer",
	"change-permissions",
	"hard-delete",
	"export",
	"manage-connectors",
] as const

export type PrincipalCapability = (typeof ALL_PRINCIPAL_CAPABILITIES)[number]
export type PrincipalTrustTier = "restricted" | "standard" | "admin"
export type PrincipalIdentityState = "active" | "stale" | "unknown"
export type PrincipalScopeGrant = {
	scope: MemoryScope | "*"
	scopeRef: string
}

export type ApiPrincipal = {
	subjectId: string
	displayName?: string
	groups: string[]
	roles: string[]
	departments: string[]
	trustTier: PrincipalTrustTier
	allowedAgentIds: string[]
	allowedScopes: PrincipalScopeGrant[]
	capabilities: PrincipalCapability[]
	identityState: PrincipalIdentityState
	identityValidUntil?: string
}

export type ScopedApiKeyCredential = {
	token: string
	principal: ApiPrincipal
}

export type PrincipalRequestAuthority = {
	agentId?: string
	scope?: string
	scopeRef?: string
	capability?: PrincipalCapability
}

const MEMORY_SCOPES = new Set<string>([
	"session",
	"user",
	"agent",
	"workspace",
	"tenant",
	"global",
])
const CAPABILITIES = new Set<string>(ALL_PRINCIPAL_CAPABILITIES)
const TRUST_TIERS = new Set<string>(["restricted", "standard", "admin"])
const WILDCARD = "*"

export function timingSafeBearerEquals(a: string, b: string): boolean {
	if (!a || !b) return false
	const aDigest = createHash("sha256").update(a, "utf8").digest()
	const bDigest = createHash("sha256").update(b, "utf8").digest()
	return timingSafeEqual(aDigest, bDigest) && a.length === b.length
}

function optionalString(
	value: unknown,
	label: string,
	index: number,
): string | undefined {
	if (value === undefined) return undefined
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid ${label}`,
		)
	}
	return value.trim()
}

function stringList(
	value: unknown,
	label: string,
	index: number,
): string[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value)) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid ${label}`,
		)
	}
	const values = value.map((item) => {
		if (typeof item !== "string" || !item.trim()) {
			throw new Error(
				`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid ${label}`,
			)
		}
		return item.trim()
	})
	if (values.length === 0) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has empty ${label}`,
		)
	}
	return [...new Set(values)]
}

function defaultSubjectId(token: string): string {
	const fingerprint = createHash("sha256").update(token, "utf8").digest("hex")
	return `api-key:${fingerprint.slice(0, 16)}`
}

function normalizePolicy(raw: unknown, index: number): ScopedApiKeyCredential {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} must be an object`,
		)
	}
	const item = raw as Record<string, unknown>
	const token = optionalString(item.token, "token", index)
	if (!token) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} requires token`,
		)
	}
	const agentIds = stringList(item.agentIds, "agentIds", index)
	const scopes = stringList(item.scopes, "scopes", index)
	const scopeRefs = stringList(item.scopeRefs, "scopeRefs", index)
	if (!agentIds && !scopes && !scopeRefs) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} must constrain agentIds, scopes, or scopeRefs`,
		)
	}
	for (const scope of scopes ?? []) {
		if (scope !== WILDCARD && !MEMORY_SCOPES.has(scope)) {
			throw new Error(
				`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid scope`,
			)
		}
	}
	const groups = stringList(item.groups, "groups", index) ?? []
	if (groups.some((group) => !group.includes(":"))) {
		throw new Error("groups must use namespaced identifiers")
	}
	const roles = stringList(item.roles, "roles", index) ?? []
	const departments = stringList(item.departments, "departments", index) ?? []
	const trustTier =
		optionalString(item.trustTier, "trustTier", index) ?? "standard"
	if (!TRUST_TIERS.has(trustTier)) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid trustTier`,
		)
	}
	const configuredCapabilities = stringList(
		item.capabilities,
		"capabilities",
		index,
	)
	const capabilities = configuredCapabilities ?? ["read", "write"]
	if (capabilities.some((capability) => !CAPABILITIES.has(capability))) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid capability`,
		)
	}
	const subjectId =
		optionalString(item.subjectId, "subjectId", index) ??
		defaultSubjectId(token)
	const displayName = optionalString(item.displayName, "displayName", index)
	const identityValidUntil = optionalString(
		item.membershipValidUntil,
		"membershipValidUntil",
		index,
	)
	if (identityValidUntil && !Number.isFinite(Date.parse(identityValidUntil))) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid membershipValidUntil`,
		)
	}
	const identityState: PrincipalIdentityState =
		item.active === false ? "stale" : "active"
	const allowedScopes = (scopes ?? [WILDCARD]).flatMap((scope) =>
		(scopeRefs ?? [WILDCARD]).map((scopeRef) => ({
			scope: scope as MemoryScope | "*",
			scopeRef,
		})),
	)
	return {
		token,
		principal: {
			subjectId,
			...(displayName ? { displayName } : {}),
			groups,
			roles,
			departments,
			trustTier: trustTier as PrincipalTrustTier,
			allowedAgentIds: agentIds ?? [WILDCARD],
			allowedScopes,
			capabilities: capabilities as PrincipalCapability[],
			identityState,
			...(identityValidUntil ? { identityValidUntil } : {}),
		},
	}
}

export function parseScopedApiKeyPolicies(
	raw = process.env.MDBRAIN_API_SCOPED_KEYS,
): ScopedApiKeyCredential[] {
	const trimmed = raw?.trim()
	if (!trimmed) return []
	let parsed: unknown
	try {
		parsed = JSON.parse(trimmed) as unknown
	} catch {
		throw new Error("MDBRAIN_API_SCOPED_KEYS must be valid JSON")
	}
	const policies = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object"
			? Object.entries(parsed as Record<string, unknown>).map(
					([token, policy]) =>
						policy && typeof policy === "object" && !Array.isArray(policy)
							? { token, ...(policy as Record<string, unknown>) }
							: { token },
				)
			: undefined
	if (!policies) {
		throw new Error("MDBRAIN_API_SCOPED_KEYS must be a JSON array or object")
	}
	if (policies.length === 0) {
		throw new Error(
			"MDBRAIN_API_SCOPED_KEYS must define at least one scoped API key policy",
		)
	}
	const credentials = policies.map(normalizePolicy)
	if (
		new Set(credentials.map((credential) => credential.principal.subjectId))
			.size !== credentials.length
	) {
		throw new Error(
			"MDBRAIN_API_SCOPED_KEYS must use unique principal subject IDs",
		)
	}
	return credentials
}

export function createAdminPrincipal(
	subjectId = "api-key:admin",
): ApiPrincipal {
	return {
		subjectId,
		displayName: "MDBrain administrator",
		groups: [],
		roles: ["admin"],
		departments: [],
		trustTier: "admin",
		allowedAgentIds: [WILDCARD],
		allowedScopes: [{ scope: WILDCARD, scopeRef: WILDCARD }],
		capabilities: [...ALL_PRINCIPAL_CAPABILITIES],
		identityState: "active",
	}
}

export function createDevelopmentPrincipal(): ApiPrincipal {
	return {
		...createAdminPrincipal("development:anonymous"),
		displayName: "Unauthenticated local development",
		roles: [],
		trustTier: "standard",
	}
}

export function resolveBearerPrincipal(options: {
	bearer: string
	adminToken?: string
	adminSubjectId?: string
	scopedCredentials: ScopedApiKeyCredential[]
}): ApiPrincipal | null {
	if (
		options.adminToken &&
		timingSafeBearerEquals(options.bearer, options.adminToken)
	) {
		return createAdminPrincipal(options.adminSubjectId)
	}
	return (
		options.scopedCredentials.find((credential) =>
			timingSafeBearerEquals(credential.token, options.bearer),
		)?.principal ?? null
	)
}

export function authorizePrincipalRequest(
	principal: ApiPrincipal,
	request: PrincipalRequestAuthority,
	now = new Date(),
): string | null {
	if (
		principal.identityState !== "active" ||
		(principal.identityValidUntil &&
			Date.parse(principal.identityValidUntil) <= now.getTime())
	) {
		return "identity is not active"
	}
	if (!principal.allowedAgentIds.includes(WILDCARD)) {
		if (!request.agentId) return "agentId is required for this API key"
		if (!principal.allowedAgentIds.includes(request.agentId)) {
			return "agentId is not allowed for this API key"
		}
	}
	const restrictsScope = principal.allowedScopes.some(
		(grant) => grant.scope !== WILDCARD,
	)
	const restrictsScopeRef = principal.allowedScopes.some(
		(grant) => grant.scopeRef !== WILDCARD,
	)
	if (restrictsScope && !request.scope) {
		return "scope is required for this API key"
	}
	if (restrictsScopeRef && !request.scopeRef) {
		return "scopeRef is required for this API key"
	}
	if (
		restrictsScope &&
		!principal.allowedScopes.some(
			(grant) => grant.scope === WILDCARD || grant.scope === request.scope,
		)
	) {
		return "scope is not allowed for this API key"
	}
	if (
		restrictsScopeRef &&
		!principal.allowedScopes.some(
			(grant) =>
				grant.scopeRef === WILDCARD || grant.scopeRef === request.scopeRef,
		)
	) {
		return "scopeRef is not allowed for this API key"
	}
	if (
		(restrictsScope || restrictsScopeRef) &&
		!principal.allowedScopes.some(
			(grant) =>
				(grant.scope === WILDCARD || grant.scope === request.scope) &&
				(grant.scopeRef === WILDCARD || grant.scopeRef === request.scopeRef),
		)
	) {
		return "scope and scopeRef are not allowed for this API key"
	}
	if (
		request.capability &&
		!principal.capabilities.includes(request.capability)
	) {
		return "capability is not allowed for this API key"
	}
	return null
}
