export const SCOPES = [
	"session",
	"user",
	"agent",
	"workspace",
	"tenant",
	"global",
] as const

export type Scope = (typeof SCOPES)[number]

export type ConnectionDraft = {
	baseUrl: string
	apiKey: string
	agentId: string
	scope: string
	scopeRef: string
}

/** A validated identity. `id` changes on every connect so a reconnect, even to
 *  the same identity, starts from an empty view. */
export type Connection = {
	id: number
	baseUrl: string
	apiKey: string
	agentId: string
	scope: Scope
	scopeRef: string
}

export type DraftErrors = Partial<Record<keyof ConnectionDraft, string>>

// Exact hosts only: a suffix such as localhost.example.test is a remote name.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function isScope(value: string): value is Scope {
	return (SCOPES as readonly string[]).includes(value)
}

export function validateDraft(
	draft: ConnectionDraft,
	id: number,
): { ok: true; connection: Connection } | { ok: false; errors: DraftErrors } {
	const errors: DraftErrors = {}

	const rawUrl = draft.baseUrl.trim()
	let baseUrl = ""
	if (!rawUrl) {
		errors.baseUrl = "Enter the API base URL."
	} else {
		try {
			const parsed = new URL(rawUrl)
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				errors.baseUrl = "Use an http:// or https:// URL."
			} else if (
				parsed.protocol === "http:" &&
				!LOOPBACK_HOSTS.has(parsed.hostname)
			) {
				errors.baseUrl =
					"Use https:// for remote servers. http:// is only allowed for localhost, 127.0.0.1 and [::1]."
			} else if (parsed.username || parsed.password) {
				errors.baseUrl =
					"Remove credentials from the URL; use the API key field."
			} else {
				baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "")
			}
		} catch {
			errors.baseUrl = "Enter a full URL, for example http://127.0.0.1:3847."
		}
	}

	const agentId = draft.agentId.trim()
	if (!agentId) {
		errors.agentId = "Enter the agent ID."
	}

	const scope = draft.scope.trim()
	if (!scope) {
		errors.scope = "Choose a scope."
	} else if (!isScope(scope)) {
		errors.scope = "Choose one of the listed scopes."
	}

	const scopeRef = draft.scopeRef.trim()
	if (!scopeRef) {
		errors.scopeRef = "Enter the scope reference that goes with the scope."
	}

	if (Object.keys(errors).length > 0 || !isScope(scope)) {
		return { ok: false, errors }
	}
	return {
		ok: true,
		connection: {
			id,
			baseUrl,
			apiKey: draft.apiKey.trim(),
			agentId,
			scope,
			scopeRef,
		},
	}
}
