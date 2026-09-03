import { createHash, timingSafeEqual } from "node:crypto"
import type { MemoryScope } from "@mdbrain/lib"

export const ALL_PRINCIPAL_CAPABILITIES = [
	"read",
	"write",
	"write-trusted",
	"administer",
	"change-permissions",
	"hard-delete",
	"export",
	"manage-connectors",
] as const

export type PrincipalCapability = (typeof ALL_PRINCIPAL_CAPABILITIES)[number]
export type PrincipalTrustTier =
	| "restricted"
	| "standard"
	| "admin"
	| "development"
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
const TRUST_TIERS = new Set<string>([
	"restricted",
	"standard",
	"admin",
	"development",
])
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

function parseGrantPairs(
	value: unknown,
	index: number,
): PrincipalScopeGrant[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid grants`,
		)
	}
	return value.map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(
				`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid grants`,
			)
		}
		const grant = entry as Record<string, unknown>
		const scope = optionalString(grant.scope, "grants scope", index)
		const scopeRef = optionalString(grant.scopeRef, "grants scopeRef", index)
		if (scope && scope !== WILDCARD && !MEMORY_SCOPES.has(scope)) {
			throw new Error(
				`MDBRAIN_API_SCOPED_KEYS policy at index ${index} has invalid grants scope`,
			)
		}
		return {
			scope: (scope ?? WILDCARD) as MemoryScope | "*",
			scopeRef: scopeRef ?? WILDCARD,
		}
	})
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
	const grants = parseGrantPairs(item.grants, index)
	if (!agentIds && !scopes && !scopeRefs && !grants) {
		throw new Error(
			`MDBRAIN_API_SCOPED_KEYS policy at index ${index} must constrain agentIds, scopes, scopeRefs, or grants`,
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
	// Scope authority: `scopes: [A, B]` x `scopeRefs: [X, Y]` expands to the
	// FULL Cartesian product (all four pairs) — intending (A,X) and (B,Y)
	// accidentally grants (A,Y) and (B,X). Use `grants: [{scope, scopeRef}]`
	// for exact pair grants when the cross product would over-authorize.
	const cartesianGrants =
		scopes || scopeRefs
			? (scopes ?? [WILDCARD]).flatMap((scope) =>
					(scopeRefs ?? [WILDCARD]).map((scopeRef) => ({
						scope: scope as MemoryScope | "*",
						scopeRef,
					})),
				)
			: []
	const allowedScopes = [...cartesianGrants, ...(grants ?? [])]
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
					([token, policy]) => {
						if (
							policy &&
							typeof policy === "object" &&
							!Array.isArray(policy) &&
							"token" in (policy as Record<string, unknown>)
						) {
							throw new Error(
								"MDBRAIN_API_SCOPED_KEYS object-form policy must not contain a token field",
							)
						}
						return policy &&
							typeof policy === "object" &&
							!Array.isArray(policy)
							? { token, ...(policy as Record<string, unknown>) }
							: { token }
					},
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
		new Set(credentials.map((credential) => credential.token)).size !==
		credentials.length
	) {
		throw new Error("MDBRAIN_API_SCOPED_KEYS must use unique tokens")
	}
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
		// Reported honestly for audit/forensics: this principal is
		// development-only and full-capability, not an ordinary "standard"
		// writer. Governance treats it as admin (it holds every capability).
		trustTier: "development",
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

/** Resolves the CURRENT principal for a subject ID from the given (or
 *  freshly-parsed) credential configuration: scoped API keys, the admin
 *  principal, and the local development principal. Used by background replay
 *  paths (e.g. memory-delivery reconciliation) to re-authorize persisted
 *  intents against the live credential set instead of trusting identity or
 *  trust-tier data captured in the request payload at record time.
 *
 *  Returns null when the subject no longer resolves — key removed, env
 *  changed, or the credential config itself fails to parse. Callers must
 *  treat null as an authorization failure, never as "keep the old tier". */
export function resolvePrincipalBySubjectId(
	subjectId: string,
	options: {
		scopedCredentials?: ScopedApiKeyCredential[]
		adminSubjectId?: string
	} = {},
): ApiPrincipal | null {
	let scoped = options.scopedCredentials
	if (scoped === undefined) {
		try {
			scoped = parseScopedApiKeyPolicies()
		} catch {
			return null
		}
	}
	const admin = createAdminPrincipal(options.adminSubjectId)
	if (admin.subjectId === subjectId) return admin
	const development = createDevelopmentPrincipal()
	if (development.subjectId === subjectId) return development
	return (
		scoped.find((credential) => credential.principal.subjectId === subjectId)
			?.principal ?? null
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
