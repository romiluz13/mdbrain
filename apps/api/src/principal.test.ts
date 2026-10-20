import { describe, expect, it } from "vitest"
import {
	ALL_PRINCIPAL_CAPABILITIES,
	authorizePrincipalRequest,
	createAdminPrincipal,
	createDevelopmentPrincipal,
	isProposalOnlyPrincipal,
	parseScopedApiKeyPolicies,
	resolveBearerPrincipal,
} from "./principal.js"

describe("server-owned API principals", () => {
	it("derives identity and authority from a scoped API-key policy", () => {
		const [credential] = parseScopedApiKeyPolicies(
			JSON.stringify([
				{
					token: "secret",
					subjectId: "user:alice",
					displayName: "Alice",
					groups: ["idp:engineering"],
					roles: ["editor"],
					departments: ["engineering"],
					trustTier: "standard",
					agentIds: ["codex"],
					scopes: ["workspace"],
					scopeRefs: ["workspace:mdbrain"],
					capabilities: ["read", "write", "export"],
				},
			]),
		)

		expect(credential?.principal).toEqual({
			subjectId: "user:alice",
			displayName: "Alice",
			groups: ["idp:engineering"],
			roles: ["editor"],
			departments: ["engineering"],
			trustTier: "standard",
			allowedAgentIds: ["codex"],
			allowedScopes: [{ scope: "workspace", scopeRef: "workspace:mdbrain" }],
			capabilities: ["read", "write", "export"],
			identityState: "active",
		})
		expect(credential?.principal).not.toHaveProperty("token")
	})

	it("lets request input narrow but never widen principal authority", () => {
		const [credential] = parseScopedApiKeyPolicies(
			JSON.stringify([
				{
					token: "secret",
					subjectId: "user:alice",
					agentIds: ["codex"],
					scopes: ["workspace"],
					scopeRefs: ["workspace:mdbrain"],
					capabilities: ["read"],
				},
			]),
		)
		const principal = credential!.principal

		expect(
			authorizePrincipalRequest(principal, {
				agentId: "codex",
				scope: "workspace",
				scopeRef: "workspace:mdbrain",
				capability: "read",
			}),
		).toBeNull()
		expect(
			authorizePrincipalRequest(principal, {
				agentId: "other",
				scope: "workspace",
				scopeRef: "workspace:mdbrain",
				capability: "read",
			}),
		).toBe("agentId is not allowed for this API key")
		expect(
			authorizePrincipalRequest(principal, {
				agentId: "codex",
				scope: "global",
				scopeRef: "global",
				capability: "read",
			}),
		).toBe("scope is not allowed for this API key")
		expect(
			authorizePrincipalRequest(principal, {
				agentId: "codex",
				scope: "workspace",
				scopeRef: "workspace:mdbrain",
				capability: "administer",
			}),
		).toBe("capability is not allowed for this API key")
	})

	it("fails closed for stale identities and invalid group namespaces", () => {
		const [credential] = parseScopedApiKeyPolicies(
			JSON.stringify([
				{
					token: "secret",
					subjectId: "user:alice",
					active: false,
					scopes: ["workspace"],
				},
			]),
		)
		expect(
			authorizePrincipalRequest(credential!.principal, {
				scope: "workspace",
				scopeRef: "workspace:mdbrain",
				capability: "read",
			}),
		).toBe("identity is not active")

		expect(() =>
			parseScopedApiKeyPolicies(
				JSON.stringify([
					{
						token: "secret",
						subjectId: "user:alice",
						groups: ["engineering"],
						scopes: ["workspace"],
					},
				]),
			),
		).toThrow("groups must use namespaced identifiers")
	})

	it("resolves credentials without accepting request-supplied identity", () => {
		const credentials = parseScopedApiKeyPolicies(
			JSON.stringify([
				{
					token: "scoped-secret",
					subjectId: "user:alice",
					scopes: ["workspace"],
				},
			]),
		)
		const principal = resolveBearerPrincipal({
			bearer: "scoped-secret",
			adminToken: "admin-secret",
			scopedCredentials: credentials,
		})
		expect(principal?.subjectId).toBe("user:alice")

		const admin = resolveBearerPrincipal({
			bearer: "admin-secret",
			adminToken: "admin-secret",
			scopedCredentials: credentials,
		})
		expect(admin).toEqual(createAdminPrincipal())
		expect(admin?.capabilities).toEqual(ALL_PRINCIPAL_CAPABILITIES)
	})

	it("does not include API-key material in configuration errors", () => {
		expect(() =>
			parseScopedApiKeyPolicies(
				JSON.stringify([{ token: "never-print-this-secret" }]),
			),
		).toThrow(
			"MDBRAIN_API_SCOPED_KEYS policy at index 0 must constrain agentIds, scopes, scopeRefs, or grants",
		)
	})

	it("reports the development principal honestly for audit and forensics", () => {
		const principal = createDevelopmentPrincipal()
		expect(principal.subjectId).toBe("development:anonymous")
		expect(principal.trustTier).toBe("development")
		expect(principal.capabilities).toEqual([...ALL_PRINCIPAL_CAPABILITIES])
	})

	it("supports exact pair grants without the Cartesian cross product", () => {
		const [credential] = parseScopedApiKeyPolicies(
			JSON.stringify([
				{
					token: "secret",
					grants: [
						{ scope: "workspace", scopeRef: "ws:a" },
						{ scope: "user", scopeRef: "ws:b" },
					],
				},
			]),
		)
		expect(credential?.principal.allowedScopes).toEqual([
			{ scope: "workspace", scopeRef: "ws:a" },
			{ scope: "user", scopeRef: "ws:b" },
		])
	})

	it("expands scope arrays to the documented Cartesian product", () => {
		const [credential] = parseScopedApiKeyPolicies(
			JSON.stringify([
				{
					token: "secret",
					scopes: ["workspace", "user"],
					scopeRefs: ["ws:a", "ws:b"],
				},
			]),
		)
		expect(credential?.principal.allowedScopes).toEqual([
			{ scope: "workspace", scopeRef: "ws:a" },
			{ scope: "workspace", scopeRef: "ws:b" },
			{ scope: "user", scopeRef: "ws:a" },
			{ scope: "user", scopeRef: "ws:b" },
		])
	})

	it("rejects duplicate tokens across policies", () => {
		expect(() =>
			parseScopedApiKeyPolicies(
				JSON.stringify([
					{ token: "dup-secret", agentIds: ["a"] },
					{ token: "dup-secret", agentIds: ["b"] },
				]),
			),
		).toThrow("MDBRAIN_API_SCOPED_KEYS must use unique tokens")
	})

	it("rejects object-form policies that override the key token", () => {
		expect(() =>
			parseScopedApiKeyPolicies(
				JSON.stringify({
					"real-token": { token: "injected-token", agentIds: ["a"] },
				}),
			),
		).toThrow(
			"MDBRAIN_API_SCOPED_KEYS object-form policy must not contain a token field",
		)
	})
})

