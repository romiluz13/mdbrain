import type { Context } from "hono"
import type { MemoryScope } from "@mdbrain/lib"
import type { ApiPrincipal } from "./principal.js"

export type AuthorizedRequestScope = {
	agentId?: string
	scope?: MemoryScope
	scopeRef?: string
}

export type ApiEnvironment = {
	Variables: {
		principal: ApiPrincipal
		authorizedRequestScope: AuthorizedRequestScope
	}
}

export function getApiPrincipal(c: Context<ApiEnvironment>): ApiPrincipal {
	return c.get("principal")
}

export function getAuthorizedRequestScope(
	c: Context<ApiEnvironment>,
): AuthorizedRequestScope {
	return c.get("authorizedRequestScope")
}
