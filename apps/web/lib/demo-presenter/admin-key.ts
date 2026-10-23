// The presenter's review key is held by the web server and decides proposals
// for the leased slot. Before any presenter action the server asks the API
// what that key may do and serves presenter mode only for a key whose
// capabilities are exactly administer: a key that can also read, write or
// export (the API's own admin key, say) would hand a leaked environment far
// more than the review queue. Same shape as the read key check: a settled
// verdict is kept, a check that could not finish is not and never passes.

export type AdminKeyTarget = { apiBaseUrl: string; adminKey: string }

export type AdminKeyCheck = (
	target: AdminKeyTarget,
	fetchImpl: typeof fetch,
) => Promise<boolean>

const CHECK_TIMEOUT_MS = 5_000

type Verdict = "administer-only" | "refused" | "unknown"

// D29: the API ties a decision to the operation's own scope (347), so a key
// granted exact slots can decide nothing else; a wildcard grant could.
function exactGrantsOnly(grants: unknown): boolean {
	return (
		Array.isArray(grants) &&
		grants.length > 0 &&
		grants.every((grant) => {
			const { scope, scopeRef } = (grant ?? {}) as {
				scope?: unknown
				scopeRef?: unknown
			}
			return (
				typeof scope === "string" &&
				typeof scopeRef === "string" &&
				scope.length > 0 &&
				scopeRef.length > 0 &&
				scope !== "*" &&
				scopeRef !== "*"
			)
		})
	)
}

async function askApi(
	target: AdminKeyTarget,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<Verdict> {
	let body: unknown
	try {
		const response = await fetchImpl(
			new URL(`${target.apiBaseUrl}/v1/principal/self`),
			{
				method: "GET",
				headers: {
					authorization: `Bearer ${target.adminKey}`,
					accept: "application/json",
				},
				signal: AbortSignal.timeout(timeoutMs),
			},
		)
		if (!response.ok) return "unknown"
		body = await response.json()
	} catch {
		return "unknown"
	}
	const { capabilities, grants } =
		typeof body === "object" && body !== null
			? (body as { capabilities?: unknown; grants?: unknown })
			: { capabilities: undefined, grants: undefined }
	return Array.isArray(capabilities) &&
		capabilities.length === 1 &&
		capabilities[0] === "administer" &&
		exactGrantsOnly(grants)
		? "administer-only"
		: "refused"
}

export function createAdminKeyCheck(
	options: { timeoutMs?: number } = {},
): AdminKeyCheck {
	const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS
	const settled = new Map<string, boolean>()
	const asking = new Map<string, Promise<boolean>>()
	return async (target, fetchImpl) => {
		const id = JSON.stringify([target.apiBaseUrl, target.adminKey])
		const known = settled.get(id)
		if (known !== undefined) return known
		const pending = asking.get(id)
		if (pending) return pending
		const check = askApi(target, fetchImpl, timeoutMs).then((verdict) => {
			if (verdict !== "unknown") settled.set(id, verdict === "administer-only")
			return verdict === "administer-only"
		})
		asking.set(id, check)
		try {
			return await check
		} finally {
			asking.delete(id)
		}
	}
}