describe("proposal-only principals", () => {
	const policy = (capabilities: string[]) =>
		parseScopedApiKeyPolicies(
			JSON.stringify([
				{ token: "secret", scopes: ["workspace"], capabilities },
			]),
		)[0]?.principal as NonNullable<
			ReturnType<typeof parseScopedApiKeyPolicies>[number]
		>["principal"]

	it("accepts propose as a capability and keeps it out of the default grant", () => {
		expect(policy(["read", "propose"]).capabilities).toEqual([
			"read",
			"propose",
		])
		const [defaults] = parseScopedApiKeyPolicies(
			JSON.stringify([{ token: "secret", scopes: ["workspace"] }]),
		)
		expect(defaults?.principal.capabilities).toEqual(["read", "write"])
	})

	it("is proposal-only only with propose and without write", () => {
		expect(isProposalOnlyPrincipal(policy(["read", "propose"]))).toBe(true)
		expect(isProposalOnlyPrincipal(policy(["read", "write", "propose"]))).toBe(
			false,
		)
		expect(isProposalOnlyPrincipal(policy(["read", "write"]))).toBe(false)
		expect(isProposalOnlyPrincipal(policy(["read"]))).toBe(false)
		expect(isProposalOnlyPrincipal(createAdminPrincipal())).toBe(false)
		expect(isProposalOnlyPrincipal(createDevelopmentPrincipal())).toBe(false)
	})

	it("authorizes a proposer for propose but not for write", () => {
		const principal = policy(["read", "propose"])
		const request = { scope: "workspace" }
		expect(
			authorizePrincipalRequest(principal, {
				...request,
				capability: "propose",
			}),
		).toBeNull()
		expect(
			authorizePrincipalRequest(principal, { ...request, capability: "write" }),
		).toBe("capability is not allowed for this API key")
	})
})
