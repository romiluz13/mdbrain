// The proxy serves anonymous visitors with its read key, so before it serves
// any read it asks the API what that key may do, and serves only a key that
// reads exactly the configured scope and nothing more. An operator who sets
// the admin, slot, proposer or agent key here gets the not-configured answer
// instead of handing that authority to every visitor.

import type { DemoProxyEnv } from "./proxy.js"

type Verdict = "reader" | "refused" | "unknown"

export type ReadKeyCheck = (
	env: DemoProxyEnv,
	fetchImpl: typeof fetch,
) => Promise<boolean>

const SERVABLE_TIERS = new Set(["restricted", "standard"])

function isExactReader(body: unknown, env: DemoProxyEnv): boolean {
	if (typeof body !== "object" || body === null) {
		return false
	}
	const { trustTier, capabilities, grants } = body as Record<string, unknown>
	if (typeof trustTier !== "string" || !SERVABLE_TIERS.has(trustTier)) {
		return false
	}
	if (
		!Array.isArray(capabilities) ||
		capabilities.length !== 1 ||
		capabilities[0] !== "read"
	) {
		return false
	}
	if (!Array.isArray(grants) || grants.length !== 1) {
		return false
	}
	const grant = grants[0] as { scope?: unknown; scopeRef?: unknown } | null
	return grant?.scope === env.scope && grant?.scopeRef === env.scopeRef
}

async function askApi(
	env: DemoProxyEnv,
	fetchImpl: typeof fetch,
): Promise<Verdict> {
	let body: unknown
	try {
		const response = await fetchImpl(
			new URL(`${env.apiBaseUrl}/v1/principal/self`),
			{
				method: "GET",
				headers: {
					authorization: `Bearer ${env.readKey}`,
					accept: "application/json",
				},
			},
		)
		if (!response.ok) {
			return "unknown"
		}
		body = await response.json()
	} catch {
		return "unknown"
	}
	return isExactReader(body, env) ? "reader" : "refused"
}

/** One check per process: a settled verdict is kept for the env it was asked
 * about; a check that could not finish is not kept, so the next read asks
 * again, and it never passes. */
export function createReadKeyCheck(): ReadKeyCheck {
	let settled: { id: string; reader: boolean } | null = null
	return async (env, fetchImpl) => {
		const id = JSON.stringify([
			env.apiBaseUrl,
			env.readKey,
			env.scope,
			env.scopeRef,
		])
		if (settled?.id === id) {
			return settled.reader
		}
		const verdict = await askApi(env, fetchImpl)
		if (verdict !== "unknown") {
			settled = { id, reader: verdict === "reader" }
		}
		return verdict === "reader"
	}
}
