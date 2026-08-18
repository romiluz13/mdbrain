import { describe, expect, it } from "vitest"
import {
	ALL_PRINCIPAL_CAPABILITIES,
	authorizePrincipalRequest,
	createAdminPrincipal,
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
			"MDBRAIN_API_SCOPED_KEYS policy at index 0 must constrain agentIds, scopes, or scopeRefs",
		)
	})
})
